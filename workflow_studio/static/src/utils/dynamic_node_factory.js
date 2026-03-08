/** @odoo-module **/

import { registry } from "@web/core/registry";
import { BaseNode } from "../core/node";
import {
    AuthControl,
    BodyTypeControl,
    CheckboxControl,
    CodeControl,
    KeyValueControl,
    NumberControl,
    QueryParamsControl,
    SelectControl,
    TextInputControl,
} from "../core/control";
import { DataSocket, ErrorSocket, TriggerSocket } from "../core/socket";

const nodeTypeRegistry = registry.category("workflow_node_types");
const nodeCategoryRegistry = registry.category("workflow_node_categories");

const DEFAULT_NODE_ICON = "fa-cube";
const DEFAULT_NODE_CATEGORY = "transform";
const DEFAULT_CATEGORY_ICON = "fa-cube";
const DEFAULT_CATEGORY_SEQUENCE = 100;

const SOCKET_BY_NAME = {
    data: DataSocket,
    error: ErrorSocket,
    trigger: TriggerSocket,
};

const CATEGORY_LABELS = {
    trigger: "Triggers",
    action: "Actions",
    flow: "Flow Control",
    data: "Data",
    integration: "Integrations",
    transform: "Transform",
};

const HTTP_CONTROL_SUGGESTION_DEFAULTS = {
    url: {
        suggestions: [
            "https://api.example.com",
            "https://httpbin.org/anything",
        ],
    },
    query_params: {
        suggestionsByKey: {
            limit: ["10", "20", "50", "100"],
            offset: ["0", "10", "20"],
            page: ["1", "2", "3"],
            sort: ["asc", "desc"],
            status: ["active", "inactive"],
        },
    },
    auth: {
        suggestionsByKey: {
            header_name: ["Authorization", "X-API-Key"],
            key_name: ["X-API-Key", "api_key"],
            scope: ["read", "write", "read write"],
        },
    },
    body_config: {
        suggestionsByKey: {
            form_data_value: ["true", "false", "null"],
        },
    },
    headers: {
        suggestionsByKey: {
            "Content-Type": [
                "application/json",
                "application/x-www-form-urlencoded",
                "multipart/form-data",
            ],
            Accept: ["application/json", "*/*"],
            Authorization: ["Bearer "],
        },
    },
};

function clonePlain(value) {
    if (value === null || value === undefined) {
        return value;
    }
    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        return value;
    }
}

function withHttpSuggestionDefaults(nodeType, schema) {
    if (nodeType !== "http" || !schema || typeof schema !== "object" || Array.isArray(schema)) {
        return schema;
    }

    const merged = { ...schema };
    for (const [controlKey, defaultMeta] of Object.entries(HTTP_CONTROL_SUGGESTION_DEFAULTS)) {
        const control = merged[controlKey];
        if (!control || typeof control !== "object" || Array.isArray(control)) {
            continue;
        }

        const controlMerged = { ...control };
        for (const [metaKey, metaValue] of Object.entries(defaultMeta)) {
            if (Object.prototype.hasOwnProperty.call(controlMerged, metaKey)) {
                continue;
            }
            controlMerged[metaKey] = clonePlain(metaValue);
        }
        merged[controlKey] = controlMerged;
    }

    return merged;
}

function getNodeTypeKey(entry) {
    if (!entry || typeof entry !== "object") {
        return "";
    }
    const key = entry.node_type || entry.nodeType || entry.key;
    if (typeof key !== "string") {
        return "";
    }
    return key.trim();
}

function humanizeKey(key) {
    return String(key || "")
        .split("_")
        .filter(Boolean)
        .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
        .join(" ");
}

function normalizeSchema(rawSchema) {
    if (!rawSchema) {
        return {};
    }
    if (typeof rawSchema === "string") {
        try {
            const parsed = JSON.parse(rawSchema);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                return parsed;
            }
            return {};
        } catch {
            return {};
        }
    }
    if (typeof rawSchema === "object" && !Array.isArray(rawSchema)) {
        return rawSchema;
    }
    return {};
}

function normalizeControlSchema(rawSchema) {
    if (!rawSchema) {
        return {};
    }
    if (typeof rawSchema === "string") {
        return { type: rawSchema };
    }
    if (typeof rawSchema === "object" && !Array.isArray(rawSchema)) {
        return rawSchema;
    }
    return {};
}

function normalizeSocketName(rawType) {
    if (typeof rawType !== "string") {
        return "data";
    }
    let normalized = rawType.trim().toLowerCase();
    if (normalized.endsWith("socket")) {
        normalized = normalized.slice(0, -6);
    }
    if (!normalized) {
        return "data";
    }
    return normalized;
}

function resolveSocket(socketDefinition) {
    let socketType = "data";

    if (typeof socketDefinition === "string") {
        socketType = normalizeSocketName(socketDefinition);
    } else if (socketDefinition && typeof socketDefinition === "object" && !Array.isArray(socketDefinition)) {
        if (typeof socketDefinition.type === "string") {
            socketType = normalizeSocketName(socketDefinition.type);
        } else if (typeof socketDefinition.socket === "string") {
            socketType = normalizeSocketName(socketDefinition.socket);
        }
    }

    if (Object.prototype.hasOwnProperty.call(SOCKET_BY_NAME, socketType)) {
        return SOCKET_BY_NAME[socketType];
    }
    return DataSocket;
}

function getDefaultValue(schema, fallback) {
    if (Object.prototype.hasOwnProperty.call(schema, "default")) {
        return schema.default;
    }
    if (Object.prototype.hasOwnProperty.call(schema, "defaultValue")) {
        return schema.defaultValue;
    }
    return fallback;
}

function normalizeControlType(rawType) {
    if (typeof rawType !== "string") {
        return "text";
    }
    const normalized = rawType.trim().toLowerCase();
    if (!normalized) {
        return "text";
    }
    return normalized;
}

function normalizeSelectOptions(rawOptions) {
    if (!Array.isArray(rawOptions)) {
        return [];
    }

    const normalized = [];
    for (const option of rawOptions) {
        if (option && typeof option === "object" && !Array.isArray(option)) {
            const hasValue = Object.prototype.hasOwnProperty.call(option, "value");
            const hasLabel = Object.prototype.hasOwnProperty.call(option, "label");
            const value = hasValue ? option.value : option.label;
            const label = hasLabel ? option.label : option.value;
            if (value !== undefined && value !== null) {
                normalized.push({
                    value: String(value),
                    label: String(label !== undefined && label !== null ? label : value),
                });
            }
            continue;
        }

        if (option !== undefined && option !== null) {
            normalized.push({ value: String(option), label: String(option) });
        }
    }

    return normalized;
}

function getSuggestionOptions(schema) {
    const options = {};

    if (Array.isArray(schema.suggestions)) {
        options.suggestions = schema.suggestions;
    }
    if (Array.isArray(schema.valueSuggestions)) {
        options.valueSuggestions = schema.valueSuggestions;
    }
    if (Array.isArray(schema.expressionSuggestions)) {
        options.expressionSuggestions = schema.expressionSuggestions;
    }
    if (schema.suggestionsByKey && typeof schema.suggestionsByKey === "object" && !Array.isArray(schema.suggestionsByKey)) {
        options.suggestionsByKey = schema.suggestionsByKey;
    }

    return options;
}

function createControl(controlKey, rawSchema) {
    const schema = normalizeControlSchema(rawSchema);
    const controlType = normalizeControlType(schema.type);
    const label = typeof schema.label === "string" && schema.label ? schema.label : humanizeKey(controlKey);
    const placeholder = typeof schema.placeholder === "string" ? schema.placeholder : "";
    const suggestionOptions = getSuggestionOptions(schema);

    let control;

    switch (controlType) {
        case "select": {
            control = new SelectControl(controlKey, {
                label,
                options: normalizeSelectOptions(schema.options),
                default: getDefaultValue(schema, undefined),
                ...suggestionOptions,
            });
            break;
        }
        case "number": {
            control = new NumberControl(controlKey, {
                label,
                min: schema.min,
                max: schema.max,
                step: schema.step,
                default: getDefaultValue(schema, 0),
                ...suggestionOptions,
            });
            break;
        }
        case "boolean":
        case "checkbox": {
            control = new CheckboxControl(controlKey, {
                label,
                default: Boolean(getDefaultValue(schema, false)),
                ...suggestionOptions,
            });
            break;
        }
        case "keyvalue": {
            control = new KeyValueControl(controlKey, {
                label,
                keyPlaceholder:
                    typeof schema.keyPlaceholder === "string" ? schema.keyPlaceholder : "Key",
                valuePlaceholder:
                    typeof schema.valuePlaceholder === "string" ? schema.valuePlaceholder : "Value",
                default: getDefaultValue(schema, []),
                ...suggestionOptions,
            });
            break;
        }
        case "code": {
            control = new CodeControl(controlKey, {
                label,
                language: typeof schema.language === "string" ? schema.language : "python",
                height: typeof schema.height === "number" ? schema.height : 200,
                placeholder,
                default: getDefaultValue(schema, ""),
                ...suggestionOptions,
            });
            break;
        }
        case "auth": {
            control = new AuthControl(controlKey, {
                label,
                default: getDefaultValue(schema, { type: "none" }),
                ...suggestionOptions,
            });
            break;
        }
        case "body_type": {
            control = new BodyTypeControl(controlKey, {
                label,
                default: getDefaultValue(schema, { content_type: "none", body: "", form_data: [] }),
                ...suggestionOptions,
            });
            break;
        }
        case "query_params": {
            control = new QueryParamsControl(controlKey, {
                label,
                default: getDefaultValue(schema, []),
                ...suggestionOptions,
            });
            break;
        }
        // -----------------------------------------------------------------------
        // Record-operation specific control types
        // -----------------------------------------------------------------------
        case "model_select": {
            // Renders as ExpressionInput (fixed mode only) with model autocomplete.
            // Suggestions are injected at render time by NodeConfigPanel via useOdooModels.
            control = new TextInputControl(controlKey, {
                label,
                placeholder,
                multiline: false,
                default: getDefaultValue(schema, ""),
                ...suggestionOptions,
            });
            control.type = "model_select"; // Override so ControlRenderer can route correctly
            break;
        }
        case "domain": {
            // Renders with DomainControl (wraps Odoo's DomainSelector).
            // Stores a plain Odoo domain string: "[]" or "[('field', 'op', val)]"
            control = new TextInputControl(controlKey, {
                label,
                placeholder: "[]",
                multiline: false,
                default: getDefaultValue(schema, "[]"),
                ...suggestionOptions,
            });
            control.type = "domain";
            break;
        }
        case "field_values": {
            // Renders with FieldValuesControl (field-name + value rows).
            // Stores a JSON object string: '{"name": "Test", "email": "{{ _input.email }}"}'
            control = new TextInputControl(controlKey, {
                label,
                placeholder: "{}",
                multiline: false,
                default: getDefaultValue(schema, "{}"),
                ...suggestionOptions,
            });
            control.type = "field_values";
            break;
        }
        case "json":
        case "text":
        case "expression":
        case "string":
        default: {
            const defaultMultiline = controlType === "text" || controlType === "json";
            control = new TextInputControl(controlKey, {
                label,
                placeholder,
                multiline: schema.multiline === true || defaultMultiline,
                default: getDefaultValue(schema, ""),
                ...suggestionOptions,
            });
            break;
        }
    }

    if (typeof schema.section === "string" && schema.section) {
        control.section = schema.section;
    }

    // Conditional visibility: copy visibleWhen conditions
    if (schema.visibleWhen && typeof schema.visibleWhen === "object") {
        control.visibleWhen = schema.visibleWhen;
    }

    return control;
}

function ensureCategory(categoryKey) {
    if (typeof categoryKey !== "string" || !categoryKey) {
        return;
    }
    if (nodeCategoryRegistry.contains(categoryKey)) {
        return;
    }

    nodeCategoryRegistry.add(
        categoryKey,
        {
            name: CATEGORY_LABELS[categoryKey] || humanizeKey(categoryKey),
            icon: DEFAULT_CATEGORY_ICON,
            description: "",
        },
        { sequence: DEFAULT_CATEGORY_SEQUENCE }
    );
}

function createDynamicNodeClass(typeDef) {
    const nodeType = getNodeTypeKey(typeDef);
    const nodeLabel =
        typeof typeDef.name === "string" && typeDef.name ? typeDef.name : humanizeKey(nodeType);
    const nodeIcon =
        typeof typeDef.icon === "string" && typeDef.icon ? typeDef.icon : DEFAULT_NODE_ICON;
    const nodeCategory =
        typeof typeDef.category === "string" && typeDef.category
            ? typeDef.category
            : DEFAULT_NODE_CATEGORY;
    const nodeDescription =
        typeof typeDef.description === "string" ? typeDef.description : "";

    const configSchema = withHttpSuggestionDefaults(
        nodeType,
        normalizeSchema(typeDef.config_schema)
    );
    const inputSchema = normalizeSchema(typeDef.input_schema);
    const outputSchema = normalizeSchema(typeDef.output_schema);

    class DynamicNode extends BaseNode {
        constructor() {
            super();

            for (const [socketKey, socketDef] of Object.entries(inputSchema)) {
                if (!socketKey) {
                    continue;
                }
                const label =
                    socketDef && typeof socketDef === "object" && !Array.isArray(socketDef)
                        ? socketDef.label || humanizeKey(socketKey)
                        : humanizeKey(socketKey);
                const multiple =
                    Boolean(
                        socketDef
                        && typeof socketDef === "object"
                        && !Array.isArray(socketDef)
                        && socketDef.multiple === true
                    );
                this.addInput(socketKey, resolveSocket(socketDef), label, { multiple });
            }

            for (const [socketKey, socketDef] of Object.entries(outputSchema)) {
                if (!socketKey) {
                    continue;
                }
                const label =
                    socketDef && typeof socketDef === "object" && !Array.isArray(socketDef)
                        ? socketDef.label || humanizeKey(socketKey)
                        : humanizeKey(socketKey);
                this.addOutput(socketKey, resolveSocket(socketDef), label);
            }

            for (const [controlKey, controlDef] of Object.entries(configSchema)) {
                if (!controlKey) {
                    continue;
                }
                this.addControl(controlKey, createControl(controlKey, controlDef));
            }
        }
    }

    DynamicNode.nodeType = nodeType;
    DynamicNode.label = nodeLabel;
    DynamicNode.icon = nodeIcon;
    DynamicNode.category = nodeCategory;
    DynamicNode.description = nodeDescription;

    return DynamicNode;
}

/**
 * Register backend-defined node types as runtime-generated node classes.
 * This is backend-driven by design: node types not returned by backend are
 * removed from frontend registry on each refresh.
 *
 * @param {Array<Object>} typeDefs
 * @returns {string[]} registered node type keys
 */
export function registerBackendNodeTypes(typeDefs = []) {
    const safeTypeDefs = Array.isArray(typeDefs) ? typeDefs : [];
    const nextKeys = new Set();

    for (const typeDef of safeTypeDefs) {
        const nodeType = getNodeTypeKey(typeDef);
        if (!nodeType) {
            continue;
        }

        nextKeys.add(nodeType);
        ensureCategory(typeDef.category || DEFAULT_NODE_CATEGORY);

        const DynamicNodeClass = createDynamicNodeClass(typeDef);
        nodeTypeRegistry.add(
            nodeType,
            {
                class: DynamicNodeClass,
                name: DynamicNodeClass.label,
                icon: DynamicNodeClass.icon,
                category: DynamicNodeClass.category,
                description: DynamicNodeClass.description || "",
            },
            { force: true }
        );
    }

    for (const [registeredKey] of nodeTypeRegistry.getEntries()) {
        if (!nextKeys.has(registeredKey)) {
            nodeTypeRegistry.remove(registeredKey);
        }
    }

    return Array.from(nextKeys);
}