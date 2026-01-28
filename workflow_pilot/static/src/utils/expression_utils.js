/** @odoo-module **/

/**
 * Expression Utilities
 * 
 * n8n-style expression handling: {{ $json.field }}, {{ $vars.name }}, {{ $loop.item }}
 * Bare namespace handling: {{ json.field }}, {{ vars.name }}, {{ input.item }}
 * 
 * Supports all ExecutionContext namespaces:
 * - $json: Previous node output (shortcut)
 * - $node: Node outputs keyed by node ID
 * - $vars: Mutable workflow variables
 * - $loop: Current loop iteration context
 * - $input: Input data for current node
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
    // Match namespace prefix: $json, $vars, $loop, $node, $input
    NAMESPACE: /^\$(\w+)/,
    // Match bare namespace: json, vars, loop, node, input
    BARE_NAMESPACE: /^(json|vars|loop|node|input)(?=\.|\[|$)/,
    // n8n-style node selector: $('nodeId') or $("nodeId")
    NODE_SELECTOR: /\$\(\s*['"]([^'"]+)['"]\s*\)/g,
    // Single node selector match
    SINGLE_NODE_SELECTOR: /^\$\(\s*['"]([^'"]+)['"]\s*\)/,
};

/**
 * Supported expression namespaces
 */
export const NAMESPACES = ['$json', '$vars', '$loop', '$node', '$input'];

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
export function generateExpressionPath(pathParts, root = '$json') {
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
 * Generate node-scoped expression path using n8n-style node selector.
 *
 * Example:
 * - nodeId: "n_1", pathParts: ["body", "data"]
 * - result: $("n_1").json.body.data
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
        return generateExpressionPath(pathParts, '$json');
    }

    // Prefer double quotes for consistency and to avoid common single-quote pitfalls.
    // Supported by rewriteNodeSelector(): $("nodeId").json...
    const root = `$("${nodeId}").json`;
    return generateExpressionPath(pathParts, root);
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
 * Rewrite n8n-style node selector to standard $node path.
 * 
 * Converts: $('n_1').json.body.data  →  $node['n_1'].json.body.data
 * Converts: $("n_1").json.key       →  $node['n_1'].json.key
 * 
 * @param {string} expression - Expression that may contain $('nodeId') selectors
 * @returns {{ rewritten: string, error: string|null }}
 */
export function rewriteNodeSelector(expression) {
    if (!expression || typeof expression !== 'string') {
        return { rewritten: expression, error: null };
    }

    // Check if expression contains node selector pattern
    if (!expression.includes('$(')) {
        return { rewritten: expression, error: null };
    }

    let result = expression;
    let hasError = null;

    // Replace all $('nodeId') or $("nodeId") with $node['nodeId']
    result = result.replace(EXPRESSION_PATTERNS.NODE_SELECTOR, (match, nodeId) => {
        return `$node['${nodeId}']`;
    });

    // Validate: after rewrite, $node['id'] must be followed by .json
    // Pattern: $node['...'] not followed by .json is invalid
    const invalidPattern = /\$node\['[^']+'](?!\.json)/g;
    if (invalidPattern.test(result)) {
        // Check if it's actually missing .json or has different property
        const checkPattern = /\$node\['[^']+'](\.\w+)?/g;
        let match;
        while ((match = checkPattern.exec(result)) !== null) {
            const afterBracket = match[1];
            if (afterBracket && !afterBracket.startsWith('.json')) {
                hasError = `Node selector must use .json accessor, got: ${match[0]}`;
                break;
            }
        }
    }

    return { rewritten: result, error: hasError };
}

/**
 * Parse an expression path into namespace and parts
 * @param {string} path - e.g., $json.items[0].name, $vars.result, $loop.item
 * @returns {{ namespace: string, parts: string[] }}
 */
export function parseExpressionPath(path) {
    if (!path || typeof path !== 'string') {
        return { namespace: null, parts: [] };
    }

    // Extract namespace
    const nsMatch = path.match(EXPRESSION_PATTERNS.NAMESPACE);
    const bareMatch = nsMatch ? null : path.match(EXPRESSION_PATTERNS.BARE_NAMESPACE);
    const namespace = nsMatch
        ? `$${nsMatch[1]}`
        : (bareMatch ? `$${bareMatch[1]}` : null);

    // Remove namespace prefix for path parsing
    let cleanPath = path;
    if (namespace) {
        const prefixLength = nsMatch ? namespace.length : bareMatch[1].length;
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
 * Legacy: Parse path and return just parts (for backward compatibility)
 * @deprecated Use parseExpressionPath() instead
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
 * Supports all namespaces: $json, $vars, $loop, $node, $input
 * 
 * @param {string} expression - Expression like $json.email, $vars.result, $loop.item
 * @param {Object} context - Full context { $json, $vars, $loop, $node, $input }
 * @returns {*} - Resolved value or undefined
 */
export function resolveExpression(expression, context = {}) {
    const { namespace, parts } = parseExpressionPath(expression);

    // Determine source data based on namespace
    let source;
    switch (namespace) {
        case '$json':
            source = context.$json || {};
            break;
        case '$input':
            source = context.$input || {};
            break;
        case '$vars':
            source = context.$vars || {};
            break;
        case '$loop':
            source = context.$loop || {};
            break;
        case '$node':
            source = context.$node || {};
            break;
        default:
            // No namespace - try to resolve as-is (backward compat)
            source = context.$json || {};
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
 * Supports all namespaces: $json, $vars, $loop, $node
 * 
 * Note: This is a basic evaluator for client-side preview.
 * Full evaluation happens on Python engine.
 * 
 * @param {string} expression - Expression like {{ $json.email }} or {{ $vars.result }}
 * @param {Object} context - Context object { $json, $vars, $loop, $node }
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
            // Rewrite n8n-style node selectors before resolving
            const { rewritten, error: rewriteError } = rewriteNodeSelector(templates[0].expression);
            if (rewriteError) {
                return { value: null, error: rewriteError };
            }
            const value = resolveExpression(rewritten, context);
            return { value, error: null };
        }

        // Multiple templates or mixed content: replace each
        let result = expression;
        for (const tmpl of templates) {
            // Rewrite n8n-style node selectors
            const { rewritten, error: rewriteError } = rewriteNodeSelector(tmpl.expression);
            if (rewriteError) {
                return { value: null, error: rewriteError };
            }
            const value = resolveExpression(rewritten, context);
            const stringValue = value === undefined ? '' : String(value);
            result = result.replace(tmpl.full, stringValue);
        }

        return { value: result, error: null };
    } catch (err) {
        return { value: null, error: err.message };
    }
}
