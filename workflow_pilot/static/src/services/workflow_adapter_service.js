/** @odoo-module **/

/**
 * Workflow Adapter Service
 *
 * Odoo service wrapper for WorkflowAdapter.
 * Provides dependency injection for components that need adapter access.
 *
 * Usage in components:
 *   this.adapterService = useService("workflowAdapter");
 *   this.adapterService.setAdapter(adapter);
 *   this.adapterService.getNodeConfig(nodeId);
 *   
 *   // Variable operations via adapter:
 *   this.adapterService.getExpressionContext();
 *   this.adapterService.setVariable('result', []);
 */

import { registry } from "@web/core/registry";

export const workflowAdapterService = {
    dependencies: ["workflowVariable", "rpc"],

    start(env, { workflowVariable, rpc }) {
        // Current adapter instance (set by app component)
        let currentAdapter = null;
        let _versionHash = null;
        let _workflowId = null;

        return {
            /**
             * Set the adapter instance (called by app component)
             * @param {WorkflowAdapter} adapter
             */
            setAdapter(adapter) {
                currentAdapter = adapter;
            },

            /**
             * Get current adapter (internal use)
             * @private
             */
            _getAdapter() {
                if (!currentAdapter) {
                    console.warn('[AdapterService] No adapter set');
                }
                return currentAdapter;
            },

            // ============================================
            // CONFIG MANAGEMENT (Proxy to Adapter)
            // ============================================

            /**
             * Get node configuration
             * @param {string} nodeId
             * @returns {Object}
             */
            getNodeConfig(nodeId) {
                return currentAdapter.getNodeConfig(nodeId);
            },

            /**
             * Set node configuration
             * @param {string} nodeId
             * @param {Object} config
             * @returns {boolean}
             */
            setNodeConfig(nodeId, config) {
                return currentAdapter.setNodeConfig(nodeId, config);
            },

            /**
             * Get node controls metadata
             * @param {string} nodeId
             * @returns {Array}
             */
            getNodeControls(nodeId) {
                return currentAdapter.getNodeControls(nodeId);
            },

            /**
             * Get node meta (UI/runtime metadata)
             * @param {string} nodeId
             * @returns {Object}
             */
            getNodeMeta(nodeId) {
                return currentAdapter.getNodeMeta(nodeId);
            },

            /**
             * Update node meta (shallow merge + meta.ui merge)
             * @param {string} nodeId
             * @param {Object} metaPatch
             * @returns {boolean}
             */
            setNodeMeta(nodeId, metaPatch) {
                return currentAdapter.setNodeMeta(nodeId, metaPatch);
            },

            /**
             * Update a single control value
             * @param {string} nodeId
             * @param {string} controlKey
             * @param {*} value
             * @returns {boolean}
             */
            setControlValue(nodeId, controlKey, value) {
                return currentAdapter.setControlValue(nodeId, controlKey, value);
            },

            // ============================================
            // GRAPH MUTATIONS (Proxy to Adapter)
            // ============================================

            /**
             * Update node position
             * @param {string} nodeId
             * @param {{x: number, y: number}} position
             */
            updatePosition(nodeId, position) {
                return currentAdapter.updatePosition(nodeId, position);
            },

            /**
             * Remove node
             * @param {string} nodeId
             */
            removeNode(nodeId) {
                return currentAdapter.removeNode(nodeId);
            },

            /**
             * Add node
             * @param {string} type
             * @param {{x: number, y: number}} position
             * @returns {string|null} nodeId
             */
            addNode(type, position) {
                return currentAdapter.addNode(type, position);
            },

            /**
             * Add node with fixed ID (for undo/redo)
             * @param {string} type
             * @param {{x: number, y: number}} position
             * @param {string} forcedId
             * @param {Object} [config]
             * @returns {string|null} nodeId
             */
            addNodeWithId(type, position, forcedId, config) {
                return currentAdapter.addNodeWithId(type, position, forcedId, config);
            },

            /**
             * Add connection
             * @param {string} source
             * @param {string} sourceHandle
             * @param {string} target
             * @param {string} targetHandle
             * @returns {Object|null} connection
             */
            addConnection(source, sourceHandle, target, targetHandle) {
                return currentAdapter.addConnection(source, sourceHandle, target, targetHandle);
            },

            /**
             * Remove connection
             * @param {string} connectionId
             */
            removeConnection(connectionId) {
                return currentAdapter.removeConnection(connectionId);
            },

            /**
             * Get reactive state from adapter
             * @returns {Object} { nodes, connections }
             */
            get state() {
                if (!currentAdapter) {
                    return { nodes: [], connections: [] };
                }
                return currentAdapter.state;
            },

            /**
             * Execute a single node with context
             * Automatically uses current execution context from workflowVariable service
             * @param {string} nodeId
             * @param {Object} inputData
             * @returns {Promise}
             */
            async executeNode(nodeId, inputData = {}) {
                if (!currentAdapter) {
                    return { json: null, error: 'No adapter', meta: {} };
                }

                // Get current ExecutionContext from variable service
                // This is the actual context instance (with methods), not just the plain object
                let context = workflowVariable.getContext();

                // Auto-create context if not exists
                if (!context) {
                    context = workflowVariable.createContext();
                }

                // Execute node with full ExecutionContext
                const result = await currentAdapter.executeNode(nodeId, inputData, context);

                return result;
            },

            /**
             * Load workflow from database via RPC
             * @param {number} workflowId
             * @returns {Promise<Object>} Workflow data with draft_snapshot
             */
            async loadWorkflow(workflowId) {
                const data = await rpc('/web/dataset/call_kw', {
                    model: 'workflow',
                    method: 'load_workflow',
                    args: [workflowId],
                    kwargs: {},
                });

                currentAdapter.fromJSON(data.draft_snapshot);
                _versionHash = data.version_hash;
                _workflowId = workflowId;

                return data;
            },

            /**
             * Save workflow to database via RPC
             * @returns {Promise<Object>} Result with new version_hash
             */
            async saveWorkflow() {
                const snapshot = currentAdapter.toJSON();
                const result = await rpc('/web/dataset/call_kw', {
                    model: 'workflow',
                    method: 'save_workflow',
                    args: [_workflowId, snapshot, _versionHash],
                    kwargs: {},
                });

                _versionHash = result.version_hash;
                return result;
            },

            /**
             * Get current workflow ID
             * @returns {number|null}
             */
            getWorkflowId() {
                return _workflowId;
            },

            /**
             * Check if workflow has unsaved changes
             * @returns {boolean}
             */
            hasUnsavedChanges() {
                // Simple implementation: compare current snapshot with saved state
                // For now, always return false (no comparison logic needed in Phase 2)
                return false;
            },

            /**
             * Get node class by type
             * @param {string} type
             * @returns {Function|null}
             */
            getNodeClass(type) {
                return currentAdapter.getNodeClass(type);
            },

            // ============================================
            // VARIABLE OPERATIONS (Proxy to VariableService)
            // ============================================

            /**
             * Get expression context for evaluation
             * @returns {Object} { $vars, $node, $json, $loop }
             */
            getExpressionContext() {
                return workflowVariable.getExpressionContext();
            },

            /**
             * Get variable value
             * @param {string} path - Dot-notation path
             * @returns {*}
             */
            getVariable(path) {
                return workflowVariable.getVariable(path);
            },

            /**
             * Set variable value
             * @param {string} path - Dot-notation path
             * @param {*} value
             */
            setVariable(path, value) {
                workflowVariable.setVariable(path, value);
            },

            /**
             * Append to array variable
             * @param {string} path
             * @param {*} value
             */
            appendVariable(path, value) {
                workflowVariable.appendVariable(path, value);
            },

            /**
             * Get current loop state
             * @returns {Object|null} { item, index, total, isFirst, isLast }
             */
            getLoopState() {
                return workflowVariable.getLoopState();
            },

            /**
             * Create new execution context
             * @param {string} workflowId
             * @returns {ExecutionContext}
             */
            createContext(workflowId = null) {
                return workflowVariable.createContext(workflowId);
            },

            /**
             * Clear execution context
             */
            clearContext() {
                workflowVariable.clearContext();
            },
        };
    },
};

// Register service
registry.category("services").add("workflowAdapter", workflowAdapterService);
