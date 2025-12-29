/** @odoo-module **/

/**
 * MockVariableStore - Simulates variable persistence
 *
 * In production, this will be replaced by:
 * - Odoo model: workflow.execution.variable
 * - Or Redis/session cache for temporary variables
 *
 * BACKEND MIGRATION:
 * ──────────────────
 * 1. Create model workflow.execution.variable
 *    - workflow_id: Many2one
 *    - name: Char
 *    - value_json: Text (JSON serialized)
 *    - execution_id: Char (for scoping)
 *
 * 2. Create RPC endpoints:
 *    - POST /workflow/vars/save { workflow_id, execution_id, variables }
 *    - GET /workflow/vars/load { workflow_id, execution_id }
 *    - DELETE /workflow/vars/clear { workflow_id, execution_id }
 *
 * INTERFACE CONTRACT:
 * ───────────────────
 * save(workflowId, executionId, variables) → Promise<void>
 * load(workflowId, executionId) → Promise<Object>
 * clear(workflowId, executionId) → Promise<void>
 */

export class MockVariableStore {
    constructor() {
        // In-memory store: Map<string, Object>
        // Key format: "workflow_{id}_exec_{execId}"
        this._store = new Map();
    }

    /**
     * Generate storage key
     * @private
     */
    _getKey(workflowId, executionId = 'default') {
        return `workflow_${workflowId}_exec_${executionId}`;
    }

    /**
     * Save variables for a workflow execution
     *
     * @param {string|number} workflowId - Workflow identifier
     * @param {string} executionId - Execution run identifier
     * @param {Object} variables - Variables to persist
     *
     * Backend equivalent:
     *   POST /workflow/vars/save
     *   Body: { workflow_id, execution_id, variables }
     */
    async save(workflowId, executionId, variables) {
        const key = this._getKey(workflowId, executionId);
        // Deep clone to avoid reference issues
        const cloned = JSON.parse(JSON.stringify(variables));
        this._store.set(key, cloned);

        console.log(`[MockVariableStore] Saved vars for ${key}:`, cloned);
    }

    /**
     * Load variables for a workflow execution
     *
     * @param {string|number} workflowId - Workflow identifier
     * @param {string} executionId - Execution run identifier
     * @returns {Promise<Object>} Stored variables or empty object
     *
     * Backend equivalent:
     *   GET /workflow/vars/load?workflow_id=X&execution_id=Y
     *   Response: { variables: {...} }
     */
    async load(workflowId, executionId = 'default') {
        const key = this._getKey(workflowId, executionId);
        const vars = this._store.get(key);

        console.log(`[MockVariableStore] Loaded vars for ${key}:`, vars);
        return vars ? JSON.parse(JSON.stringify(vars)) : {};
    }

    /**
     * Clear variables for a workflow execution
     *
     * @param {string|number} workflowId - Workflow identifier
     * @param {string} executionId - Execution run identifier (optional, clears all if not provided)
     *
     * Backend equivalent:
     *   DELETE /workflow/vars/clear
     *   Body: { workflow_id, execution_id }
     */
    async clear(workflowId, executionId = null) {
        if (executionId) {
            const key = this._getKey(workflowId, executionId);
            this._store.delete(key);
            console.log(`[MockVariableStore] Cleared vars for ${key}`);
        } else {
            // Clear all executions for this workflow
            const prefix = `workflow_${workflowId}_`;
            for (const key of this._store.keys()) {
                if (key.startsWith(prefix)) {
                    this._store.delete(key);
                }
            }
            console.log(`[MockVariableStore] Cleared all vars for workflow ${workflowId}`);
        }
    }

    /**
     * List all stored variable sets (for debugging)
     *
     * @returns {Array<{key: string, variables: Object}>}
     */
    list() {
        return Array.from(this._store.entries()).map(([key, variables]) => ({
            key,
            variables,
        }));
    }

    /**
     * Get storage size (for debugging)
     */
    get size() {
        return this._store.size;
    }
}

// Singleton instance
export const mockVariableStore = new MockVariableStore();
