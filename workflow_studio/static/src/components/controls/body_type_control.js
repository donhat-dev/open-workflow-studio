/** @odoo-module **/

import { Component, useState, onWillUpdateProps } from "@odoo/owl";
import { ExpressionInput } from "../expression/ExpressionInput";
import { CodeEditor } from "../code_editor";
import { getSuggestionsByKey, mergeUniqueSuggestions } from "@workflow_studio/utils/input_suggestion_utils";

/**
 * BodyTypeControl Component
 *
 * Postman-inspired body type selector with content-specific editors.
 * Tabs: none | json | form-data | x-www-form-urlencoded | raw
 *
 * Value shape: { content_type: string, body: string, form_data: Array }
 */

const BODY_TYPES = [
    { value: "none", label: "none" },
    { value: "json", label: "JSON" },
    { value: "form_data", label: "form-data" },
    { value: "urlencoded", label: "x-www-form-urlencoded" },
    { value: "raw", label: "raw" },
];

const RAW_CONTENT_TYPES = [
    { value: "text/plain", label: "Text" },
    { value: "text/html", label: "HTML" },
    { value: "application/xml", label: "XML" },
];

const DEFAULT_BODY_SUGGESTIONS = {
    content_type: ["none", "json", "form_data", "urlencoded", "raw"],
    form_data_value: ["true", "false", "null"],
};

export class BodyTypeControl extends Component {
    static template = "workflow_studio.body_type_control";
    static components = { ExpressionInput, CodeEditor };

    static props = {
        value: { type: Object, optional: true },
        onChange: { type: Function },
        inputContext: { type: Object, optional: true },
        readonly: { type: Boolean, optional: true },
        suggestionsByKey: { type: Object, optional: true },
    };

    setup() {
        this.bodyTypes = BODY_TYPES;
        this.rawContentTypes = RAW_CONTENT_TYPES;
        this.defaultSuggestionsByKey = DEFAULT_BODY_SUGGESTIONS;
        this.placeholders = {
            formValue: "Value",
            rawBody: "Enter raw body...",
            jsonBody: "{}",
        };
        this._nextPairId = 1;

        this.state = useState({
            bodyValue: this._normalize(this.props.value),
        });

        onWillUpdateProps((nextProps) => {
            const next = this._normalize(nextProps.value);
            if (JSON.stringify(next) !== JSON.stringify(this.state.bodyValue)) {
                this.state.bodyValue = next;
            }
        });
    }

    _normalize(val) {
        if (!val || typeof val !== "object") {
            return { content_type: "none", body: "", form_data: [], raw_type: "text/plain" };
        }
        const rawFormData = Array.isArray(val.form_data) ? val.form_data : [];
        const formData = rawFormData.length
            ? rawFormData.map(p => ({
                id: p.id || this._nextPairId++,
                key: p.key || "",
                value: p.value || "",
            }))
            : [{ id: this._nextPairId++, key: "", value: "" }];
        return {
            content_type: val.content_type || "none",
            body: val.body || "",
            form_data: formData,
            raw_type: val.raw_type || "text/plain",
        };
    }

    get contentType() {
        return this.state.bodyValue.content_type || "none";
    }

    get body() {
        return this.state.bodyValue.body || "";
    }

    get formData() {
        return this.state.bodyValue.form_data || [];
    }

    get rawType() {
        return this.state.bodyValue.raw_type || "text/plain";
    }

    getFieldSuggestions(fieldKey) {
        const fromDefault = getSuggestionsByKey(this.defaultSuggestionsByKey, fieldKey);
        const fromSchema = getSuggestionsByKey(this.props.suggestionsByKey, fieldKey);
        return mergeUniqueSuggestions(fromDefault, fromSchema);
    }

    _emit() {
        this.props.onChange({ ...this.state.bodyValue });
    }

    onTypeClick(type) {
        this.state.bodyValue.content_type = type;
        this._emit();
    }

    onBodyChange(value) {
        this.state.bodyValue.body = value;
        this._emit();
    }

    onCodeChange(value) {
        this.state.bodyValue.body = value;
        this._emit();
    }

    onRawTypeChange(ev) {
        this.state.bodyValue.raw_type = ev.target.value;
        this._emit();
    }

    // Form data key-value management
    onFormKeyChange(index, ev) {
        if (!this.state.bodyValue.form_data[index]) return;
        this.state.bodyValue.form_data[index].key = ev.target.value;
        this._emit();
    }

    onFormValueChange(index, value) {
        if (!this.state.bodyValue.form_data[index]) return;
        this.state.bodyValue.form_data[index].value = value;
        this._emit();
    }

    addFormPair() {
        this.state.bodyValue.form_data.push({
            id: this._nextPairId++,
            key: "",
            value: "",
        });
        this._emit();
    }

    removeFormPair(index) {
        if (this.state.bodyValue.form_data.length <= 1) return;
        this.state.bodyValue.form_data.splice(index, 1);
        this._emit();
    }
}
