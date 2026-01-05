/** @odoo-module **/

/**
 * NodeHelpers - n8n-style helper methods for node execution
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Similar to n8n's IExecuteFunctions, provides context injection for nodes:
 * - getInputData() - get input from previous node
 * - getContext(scope) - get/create persistent node context
 * - getNodeParameter(name) - get resolved config value
 * - getVariables() - get workflow variables
 * - continueOnFail() - check if should continue on error
 * - log(level, message) - logging helper
 *
 * This keeps nodes STATELESS while allowing access to execution state.
 *
 * Reference: n8n/packages/core/src/execution-engine/node-execution-context/base-execute-context.ts
 *
 * @example
 * async execute(inputData, exprCtx, execCtx, helpers) {
 *     const items = helpers.getInputData();
 *     const nodeContext = helpers.getContext('node');
 *     const batchSize = helpers.getNodeParameter('batchSize', 1);
 *     // ...
 * }
 */
export class NodeHelpers {
    /**
     * @param {Object} options
     * @param {any} options.inputData - Input from previous node
     * @param {Map} options.nodeContext - Persistent context map from executor
     * @param {string} options.nodeId - Current node ID
     * @param {Object} options.config - Resolved node config
     * @param {Object} options.expressionContext - Expression evaluation context
     * @param {Object} [options.variableService] - Workflow variable service
     * @param {Object} [options.node] - Node definition (for continueOnFail)
     */
    constructor(options) {
        this._inputData = options.inputData;
        this._nodeContext = options.nodeContext;
        this._nodeId = options.nodeId;
        this._config = options.config || {};
        this._expressionContext = options.expressionContext || {};
        this._variableService = options.variableService;
        this._node = options.node;
    }

    // ═══════════════════════════════════════════════════════════════
    // INPUT DATA
    // ═══════════════════════════════════════════════════════════════

    /**
     * Get input data from previous node
     * @param {number} [inputIndex=0] - Input connector index
     * @returns {any[]} Input items array
     */
    getInputData(inputIndex = 0) {
        const data = this._inputData;
        if (Array.isArray(data)) return data;
        return data ? [data] : [];
    }

    /**
     * Get first input item's JSON data
     * @returns {Object}
     */
    getInputJson() {
        const items = this.getInputData();
        return items[0]?.json || items[0] || {};
    }

    // ═══════════════════════════════════════════════════════════════
    // NODE CONTEXT (Persistent State)
    // ═══════════════════════════════════════════════════════════════

    /**
     * Get persistent context for this node
     * Survives across loop iterations, cleared on workflow completion
     *
     * @param {string} [scope='node'] - 'node' for node-scoped context
     * @returns {Object} Mutable context object
     */
    getContext(scope = 'node') {
        if (!this._nodeContext.has(this._nodeId)) {
            this._nodeContext.set(this._nodeId, {});
        }
        return this._nodeContext.get(this._nodeId);
    }

    /**
     * Clear context for this node
     */
    clearContext() {
        this._nodeContext.delete(this._nodeId);
    }

    /**
     * Check if context exists for this node
     * @returns {boolean}
     */
    hasContext() {
        return this._nodeContext.has(this._nodeId);
    }

    // ═══════════════════════════════════════════════════════════════
    // NODE PARAMETERS
    // ═══════════════════════════════════════════════════════════════

    /**
     * Get node parameter value from config
     * @param {string} name - Parameter name
     * @param {any} [defaultValue] - Default if not found
     * @returns {any} Parameter value
     */
    getNodeParameter(name, defaultValue = undefined) {
        return this._config[name] ?? defaultValue;
    }

    /**
     * Get all node parameters
     * @returns {Object}
     */
    getAllNodeParameters() {
        return { ...this._config };
    }

    // ═══════════════════════════════════════════════════════════════
    // EXPRESSION CONTEXT
    // ═══════════════════════════════════════════════════════════════

    /**
     * Get expression evaluation context
     * Contains $json, $node, $vars, $loop, etc.
     * @returns {Object}
     */
    getExpressionContext() {
        return this._expressionContext;
    }

    /**
     * Get specific expression variable
     * @param {string} name - Variable name (e.g., '$json', '$vars')
     * @returns {any}
     */
    getExpressionVariable(name) {
        return this._expressionContext[name];
    }

    // ═══════════════════════════════════════════════════════════════
    // WORKFLOW VARIABLES
    // ═══════════════════════════════════════════════════════════════

    /**
     * Get workflow variables
     * @returns {Object} Key-value map of variables
     */
    getVariables() {
        if (this._variableService) {
            return this._variableService.getAllVariables?.() || {};
        }
        return this._expressionContext.$vars || {};
    }

    /**
     * Get specific workflow variable
     * @param {string} name - Variable name
     * @param {any} [defaultValue] - Default if not found
     * @returns {any}
     */
    getVariable(name, defaultValue = undefined) {
        const vars = this.getVariables();
        return vars[name] ?? defaultValue;
    }

    // ═══════════════════════════════════════════════════════════════
    // ERROR HANDLING
    // ═══════════════════════════════════════════════════════════════

    /**
     * Check if execution should continue on error
     * Based on node's onError setting
     * @returns {boolean}
     */
    continueOnFail() {
        if (!this._node) return false;

        const onError = this._node.onError || this._node.settings?.onError;
        if (onError === undefined) {
            return this._node.continueOnFail === true;
        }
        return ['continueRegularOutput', 'continueErrorOutput'].includes(onError);
    }

    // ═══════════════════════════════════════════════════════════════
    // LOGGING
    // ═══════════════════════════════════════════════════════════════

    /**
     * Log message with node context
     * @param {'debug'|'info'|'warn'|'error'} level - Log level
     * @param {string} message - Message to log
     * @param {Object} [data] - Additional data
     */
    log(level, message, data = {}) {
        const prefix = `[Node:${this._nodeId}]`;
        const logData = { nodeId: this._nodeId, ...data };

        switch (level) {
            case 'debug':
                console.debug(prefix, message, logData);
                break;
            case 'info':
                console.info(prefix, message, logData);
                break;
            case 'warn':
                console.warn(prefix, message, logData);
                break;
            case 'error':
                console.error(prefix, message, logData);
                break;
            default:
                console.log(prefix, message, logData);
        }
    }

    /**
     * Send message to UI console (for debugging in manual mode)
     * @param {...any} args - Arguments to log
     */
    sendMessageToUI(...args) {
        // TODO: Integrate with Odoo bus for UI messaging
        console.log(`[Node:${this._nodeId}]`, ...args);
    }
}
