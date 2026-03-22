/** @odoo-module **/

import { Component } from "@odoo/owl";

function normalizeValues(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .filter((item) => typeof item === "string" && item.trim())
        .map((item) => item.trim());
}

export class TriggerFieldsControl extends Component {
    static template = "workflow_studio.trigger_fields_control";
    static props = {
        value: { type: Array, optional: true },
        suggestions: { type: Array, optional: true },
        onChange: { type: Function },
        readonly: { type: Boolean, optional: true },
    };

    get selectedValues() {
        return new Set(normalizeValues(this.props.value));
    }

    get fields() {
        const suggestions = Array.isArray(this.props.suggestions) ? this.props.suggestions : [];
        return suggestions.map((field) => ({
            name: field.value || field.name || "",
            label: field.label || field.value || field.name || "",
            type: field.type || field.description || "unknown",
        }));
    }

    isChecked(fieldName) {
        return this.selectedValues.has(fieldName);
    }

    onToggle(fieldName, ev) {
        const next = new Set(this.selectedValues);
        if (ev.target.checked) {
            next.add(fieldName);
        } else {
            next.delete(fieldName);
        }
        this.props.onChange(Array.from(next));
    }
}
