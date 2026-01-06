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
    dependencies: ["workflowVariable"],

    start(env, { workflowVariable }) {
        // Current adapter instance (set by app component)
        let currentAdapter = null;

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
                return currentAdapter?.getNodeConfig(nodeId) || {};
            },

            /**
             * Set node configuration
             * @param {string} nodeId
             * @param {Object} config
             * @returns {boolean}
             */
            setNodeConfig(nodeId, config) {
                return currentAdapter?.setNodeConfig(nodeId, config) || false;
            },

            /**
             * Get node controls metadata
             * @param {string} nodeId
             * @returns {Array}
             */
            getNodeControls(nodeId) {
                return currentAdapter?.getNodeControls(nodeId) || [];
            },

            /**
             * Get node meta (UI/runtime metadata)
             * @param {string} nodeId
             * @returns {Object}
             */
            getNodeMeta(nodeId) {
                return currentAdapter?.getNodeMeta(nodeId) || {};
            },

            /**
             * Update node meta (shallow merge + meta.ui merge)
             * @param {string} nodeId
             * @param {Object} metaPatch
             * @returns {boolean}
             */
            setNodeMeta(nodeId, metaPatch) {
                return currentAdapter?.setNodeMeta(nodeId, metaPatch) || false;
            },

            /**
             * Update a single control value
             * @param {string} nodeId
             * @param {string} controlKey
             * @param {*} value
             * @returns {boolean}
             */
            setControlValue(nodeId, controlKey, value) {
                return currentAdapter?.setControlValue(nodeId, controlKey, value) || false;
            },

            // ============================================
            // EXECUTION (Proxy to Adapter)
            // ============================================

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
             * Get node class by type
             * @param {string} type
             * @returns {Function|null}
             */
            getNodeClass(type) {
                return currentAdapter?.getNodeClass(type) || null;
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
