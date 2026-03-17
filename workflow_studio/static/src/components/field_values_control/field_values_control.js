/** @odoo-module **/

import { Component, useState, onMounted, onWillUpdateProps } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";
import { ExpressionInput } from "../expression/ExpressionInput";
import { inferExpressionModeFromValue } from "@workflow_studio/utils/expression_utils";

/**
 * FieldValuesControl — visual field→value editor for record create/write operations.
 *
 * Each row has:
 *   - field name: ExpressionInput (fixed mode, autocomplete from model field definitions)
 *   - value:      ExpressionInput (fixed + expression modes, inputContext for {{ }} paths)
 *
 * Serializes to a JSON object string:
 *   '{"name": "Test Partner", "email": "{{ _input.email }}"}'
 *
 * The backend runner parses this JSON and evaluates expression values individually.
 */
export class FieldValuesControl extends Component {
    static template = "workflow_studio.field_values_control";
    static components = { ExpressionInput };

    static props = {
        resModel: { type: String, optional: true },
        operation: { type: String, optional: true }, // 'create' | 'write'
        value: { type: String, optional: true },
        onChange: Function,
        readonly: { type: Boolean, optional: true },
        inputContext: { type: Object, optional: true },
    };

    setup() {
        this.fieldService = useService("field");
        this._nextId = 1;

        this.state = useState({
            rows: this._parseToRows(this.props.value),
            fieldSuggestions: [],
            fieldModes: {}, // { [rowId]: 'fixed' | 'expression' }
            valueModes: {}, // { [rowId]: 'fixed' | 'expression' }
        });

        this.state.fieldModes = this._buildFieldModes(this.state.rows);
        this.state.valueModes = this._buildValueModes(this.state.rows);

        onMounted(() => {
            this._loadFields(this.props.resModel);
        });

        onWillUpdateProps((nextProps) => {
            if (nextProps.resModel !== this.props.resModel) {
                this._loadFields(nextProps.resModel);
            }
            // Sync when parent resets value externally (e.g. on model change).
            // Skip if the incoming value matches what we'd serialize — this is just
            // the parent echoing back our own onChange, and re-parsing would create
            // new row IDs that break t-key continuity (causing focus loss).
            if (nextProps.value !== this.props.value && nextProps.value !== this._serialize()) {
                const incoming = this._parseToRows(nextProps.value);
                this.state.rows = incoming;
                this.state.fieldModes = this._buildFieldModes(incoming);
                this.state.valueModes = this._buildValueModes(incoming);
            }
        });
    }

    _parseToRows(valueStr) {
        try {
            const obj = JSON.parse(valueStr || "{}");
            if (obj && typeof obj === "object" && !Array.isArray(obj)) {
                const entries = Object.entries(obj);
                if (entries.length > 0) {
                    return entries.map(([field, val]) => ({
                        id: this._nextId++,
                        field: String(field),
                        value: typeof val === "string" ? val : JSON.stringify(val),
                    }));
                }
            }
        } catch {}
        return [{ id: this._nextId++, field: "", value: "" }];
    }

    _sig(rows) {
        return (rows || []).map((r) => `${r.id}:${r.field}=${r.value}`).join("|");
    }

    _inferValueMode(value) {
        return inferExpressionModeFromValue(value) ? "expression" : "fixed";
    }

    _buildValueModes(rows) {
        const modes = {};
        for (const row of rows || []) {
            modes[row.id] = this._inferValueMode(row.value);
        }
        return modes;
    }

    _buildFieldModes(rows) {
        const modes = {};
        for (const row of rows || []) {
            modes[row.id] = this._inferValueMode(row.field);
        }
        return modes;
    }

    _serialize() {
        const out = {};
        for (const row of this.state.rows) {
            if (row.field.trim()) {
                out[row.field.trim()] = row.value;
            }
        }
        return JSON.stringify(out);
    }

    async _loadFields(resModel) {
        if (!resModel) {
            this.state.fieldSuggestions = [];
            return;
        }
        try {
            const defs = await this.fieldService.loadFields(resModel);
            const isCreate = this.props.operation !== "write";
            this.state.fieldSuggestions = Object.entries(defs)
                .filter(([, fd]) => {
                    // Exclude relational *2many — not settable as plain values
                    if (fd.type === "one2many") return false;
                    // For create: exclude purely computed+non-stored fields
                    if (isCreate && fd.readonly && !fd.store) return false;
                    return true;
                })
                .map(([fname, fd]) => ({
                    value: fname,
                    label: fname,
                    description: `${fd.string || fname} (${fd.type})`,
                }))
                .sort((a, b) => a.value.localeCompare(b.value));
        } catch {
            this.state.fieldSuggestions = [];
        }
    }

    _extractDroppedFieldName(payload) {
        if (payload && typeof payload.keyName === "string" && payload.keyName.trim()) {
            return payload.keyName.trim();
        }
        if (payload && payload.meta && Array.isArray(payload.meta.path) && payload.meta.path.length) {
            const lastSegment = payload.meta.path[payload.meta.path.length - 1];
            if (typeof lastSegment === "string" && lastSegment.trim()) {
                return lastSegment.trim();
            }
        }
        if (payload && typeof payload.path === "string") {
            const path = payload.path.trim();
            const dotMatch = path.match(/\.([A-Za-z_][A-Za-z0-9_]*)$/);
            if (dotMatch && dotMatch[1]) {
                return dotMatch[1];
            }
            const bracketMatch = path.match(/\["([^"\]]+)"\]$/);
            if (bracketMatch && bracketMatch[1]) {
                return bracketMatch[1];
            }
        }
        return "";
    }

    _hasFieldSuggestion(fieldName) {
        if (!fieldName) {
            return false;
        }
        return this.state.fieldSuggestions.some((item) => item && item.value === fieldName);
    }

    getFieldMode(rowId) {
        const row = this.state.rows.find((item) => item.id === rowId);
        if (!row) {
            return "fixed";
        }
        return this.state.fieldModes[rowId] || this._inferValueMode(row.field);
    }

    getValueMode(rowId) {
        const row = this.state.rows.find((item) => item.id === rowId);
        if (!row) {
            return "fixed";
        }
        return this.state.valueModes[rowId] || this._inferValueMode(row.value);
    }

    onFieldChange(index, fieldName) {
        this.state.rows[index].field = fieldName;
        this.props.onChange(this._serialize());
    }

    onFieldModeChange(rowId, mode) {
        this.state.fieldModes = { ...this.state.fieldModes, [rowId]: mode };
    }

    onFieldDrop(rowId, payload) {
        const droppedFieldName = this._extractDroppedFieldName(payload);
        if (this._hasFieldSuggestion(droppedFieldName)) {
            return {
                handled: true,
                mode: "fixed",
                value: droppedFieldName,
            };
        }

        if (payload && typeof payload.expression === "string" && payload.expression) {
            return {
                handled: true,
                mode: "expression",
                value: payload.expression,
            };
        }

        return null;
    }

    onValueChange(index, val) {
        this.state.rows[index].value = val;
        this.props.onChange(this._serialize());
    }

    onValueModeChange(rowId, mode) {
        this.state.valueModes = { ...this.state.valueModes, [rowId]: mode };
    }

    addRow() {
        const id = this._nextId++;
        this.state.rows = [...this.state.rows, { id, field: "", value: "" }];
        this.state.fieldModes = { ...this.state.fieldModes, [id]: "fixed" };
        this.state.valueModes = { ...this.state.valueModes, [id]: "fixed" };
    }

    removeRow(index) {
        const removedRow = this.state.rows[index];
        const next = this.state.rows.filter((_, i) => i !== index);
        const nextFieldModes = { ...this.state.fieldModes };
        const nextModes = { ...this.state.valueModes };
        if (removedRow) {
            delete nextFieldModes[removedRow.id];
            delete nextModes[removedRow.id];
        }
        this.state.rows = next.length > 0 ? next : [{ id: this._nextId++, field: "", value: "" }];
        this.state.fieldModes = next.length > 0 ? nextFieldModes : this._buildFieldModes(this.state.rows);
        this.state.valueModes = next.length > 0 ? nextModes : this._buildValueModes(this.state.rows);
        this.props.onChange(this._serialize());
    }
}
