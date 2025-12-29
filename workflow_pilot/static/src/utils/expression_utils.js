/** @odoo-module **/

/**
 * Expression Utilities
 * 
 * n8n-style expression handling: {{ $json.field }}
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
};

/**
 * Check if a value contains expression templates
 * @param {string} value - Value to check
 * @returns {boolean}
 */
export function hasExpressions(value) {
    if (typeof value !== 'string') return false;
    return EXPRESSION_PATTERNS.TEMPLATE.test(value);
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
            full: match[0],           // {{ $json.email }}
            expression: match[1].trim(), // $json.email
            start: match.index,
            end: match.index + match[0].length,
        });
    }

    return results;
}

/**
 * Generate expression path from a JSON tree path
 * @param {string[]} pathParts - Array of path segments
 * @returns {string} - Expression like $json.items[0].name
 */
export function generateExpressionPath(pathParts) {
    if (!pathParts || pathParts.length === 0) return '$json';

    let path = '$json';

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
 * Wrap expression in template syntax
 * @param {string} expression - e.g., $json.email
 * @returns {string} - e.g., {{ $json.email }}
 */
export function wrapExpression(expression) {
    return `{{ ${expression} }}`;
}

/**
 * Parse an expression path into parts
 * @param {string} path - e.g., $json.items[0].name
 * @returns {string[]} - ['items', '0', 'name']
 */
export function parseExpressionPath(path) {
    if (!path || typeof path !== 'string') return [];

    // Remove $json prefix
    let cleanPath = path.replace(/^\$json\.?/, '');
    if (!cleanPath) return [];

    const parts = [];
    // Match: .property, ['property'], [0]
    const regex = /\.?([a-zA-Z_][a-zA-Z0-9_]*)|(\[(\d+)\])|(\['([^']+)'\])/g;
    let match;

    while ((match = regex.exec(cleanPath)) !== null) {
        if (match[1]) parts.push(match[1]);       // .property
        else if (match[3]) parts.push(match[3]); // [0]
        else if (match[5]) parts.push(match[5]); // ['property']
    }

    return parts;
}

/**
 * Get value from object using expression path
 * @param {Object} data - Source data object
 * @param {string} path - Expression path like $json.items[0].name
 * @returns {*} - Value at path or undefined
 */
export function getValueByPath(data, path) {
    const parts = parseExpressionPath(path);

    let current = data;
    for (const part of parts) {
        if (current === null || current === undefined) return undefined;
        current = current[part];
    }

    return current;
}

/**
 * Evaluate a simple expression against context
 * Note: This is a basic evaluator for client-side preview.
 * Full evaluation happens on Python engine.
 * 
 * @param {string} expression - Expression like {{ $json.email }}
 * @param {Object} context - Context object { $json: {...} }
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
            const value = getValueByPath(context.$json || {}, templates[0].expression);
            return { value, error: null };
        }

        // Multiple templates or mixed content: replace each
        let result = expression;
        for (const tmpl of templates) {
            const value = getValueByPath(context.$json || {}, tmpl.expression);
            const stringValue = value === undefined ? '' : String(value);
            result = result.replace(tmpl.full, stringValue);
        }

        return { value: result, error: null };
    } catch (err) {
        return { value: null, error: err.message };
    }
}
