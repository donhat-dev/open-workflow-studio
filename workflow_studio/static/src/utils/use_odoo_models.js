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
 *   {
 *     getOdooModels: () => Array<{ model, description, moduleName, iconUrl }>,
 *     getModelMetaByName: (modelName) => Object|null,
 *   }
 */

// ---------------------------------------------------------------------------
// Static fallback — used immediately and whenever the fetch fails
// ---------------------------------------------------------------------------
export const ODOO_MODELS_FALLBACK = [
    {
        model: "res.partner",
        description: "Contacts",
        moduleName: "base",
        iconUrl: "/base/static/description/icon.png",
    },
    {
        model: "res.users",
        description: "Users",
        moduleName: "base",
        iconUrl: "/base/static/description/icon.png",
    },
    {
        model: "res.company",
        description: "Companies",
        moduleName: "base",
        iconUrl: "/base/static/description/icon.png",
    },
];

// ---------------------------------------------------------------------------
// Module-level singleton state (shared across all hook callers)
// ---------------------------------------------------------------------------
let _odooModelList = null;   // null → not yet fetched; Array → ready
let _fetchPromise   = null;  // singleton guard — fetch fires at most once

function toModuleName(modules) {
    if (typeof modules !== "string" || !modules.trim()) {
        return "";
    }
    return modules
        .split(",")
        .map((item) => item.trim())
        .find((item) => !!item) || "";
}

function toIconUrl(moduleName) {
    if (!moduleName) {
        return "";
    }
    return `/${moduleName}/static/description/icon.png`;
}

function normalizeModelMeta(record) {
    const model = record && record.model ? String(record.model) : "";
    const description = record && record.name ? String(record.name) : model;
    const moduleName = toModuleName(record && record.modules);
    const iconUrl = toIconUrl(moduleName);
    return { model, description, moduleName, iconUrl };
}

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
            ["model", "name", "modules"],
            { limit: 500, order: "model asc" }
        )
        .then((records) => {
            _odooModelList = records.map((record) => normalizeModelMeta(record));
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
         * @returns {Array<{ model: string, description: string, moduleName: string, iconUrl: string }>}
         */
        getOdooModels() {
            return _odooModelList || ODOO_MODELS_FALLBACK;
        },

        /**
         * Return model metadata by technical model name.
         * @param {string} modelName
         * @returns {Object|null}
         */
        getModelMetaByName(modelName) {
            if (typeof modelName !== "string" || !modelName) {
                return null;
            }
            const list = _odooModelList || ODOO_MODELS_FALLBACK;
            return list.find((item) => item.model === modelName) || null;
        },
    };
}
