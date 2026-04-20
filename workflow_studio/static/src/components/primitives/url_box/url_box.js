/** @odoo-module **/

import { Component } from "@odoo/owl";

// Regex to match {param} path parameters
const PATH_PARAM_REGEX = /\{(\w+)\}/g;

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

    /**
     * Parse the URL into segments, identifying {param} tokens for highlighting.
     * Returns array of { text, isParam } objects.
     */
    get segments() {
        const url = this.displayValue;
        if (!url) {
            return [{ text: "", isParam: false }];
        }

        const segments = [];
        let lastIndex = 0;
        let match;

        // Reset regex lastIndex for fresh matching
        PATH_PARAM_REGEX.lastIndex = 0;

        while ((match = PATH_PARAM_REGEX.exec(url)) !== null) {
            // Add text before the param
            if (match.index > lastIndex) {
                segments.push({
                    text: url.slice(lastIndex, match.index),
                    isParam: false,
                });
            }
            // Add the param itself (include braces for display)
            segments.push({
                text: match[0], // e.g., "{order_id}"
                isParam: true,
                paramName: match[1], // e.g., "order_id"
            });
            lastIndex = match.index + match[0].length;
        }

        // Add remaining text after last param
        if (lastIndex < url.length) {
            segments.push({
                text: url.slice(lastIndex),
                isParam: false,
            });
        }

        // If no segments were found (no params), return the whole URL as one segment
        if (segments.length === 0) {
            return [{ text: url, isParam: false }];
        }

        return segments;
    }

    /**
     * Whether the URL contains any path parameters.
     */
    get hasPathParams() {
        PATH_PARAM_REGEX.lastIndex = 0;
        return PATH_PARAM_REGEX.test(this.displayValue);
    }

    async onCopyClick() {
        if (!this.hasValue || this.props.readonly || !this.props.onCopy) {
            return;
        }
        await this.props.onCopy(this.props.value, this.props.label || "URL");
    }
}
