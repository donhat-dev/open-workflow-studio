/** @odoo-module **/

/**
 * StackExecutor - Stack-Based Workflow Execution Engine
 *
 * Replaces topological sort with dynamic stack-based execution.
 * This approach correctly handles:
 * - Cyclic graphs (loops with back-edges)
 * - Branch routing (IF/Switch nodes)
 * - Multi-output nodes
 *
 * Based on n8n's WorkflowExecute pattern.
 *
 * KEY CONCEPT:
 * ────────────
 * 1. Push start node to stack
 * 2. Pop node, execute it
 * 3. Based on outputs[][], push child nodes to stack
 * 4. Empty output = skip that branch (children not pushed)
 * 5. Repeat until stack empty or target reached
 *
 * INTERFACE:
 * ──────────
 * executeUntil(workflow, targetNodeId, options) → Promise<ExecutionContext>
 * getNodeOutput(nodeId) → NodeOutput
 * isExecuting() → boolean
 */

import { ExecutionContext } from '../core/context';
import { evaluateExpression, hasExpressions } from '../utils/expression_utils';

/**
 * ExecutionState - Internal state for a single execution run
 */
class ExecutionState {
    constructor() {
        /** @type {Array<{nodeId: string, inputData: any}>} Nodes waiting to be executed */
        this.executionStack = [];

        /** @type {Map<string, NodeOutput>} Results from executed nodes */
        this.nodeOutputs = new Map();

        /** @type {Map<string, any>} Persistent context per node (e.g., loop counters) */
        this.nodeContext = new Map();

        /** @type {Map<string, Map<number, any>>} Nodes waiting for multiple inputs */
        this.waitingExecution = new Map();

        /** @type {Set<string>} Nodes that have been executed in this run */
        this.executedNodes = new Set();

        /** @type {number} Safety counter for infinite loop detection */
        this.iterationCount = 0;

        /** @type {number} Maximum iterations before throwing error */
        this.maxIterations = 1000;
    }
}

/**
 * @typedef {Object} NodeOutput
 * @property {Array<Array<any>>} outputs - Array per output socket. Empty array = skip.
 * @property {any} json - Convenience access to first output data
 * @property {string} [branch] - For IF nodes: 'true' or 'false'
 * @property {string} [error] - Error message if execution failed
 * @property {Object} [meta] - Metadata (duration, executedAt, etc.)
 */

export class StackExecutor {
    constructor() {
        /** @type {ExecutionState|null} */
        this.state = null;

        /** @type {ExecutionContext|null} */
        this.context = null;

        /** @type {boolean} */
        this._isExecuting = false;
    }

    /**
     * Execute workflow until target node is reached
     *
     * @param {Object} workflow - { nodes: Node[], connections: Connection[] }
     * @param {string} targetNodeId - Stop after this node executes
     * @param {Object} options - Execution options
     * @param {ExecutionContext} [options.context] - Existing context to use
     * @param {Function} [options.nodeRunner] - Custom node execution function
     * @param {Function} [options.onNodeStart] - Callback before node executes
     * @param {Function} [options.onNodeComplete] - Callback after node executes
     * @param {Function} [options.onError] - Callback on error
     * @param {any} [options.initialData] - Initial input data for start node
     * @returns {Promise<ExecutionContext>}
     */
    async executeUntil(workflow, targetNodeId, options = {}) {
        if (this._isExecuting) {
            throw new Error('Execution already in progress');
        }

        this._isExecuting = true;
        this.state = new ExecutionState();
        this.context = options.context || new ExecutionContext();

        try {
            // Find start node(s) - nodes with no incoming connections
            const startNodeIds = this._findStartNodes(workflow);

            if (startNodeIds.length === 0) {
                throw new Error('No start node found (node with no incoming connections)');
            }

            // Push start nodes to stack
            for (const startNodeId of startNodeIds) {
                this.state.executionStack.push({
                    nodeId: startNodeId,
                    inputData: options.initialData || {}
                });
            }

            // Process stack until empty or target reached
            while (this.state.executionStack.length > 0) {
                // Safety check for infinite loops
                if (++this.state.iterationCount > this.state.maxIterations) {
                    throw new Error(`Max iterations (${this.state.maxIterations}) exceeded - possible infinite loop`);
                }

                const { nodeId, inputData } = this.state.executionStack.pop();
                const node = workflow.nodes.find(n => n.id === nodeId);

                if (!node) {
                    console.warn(`[StackExecutor] Node not found: ${nodeId}`);
                    continue;
                }

                // Callback: node starting
                options.onNodeStart?.(nodeId, node);

                // Set current input data for expression context
                this.context.setCurrentInput(inputData);

                // Execute the node
                const result = await this._executeNode(node, inputData, workflow, options);

                // Store result
                this.state.nodeOutputs.set(nodeId, result);
                this.state.executedNodes.add(nodeId);

                // Update ExecutionContext
                this.context.setNodeOutput(nodeId, result);

                // Callback: node completed
                options.onNodeComplete?.(nodeId, result);

                // Check if target reached
                if (nodeId === targetNodeId) {
                    console.log(`[StackExecutor] Target node reached: ${targetNodeId}`);
                    break;
                }

                // Route outputs to child nodes
                this._routeOutputs(node, result, workflow);
            }

            return this.context;

        } catch (error) {
            console.error('[StackExecutor] Execution error:', error);
            options.onError?.(error);
            throw error;

        } finally {
            this._isExecuting = false;
        }
    }

    /**
     * Execute a single node
     *
     * @private
     * @param {Object} node - Node to execute
     * @param {any} inputData - Input data for the node
     * @param {Object} workflow - Full workflow
     * @param {Object} options - Execution options
     * @returns {Promise<NodeOutput>}
     */
    async _executeNode(node, inputData, workflow, options) {
        const startTime = Date.now();
        const expressionContext = this.context.toExpressionContext();

        // Resolve expressions in node config
        const resolvedConfig = this._resolveConfigExpressions(
            node.config || {},
            expressionContext
        );

        try {
            // Use custom nodeRunner if provided
            if (typeof options.nodeRunner === 'function') {
                const result = await options.nodeRunner(
                    node,
                    resolvedConfig,
                    expressionContext,
                    this.context
                );
                return this._normalizeResult(result, startTime);
            }

            // Handle special node types
            switch (node.type) {
                case 'if':
                    return await this._executeIfNode(node, inputData, expressionContext, startTime);

                case 'loop':
                    return await this._executeLoopNode(node, inputData, expressionContext, startTime);

                default:
                    // Default: pass through with single output
                    return {
                        outputs: [[inputData]],
                        json: inputData,
                        meta: {
                            duration: Date.now() - startTime,
                            executedAt: new Date().toISOString()
                        }
                    };
            }

        } catch (error) {
            return {
                outputs: [],
                json: null,
                error: error.message || String(error),
                meta: {
                    duration: Date.now() - startTime,
                    executedAt: new Date().toISOString()
                }
            };
        }
    }

    /**
     * Execute IF node - returns outputs based on condition
     *
     * @private
     */
    async _executeIfNode(node, inputData, expressionContext, startTime) {
        const config = node.config || {};
        const operator = config.operator || 'eq';

        // Resolve operands
        let left = config.leftOperand || '';
        if (hasExpressions(left)) {
            const result = evaluateExpression(left, expressionContext);
            left = result.error ? left : result.value;
        }

        let right = config.rightOperand || '';
        if (hasExpressions(right)) {
            const result = evaluateExpression(right, expressionContext);
            right = result.error ? right : result.value;
        }

        // Parse numbers if applicable
        if (!isNaN(left) && !isNaN(right) && left !== '' && right !== '') {
            left = parseFloat(left);
            right = parseFloat(right);
        }

        // Evaluate condition
        let conditionResult = false;
        switch (operator) {
            case 'eq': conditionResult = left == right; break;
            case 'neq': conditionResult = left != right; break;
            case 'gt': conditionResult = left > right; break;
            case 'gte': conditionResult = left >= right; break;
            case 'lt': conditionResult = left < right; break;
            case 'lte': conditionResult = left <= right; break;
            case 'contains': conditionResult = String(left).includes(String(right)); break;
            case 'startsWith': conditionResult = String(left).startsWith(String(right)); break;
            case 'endsWith': conditionResult = String(left).endsWith(String(right)); break;
            case 'empty':
                conditionResult = left === '' || left === null || left === undefined ||
                    (Array.isArray(left) && left.length === 0);
                break;
            case 'notEmpty':
                conditionResult = !(left === '' || left === null || left === undefined ||
                    (Array.isArray(left) && left.length === 0));
                break;
            case 'truthy': conditionResult = Boolean(left); break;
            case 'falsy': conditionResult = !left; break;
            default: conditionResult = false;
        }

        // Return outputs based on condition
        // outputs[0] = true branch, outputs[1] = false branch
        const outputs = conditionResult
            ? [[inputData], []]   // TRUE: data to first output, nothing to second
            : [[], [inputData]];  // FALSE: nothing to first, data to second

        return {
            outputs,
            json: inputData,
            branch: conditionResult ? 'true' : 'false',
            meta: {
                duration: Date.now() - startTime,
                executedAt: new Date().toISOString(),
                condition: { left, operator, right, result: conditionResult }
            }
        };
    }

    /**
     * Execute LOOP node - handles iteration state
     *
     * @private
     */
    async _executeLoopNode(node, inputData, expressionContext, startTime) {
        const config = node.config || {};

        // Get or initialize loop context for this node
        let loopCtx = this.state.nodeContext.get(node.id);

        if (!loopCtx) {
            // First execution: resolve collection
            let collection = [];

            const collectionExpr = config.collection || '';
            if (collectionExpr && hasExpressions(collectionExpr)) {
                const result = evaluateExpression(collectionExpr, expressionContext);
                collection = result.error ? [] : result.value;
            } else if (inputData) {
                collection = Array.isArray(inputData)
                    ? inputData
                    : (inputData.items || inputData.data || []);
            }

            if (!Array.isArray(collection)) {
                collection = collection ? [collection] : [];
            }

            loopCtx = {
                currentIndex: 0,
                items: collection,
                maxIndex: collection.length
            };
        }

        // Get current item
        const currentItem = loopCtx.items[loopCtx.currentIndex];

        // Update ExecutionContext's $loop
        this.context.pushLoop(loopCtx.items);
        // Advance to current index
        for (let i = 0; i < loopCtx.currentIndex; i++) {
            this.context.advanceLoop();
        }

        // Prepare for next iteration
        loopCtx.currentIndex++;
        this.state.nodeContext.set(node.id, loopCtx);

        // Decide which output to use
        if (loopCtx.currentIndex < loopCtx.maxIndex) {
            // More items remain → output to "loop" (index 0)
            return {
                outputs: [[currentItem], []],
                json: currentItem,
                meta: {
                    duration: Date.now() - startTime,
                    executedAt: new Date().toISOString(),
                    iteration: loopCtx.currentIndex,
                    total: loopCtx.maxIndex
                }
            };
        } else {
            // Last item → output to "done" (index 1)
            // Reset for potential re-execution
            this.state.nodeContext.delete(node.id);
            this.context.popLoop();

            return {
                outputs: [[], [currentItem]],
                json: currentItem,
                meta: {
                    duration: Date.now() - startTime,
                    executedAt: new Date().toISOString(),
                    iterations: loopCtx.maxIndex,
                    completed: true
                }
            };
        }
    }

    /**
     * Route node outputs to child nodes
     *
     * @private
     * @param {Object} node - Node that just executed
     * @param {NodeOutput} result - Execution result
     * @param {Object} workflow - Full workflow
     */
    _routeOutputs(node, result, workflow) {
        const outputs = result.outputs || [[result.json]];
        const outputSockets = this._getOutputSockets(node);

        for (let outputIndex = 0; outputIndex < outputs.length; outputIndex++) {
            const outputData = outputs[outputIndex];

            // KEY MECHANISM: Empty array = skip this output socket
            if (!outputData || outputData.length === 0) {
                continue;
            }

            // Get socket name for this index
            const socketName = outputSockets[outputIndex] || 'output';

            // Find connections from this output socket
            // For loop/if nodes: match exact socket name
            // For other nodes: also match generic 'output'/'result' or undefined
            const connections = workflow.connections.filter(c => {
                if (c.source !== node.id) return false;

                // Exact match
                if (c.sourceHandle === socketName) return true;

                // For non-flow-control nodes, also match generic handles
                if (node.type !== 'loop' && node.type !== 'if' && node.type !== 'switch') {
                    return c.sourceHandle === undefined ||
                           c.sourceHandle === 'output' ||
                           c.sourceHandle === 'result';
                }

                return false;
            });

            // Push child nodes to stack with data
            for (const conn of connections) {
                this.state.executionStack.push({
                    nodeId: conn.target,
                    inputData: outputData[0]  // Use first item of output data
                });
            }
        }
    }

    /**
     * Get output socket names for node type
     *
     * @private
     * @param {Object} node
     * @returns {string[]}
     */
    _getOutputSockets(node) {
        switch (node.type) {
            case 'if':
                return ['true', 'false'];
            case 'loop':
                return ['loop', 'done'];
            case 'switch':
                return ['case0', 'case1', 'case2', 'case3', 'default'];
            default:
                return ['output', 'result'];
        }
    }

    /**
     * Find start nodes (no incoming connections)
     *
     * @private
     * @param {Object} workflow
     * @returns {string[]}
     */
    _findStartNodes(workflow) {
        const nodesWithIncoming = new Set(
            workflow.connections.map(c => c.target)
        );

        return workflow.nodes
            .filter(n => !nodesWithIncoming.has(n.id))
            .map(n => n.id);
    }

    /**
     * Resolve expressions in config object
     *
     * @private
     */
    _resolveConfigExpressions(config, context) {
        const resolved = {};

        for (const [key, value] of Object.entries(config)) {
            if (typeof value === 'string' && hasExpressions(value)) {
                const result = evaluateExpression(value, context);
                resolved[key] = result.error ? value : result.value;
            } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                resolved[key] = this._resolveConfigExpressions(value, context);
            } else {
                resolved[key] = value;
            }
        }

        return resolved;
    }

    /**
     * Normalize result to standard NodeOutput format
     *
     * @private
     */
    _normalizeResult(result, startTime) {
        if (!result) {
            return {
                outputs: [[]],
                json: null,
                meta: { executedAt: new Date().toISOString() }
            };
        }

        // Already has outputs array
        if (Array.isArray(result.outputs)) {
            return {
                ...result,
                json: result.json || result.outputs[0]?.[0],
                meta: {
                    ...result.meta,
                    duration: Date.now() - startTime,
                    executedAt: new Date().toISOString()
                }
            };
        }

        // Has json property
        if (result.json !== undefined) {
            return {
                outputs: [[result.json]],
                json: result.json,
                branch: result.branch,
                error: result.error,
                meta: {
                    ...result.meta,
                    duration: Date.now() - startTime,
                    executedAt: new Date().toISOString()
                }
            };
        }

        // Raw result
        return {
            outputs: [[result]],
            json: result,
            meta: {
                duration: Date.now() - startTime,
                executedAt: new Date().toISOString()
            }
        };
    }

    // ============================================
    // PUBLIC API
    // ============================================

    /**
     * Get output for a specific node
     *
     * @param {string} nodeId
     * @returns {NodeOutput|undefined}
     */
    getNodeOutput(nodeId) {
        return this.state?.nodeOutputs.get(nodeId);
    }

    /**
     * Check if execution is in progress
     *
     * @returns {boolean}
     */
    isExecuting() {
        return this._isExecuting;
    }

    /**
     * Get current execution context
     *
     * @returns {ExecutionContext|null}
     */
    getContext() {
        return this.context;
    }

    /**
     * Get node-specific persistent context
     *
     * @param {string} nodeId
     * @returns {any}
     */
    getNodeContext(nodeId) {
        return this.state?.nodeContext.get(nodeId);
    }

    /**
     * Set node-specific persistent context
     *
     * @param {string} nodeId
     * @param {any} context
     */
    setNodeContext(nodeId, context) {
        if (this.state) {
            if (context === null || context === undefined) {
                this.state.nodeContext.delete(nodeId);
            } else {
                this.state.nodeContext.set(nodeId, context);
            }
        }
    }

    /**
     * Reset executor state
     */
    reset() {
        this.state = null;
        this.context = null;
        this._isExecuting = false;
    }
}

// Export singleton instance for convenience
export const stackExecutor = new StackExecutor();
