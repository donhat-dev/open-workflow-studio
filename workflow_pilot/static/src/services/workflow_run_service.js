/** @odoo-module **/

/**
 * Workflow Run Service
 *
 * Orchestrates user-initiated workflow/node execution.
 * Inspired by n8n's useRunWorkflow composable pattern.
 *
 * Separates execution orchestration from UI components, allowing
 * execution to be triggered from:
 * - NodeConfigPanel (existing)
 * - Canvas toolbar
 * - Keyboard shortcuts
 * - Context menu
 *
 * Usage:
 *   const runService = useService("workflowRun");
 *   
 *   // Execute up to specific node
 *   await runService.runUntilNode(workflow, nodeId, options);
 *   
 *   // Execute entire workflow (full flow)
 *   await runService.runEntireWorkflow(workflow, options);
 *   
 *   // Execute single node
 *   await runService.runNode(nodeId, inputData);
 */

import { registry } from "@web/core/registry";

export const workflowRunService = {
    dependencies: ["workflowExecutor", "workflowAdapter", "workflowVariable"],

    start(env, { workflowExecutor, workflowAdapter, workflowVariable }) {
        // Current execution state
        let executionState = {
            status: 'idle',  // 'idle' | 'running' | 'success' | 'error'
            nodeId: null,
            startTime: null,
            result: null,
            error: null,
        };

        // Event listeners for execution updates
        const listeners = new Set();

        /**
         * Notify all listeners of state change
         */
        function notifyListeners() {
            listeners.forEach(fn => fn(executionState));
        }

        /**
         * Update execution state and notify
         */
        function setState(patch) {
            executionState = { ...executionState, ...patch };
            notifyListeners();
        }

        return {
            /**
             * Execute workflow up to a specific node
             * 
             * @param {Object} workflow - Workflow data { nodes, connections }
             * @param {string} destinationNodeId - Node to execute up to
             * @param {Object} options
             * @param {boolean} options.syncConfig - Sync config before execution
             * @param {Object} options.controlValues - Control values to sync
             * @param {Function} options.onProgress - Called after each node executes
             * @returns {Promise<{output, error, meta}>}
             */
            async runUntilNode(workflow, destinationNodeId, options = {}) {
                if (executionState.status === 'running') {
                    console.warn('[workflowRun] Execution already in progress');
                    return null;
                }

                setState({
                    status: 'running',
                    nodeId: destinationNodeId,
                    startTime: Date.now(),
                    result: null,
                    error: null,
                });

                try {
                    // 1. Sync config if requested
                    if (options.syncConfig && options.controlValues) {
                        workflowAdapter.setNodeConfig(destinationNodeId, options.controlValues);
                        console.log('[workflowRun] Config synced for node:', destinationNodeId);
                    }

                    // 2. Execute via executor service
                    await workflowExecutor.executeUntil(
                        workflow,
                        destinationNodeId,
                        (executedNodeId, nodeResult) => {
                            console.log(`[workflowRun] Node ${executedNodeId} executed`);
                            options.onProgress?.(executedNodeId, nodeResult);
                        }
                    );

                    // 3. Get result
                    const result = workflowExecutor.getNodeOutput(destinationNodeId);

                    setState({
                        status: 'success',
                        result: result ? {
                            output: result.json,
                            error: result.error,
                            meta: result.meta,
                        } : null,
                    });

                    // 4. Snapshot expression context
                    const expressionContext = workflowAdapter.getExpressionContext?.() || null;

                    return {
                        ...executionState.result,
                        expressionContext,
                    };

                } catch (err) {
                    console.error('[workflowRun] Execution error:', err);

                    setState({
                        status: 'error',
                        error: err.message,
                        result: {
                            output: null,
                            error: err.message,
                            meta: { executedAt: new Date().toISOString() },
                        },
                    });

                    return executionState.result;
                }
            },

            /**
             * Execute single node without workflow context (fallback)
             * 
             * @param {string} nodeId
             * @param {Object} inputData
             * @returns {Promise<{json, error, meta}>}
             */
            async runNode(nodeId, inputData = {}) {
                if (executionState.status === 'running') {
                    console.warn('[workflowRun] Execution already in progress');
                    return null;
                }

                setState({
                    status: 'running',
                    nodeId,
                    startTime: Date.now(),
                    result: null,
                    error: null,
                });

                try {
                    const result = await workflowAdapter.executeNode(nodeId, inputData);

                    setState({
                        status: 'success',
                        result: {
                            output: result.json,
                            error: result.error,
                            meta: result.meta,
                        },
                    });

                    return executionState.result;

                } catch (err) {
                    console.error('[workflowRun] Node execution error:', err);

                    setState({
                        status: 'error',
                        error: err.message,
                        result: {
                            output: null,
                            error: err.message,
                            meta: { executedAt: new Date().toISOString() },
                        },
                    });

                    return executionState.result;
                }
            },

            /**
             * Execute entire workflow (full flow)
             * Finds trigger/start nodes and executes all paths to completion
             * 
             * @param {Object} workflow - Workflow data { nodes, connections }
             * @param {Object} options
             * @param {Function} options.onProgress - Called after each node executes
             * @param {Function} options.onNodeStart - Called before each node executes
             * @param {boolean} options.stopOnError - Stop execution on first error (default: true)
             * @returns {Promise<{results: Object, errors: Array, executedNodes: Array}>}
             */
            async runEntireWorkflow(workflow, options = {}) {
                if (executionState.status === 'running') {
                    console.warn('[workflowRun] Execution already in progress');
                    return null;
                }

                const { stopOnError = true } = options;

                setState({
                    status: 'running',
                    nodeId: null,  // Full workflow, no single target
                    startTime: Date.now(),
                    result: null,
                    error: null,
                });

                const results = {};
                const errors = [];
                const executedNodes = [];

                try {
                    console.log('[workflowRun] Starting entire workflow execution');

                    // Execute full workflow via executor
                    await workflowExecutor.executeAll(
                        workflow,
                        (executedNodeId, nodeResult) => {
                            console.log(`[workflowRun] Node ${executedNodeId} executed`);
                            results[executedNodeId] = nodeResult;
                            executedNodes.push(executedNodeId);

                            if (nodeResult?.error) {
                                errors.push({ nodeId: executedNodeId, error: nodeResult.error });
                                if (stopOnError) {
                                    throw new Error(`Node ${executedNodeId} failed: ${nodeResult.error}`);
                                }
                            }

                            options.onProgress?.(executedNodeId, nodeResult);
                        }
                    );

                    const finalResult = {
                        results,
                        errors,
                        executedNodes,
                        expressionContext: workflowAdapter.getExpressionContext?.() || null,
                    };

                    setState({
                        status: errors.length > 0 ? 'error' : 'success',
                        result: finalResult,
                        error: errors.length > 0 ? errors[0].error : null,
                    });

                    console.log(`[workflowRun] Workflow completed. Executed ${executedNodes.length} nodes, ${errors.length} errors`);

                    return finalResult;

                } catch (err) {
                    console.error('[workflowRun] Workflow execution error:', err);

                    const finalResult = {
                        results,
                        errors: [...errors, { nodeId: null, error: err.message }],
                        executedNodes,
                    };

                    setState({
                        status: 'error',
                        error: err.message,
                        result: finalResult,
                    });

                    return finalResult;
                }
            },

            /**
             * Get current execution state
             * @returns {Object}
             */
            getState() {
                return { ...executionState };
            },

            /**
             * Check if currently executing
             * @returns {boolean}
             */
            get isExecuting() {
                return executionState.status === 'running';
            },

            /**
             * Subscribe to execution state changes
             * @param {Function} callback
             * @returns {Function} Unsubscribe function
             */
            subscribe(callback) {
                listeners.add(callback);
                return () => listeners.delete(callback);
            },

            /**
             * Reset execution state
             */
            reset() {
                setState({
                    status: 'idle',
                    nodeId: null,
                    startTime: null,
                    result: null,
                    error: null,
                });
            },
        };
    },
};

// Register service
registry.category("services").add("workflowRun", workflowRunService);
