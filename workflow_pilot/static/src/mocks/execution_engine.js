/** @odoo-module **/

/**
 * MockExecutionEngine - Frontend mock for workflow execution
 *
 * This mock will be replaced by backend Python engine in production.
 * Maintains same interface for seamless migration.
 *
 * BACKEND MIGRATION:
 * ──────────────────
 * 1. Create Python WorkflowEngine class (models/workflow_engine.py)
 * 2. Create RPC endpoints:
 *    - POST /workflow/execute { workflow_json, target_node_id, context }
 *    - POST /workflow/execute_node { node_json, context }
 * 3. Replace mock calls with jsonrpc calls in services
 *
 * INTERFACE CONTRACT:
 * ───────────────────
 * executeUntil(workflow, targetNodeId, options) → Promise<ExecutionContext>
 * executeNode(node, context) → Promise<NodeOutput>
 * getContext() → ExecutionContext
 * isExecuting() → boolean
 */

import { ExecutionContext } from '../core/context';
import { resolveExpression, evaluateExpression, hasExpressions } from '../utils/expression_utils';

export class MockExecutionEngine {
    constructor() {
        this.context = null;
        this._isExecuting = false;
        this._nodeExecutors = new Map();
    }

    /**
     * Inject an existing ExecutionContext.
     * Useful when another service owns the context lifecycle (e.g., workflowVariable).
     * @param {ExecutionContext} context
     */
    setContext(context) {
        this.context = context;
    }

    /**
     * Register a node executor
     * @param {string} nodeType - Node type identifier
     * @param {Function} executor - async (config, context) => output
     */
    registerNodeExecutor(nodeType, executor) {
        this._nodeExecutors.set(nodeType, executor);
    }

    /**
     * Execute workflow up to target node
     *
     * @param {Object} workflow - { nodes: [], connections: [] }
     * @param {string} targetNodeId - Stop after this node
     * @param {Object} options - { onNodeStart, onNodeComplete, onError, initialVars }
     * @returns {Promise<ExecutionContext>}
     *
     * Backend equivalent:
     *   POST /workflow/execute
     *   Body: { workflow_json, target_node_id, initial_context }
     *   Response: { context, outputs, error }
     */
    async executeUntil(workflow, targetNodeId, options = {}) {
        if (this._isExecuting) {
            throw new Error('Execution already in progress');
        }

        // Allow caller to inject a real ExecutionContext (e.g., from workflowVariable service)
        this.context = options.context || new ExecutionContext();
        this._isExecuting = true;

        // Initialize variables if provided
        if (options.initialVars) {
            for (const [key, value] of Object.entries(options.initialVars)) {
                this.context.setVariable(key, value);
            }
        }

        try {
            const executionOrder = this._topologicalSort(workflow);
            const targetIndex = executionOrder.indexOf(targetNodeId);

            if (targetIndex === -1) {
                    throw new Error(`Target node not found: ${targetNodeId}`);
            }

            for (let i = 0; i <= targetIndex; i++) {
                const nodeId = executionOrder[i];
                const node = workflow.nodes.find(n => n.id === nodeId);

                if (!node) {
                    console.warn(`[MockEngine] Node not found: ${nodeId}`);
                    continue;
                }

                options.onNodeStart?.(nodeId, node);

                let result;
                if (node.type === 'loop') {
                    result = await this._executeLoop(node, workflow, options);
                } else {
                    result = await this._executeNode(node, options);
                }

                this.context.setNodeOutput(nodeId, result);
                options.onNodeComplete?.(nodeId, result);
            }

            return this.context;
        } catch (error) {
            console.error('[MockEngine] Execution error:', error);
            options.onError?.(error);
            throw error;
        } finally {
            this._isExecuting = false;
        }
    }

    /**
     * Execute a single node
     *
     * @param {Object} node - Node definition
     * @param {Object} options - Execution options
     * @returns {Promise<*>} Node output
     */
    async _executeNode(node, options = {}) {
        const expressionContext = this.context.toExpressionContext();

        // Resolve expressions in config before executing
        const resolvedConfig = this._resolveConfigExpressions(
            node.config || {},
            expressionContext
        );

        // Preferred: per-node runner (lets a service own how nodes execute)
        if (typeof options.nodeRunner === 'function') {
            try {
                const result = await options.nodeRunner(node, resolvedConfig, expressionContext, this.context);
                // Normalize: allow runner to return either NodeOutput-like or raw json
                if (result && typeof result === 'object' && Object.prototype.hasOwnProperty.call(result, 'json')) {
                    return result;
                }
                return {
                    json: result,
                    meta: {
                        executedAt: new Date().toISOString(),
                    },
                };
            } catch (error) {
                return {
                    json: null,
                    error: error?.message || String(error),
                    meta: {
                        executedAt: new Date().toISOString(),
                    },
                };
            }
        }

        // Legacy: type-based executor registry
        const executor = this._nodeExecutors.get(node.type);
        if (!executor) {
            console.warn(`[MockEngine] No executor for type: ${node.type}`);
            return { _mock: true, _type: node.type, _message: 'No executor registered' };
        }

        try {
            const startTime = Date.now();
            const output = await executor(resolvedConfig, expressionContext, this.context);

            return {
                json: output,
                meta: {
                    duration: Date.now() - startTime,
                    executedAt: new Date().toISOString(),
                }
            };
        } catch (error) {
            return {
                json: null,
                error: error.message,
                meta: {
                    executedAt: new Date().toISOString(),
                }
            };
        }
    }

    /**
     * Execute loop node with iteration context
     *
     * @param {Object} loopNode - Loop node definition
     * @param {Object} workflow - Full workflow
     * @param {Object} options - Execution options
     */
    async _executeLoop(loopNode, workflow, options = {}) {
        const expressionContext = this.context.toExpressionContext();

        // Resolve collection expression
        const collectionExpr = loopNode.config?.collection || '[]';
        const collection = this._resolveExpression(collectionExpr, expressionContext);

        if (!Array.isArray(collection)) {
            throw new Error(`Loop collection must be array, got: ${typeof collection}`);
        }

        // Get loop body nodes (nodes connected after loop)
        const loopBodyNodeIds = this._getLoopBodyNodes(loopNode.id, workflow);
        const accumulatedResults = [];

        // Push loop context
        this.context.pushLoop(collection);

        // Iterate through collection
        do {
            const loopContext = this.context.$loop;
            options.onLoopIteration?.(loopNode.id, loopContext.index, loopContext.item);

            // Execute each body node
            for (const bodyNodeId of loopBodyNodeIds) {
                const bodyNode = workflow.nodes.find(n => n.id === bodyNodeId);
                if (bodyNode) {
                    const result = await this._executeNode(bodyNode, options);
                    this.context.setNodeOutput(bodyNodeId, result);
                }
            }

            // Collect iteration result if accumulator enabled
            if (loopNode.config?.accumulate) {
                const lastBodyNodeId = loopBodyNodeIds[loopBodyNodeIds.length - 1];
                const iterationResult = this.context.getNodeOutput(lastBodyNodeId);
                accumulatedResults.push(iterationResult?.json);
            }

        } while (this.context.advanceLoop());

        // Pop loop context
        this.context.popLoop();

        return {
            json: accumulatedResults,
            meta: {
                iterations: collection.length,
                executedAt: new Date().toISOString(),
            }
        };
    }

    /**
     * Topological sort for execution order (Kahn's algorithm)
     * @private
     */
    _topologicalSort(workflow) {
        const { nodes, connections } = workflow;
        const inDegree = {};
        const adjacency = {};

        // Initialize
        for (const node of nodes) {
            inDegree[node.id] = 0;
            adjacency[node.id] = [];
        }

        // Build graph
        for (const conn of connections) {
            adjacency[conn.source].push(conn.target);
            inDegree[conn.target]++;
        }

        // Find nodes with no incoming edges
        const queue = nodes
            .filter(n => inDegree[n.id] === 0)
            .map(n => n.id);

        const order = [];

        while (queue.length > 0) {
            const nodeId = queue.shift();
            order.push(nodeId);

            for (const successor of adjacency[nodeId]) {
                inDegree[successor]--;
                if (inDegree[successor] === 0) {
                    queue.push(successor);
                }
            }
        }

        return order;
    }

    /**
     * Get nodes that are part of loop body
     * @private
     */
    _getLoopBodyNodes(loopNodeId, workflow) {
        // Simple implementation: get direct successors of loop node
        // In future, could support explicit loop body markers
        return workflow.connections
            .filter(c => c.source === loopNodeId)
            .map(c => c.target);
    }

    /**
     * Resolve expressions in config object
     * @private
     */
    _resolveConfigExpressions(config, context) {
        const resolved = {};

        for (const [key, value] of Object.entries(config)) {
            if (typeof value === 'string' && value.includes('{{')) {
                resolved[key] = this._resolveExpression(value, context);
            } else if (typeof value === 'object' && value !== null) {
                resolved[key] = this._resolveConfigExpressions(value, context);
            } else {
                resolved[key] = value;
            }
        }

        return resolved;
    }

    /**
     * Resolve single expression string
     * @private
     */
    _resolveExpression(expr, context) {
        if (typeof expr !== 'string') return expr;
        if (!hasExpressions(expr)) return expr;

        // Use expression_utils for full namespace support
        const result = evaluateExpression(expr, context);
        return result.error ? expr : result.value;
    }

    /**
     * Resolve dot-notation path on object
     * @private
     */
    _resolvePath(obj, path) {
        if (!obj || !path) return obj;

        const parts = path.split('.');
        let current = obj;

        for (const part of parts) {
            if (current === null || current === undefined) return undefined;

            // Handle array index: items[0]
            const arrayMatch = part.match(/^(\w+)\[(\d+)\]$/);
            if (arrayMatch) {
                current = current[arrayMatch[1]]?.[parseInt(arrayMatch[2])];
            } else {
                current = current[part];
            }
        }

        return current;
    }

    /**
     * Check if execution is in progress
     */
    isExecuting() {
        return this._isExecuting;
    }

    /**
     * Get current execution context
     */
    getContext() {
        return this.context;
    }

    /**
     * Clear execution state
     */
    reset() {
        this.context = null;
        this._isExecuting = false;
    }
}

// Singleton instance
export const mockExecutionEngine = new MockExecutionEngine();
