/** @odoo-module **/

import { Component } from "@odoo/owl";

export class UrlBox extends Component {
    static template = "workflow_studio.url_box";

    static props = {
        value: { type: String, optional: true },
        placeholder: { type: String, optional: true },
        label: { type: String, optional: true },
        tone: { type: String, optional: true },
        readonly: { type: Boolean, optional: true },
        onCopy: { type: Function, optional: true },
    };

    get displayValue() {
        if (typeof this.props.value === "string" && this.props.value.trim()) {
            return this.props.value;
        }
        return this.props.placeholder || "";
    }

    get hasValue() {
        return typeof this.props.value === "string" && !!this.props.value.trim();
    }

    get toneClass() {
        if (!this.props.tone) {
            return "";
        }
        return `wf-url-box--${this.props.tone}`;
    }

    async onCopyClick() {
        if (!this.hasValue || this.props.readonly || !this.props.onCopy) {
            return;
        }
        await this.props.onCopy(this.props.value, this.props.label || "URL");
    }
}
