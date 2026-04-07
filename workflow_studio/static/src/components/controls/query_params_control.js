/** @odoo-module **/

import { Component, useState, onWillUpdateProps } from "@odoo/owl";
import { ExpressionInput } from "../expression/ExpressionInput";
import { getSuggestionsByKey, mergeUniqueSuggestions } from "@workflow_studio/utils/input_suggestion_utils";

const DEFAULT_QUERY_VALUE_SUGGESTIONS = {
    limit: ["10", "20", "50", "100"],
    offset: ["0", "10", "20", "50"],
    page: ["1", "2", "3"],
    sort: ["asc", "desc"],
    order: ["asc", "desc"],
    status: ["active", "inactive", "pending"],
};

/**
 * QueryParamsControl Component
 *
 * Key-value editor for URL query parameters with enable/disable toggle per row.
 *
 * Value shape: Array<{ id, key, value, enabled }>
 */
export class QueryParamsControl extends Component {
    static template = "workflow_studio.query_params_control";
    static components = { ExpressionInput };

    static props = {
        value: { type: [Array, { value: undefined }], optional: true },
        onChange: { type: Function },
        inputContext: { type: Object, optional: true },
        readonly: { type: Boolean, optional: true },
        suggestionsByKey: { type: Object, optional: true },
    };

    setup() {
        this.placeholders = {
            value: "Value",
        };
        this.valueSuggestionsByKey = DEFAULT_QUERY_VALUE_SUGGESTIONS;
        this._nextId = 1;

        this.state = useState({
            params: this._normalize(this.props.value),
        });

        onWillUpdateProps((nextProps) => {
            const next = this._normalize(nextProps.value);
            const nextSig = this._signature(next);
            const curSig = this._signature(this.state.params);
            if (nextSig !== curSig) {
                this.state.params = next;
            }
        });
    }

    _normalize(val) {
        const arr = Array.isArray(val) ? val : [];
        if (arr.length === 0) {
            return [{ id: this._nextId++, key: "", value: "", enabled: true }];
        }
        const maxId = arr.reduce((m, p) => Math.max(m, p.id || 0), 0);
        this._nextId = Math.max(this._nextId, maxId + 1);
        return arr.map(p => ({
            id: p.id || this._nextId++,
            key: p.key || "",
            value: p.value || "",
            enabled: p.enabled !== false,
        }));
    }

    _signature(params) {
        return (params || [])
            .map(p => `${p.id}:${p.enabled}:${p.key}=${p.value}`)
            .join("|");
    }

    get enabledCount() {
        return this.state.params.filter(p => p.enabled && p.key).length;
    }

    _emit() {
        this.props.onChange([...this.state.params]);
    }

    getKeySuggestions() {
        const keys = new Set();
        for (const k of Object.keys(this.valueSuggestionsByKey)) {
            keys.add(k);
        }
        if (this.props.suggestionsByKey) {
            for (const k of Object.keys(this.props.suggestionsByKey)) {
                keys.add(k);
            }
        }
        return Array.from(keys).map(k => ({ label: k, value: k }));
    }

    getValueSuggestions(key) {
        const defaultSuggestions = getSuggestionsByKey(this.valueSuggestionsByKey, key);
        const schemaSuggestions = getSuggestionsByKey(this.props.suggestionsByKey, key);
        return mergeUniqueSuggestions(defaultSuggestions, schemaSuggestions);
    }

    onKeyChange(index, value) {
        if (!this.state.params[index]) return;
        const val = typeof value === 'object' ? value.target.value : value;
        this.state.params[index].key = val;
        this._emit();
    }

    onValueChange(index, value) {
        if (!this.state.params[index]) return;
        this.state.params[index].value = value;
        this._emit();
    }

    onToggleEnabled(index) {
        if (!this.state.params[index]) return;
        this.state.params[index].enabled = !this.state.params[index].enabled;
        this._emit();
    }

    addParam() {
        this.state.params.push({
            id: this._nextId++,
            key: "",
            value: "",
            enabled: true,
        });
        this._emit();
    }

    removeParam(index) {
        if (this.state.params.length <= 1) return;
        this.state.params.splice(index, 1);
        this._emit();
    }
}
