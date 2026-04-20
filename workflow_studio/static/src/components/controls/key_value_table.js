/** @odoo-module **/

import { Component, useState, onWillUpdateProps } from "@odoo/owl";
import { ExpressionInput } from "../expression/ExpressionInput";
import { getSuggestionsByKey, mergeUniqueSuggestions } from "@workflow_studio/utils/input_suggestion_utils";

/**
 * KeyValueTable Component
 *
 * Unified 3-column table for key-value pair editing.
 * Used by: headers, query_params, body form-data, urlencoded.
 *
 * Features:
 * - Auto-placeholder row at bottom; typing in Key promotes it to a real row
 * - Optional toggle column with global check/uncheck (for query_params)
 * - Trash button visible on row hover/focus-within
 * - No "Add" button — placeholder row replaces it
 *
 * Value shape (emitted via onChange):
 *   withToggle=false → Array<{ id, key, value }>
 *   withToggle=true  → Array<{ id, key, value, enabled }>
 */
export class KeyValueTable extends Component {
    static template = "workflow_studio.key_value_table";
    static components = { ExpressionInput };

    static props = {
        pairs: { type: [Array, { value: undefined }], optional: true },
        withToggle: { type: Boolean, optional: true },
        onChange: { type: Function },
        inputContext: { type: Object, optional: true },
        readonly: { type: Boolean, optional: true },
        keyPlaceholder: { type: String, optional: true },
        valuePlaceholder: { type: String, optional: true },
        keySuggestions: { type: Array, optional: true },
        valueSuggestions: { type: Array, optional: true },
        expressionSuggestions: { type: Array, optional: true },
        suggestionsByKey: { type: Object, optional: true },
        // Per-pair expression modes: { [pairId]: { key: 'fixed'|'expression', value: 'fixed'|'expression' } }
        pairModes: { type: Object, optional: true },
        onPairModeChange: { type: Function, optional: true },
        // Keys that are locked (non-deletable, non-editable key, non-toggleable)
        lockedKeys: { type: Array, optional: true },
    };

    setup() {
        this._nextId = 1;

        this.state = useState({
            rows: this._normalize(this.props.pairs),
        });

        onWillUpdateProps((nextProps) => {
            const next = this._normalize(nextProps.pairs);
            const nextSig = this._signature(next);
            // Compute signature of current rows EXCLUDING the placeholder
            const curReal = this.state.rows.filter((r) => !r._placeholder);
            const curSig = this._signature(curReal);
            if (nextSig !== curSig) {
                this.state.rows = next;
            }
        });
    }

    get withToggle() {
        return this.props.withToggle !== false;
    }

    /**
     * Normalize incoming pairs and append a trailing placeholder row.
     */
    _normalize(val) {
        const arr = Array.isArray(val) ? val : [];
        const locked = new Set(this.props.lockedKeys || []);
        if (arr.length > 0) {
            const maxId = arr.reduce((m, p) => Math.max(m, p.id || 0), 0);
            this._nextId = Math.max(this._nextId, maxId + 1);
        }
        const rows = arr.map((p) => ({
            id: p.id || this._nextId++,
            key: p.key || "",
            value: p.value || "",
            enabled: p.enabled !== false,
            _placeholder: false,
            _locked: locked.has(p.key || ""),
        }));
        rows.push(this._makePlaceholder());
        return rows;
    }

    _makePlaceholder() {
        return {
            id: this._nextId++,
            key: "",
            value: "",
            enabled: true,
            _placeholder: true,
        };
    }

    _signature(rows) {
        return (rows || [])
            .map((r) => `${r.id}:${r.enabled}:${r.key}=${r.value}`)
            .join("|");
    }

    /**
     * Emit only real (non-placeholder) rows to parent.
     */
    _emit() {
        const real = this.state.rows.filter((r) => !r._placeholder);
        const withToggle = this.withToggle;
        const out = real.map((r) => {
            const item = { id: r.id, key: r.key, value: r.value };
            if (withToggle) {
                item.enabled = r.enabled;
            }
            return item;
        });
        this.props.onChange(out);
    }

    // ---- Global toggle ----

    get allEnabled() {
        const real = this.state.rows.filter((r) => !r._placeholder);
        return real.length > 0 && real.every((r) => r.enabled);
    }

    get someEnabled() {
        const real = this.state.rows.filter((r) => !r._placeholder);
        return real.some((r) => r.enabled) && !this.allEnabled;
    }

    onToggleAll() {
        const target = !this.allEnabled;
        for (const row of this.state.rows) {
            if (!row._placeholder) {
                row.enabled = target;
            }
        }
        this._emit();
    }

    // ---- Per-row toggle ----

    onToggleRow(index) {
        const row = this.state.rows[index];
        if (!row || row._placeholder || row._locked) return;
        row.enabled = !row.enabled;
        this._emit();
    }

    // ---- Key/Value editing ----

    onKeyChange(index, value) {
        const row = this.state.rows[index];
        if (!row || row._locked) return;
        row.key = value;
        // If this was the placeholder row, promote it and add new placeholder
        if (row._placeholder && value) {
            row._placeholder = false;
            this.state.rows.push(this._makePlaceholder());
        }
        this._emit();
    }

    onValueChange(index, value) {
        const row = this.state.rows[index];
        if (!row) return;
        row.value = value;
        // If this was the placeholder row, promote it and add new placeholder
        if (row._placeholder && value) {
            row._placeholder = false;
            this.state.rows.push(this._makePlaceholder());
        }
        this._emit();
    }

    // ---- Remove ----

    removeRow(index) {
        const row = this.state.rows[index];
        if (!row || row._placeholder || row._locked) return;
        this.state.rows.splice(index, 1);
        this._emit();
    }

    // ---- Suggestions ----

    getKeySuggestions() {
        const schemaKeySuggestions = Object.keys(this.props.suggestionsByKey || {}).map((key) => ({
            label: key,
            value: key,
        }));
        return mergeUniqueSuggestions(this.props.keySuggestions, schemaKeySuggestions);
    }

    getValueSuggestions(row) {
        const key = row && typeof row.key === "string" ? row.key : "";
        const schemaSuggestions = getSuggestionsByKey(this.props.suggestionsByKey, key);
        return mergeUniqueSuggestions(schemaSuggestions, this.props.valueSuggestions);
    }

    // ---- Pair expression mode proxies ----

    getPairKeyMode(pairId) {
        const modes = this.props.pairModes || {};
        const m = modes[pairId];
        if (!m) return "fixed";
        if (typeof m === "string") return "fixed";
        return m.key || "fixed";
    }

    getPairValueMode(pairId) {
        const modes = this.props.pairModes || {};
        const m = modes[pairId];
        if (!m) return "fixed";
        if (typeof m === "string") return m;
        return m.value || "fixed";
    }

    onPairKeyModeChange(pairId, mode) {
        if (this.props.onPairModeChange) {
            this.props.onPairModeChange(pairId, "key", mode);
        }
    }

    onPairValueModeChange(pairId, mode) {
        if (this.props.onPairModeChange) {
            this.props.onPairModeChange(pairId, "value", mode);
        }
    }
}
