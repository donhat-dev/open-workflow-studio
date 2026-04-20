/** @odoo-module **/

import { registry } from "@web/core/registry";
import { fuzzyLookup } from "@web/core/utils/search";

const nodeTypeRegistry = registry.category("workflow_node_types");
const nodeCategoryRegistry = registry.category("workflow_node_categories");
const MAX_RECENT = 10;
let recentNodeKeys = [];

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

export function getAllNodeTypes(backendTypes = null) {
    const hasBackendTypes = Array.isArray(backendTypes) && backendTypes.length > 0;
    if (hasBackendTypes) {
        return backendTypes.map((entry) => {
            const key = getNodeTypeKey(entry);
            if (!key) {
                return null;
            }
            if (!nodeTypeRegistry.contains(key)) {
                console.warn(`[workflowNode] Missing frontend node class for "${key}"`);
                return null;
            }
            const value = nodeTypeRegistry.get(key);
            const NodeClass = value.class || value;
            if (typeof NodeClass !== 'function') {
                console.warn(`[workflowNode] Invalid node type "${key}":`, value);
                return null;
            }
            return {
                key,
                class: NodeClass,
                name: entry.name || NodeClass.label || value.name || key,
                icon: entry.icon || NodeClass.icon || value.icon || "fa-cube",
                category: entry.category || NodeClass.category || value.category || "action",
                description: entry.description || NodeClass.description || value.description || "",
                group: entry.group || NodeClass.group || value.group || "",
            };
        }).filter(Boolean);
    }

    return nodeTypeRegistry.getEntries().map(([key, value]) => {
        const NodeClass = value.class || value;
        const isClass = typeof NodeClass === 'function';

        if (!isClass) {
            console.warn(`[workflowNode] Invalid node type "${key}":`, value);
            return null;
        }

        return {
            key,
            class: NodeClass,
            name: NodeClass.label || value.name || key,
            icon: NodeClass.icon || value.icon || "fa-cube",
            category: NodeClass.category || value.category || "action",
            description: NodeClass.description || value.description || "",
            group: NodeClass.group || value.group || "",
        };
    }).filter(Boolean);
}

export function getNodeType(key, backendTypes = null) {
    if (!nodeTypeRegistry.contains(key)) {
        return null;
    }
    const value = nodeTypeRegistry.get(key);
    const NodeClass = value.class || value;
    const backend = findBackendType(backendTypes, key);

    return {
        key,
        class: NodeClass,
        name: (backend && backend.name) || NodeClass.label || value.name || key,
        icon: (backend && backend.icon) || NodeClass.icon || value.icon || "fa-cube",
        category: (backend && backend.category) || NodeClass.category || value.category || "action",
        description: (backend && backend.description) || NodeClass.description || value.description || "",
        group: (backend && backend.group) || NodeClass.group || value.group || "",
    };
}

export function getNodeClass(key) {
    if (!nodeTypeRegistry.contains(key)) {
        return null;
    }
    const value = nodeTypeRegistry.get(key);
    return value.class || value;
}

export function pruneRecentNodes(validKeys = []) {
    const valid = new Set(Array.isArray(validKeys) ? validKeys : []);
    if (!valid.size) {
        recentNodeKeys = [];
        return;
    }
    recentNodeKeys = recentNodeKeys.filter((nodeKey) => valid.has(nodeKey));
}

export function getCategories() {
    const entries = nodeCategoryRegistry.getEntries();
    return entries
        .map(([key, value]) => ({ key, ...value }))
        .sort((a, b) => {
            const seqA = nodeCategoryRegistry.get(a.key, { sequence: 100 }).sequence || 100;
            const seqB = nodeCategoryRegistry.get(b.key, { sequence: 100 }).sequence || 100;
            return seqA - seqB;
        });
}

export function searchNodes(searchValue = "", options = {}, backendTypes = null) {
    let nodes = getAllNodeTypes(backendTypes);

    if (options.category) {
        nodes = nodes.filter(n => n.category === options.category);
    }

    if (searchValue && searchValue.trim()) {
        nodes = fuzzyLookup(searchValue, nodes, (n) => n.name);
    }

    return groupByCategory(nodes);
}

export function trackNodeUsage(nodeKey) {
    recentNodeKeys = recentNodeKeys.filter(k => k !== nodeKey);
    recentNodeKeys.unshift(nodeKey);
    recentNodeKeys = recentNodeKeys.slice(0, MAX_RECENT);
}

export function getRecentNodes(limit = 5) {
    return recentNodeKeys
        .slice(0, limit)
        .map(key => getNodeType(key))
        .filter(Boolean);
}

export function clearRecentNodes() {
    recentNodeKeys = [];
}

function groupByCategory(nodes) {
    const categories = getCategories();
    const grouped = [];

    for (const cat of categories) {
        const catNodes = nodes.filter(n => n.category === cat.key);
        if (catNodes.length) {
            grouped.push({
                key: cat.key,
                name: cat.name,
                icon: cat.icon,
                nodes: catNodes,
            });
        }
    }

    const categorized = new Set(categories.map(c => c.key));
    const uncategorized = nodes.filter(n => !categorized.has(n.category));
    if (uncategorized.length) {
        grouped.push({
            key: "default",
            name: "Other",
            icon: "fa-cube",
            nodes: uncategorized,
        });
    }

    return grouped;
}

function findBackendType(backendTypes, key) {
    if (!Array.isArray(backendTypes)) {
        return null;
    }
    for (const entry of backendTypes) {
        const entryKey = getNodeTypeKey(entry);
        if (entryKey === key) {
            return entry;
        }
    }
    return null;
}
