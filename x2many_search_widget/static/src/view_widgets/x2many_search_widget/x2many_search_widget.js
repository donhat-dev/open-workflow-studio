/** @odoo-module **/

import { _t } from "@web/core/l10n/translation";
import { registry } from "@web/core/registry";
import { standardWidgetProps } from "@web/views/widgets/standard_widget_props";
import { X2MANY_SEARCH_WIDGET_EVENT } from "@x2many_search_widget/core/x2many_search_widget_bus";

import { Component, onWillUnmount, useState } from "@odoo/owl";

function parsePositiveInt(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseSearchFields(value) {
    if (!value) {
        return ["name"];
    }
    const trimmed = value.trim();
    if (trimmed[0] === "[") {
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) {
                const fields = parsed.filter((fieldName) => typeof fieldName === "string");
                return fields.length ? fields : ["name"];
            }
        } catch {
            // Fall back to comma-separated parsing.
        }
    }
    const fields = trimmed
        .split(",")
        .map((fieldName) => fieldName.trim())
        .filter(Boolean);
    return fields.length ? fields : ["name"];
}

export class X2ManySearchWidget extends Component {
    static template = "x2many_search_widget.X2ManySearchWidget";
    static props = {
        ...standardWidgetProps,
        targetField: { type: String },
        searchFields: { type: Array, element: String, optional: true },
        placeholder: { type: String, optional: true },
        debounceMs: { type: Number, optional: true },
        minChars: { type: Number, optional: true },
    };

    static defaultProps = {
        searchFields: ["name"],
        placeholder: _t("Search lines..."),
        debounceMs: 250,
        minChars: 1,
    };

    setup() {
        this.state = useState({ query: "" });
        this._debounceTimer = null;

        onWillUnmount(() => {
            this._clearTimer();
            this._emitSearch("");
        });
    }

    get isDisabled() {
        return this.props.readonly || !this.props.targetField;
    }

    get showClearButton() {
        return Boolean(this.state.query) && !this.isDisabled;
    }

    onInput(ev) {
        if (this.isDisabled) {
            return;
        }
        const query = ev.target.value;
        this.state.query = query;
        this._clearTimer();
        this._debounceTimer = setTimeout(() => {
            this._emitSearch(query);
        }, this.props.debounceMs);
    }

    onClear() {
        if (this.isDisabled) {
            return;
        }
        this._clearTimer();
        this.state.query = "";
        this._emitSearch("");
    }

    _clearTimer() {
        if (this._debounceTimer !== null) {
            clearTimeout(this._debounceTimer);
            this._debounceTimer = null;
        }
    }

    _emitSearch(rawQuery) {
        if (!this.props.targetField) {
            return;
        }
        const record = this.props.record;
        const query = typeof rawQuery === "string" ? rawQuery : "";
        record.model.bus.trigger(X2MANY_SEARCH_WIDGET_EVENT, {
            recordId: record.id,
            targetField: this.props.targetField,
            searchFields: this.props.searchFields,
            query,
            minChars: this.props.minChars,
        });
    }
}

export const x2ManySearchViewWidget = {
    component: X2ManySearchWidget,
    extractProps: ({ attrs }) => {
        return {
            targetField: attrs.target_field || "",
            searchFields: parseSearchFields(attrs.search_fields),
            placeholder: attrs.placeholder || _t("Search lines..."),
            debounceMs: parsePositiveInt(attrs.debounce_ms, 250),
            minChars: parsePositiveInt(attrs.min_chars, 1),
        };
    },
    supportedAttributes: [
        {
            label: _t("Target x2many field"),
            name: "target_field",
            type: "string",
        },
        {
            label: _t("Search fields"),
            name: "search_fields",
            type: "string",
            help: _t("Comma-separated list or JSON array, e.g. name,default_code"),
        },
        {
            label: _t("Placeholder"),
            name: "placeholder",
            type: "string",
        },
        {
            label: _t("Debounce (ms)"),
            name: "debounce_ms",
            type: "string",
        },
        {
            label: _t("Minimum chars"),
            name: "min_chars",
            type: "string",
        },
    ],
};

registry.category("view_widgets").add("x2many_search_widget", x2ManySearchViewWidget);
