/** @odoo-module **/

import { getValueEditorInfo } from "@web/core/tree_editor/tree_editor_value_editors";
import { formatValue, Expression } from "@web/core/tree_editor/condition_tree";
import { _t } from "@web/core/l10n/translation";
import { inferExpressionModeFromValue } from "@workflow_studio/utils/expression_utils";

/**
 * Detect whether a value represents an expression-oriented domain payload.
 *
 * Canonical format is strict n8n-style prefix mode (`=...`).
 */
export function isExpressionValue(value) {
    return inferExpressionModeFromValue(value);
}

/**
 * Wraps Odoo's getValueEditorInfo so the value column renders an
 * ExpressionValueEditor — a toggle between the native Odoo editor
 * (DateTimeInput, Select, Autocomplete, …) and ExpressionInput.
 *
 * For operators that yield component=null (set/not_set), the wrapper
 * passes through unchanged (no toggle needed).
 *
 * @param {Object} options.ExpressionValueEditor — must be passed by the caller
 *   to avoid a circular dependency (domain_builder_utils ↔ expression_value_editor).
 */
export function getWorkflowValueEditorInfo(fieldDef, operator, options = {}) {
    const { ExpressionValueEditor, inputContext } = options;
    const nativeInfo = getValueEditorInfo(fieldDef, operator, options);

    // set / not_set → no value editor at all, pass through as-is
    if (!nativeInfo.component) {
        return nativeInfo;
    }

    return {
        component: ExpressionValueEditor,
        extractProps: ({ value, update }) => ({
            nativeEditorInfo: nativeInfo,
            value,
            update,
            inputContext,
        }),
        isSupported: (value) => nativeInfo.isSupported(value) || isExpressionValue(value) || value instanceof Expression,
        defaultValue: nativeInfo.defaultValue,
        stringify: nativeInfo.stringify || ((val, disambiguate = true) => {
            if (val instanceof Expression) {
                return val.toString();
            }
            if (isExpressionValue(val)) {
                return String(val);
            }
            return disambiguate ? formatValue(val) : String(val);
        }),
        message: nativeInfo.message || _t("Value not supported"),
    };
}
