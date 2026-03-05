/** @odoo-module **/

import { useService } from "@web/core/utils/hooks";

/**
 * useOdooModels — page-level singleton hook
 *
 * Lazily fetches all non-transient ir.model records once per page load and
 * exposes them as a reactive-compatible getter.  Any component can call this
 * hook; the actual ORM request fires only on the **first** mount and the
 * result is shared across all callers via module-level state.
 *
 * Usage:
 *   const { getOdooModels } = useOdooModels();
 *   // In a completion provider or renderer:
 *   const models = getOdooModels(); // returns live list or static fallback
 *
 * Returns:
 *   { getOdooModels: () => Array<{ model: string, description: string }> }
 */

// ---------------------------------------------------------------------------
// Static fallback — used immediately and whenever the fetch fails
// ---------------------------------------------------------------------------
export const ODOO_MODELS_FALLBACK = [
    { model: "res.partner",          description: "Contacts & Partners" },
    { model: "res.users",            description: "Users" },
    { model: "res.company",          description: "Companies" },
];

// ---------------------------------------------------------------------------
// Module-level singleton state (shared across all hook callers)
// ---------------------------------------------------------------------------
let _odooModelList = null;   // null → not yet fetched; Array → ready
let _fetchPromise   = null;  // singleton guard — fetch fires at most once

/**
 * Trigger a one-time background fetch of ir.model records.
 * Safe to call multiple times; subsequent calls are no-ops.
 * @param {Object} orm  Odoo ORM service
 */
function _triggerFetch(orm) {
    if (_fetchPromise) return;
    _fetchPromise = orm
        .searchRead(
            "ir.model",
            [["transient", "=", false]],
            ["model", "name"],
            { limit: 500, order: "model asc" }
        )
        .then((records) => {
            _odooModelList = records.map((r) => ({ model: r.model, description: r.name }));
        })
        .catch(() => {
            // On any error fall back to static list and stop retrying.
            _odooModelList = ODOO_MODELS_FALLBACK;
        });
}

// ---------------------------------------------------------------------------
// Public hook
// ---------------------------------------------------------------------------
export function useOdooModels() {
    const orm = useService("orm");
    // Fire-and-forget: kick off the fetch if it hasn't started yet.
    _triggerFetch(orm);

    return {
        /**
         * Returns the current model list.
         * Before the fetch completes returns the static fallback.
         * @returns {Array<{ model: string, description: string }>}
         */
        getOdooModels() {
            return _odooModelList || ODOO_MODELS_FALLBACK;
        },
    };
}
