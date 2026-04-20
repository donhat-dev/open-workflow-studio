/** @odoo-module **/

const CONNECTOR_RELATION_KEYS = new Set([
    "connector_id",
    "workspace_id",
    "endpoint_id",
    "auth_profile_id",
]);

function isPlainObject(value) {
    return value && typeof value === "object" && !Array.isArray(value);
}

function hasEnabledKeyValueEntries(rows) {
    if (!Array.isArray(rows)) {
        return false;
    }
    return rows.some((row) => {
        if (!isPlainObject(row)) {
            return false;
        }
        const key = typeof row.key === "string" ? row.key.trim() : "";
        if (!key) {
            return false;
        }
        return row.enabled !== false;
    });
}

function isBlankBodyConfig(bodyConfig) {
    if (!isPlainObject(bodyConfig)) {
        return true;
    }

    const contentType = typeof bodyConfig.content_type === "string"
        ? bodyConfig.content_type.trim().toLowerCase()
        : "none";

    if (!contentType || contentType === "none") {
        return true;
    }

    if (contentType === "form_data" || contentType === "urlencoded") {
        return !hasEnabledKeyValueEntries(bodyConfig.form_data);
    }

    return false;
}

export function sanitizeConnectorRequestConfig(rawConfig) {
    if (!isPlainObject(rawConfig)) {
        return {};
    }

    const config = { ...rawConfig };

    for (const relationKey of CONNECTOR_RELATION_KEYS) {
        const value = config[relationKey];
        if (value === undefined || value === null || value === "" || value === 0) {
            delete config[relationKey];
        }
    }

    if (!String(config.url || "").trim()) {
        delete config.url;
    }

    if (!String(config.method || "").trim()) {
        delete config.method;
    }

    if (!hasEnabledKeyValueEntries(config.headers)) {
        delete config.headers;
    }

    if (!hasEnabledKeyValueEntries(config.query_params)) {
        delete config.query_params;
    }

    if (isBlankBodyConfig(config.body_config)) {
        delete config.body_config;
    }

    if (config.timeout === undefined || config.timeout === null || config.timeout === "") {
        delete config.timeout;
    }

    return config;
}

export function sanitizeConnectorRequestSnapshot(snapshot) {
    if (!isPlainObject(snapshot) || !Array.isArray(snapshot.nodes)) {
        return snapshot;
    }

    return {
        ...snapshot,
        nodes: snapshot.nodes.map((node) => {
            if (!isPlainObject(node) || node.type !== "connector_request") {
                return node;
            }
            return {
                ...node,
                config: sanitizeConnectorRequestConfig(node.config),
            };
        }),
    };
}
