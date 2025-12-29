/** @odoo-module **/

/**
 * ExecutionContext - Manages workflow execution state
 *
 * Provides namespaced access to:
 * - $vars: Mutable workflow variables (user-defined)
 * - $node: Immutable node outputs (keyed by node ID)
 * - $json: Shortcut to previous node output
 * - $loop: Current loop iteration context
 *
 * USAGE:
 * ──────
 * const ctx = new ExecutionContext();
 *
 * // Variables
 * ctx.setVariable('result.order_line', []);
 * ctx.appendVariable('result.order_line', { product_id: 1 });
 * const lines = ctx.getVariable('result.order_line');
 *
 * // Node outputs
 * ctx.setNodeOutput('node_1', { data: 'value' });
 * const output = ctx.getNodeOutput('node_1');
 *
 * // Loop context
 * ctx.pushLoop([item1, item2, item3]);
 * while (ctx.$loop) {
 *     console.log(ctx.$loop.item, ctx.$loop.index);
 *     if (!ctx.advanceLoop()) break;
 * }
 * ctx.popLoop();
 *
 * // Expression context
 * const exprCtx = ctx.toExpressionContext();
 * // { $vars: {...}, $node: {...}, $json: {...}, $loop: {...} }
 */
export class ExecutionContext {
    constructor() {
        /** @type {Object} Mutable workflow variables */
        this._vars = {};

        /** @type {Object<string, any>} Immutable node outputs */
        this._nodeOutputs = {};

        /** @type {string|null} Current node being executed */
        this._currentNodeId = null;

        /** @type {Array<LoopState>} Stack for nested loops */
        this._loopStack = [];
    }

    // ============================================
    // VARIABLES ($vars)
    // ============================================

    /**
     * Get a variable value by path
     *
     * @param {string} path - Dot-notation path (e.g., 'result.order_line')
     * @returns {*} Variable value or undefined
     */
    getVariable(path) {
        return this._resolvePath(this._vars, path);
    }

    /**
     * Set a variable value by path
     *
     * @param {string} path - Dot-notation path
     * @param {*} value - Value to set
     */
    setVariable(path, value) {
        if (!path) {
            throw new Error('Variable path is required');
        }
        this._setPath(this._vars, path, value);
    }

    /**
     * Append value to an array variable
     *
     * @param {string} path - Path to array variable
     * @param {*} value - Value to append
     */
    appendVariable(path, value) {
        let arr = this.getVariable(path);

        if (arr === undefined) {
            arr = [];
            this.setVariable(path, arr);
        }

        if (!Array.isArray(arr)) {
            throw new Error(`Cannot append to non-array at path: ${path}`);
        }

        arr.push(value);
    }

    /**
     * Merge object into variable
     *
     * @param {string} path - Path to object variable
     * @param {Object} value - Object to merge
     */
    mergeVariable(path, value) {
        let obj = this.getVariable(path);

        if (obj === undefined) {
            obj = {};
            this.setVariable(path, obj);
        }

        if (typeof obj !== 'object' || Array.isArray(obj) || obj === null) {
            throw new Error(`Cannot merge into non-object at path: ${path}`);
        }

        Object.assign(obj, value);
    }

    /**
     * Increment numeric variable
     *
     * @param {string} path - Path to numeric variable
     * @param {number} amount - Amount to add (default: 1)
     * @returns {number} New value
     */
    incrementVariable(path, amount = 1) {
        const current = this.getVariable(path) || 0;
        const newValue = current + amount;
        this.setVariable(path, newValue);
        return newValue;
    }

    /**
     * Delete a variable
     *
     * @param {string} path - Path to variable
     */
    deleteVariable(path) {
        if (!path) return;

        const parts = path.split('.');
        if (parts.length === 1) {
            delete this._vars[path];
            return;
        }

        const parentPath = parts.slice(0, -1).join('.');
        const key = parts[parts.length - 1];
        const parent = this.getVariable(parentPath);

        if (parent && typeof parent === 'object') {
            delete parent[key];
        }
    }

    /**
     * Check if variable exists
     *
     * @param {string} path - Path to check
     * @returns {boolean}
     */
    hasVariable(path) {
        return this.getVariable(path) !== undefined;
    }

    /**
     * Get all variables
     *
     * @returns {Object} Copy of all variables
     */
    getAllVariables() {
        return JSON.parse(JSON.stringify(this._vars));
    }

    // ============================================
    // NODE OUTPUTS ($node, $json)
    // ============================================

    /**
     * Store output for a node
     *
     * @param {string} nodeId - Node identifier
     * @param {*} output - Node output
     */
    setNodeOutput(nodeId, output) {
        this._nodeOutputs[nodeId] = output;
        this._currentNodeId = nodeId;
    }

    /**
     * Get output from a specific node
     *
     * @param {string} nodeId - Node identifier
     * @returns {*} Node output or undefined
     */
    getNodeOutput(nodeId) {
        return this._nodeOutputs[nodeId];
    }

    /**
     * Get previous node output ($json shortcut)
     *
     * @returns {*} Previous node output or empty object
     */
    get $json() {
        if (!this._currentNodeId) return {};
        return this._nodeOutputs[this._currentNodeId]?.json ||
               this._nodeOutputs[this._currentNodeId] ||
               {};
    }

    /**
     * Get all node outputs
     *
     * @returns {Object}
     */
    get $node() {
        return this._nodeOutputs;
    }

    /**
     * Get all variables
     *
     * @returns {Object}
     */
    get $vars() {
        return this._vars;
    }

    // ============================================
    // LOOP CONTEXT ($loop)
    // ============================================

    /**
     * Start a new loop iteration
     *
     * @param {Array} collection - Collection to iterate
     */
    pushLoop(collection) {
        if (!Array.isArray(collection)) {
            throw new Error('Loop collection must be an array');
        }

        this._loopStack.push({
            collection,
            index: 0,
            total: collection.length,
        });
    }

    /**
     * End current loop
     *
     * @returns {Object|undefined} Popped loop state
     */
    popLoop() {
        return this._loopStack.pop();
    }

    /**
     * Get current loop context
     *
     * @returns {Object|null} Loop context or null if not in loop
     */
    get $loop() {
        const current = this._loopStack[this._loopStack.length - 1];
        if (!current || current.total === 0) return null;

        return {
            item: current.collection[current.index],
            index: current.index,
            total: current.total,
            isFirst: current.index === 0,
            isLast: current.index === current.total - 1,
        };
    }

    /**
     * Advance to next loop iteration
     *
     * @returns {boolean} True if more iterations remain
     */
    advanceLoop() {
        const current = this._loopStack[this._loopStack.length - 1];
        if (!current) return false;

        current.index++;
        return current.index < current.total;
    }

    /**
     * Check if currently inside a loop
     *
     * @returns {boolean}
     */
    isInLoop() {
        return this._loopStack.length > 0;
    }

    /**
     * Get current loop depth (for nested loops)
     *
     * @returns {number}
     */
    getLoopDepth() {
        return this._loopStack.length;
    }

    // ============================================
    // EXPRESSION CONTEXT
    // ============================================

    /**
     * Get full context for expression evaluation
     *
     * @returns {Object} Context with all namespaces
     */
    toExpressionContext() {
        return {
            $vars: this._vars,
            $node: this._nodeOutputs,
            $json: this.$json,
            $loop: this.$loop,
        };
    }

    // ============================================
    // SERIALIZATION
    // ============================================

    /**
     * Serialize context to JSON
     *
     * @returns {Object} Serializable context state
     */
    toJSON() {
        return {
            vars: JSON.parse(JSON.stringify(this._vars)),
            nodeOutputs: JSON.parse(JSON.stringify(this._nodeOutputs)),
            currentNodeId: this._currentNodeId,
            // Note: loop stack not serialized (runtime only)
        };
    }

    /**
     * Restore context from JSON
     *
     * @param {Object} data - Serialized context
     */
    fromJSON(data) {
        this._vars = data.vars || {};
        this._nodeOutputs = data.nodeOutputs || {};
        this._currentNodeId = data.currentNodeId || null;
        this._loopStack = [];
    }

    /**
     * Clear all context state
     */
    clear() {
        this._vars = {};
        this._nodeOutputs = {};
        this._currentNodeId = null;
        this._loopStack = [];
    }

    // ============================================
    // PRIVATE HELPERS
    // ============================================

    /**
     * Resolve dot-notation path on object
     * @private
     */
    _resolvePath(obj, path) {
        if (!path) return obj;
        if (obj === null || obj === undefined) return undefined;

        const parts = path.split('.');
        let current = obj;

        for (const part of parts) {
            if (current === null || current === undefined) {
                return undefined;
            }

            // Handle array index: items[0] or items[0].name
            const arrayMatch = part.match(/^(\w+)\[(\d+)\]$/);
            if (arrayMatch) {
                const [, arrayName, indexStr] = arrayMatch;
                const index = parseInt(indexStr, 10);
                current = current[arrayName]?.[index];
            } else {
                current = current[part];
            }
        }

        return current;
    }

    /**
     * Set value at dot-notation path
     * @private
     */
    _setPath(obj, path, value) {
        const parts = path.split('.');
        let current = obj;

        for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i];

            // Handle array index
            const arrayMatch = part.match(/^(\w+)\[(\d+)\]$/);
            if (arrayMatch) {
                const [, arrayName, indexStr] = arrayMatch;
                const index = parseInt(indexStr, 10);

                if (!current[arrayName]) {
                    current[arrayName] = [];
                }
                if (!current[arrayName][index]) {
                    current[arrayName][index] = {};
                }
                current = current[arrayName][index];
            } else {
                if (!(part in current) || current[part] === null) {
                    current[part] = {};
                }
                current = current[part];
            }
        }

        const lastPart = parts[parts.length - 1];

        // Handle array index in last part
        const arrayMatch = lastPart.match(/^(\w+)\[(\d+)\]$/);
        if (arrayMatch) {
            const [, arrayName, indexStr] = arrayMatch;
            const index = parseInt(indexStr, 10);
            if (!current[arrayName]) {
                current[arrayName] = [];
            }
            current[arrayName][index] = value;
        } else {
            current[lastPart] = value;
        }
    }
}
