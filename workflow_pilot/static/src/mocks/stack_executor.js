/** @odoo-module **/

/**
 * StackExecutor - Stack-Based Workflow Execution Engine
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This execution engine follows n8n's Stack-Based State Machine pattern.
 * See: docs/plans/ADR/001-execution-engine.md
 *
 * ARCHITECTURE:
 * ─────────────
 * Unlike traditional DAG (Directed Acyclic Graph) algorithms like topological
 * sort, this engine uses a stack-based approach that:
 * - Dynamically determines execution order based on data flow
 * - Handles cyclic graphs (loops with back-edges)
 * - Enables data-driven routing (If/Switch nodes)
 * - Supports multi-output nodes
 *
 * Based on n8n's WorkflowExecute pattern:
 * https://github.com/n8n-io/n8n/blob/master/packages/core/src/WorkflowExecute.ts
 *
 * KEY CONCEPT - Data-Driven Routing:
 * ───────────────────────────────────
 * The engine is completely GENERIC - it doesn't know about If/Switch/Loop
 * semantics. All routing logic is embedded in node outputs:
 *
 *   - Each node returns outputs[][] (2D array)
 *   - First dimension = output socket index
 *   - Second dimension = array of items for that socket
 *   - Empty array [] = skip that branch (children not pushed)
 *
 * Example If Node:
 *   Condition TRUE:  outputs = [[inputData], []]   → true branch executes
 *   Condition FALSE: outputs = [[], [inputData]]   → false branch executes
 *
 * MAIN LOOP:
 * ──────────
 * 1. Push start node(s) to executionStack
 * 2. While stack not empty AND target not reached:
 *    a. Pop {nodeId, inputData} from stack
 *    b. Execute node → get outputs[][]
 *    c. Store result in nodeOutputs Map
 *    d. For each output socket with data:
 *       - Find connected nodes
 *       - Push them to stack with data
 *    e. Next iteration
 * 3. Return ExecutionContext with all results
 *
 * OUTPUT FORMAT (See ADR-002):
 * ────────────────────────────
 * All nodes MUST return:
 * {
 *   outputs: [
 *     [item1, item2],  // Socket 0 items
 *     [item3],         // Socket 1 items
 *   ],
 *   json: any,         // Convenience: first item
 *   meta: { duration, executedAt, ... }
 * }
 *
 * INTERFACE:
 * ──────────
 * executeUntil(workflow, targetNodeId, options) → Promise<ExecutionContext>
 * getNodeOutput(nodeId) → NodeOutput
 * getNodeContext(nodeId) → any  (for loops)
 * isExecuting() → boolean
 * reset() → void
 */

import { ExecutionContext } from '../core/context';
import { evaluateExpression, hasExpressions } from '../utils/expression_utils';
import { NodeHelpers } from '../core/node_helpers';

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
            const startNodeIds = this._findStartNodes(workflow, targetNodeId);

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
                // Create NodeHelpers for n8n-style context injection
                const helpers = new NodeHelpers({
                    inputData,
                    nodeContext: this.state.nodeContext,
                    nodeId: node.id,
                    config: resolvedConfig,
                    expressionContext,
                    node,
                });

                const result = await options.nodeRunner(
                    node,
                    resolvedConfig,
                    expressionContext,
                    this.context,
                    helpers  // Pass helpers to node
                );
                return this._normalizeResult(result, startTime);
            }

            // Handle special node types
            // NOTE: 'loop' is now handled by LoopNode.execute() with NodeHelpers
            switch (node.type) {
                case 'if':
                    return await this._executeIfNode(node, inputData, expressionContext, startTime);

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
        return Object.keys(node.outputs);
    }

    /**
     * Find start nodes (no incoming connections) that lead to targetNodeId
     * If targetNodeId is provided, only returns start nodes that have a path to it
     *
     * @private
     * @param {Object} workflow
     * @param {string|null} targetNodeId - Optional target to filter start nodes
     * @returns {string[]}
     */
    _findStartNodes(workflow, targetNodeId = null) {
        const nodesWithIncoming = new Set(
            workflow.connections.map(c => c.target)
        );

        // Get all start nodes (nodes with no incoming connections)
        let startNodes = workflow.nodes
            .filter(n => !nodesWithIncoming.has(n.id))
            .sort((a, b) => (a.y - b.y) || (a.x - b.x))
            .map(n => n.id);

        // If no targetNodeId, return all start nodes
        if (!targetNodeId) {
            return startNodes;
        }

        // Find all ancestors of targetNodeId (nodes that lead to it)
        const ancestorIds = this._getNodeAncestors(workflow, targetNodeId);
        ancestorIds.add(targetNodeId);  // Include target itself

        // Filter start nodes to only those that are in the ancestor chain
        const filteredStartNodes = startNodes.filter(startId =>
            ancestorIds.has(startId) || this._hasPathToNode(workflow, startId, targetNodeId)
        );

        // If no filtered start nodes found, fall back to all start nodes
        // (edge case: targetNodeId might be a start node itself)
        if (filteredStartNodes.length === 0) {
            // Check if target itself is a start node
            if (startNodes.includes(targetNodeId)) {
                return [targetNodeId];
            }
            return startNodes;
        }

        return filteredStartNodes;
    }

    /**
     * Get all ancestor node IDs of a target node (BFS backwards traversal)
     * 
     * @private
     * @param {Object} workflow
     * @param {string} targetNodeId
     * @returns {Set<string>}
     */
    _getNodeAncestors(workflow, targetNodeId) {
        const ancestors = new Set();
        const visited = new Set();
        const queue = [targetNodeId];

        // Build reverse adjacency list (target -> sources)
        const reverseAdj = {};
        for (const conn of workflow.connections) {
            if (!reverseAdj[conn.target]) {
                reverseAdj[conn.target] = [];
            }
            reverseAdj[conn.target].push(conn.source);
        }

        // BFS backwards from target
        while (queue.length > 0) {
            const current = queue.shift();
            const parents = reverseAdj[current] || [];

            for (const parent of parents) {
                if (!visited.has(parent)) {
                    visited.add(parent);
                    ancestors.add(parent);
                    queue.push(parent);
                }
            }
        }

        return ancestors;
    }

    /**
     * Check if there's a path from sourceNodeId to targetNodeId
     * 
     * @private
     * @param {Object} workflow
     * @param {string} sourceNodeId
     * @param {string} targetNodeId
     * @returns {boolean}
     */
    _hasPathToNode(workflow, sourceNodeId, targetNodeId) {
        const visited = new Set();
        const queue = [sourceNodeId];

        // Build forward adjacency list (source -> targets)
        const forwardAdj = {};
        for (const conn of workflow.connections) {
            if (!forwardAdj[conn.source]) {
                forwardAdj[conn.source] = [];
            }
            forwardAdj[conn.source].push(conn.target);
        }

        // BFS forward from source
        while (queue.length > 0) {
            const current = queue.shift();

            if (current === targetNodeId) {
                return true;
            }

            if (visited.has(current)) continue;
            visited.add(current);

            const children = forwardAdj[current] || [];
            for (const child of children) {
                if (!visited.has(child)) {
                    queue.push(child);
                }
            }
        }

        return false;
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
