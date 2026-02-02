/** @odoo-module **/

/**
 * Expression Utilities
 * 
 * Expression handling: {{ _json.field }}, {{ _vars.name }}, {{ _loop.item }}
 * 
 * Supports all ExecutionContext namespaces:
 * - _json: Previous node output (shortcut)
 * - _node: Node outputs keyed by node ID
 * - _vars: Mutable workflow variables
 * - _loop: Current loop iteration context
 * - _input: Input data for current node
 * 
 * @core - Pure JavaScript utilities, no Odoo dependencies.
 */

/**
 * Expression regex patterns
 */
export const EXPRESSION_PATTERNS = {
    // Match {{ ... }} templates
    TEMPLATE: /\{\{(.+?)\}\}/g,
    // Match single template for extraction
    SINGLE_TEMPLATE: /\{\{(.+?)\}\}/,
    // Check if entire value is expression (n8n style: starts with =)
    EXPRESSION_PREFIX: /^=/,
    // Match namespace prefix: _json, _vars, _loop, _node, _input
    NAMESPACE: /^_(\w+)/,
};

/**
 * Supported expression namespaces
 */
export const NAMESPACES = ['_json', '_vars', '_loop', '_node', '_input'];

/**
 * Check if a value contains expression templates
 * @param {string} value - Value to check
 * @returns {boolean}
 */
export function hasExpressions(value) {
    if (typeof value !== 'string') return false;
    // IMPORTANT: do not use the global /g TEMPLATE regex with .test(),
    // as it is stateful (lastIndex) and can intermittently return false.
    // Use a non-global regex for deterministic checks.
    return EXPRESSION_PATTERNS.SINGLE_TEMPLATE.test(value);
}

/**
 * Check if value is in expression mode (n8n style: starts with =)
 * @param {string} value 
 * @returns {boolean}
 */
export function isExpressionMode(value) {
    if (typeof value !== 'string') return false;
    return value.startsWith('=');
}

/**
 * Extract all expression templates from a string
 * @param {string} value 
 * @returns {Array<{full: string, expression: string, start: number, end: number}>}
 */
export function extractExpressions(value) {
    if (typeof value !== 'string') return [];

    const results = [];
    const regex = new RegExp(EXPRESSION_PATTERNS.TEMPLATE.source, 'g');
    let match;

    while ((match = regex.exec(value)) !== null) {
        results.push({
            full: match[0],           // {{ _json.email }}
            expression: match[1].trim(), // _json.email
            start: match.index,
            end: match.index + match[0].length,
        });
    }

    return results;
}

/**
 * Generate expression path from a JSON tree path
 * @param {string[]} pathParts - Array of path segments
 * @returns {string} - Expression like _json.items[0].name
 */
export function generateExpressionPath(pathParts, root = '_json') {
    if (!pathParts || pathParts.length === 0) return root;

    let path = root;

    for (const part of pathParts) {
        // Check if part is array index
        if (/^\d+$/.test(part)) {
            path += `[${part}]`;
        }
        // Check if part needs bracket notation (spaces, dots, special chars)
        else if (/[^a-zA-Z0-9_]/.test(part)) {
            path += `['${part}']`;
        }
        // Normal dot notation
        else {
            path += `.${part}`;
        }
    }

    return path;
}

/**
 * Generate node-scoped expression path using _node namespace.
 *
 * Example:
 * - nodeId: "n_1", pathParts: ["body", "data"]
 * - result: _node["n_1"].json.body.data
 *
 * Note: nodeId must not contain unescaped quotes; IDs are expected to be safe (e.g., n_1).
 *
 * @param {string} nodeId
 * @param {string[]} pathParts
 * @returns {string}
 */
export function generateNodeSelectorExpressionPath(nodeId, pathParts) {
    if (!nodeId) {
        // Force-safe fallback
        return generateExpressionPath(pathParts, '_json');
    }

    const root = `_node["${nodeId}"].json`;
    return generateExpressionPath(pathParts, root);
}

/**
 * Wrap expression in template syntax
 * @param {string} expression - e.g., _json.email
 * @returns {string} - e.g., {{ _json.email }}
 */
export function wrapExpression(expression) {
    return `{{ ${expression} }}`;
}

/**
 * Parse an expression path into namespace and parts
 * @param {string} path - e.g., _json.items[0].name, _vars.result, _loop.item
 * @returns {{ namespace: string, parts: string[] }}
 */
export function parseExpressionPath(path) {
    if (!path || typeof path !== 'string') {
        return { namespace: null, parts: [] };
    }

    // Extract namespace
    const nsMatch = path.match(EXPRESSION_PATTERNS.NAMESPACE);
    const namespace = nsMatch ? `_${nsMatch[1]}` : null;

    // Remove namespace prefix for path parsing
    let cleanPath = path;
    if (namespace) {
        const prefixLength = nsMatch[0].length;
        cleanPath = path.slice(prefixLength);
        // Remove leading dot if present
        if (cleanPath.startsWith('.')) {
            cleanPath = cleanPath.slice(1);
        }
    }

    if (!cleanPath) {
        return { namespace, parts: [] };
    }

    const parts = [];
    // Match: property, .property, ['property'], [0], ["property"]
    const regex = /\.?([a-zA-Z_][a-zA-Z0-9_]*)|(\[(\d+)\])|(\['([^']+)'\])|(\["([^"]+)"\])/g;
    let match;

    while ((match = regex.exec(cleanPath)) !== null) {
        if (match[1]) parts.push(match[1]);       // property or .property
        else if (match[3]) parts.push(match[3]); // [0]
        else if (match[5]) parts.push(match[5]); // ['property']
        else if (match[7]) parts.push(match[7]); // ["property"]
    }

    return { namespace, parts };
}

/**
 * Parse path and return just parts
 * @param {string} path 
 * @returns {string[]}
 */
export function parsePathParts(path) {
    return parseExpressionPath(path).parts;
}

/**
 * Get value from object using expression path
 * @param {Object} data - Source data object (for single namespace)
 * @param {string} path - Expression path like items[0].name (without namespace)
 * @returns {*} - Value at path or undefined
 */
export function getValueByPath(data, path) {
    const { parts } = parseExpressionPath(path);

    let current = data;
    for (const part of parts) {
        if (current === null || current === undefined) return undefined;
        current = current[part];
    }

    return current;
}

/**
 * Resolve value from full expression context
 * Supports all namespaces: _json, _vars, _loop, _node, _input
 * 
 * @param {string} expression - Expression like _json.email, _vars.result, _loop.item
 * @param {Object} context - Full context { _json, _vars, _loop, _node, _input }
 * @returns {*} - Resolved value or undefined
 */
export function resolveExpression(expression, context = {}) {
    const { namespace, parts } = parseExpressionPath(expression);

    if (!namespace) {
        throw new Error(`Invalid expression namespace. Use one of: ${NAMESPACES.join(', ')}`);
    }

    if (!NAMESPACES.includes(namespace)) {
        throw new Error(`Unsupported namespace ${namespace}. Use one of: ${NAMESPACES.join(', ')}`);
    }

    // Determine source data based on namespace
    let source;
    switch (namespace) {
        case '_json':
            source = context._json || {};
            break;
        case '_input':
            source = context._input || {};
            break;
        case '_vars':
            source = context._vars || {};
            break;
        case '_loop':
            source = context._loop || {};
            break;
        case '_node':
            source = context._node || {};
            break;
        default:
            return undefined;
    }

    // Navigate to value
    let current = source;
    for (const part of parts) {
        if (current === null || current === undefined) return undefined;
        current = current[part];
    }

    return current;
}

/**
 * Evaluate a simple expression against context
 * Supports all namespaces: _json, _vars, _loop, _node
 * 
 * Note: This is a basic evaluator for client-side preview.
 * Full evaluation happens on Python engine.
 * 
 * @param {string} expression - Expression like {{ _json.email }} or {{ _vars.result }}
 * @param {Object} context - Context object { _json, _vars, _loop, _node }
 * @returns {{ value: *, error: string|null }}
 */
export function evaluateExpression(expression, context = {}) {
    try {
        // Extract template content
        const templates = extractExpressions(expression);

        if (templates.length === 0) {
            // No templates, return as-is
            return { value: expression, error: null };
        }

        // For single template, evaluate and return value
        if (templates.length === 1 && templates[0].full === expression) {
            const value = resolveExpression(templates[0].expression, context);
            return { value, error: null };
        }

        // Multiple templates or mixed content: replace each
        let result = expression;
        for (const tmpl of templates) {
            const value = resolveExpression(tmpl.expression, context);
            const stringValue = value === undefined ? '' : String(value);
            result = result.replace(tmpl.full, stringValue);
        }

        return { value: result, error: null };
    } catch (err) {
        return { value: null, error: err.message };
    }
}
