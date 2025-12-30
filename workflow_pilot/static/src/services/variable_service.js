/** @odoo-module **/

/**
 * Workflow Variable Service
 *
 * Odoo service for managing workflow execution variables.
 * Wraps ExecutionContext and MockVariableStore for easy access.
 *
 * USAGE:
 * ──────
 * // In component setup:
 * this.variableService = useService("workflowVariable");
 * 
 * // Create new execution context:
 * this.variableService.createContext();
 * 
 * // Variable operations:
 * this.variableService.setVariable('result.items', []);
 * this.variableService.appendVariable('result.items', { id: 1 });
 * const items = this.variableService.getVariable('result.items');
 * 
 * // Get expression context for evaluation:
 * const ctx = this.variableService.getExpressionContext();
 * // { $vars: {...}, $node: {...}, $json: {...}, $loop: null }
 *
 * MIGRATION PATH:
 * ───────────────
 * Currently uses in-memory ExecutionContext.
 * Future: Will use backend RPC for variable persistence across sessions.
 */

import { registry } from "@web/core/registry";
import { ExecutionContext } from "../core/context";

export const workflowVariableService = {
    dependencies: [],

    start(env) {
        /** @type {ExecutionContext|null} */
        let currentContext = null;

        /** @type {string|null} Current workflow ID for persistence */
        let currentWorkflowId = null;

        return {
            // ============================================
            // CONTEXT LIFECYCLE
            // ============================================

            /**
             * Create a new execution context
             * @param {string} workflowId - Optional workflow ID for persistence
             * @returns {ExecutionContext}
             */
            createContext(workflowId = null) {
                currentContext = new ExecutionContext();
                currentWorkflowId = workflowId;
                return currentContext;
            },

            /**
             * Get current execution context
             * @returns {ExecutionContext|null}
             */
            getContext() {
                return currentContext;
            },

            /**
             * Set execution context (e.g., from MockExecutionEngine)
             * @param {ExecutionContext} context
             */
            setContext(context) {
                currentContext = context;
            },

            /**
             * Clear current context
             */
            clearContext() {
                currentContext = null;
                currentWorkflowId = null;
            },

            /**
             * Check if context exists
             * @returns {boolean}
             */
            hasContext() {
                return currentContext !== null;
            },

            // ============================================
            // VARIABLE OPERATIONS (Proxy to Context)
            // ============================================

            /**
             * Get variable value by path
             * @param {string} path - Dot-notation path
             * @returns {*}
             */
            getVariable(path) {
                this._ensureContext();
                return currentContext.getVariable(path);
            },

            /**
             * Set variable value by path
             * @param {string} path - Dot-notation path
             * @param {*} value - Value to set
             */
            setVariable(path, value) {
                this._ensureContext();
                currentContext.setVariable(path, value);
            },

            /**
             * Append value to array variable
             * @param {string} path - Path to array
             * @param {*} value - Value to append
             */
            appendVariable(path, value) {
                this._ensureContext();
                currentContext.appendVariable(path, value);
            },

            /**
             * Merge object into variable
             * @param {string} path - Path to object
             * @param {Object} value - Object to merge
             */
            mergeVariable(path, value) {
                this._ensureContext();
                currentContext.mergeVariable(path, value);
            },

            /**
             * Increment numeric variable
             * @param {string} path - Path to number
             * @param {number} amount - Amount to add
             * @returns {number} New value
             */
            incrementVariable(path, amount = 1) {
                this._ensureContext();
                return currentContext.incrementVariable(path, amount);
            },

            /**
             * Delete variable
             * @param {string} path - Path to delete
             */
            deleteVariable(path) {
                this._ensureContext();
                currentContext.deleteVariable(path);
            },

            /**
             * Check if variable exists
             * @param {string} path - Path to check
             * @returns {boolean}
             */
            hasVariable(path) {
                this._ensureContext();
                return currentContext.hasVariable(path);
            },

            /**
             * Get all variables
             * @returns {Object}
             */
            getAllVariables() {
                this._ensureContext();
                return currentContext.getAllVariables();
            },

            // ============================================
            // NODE OUTPUT OPERATIONS
            // ============================================

            /**
             * Set output for a node
             * @param {string} nodeId - Node identifier
             * @param {*} output - Node output
             */
            setNodeOutput(nodeId, output) {
                this._ensureContext();
                currentContext.setNodeOutput(nodeId, output);
            },

            /**
             * Get output from a node
             * @param {string} nodeId - Node identifier
             * @returns {*}
             */
            getNodeOutput(nodeId) {
                this._ensureContext();
                return currentContext.getNodeOutput(nodeId);
            },

            // ============================================
            // LOOP OPERATIONS
            // ============================================

            /**
             * Push a new loop context
             * @param {Array} collection - Items to iterate
             */
            pushLoop(collection) {
                this._ensureContext();
                currentContext.pushLoop(collection);
            },

            /**
             * Pop current loop context
             * @returns {Object|undefined}
             */
            popLoop() {
                this._ensureContext();
                return currentContext.popLoop();
            },

            /**
             * Advance loop to next item
             * @returns {boolean} True if more items
             */
            advanceLoop() {
                this._ensureContext();
                return currentContext.advanceLoop();
            },

            /**
             * Get current loop state
             * @returns {Object|null} { item, index, total, isFirst, isLast }
             */
            getLoopState() {
                if (!currentContext) return null;
                return currentContext.$loop;
            },

            // ============================================
            // EXPRESSION CONTEXT
            // ============================================

            /**
             * Get full context for expression evaluation
             * @returns {Object} { $vars, $node, $json, $loop }
             */
            getExpressionContext() {
                if (!currentContext) {
                    return { $vars: {}, $node: {}, $json: {}, $loop: null };
                }
                return currentContext.toExpressionContext();
            },

            // ============================================
            // SERIALIZATION
            // ============================================

            /**
             * Serialize context to JSON
             * @returns {Object}
             */
            toJSON() {
                if (!currentContext) return null;
                return currentContext.toJSON();
            },

            /**
             * Restore context from JSON
             * @param {Object} json
             * @returns {ExecutionContext}
             */
            fromJSON(json) {
                currentContext = ExecutionContext.fromJSON(json);
                return currentContext;
            },

            // ============================================
            // PRIVATE
            // ============================================

            /**
             * Ensure context exists, create if not
             * @private
             */
            _ensureContext() {
                if (!currentContext) {
                    currentContext = new ExecutionContext();
                }
            },
        };
    },
};

registry.category("services").add("workflowVariable", workflowVariableService);
