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
 */

import { registry } from "@web/core/registry";

export const workflowAdapterService = {
    dependencies: [],

    start(env) {
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
             * Execute a single node
             * @param {string} nodeId
             * @param {Object} inputData
             * @returns {Promise}
             */
            async executeNode(nodeId, inputData = {}) {
                if (!currentAdapter) {
                    return { json: null, error: 'No adapter', meta: {} };
                }
                return currentAdapter.executeNode(nodeId, inputData);
            },

            /**
             * Get node class by type
             * @param {string} type
             * @returns {Function|null}
             */
            getNodeClass(type) {
                return currentAdapter?.getNodeClass(type) || null;
            },
        };
    },
};

// Register service
registry.category("services").add("workflowAdapter", workflowAdapterService);
