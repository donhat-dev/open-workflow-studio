/** @odoo-module **/

/**
 * Normalize mixed suggestion items to a stable shape.
 * Accepts strings or objects: { value, label?, description? }
 */
export function normalizeSuggestions(rawSuggestions) {
    if (!Array.isArray(rawSuggestions)) {
        return [];
    }

    const normalized = [];
    for (const item of rawSuggestions) {
        if (typeof item === "string") {
            const value = item.trim();
            if (!value) continue;
            normalized.push({ value, label: value, description: "" });
            continue;
        }

        if (!item || typeof item !== "object" || Array.isArray(item)) {
            continue;
        }

        const rawValue = Object.prototype.hasOwnProperty.call(item, "value")
            ? item.value
            : item.label;
        if (rawValue === undefined || rawValue === null) {
            continue;
        }

        const value = String(rawValue).trim();
        if (!value) continue;

        const label = item.label === undefined || item.label === null
            ? value
            : String(item.label);
        const description = item.description === undefined || item.description === null
            ? ""
            : String(item.description);

        normalized.push({ value, label, description });
    }

    return normalized;
}

/**
 * Merge suggestions and remove duplicates by value.
 */
export function mergeUniqueSuggestions(...lists) {
    const merged = [];
    const seen = new Set();

    for (const list of lists) {
        const normalized = normalizeSuggestions(list);
        for (const item of normalized) {
            const key = item.value.toLowerCase();
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            merged.push(item);
        }
    }

    return merged;
}

/**
 * Filter suggestion items by query.
 */
export function filterSuggestions(items, query, limit = 12) {
    const safeItems = Array.isArray(items) ? items : [];
    const q = String(query || "").trim().toLowerCase();

    if (!q) {
        return safeItems.slice(0, limit);
    }

    const filtered = safeItems.filter((item) => {
        const value = String(item.value || "").toLowerCase();
        const label = String(item.label || "").toLowerCase();
        const description = String(item.description || "").toLowerCase();
        return value.includes(q) || label.includes(q) || description.includes(q);
    });

    return filtered.slice(0, limit);
}

function addNamespaceSuggestions(result, context, namespace, detail) {
    result.push({ value: namespace, label: namespace, description: detail });

    const data = context && Object.prototype.hasOwnProperty.call(context, namespace)
        ? context[namespace]
        : null;

    if (!data || typeof data !== "object" || Array.isArray(data)) {
        return;
    }

    const keys = Object.keys(data).slice(0, 30);
    for (const key of keys) {
        result.push({
            value: `${namespace}.${key}`,
            label: `${namespace}.${key}`,
            description: `${namespace} key`,
        });

        const child = data[key];
        if (!child || typeof child !== "object" || Array.isArray(child)) {
            continue;
        }

        const childKeys = Object.keys(child).slice(0, 10);
        for (const childKey of childKeys) {
            result.push({
                value: `${namespace}.${key}.${childKey}`,
                label: `${namespace}.${key}.${childKey}`,
                description: `${namespace} nested key`,
            });
        }
    }
}

function addNodeSuggestions(result, nodeContext) {
    result.push({ value: "_node", label: "_node", description: "Other node outputs" });

    if (!nodeContext || typeof nodeContext !== "object" || Array.isArray(nodeContext)) {
        return;
    }

    const nodeIds = Object.keys(nodeContext).slice(0, 20);
    for (const nodeId of nodeIds) {
        const nodeBase = `_node[\"${nodeId}\"]`;
        result.push({ value: nodeBase, label: nodeBase, description: "Node output object" });
        result.push({
            value: `${nodeBase}.json`,
            label: `${nodeBase}.json`,
            description: "Node JSON output",
        });

        const nodeData = nodeContext[nodeId];
        const nodeJson = nodeData && typeof nodeData === "object" && !Array.isArray(nodeData)
            ? nodeData.json
            : null;
        if (!nodeJson || typeof nodeJson !== "object" || Array.isArray(nodeJson)) {
            continue;
        }

        const jsonKeys = Object.keys(nodeJson).slice(0, 10);
        for (const jsonKey of jsonKeys) {
            result.push({
                value: `${nodeBase}.json.${jsonKey}`,
                label: `${nodeBase}.json.${jsonKey}`,
                description: "Node JSON key",
            });
        }
    }
}

/**
 * Build context-aware expression suggestions.
 */
export function buildContextExpressionSuggestions(context) {
    const safeContext = context && typeof context === "object" ? context : {};
    const suggestions = [];

    addNamespaceSuggestions(suggestions, safeContext, "_json", "Input data from previous node");
    addNamespaceSuggestions(suggestions, safeContext, "_input", "Input alias object");
    addNamespaceSuggestions(suggestions, safeContext, "_vars", "Workflow variables");
    addNamespaceSuggestions(suggestions, safeContext, "_execution", "Execution metadata");
    addNamespaceSuggestions(suggestions, safeContext, "_workflow", "Workflow metadata");

    suggestions.push({ value: "_loop", label: "_loop", description: "Loop context" });
    suggestions.push({ value: "_now", label: "_now", description: "Current datetime" });
    suggestions.push({ value: "_today", label: "_today", description: "Current date" });

    addNodeSuggestions(suggestions, safeContext._node);

    return mergeUniqueSuggestions(suggestions);
}

/**
 * Resolve value suggestions from map using key (case-insensitive).
 */
export function getSuggestionsByKey(suggestionsByKey, key) {
    if (!suggestionsByKey || typeof suggestionsByKey !== "object" || Array.isArray(suggestionsByKey)) {
        return [];
    }

    const normalizedKey = String(key || "").trim();
    if (!normalizedKey) {
        return [];
    }

    if (Object.prototype.hasOwnProperty.call(suggestionsByKey, normalizedKey)) {
        return normalizeSuggestions(suggestionsByKey[normalizedKey]);
    }

    const lowered = normalizedKey.toLowerCase();
    for (const [mapKey, mapValue] of Object.entries(suggestionsByKey)) {
        if (String(mapKey).toLowerCase() === lowered) {
            return normalizeSuggestions(mapValue);
        }
    }

    return [];
}