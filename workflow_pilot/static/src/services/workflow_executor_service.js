/** @odoo-module **/

/**
 * Workflow Executor Service
 *
 * Phase 3 Architecture:
 * - Uses workflowAdapter service for config resolution
 * - NO direct _node access
 * - Clean separation between execution and Core layer
 *
 * Config Resolution Flow:
 *   executor._executeNode() → adapterService.getNodeConfig(nodeId) → Core layer
 */

import { registry } from "@web/core/registry";
import { WorkflowGraph } from "../utils/graph_utils";

export const workflowExecutorService = {
    dependencies: ["workflowNode", "workflowAdapter"],

    start(env, { workflowNode, workflowAdapter }) {
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
                return nodeOutputs.get(nodeId) || null;
            },

            /**
             * Check if a node has been executed
             */
            hasExecuted(nodeId) {
                return nodeOutputs.has(nodeId);
            },

            /**
             * Clear all execution results
             */
            clearResults() {
                nodeOutputs.clear();
            },

            /**
             * Get execution order using topological sort
             * @param {Object} workflow - { nodes: [], connections: [] }
             * @returns {Array<string>} Ordered array of node IDs
             */
            getExecutionOrder(workflow) {
                const wg = WorkflowGraph.fromNodes(
                    workflow.nodes,
                    workflow.connections
                );

                // Use Kahn's algorithm for topological sort
                const graph = wg.graph;
                const inDegree = {};
                const order = [];
                const queue = [];

                // Initialize in-degrees
                for (const nodeId of graph.nodes()) {
                    const preds = graph.predecessors(nodeId) || [];
                    inDegree[nodeId] = preds.length;
                    if (preds.length === 0) {
                        queue.push(nodeId);
                    }
                }

                // Process queue
                while (queue.length > 0) {
                    const nodeId = queue.shift();
                    order.push(nodeId);

                    const successors = graph.successors(nodeId) || [];
                    for (const succ of successors) {
                        inDegree[succ]--;
                        if (inDegree[succ] === 0) {
                            queue.push(succ);
                        }
                    }
                }

                return order;
            },

            /**
             * Get all ancestor nodes (nodes that should execute before given node)
             * @param {Object} workflow - { nodes: [], connections: [] }
             * @param {string} nodeId - Target node ID
             * @returns {Array<string>} Ancestor node IDs in execution order
             */
            getAncestors(workflow, nodeId) {
                const order = this.getExecutionOrder(workflow);
                const targetIndex = order.indexOf(nodeId);
                if (targetIndex <= 0) return [];
                return order.slice(0, targetIndex);
            },

            /**
             * Build aggregated context for a node
             * Includes output from all ancestor nodes
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
                    const output = nodeOutputs.get(ancestorId);

                    if (node && output) {
                        const nodeId = node.id;
                        const nodeTitle = node.title;
                        context.$node[nodeId] = {
                            title: nodeTitle,
                            json: output.json || output,
                            meta: output.meta || {},
                        };
                    }
                }

                // $json = immediate previous node output
                if (ancestors.length > 0) {
                    const prevId = ancestors[ancestors.length - 1];
                    const prevOutput = nodeOutputs.get(prevId);
                    context.$json = prevOutput?.json || prevOutput || {};
                }

                return context;
            },

            /**
             * Execute workflow up to (and including) target node
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

                // Clear previous results to ensure fresh execution
                nodeOutputs.clear();

                try {
                    const order = this.getExecutionOrder(workflow);
                    const targetIndex = order.indexOf(targetNodeId);

                    if (targetIndex === -1) {
                        throw new Error(`Node ${targetNodeId} not found in workflow`);
                    }

                    // Execute nodes up to and including target
                    for (let i = 0; i <= targetIndex; i++) {
                        const nodeId = order[i];

                        // Skip if already executed
                        if (nodeOutputs.has(nodeId)) {
                            continue;
                        }

                        // Build context for this node
                        const context = this.buildContextForNode(workflow, nodeId);

                        // Execute node
                        const result = await this._executeNode(workflow, nodeId, context);

                        // Store result
                        nodeOutputs.set(nodeId, result);

                        // Callback
                        onNodeComplete?.(nodeId, result);
                    }

                    return nodeOutputs;
                } finally {
                    isExecuting = false;
                }
            },

            /**
             * Execute a single node
             * @private
             *
             * Phase 3 Config Resolution:
             * - Uses workflowAdapter.getNodeConfig() as primary source
             * - Falls back to nodeData.config for legacy compatibility
             * - NO direct _node access
             */
            async _executeNode(workflow, nodeId, context) {
                const nodeData = workflow.nodes.find(n => n.id === nodeId);
                if (!nodeData) {
                    return { json: null, error: `Node ${nodeId} not found`, meta: {} };
                }

                const startTime = Date.now();

                try {
                    // Get node class from service
                    const NodeClass = workflowNode.getNodeClass(nodeData.type);
                    if (!NodeClass) {
                        return {
                            json: null,
                            error: `Unknown node type: ${nodeData.type}`,
                            meta: {}
                        };
                    }

                    // Create instance and configure
                    const instance = new NodeClass();

                    // Phase 3: Config resolution via adapterService
                    // Primary: workflowAdapter.getNodeConfig() (reads from Core layer)
                    // Fallback: nodeData.config (for legacy/test scenarios)
                    const config = workflowAdapter.getNodeConfig(nodeId) || {};
                    const hasConfig = Object.keys(config).length > 0;

                    if (hasConfig) {
                        instance.setConfig(config);
                        console.log(`[Executor] Node ${nodeId} config from adapter:`, config);
                    } else if (nodeData.config) {
                        // Fallback for legacy format
                        instance.setConfig(nodeData.config);
                        console.log(`[Executor] Node ${nodeId} config from nodeData (legacy):`, nodeData.config);
                    }

                    // Execute with context
                    const inputData = context.$json || {};
                    const output = await instance.execute(inputData);

                    return {
                        json: output,
                        error: null,
                        meta: {
                            duration: Date.now() - startTime,
                            executedAt: new Date().toISOString(),
                        }
                    };
                } catch (error) {
                    console.error(`[WorkflowExecutor] Node ${nodeId} error:`, error);
                    return {
                        json: null,
                        error: error.message || String(error),
                        meta: {
                            duration: Date.now() - startTime,
                            executedAt: new Date().toISOString(),
                        }
                    };
                }
            },

            /**
             * Get execution state
             */
            isExecuting() {
                return isExecuting;
            },

            /**
             * Get all stored results
             */
            getAllResults() {
                return new Map(nodeOutputs);
            },
        };
    },
};

// Register service
registry.category("services").add("workflowExecutor", workflowExecutorService);
