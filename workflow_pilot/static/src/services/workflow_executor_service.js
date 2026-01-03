/** @odoo-module **/

/**
 * Workflow Executor Service
 *
 * Uses Stack-Based Execution (like n8n) for proper handling of:
 * - Cyclic graphs (loops with back-edges)
 * - Branch routing (IF/Switch nodes)
 * - Multi-output nodes
 *
 * Config Resolution Flow:
 *   executor._executeNode() → adapterService.getNodeConfig(nodeId) → Core layer
 */

import { registry } from "@web/core/registry";
import { StackExecutor } from "../mocks/stack_executor";

export const workflowExecutorService = {
    dependencies: ["workflowNode", "workflowAdapter", "workflowVariable"],

    start(env, { workflowNode, workflowAdapter, workflowVariable }) {
        // Create StackExecutor instance
        const executor = new StackExecutor();

        // Store outputs per node: nodeId → { json, meta, error }
        let nodeOutputs = new Map();

        // Execution state
        let isExecuting = false;
        let currentWorkflow = null;

        return {
            /**
             * Get stored output for a node
             */
            getNodeOutput(nodeId) {
                // First check our local map
                const localResult = nodeOutputs.get(nodeId);
                if (localResult) return localResult;

                // Then check executor's state
                return executor.getNodeOutput(nodeId) || null;
            },

            /**
             * Check if a node has been executed
             */
            hasExecuted(nodeId) {
                return nodeOutputs.has(nodeId) || !!executor.getNodeOutput(nodeId);
            },

            /**
             * Clear all execution results
             */
            clearResults() {
                nodeOutputs.clear();
                executor.reset();
            },

            /**
             * Get all ancestor nodes (nodes that should execute before given node)
             * Uses BFS traversal on reverse graph
             *
             * @param {Object} workflow - { nodes: [], connections: [] }
             * @param {string} nodeId - Target node ID
             * @returns {Array<string>} Ancestor node IDs
             */
            getAncestors(workflow, nodeId) {
                const ancestors = [];
                const visited = new Set();
                const queue = [nodeId];

                // Build reverse adjacency list
                const reverseAdj = {};
                for (const conn of workflow.connections) {
                    if (!reverseAdj[conn.target]) {
                        reverseAdj[conn.target] = [];
                    }
                    reverseAdj[conn.target].push(conn.source);
                }

                // BFS backwards
                while (queue.length > 0) {
                    const current = queue.shift();
                    const parents = reverseAdj[current] || [];

                    for (const parent of parents) {
                        if (!visited.has(parent)) {
                            visited.add(parent);
                            ancestors.push(parent);
                            queue.push(parent);
                        }
                    }
                }

                return ancestors;
            },

            /**
             * Build aggregated context for a node
             * Includes output from all ancestor nodes
             *
             * @param {Object} workflow - { nodes: [], connections: [] }
             * @param {string} nodeId - Target node ID
             * @returns {Object} { $node: {NodeName: {json}}, $json: {...} }
             */
            buildContextForNode(workflow, nodeId) {
                const ancestors = this.getAncestors(workflow, nodeId);

                const context = {
                    $node: {},
                    $json: {},
                };

                for (const ancestorId of ancestors) {
                    const node = workflow.nodes.find(n => n.id === ancestorId);
                    const output = nodeOutputs.get(ancestorId) || executor.getNodeOutput(ancestorId);

                    if (node && output) {
                        context.$node[ancestorId] = {
                            title: node.title,
                            json: output.json || output,
                            meta: output.meta || {},
                        };
                    }
                }

                // $json = immediate previous node output (last connected parent)
                const immediateParents = workflow.connections
                    .filter(c => c.target === nodeId)
                    .map(c => c.source);

                if (immediateParents.length > 0) {
                    const prevId = immediateParents[0];
                    const prevOutput = nodeOutputs.get(prevId) || executor.getNodeOutput(prevId);
                    context.$json = prevOutput?.json || prevOutput || {};
                }

                return context;
            },

            /**
             * Execute workflow up to (and including) target node
             * Uses Stack-Based execution for proper cycle and branch handling.
             *
             * @param {Object} workflow - { nodes: [], connections: [] }
             * @param {string} targetNodeId - Stop after this node
             * @param {Function} onNodeComplete - Callback(nodeId, result)
             * @returns {Promise<Map>} nodeOutputs map
             */
            async executeUntil(workflow, targetNodeId, onNodeComplete = null) {
                if (isExecuting) {
                    throw new Error("Workflow execution already in progress");
                }

                isExecuting = true;
                currentWorkflow = workflow;

                // Clear previous results
                nodeOutputs.clear();
                executor.reset();

                // Create fresh execution context
                const execContext = workflowVariable.createContext(workflow?.id || null);

                // Create workflow view with resolved config
                const workflowWithConfig = {
                    ...workflow,
                    nodes: (workflow.nodes || []).map((n) => ({
                        ...n,
                        config: workflowAdapter.getNodeConfig(n.id) || n.config || {},
                    })),
                };

                try {
                    // Use StackExecutor for proper cycle and branch handling
                    await executor.executeUntil(workflowWithConfig, targetNodeId, {
                        context: execContext,

                        // Custom node runner that uses workflowNode service
                        nodeRunner: async (node, resolvedConfig, exprCtx, context) => {
                            const nodeId = node.id;
                            const startTime = Date.now();

                            try {
                                const NodeClass = workflowNode.getNodeClass(node.type);
                                if (!NodeClass) {
                                    return {
                                        outputs: [],
                                        json: null,
                                        error: `Unknown node type: ${node.type}`,
                                        meta: {},
                                    };
                                }

                                const instance = new NodeClass();
                                instance.setConfig(resolvedConfig || {});

                                // Get input data from context
                                const inputData = context?.$json || {};

                                // Execute node - new signature supports executionContext
                                const output = await instance.execute(inputData, exprCtx, context);

                                // Normalize output to stack-compatible format
                                return {
                                    outputs: output.outputs || [[output.json || output]],
                                    json: output.json || output,
                                    branch: output.branch,
                                    error: null,
                                    meta: {
                                        duration: Date.now() - startTime,
                                        executedAt: new Date().toISOString(),
                                        ...output.meta,
                                    },
                                };
                            } catch (error) {
                                console.error(`[WorkflowExecutor] Node ${nodeId} error:`, error);
                                return {
                                    outputs: [],
                                    json: null,
                                    error: error?.message || String(error),
                                    meta: {
                                        duration: Date.now() - startTime,
                                        executedAt: new Date().toISOString(),
                                    },
                                };
                            }
                        },

                        onNodeStart: (nodeId, node) => {
                            console.log(`[WorkflowExecutor] Starting: ${nodeId} (${node.type})`);
                        },

                        onNodeComplete: (nodeId, result) => {
                            nodeOutputs.set(nodeId, result);
                            console.log(`[WorkflowExecutor] Completed: ${nodeId}`, result);
                            onNodeComplete?.(nodeId, result);
                        },

                        onError: (error) => {
                            console.error(`[WorkflowExecutor] Execution error:`, error);
                        },
                    });

                    return nodeOutputs;
                } finally {
                    isExecuting = false;
                }
            },

            /**
             * Get execution state
             */
            isExecuting() {
                return isExecuting || executor.isExecuting();
            },

            /**
             * Get all stored results
             */
            getAllResults() {
                return new Map(nodeOutputs);
            },

            /**
             * Get the underlying executor (for advanced usage)
             */
            getExecutor() {
                return executor;
            },
        };
    },
};

// Register service
registry.category("services").add("workflowExecutor", workflowExecutorService);
