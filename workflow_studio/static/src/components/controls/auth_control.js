/** @odoo-module **/

import { Component, useState, onWillUpdateProps } from "@odoo/owl";
import { ExpressionInput } from "../expression/ExpressionInput";
import { getSuggestionsByKey, mergeUniqueSuggestions } from "@workflow_studio/utils/input_suggestion_utils";

/**
 * AuthControl Component
 *
 * Postman-inspired authentication configuration UI.
 * Supports: None, Bearer Token, Basic Auth, API Key, OAuth2, Custom Header.
 *
 * Value shape: { type: 'none' | 'bearer' | 'basic' | 'api_key' | 'oauth2' | 'custom_header', ...fields }
 */

const AUTH_TYPES = [
    { value: "none", label: "No Auth" },
    { value: "bearer", label: "Bearer Token" },
    { value: "basic", label: "Basic Auth" },
    { value: "api_key", label: "API Key" },
    { value: "oauth2", label: "OAuth 2.0" },
    { value: "custom_header", label: "Custom Header" },
];

const API_KEY_LOCATIONS = [
    { value: "header", label: "Header" },
    { value: "query", label: "Query Params" },
];

const DEFAULT_AUTH_SUGGESTIONS = {
    header_name: ["Authorization", "X-API-Key", "X-Auth-Token"],
    key_name: ["X-API-Key", "api_key", "token"],
    key_location: ["header", "query"],
    scope: ["read", "write", "read write"],
};

export class AuthControl extends Component {
    static template = "workflow_studio.auth_control";
    static components = { ExpressionInput };

    static props = {
        value: { type: Object, optional: true },
        onChange: { type: Function },
        inputContext: { type: Object, optional: true },
        readonly: { type: Boolean, optional: true },
        suggestionsByKey: { type: Object, optional: true },
    };

    setup() {
        this.authTypes = AUTH_TYPES;
        this.apiKeyLocations = API_KEY_LOCATIONS;
        this.defaultSuggestionsByKey = DEFAULT_AUTH_SUGGESTIONS;
        this.placeholders = {
            bearerToken: "Enter bearer token...",
            username: "Username",
            password: "Password",
            apiKeyName: "X-API-Key",
            apiKeyValue: "API key value",
            accessToken: "Access token",
            clientId: "Client ID",
            clientSecret: "Client secret",
            scope: "read write",
            headerName: "Authorization",
            headerValue: "Custom value...",
        };

        this.state = useState({
            authValue: this._normalize(this.props.value),
        });

        onWillUpdateProps((nextProps) => {
            const next = this._normalize(nextProps.value);
            if (JSON.stringify(next) !== JSON.stringify(this.state.authValue)) {
                this.state.authValue = next;
            }
        });
    }

    _normalize(val) {
        if (!val || typeof val !== "object") {
            return { type: "none" };
        }
        return { type: "none", ...val };
    }

    get authType() {
        return this.state.authValue.type || "none";
    }

    get authTypeLabel() {
        const entry = AUTH_TYPES.find(t => t.value === this.authType);
        return entry ? entry.label : "No Auth";
    }

    getFieldSuggestions(fieldKey) {
        const fromDefault = getSuggestionsByKey(this.defaultSuggestionsByKey, fieldKey);
        const fromSchema = getSuggestionsByKey(this.props.suggestionsByKey, fieldKey);
        return mergeUniqueSuggestions(fromDefault, fromSchema);
    }

    _emit() {
        this.props.onChange({ ...this.state.authValue });
    }

    onTypeChange(ev) {
        const newType = ev.target.value;
        // Reset to new type defaults
        this.state.authValue = { type: newType };
        this._emit();
    }

    onFieldChange(field, value) {
        this.state.authValue[field] = value;
        this._emit();
    }

    onSelectFieldChange(field, ev) {
        this.state.authValue[field] = ev.target.value;
        this._emit();
    }

    getField(field) {
        return this.state.authValue[field] || "";
    }
}
