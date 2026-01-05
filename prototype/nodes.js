/**
 * Workflow Builder - Node Definitions
 * Rete.js v2 node classes for HTTP Request, Data Validation, and Data Mapping
 */

const { ClassicPreset } = Rete;

// ============================================
// SOCKET TYPES
// ============================================
class DataSocket extends ClassicPreset.Socket {
    constructor() {
        super("Data");
    }
}

class ErrorSocket extends ClassicPreset.Socket {
    constructor() {
        super("Error");
    }
}

// Shared socket instances
const dataSocket = new DataSocket();
const errorSocket = new ErrorSocket();

// ============================================
// CONTROL TYPES
// ============================================

/**
 * Text Input Control
 */
class TextInputControl extends ClassicPreset.Control {
    constructor(initial = "", options = {}) {
        super();
        this.value = initial;
        this.placeholder = options.placeholder || "";
        this.label = options.label || "";
        this.multiline = options.multiline || false;
    }

    setValue(value) {
        this.value = value;
    }
}

/**
 * Select Control
 */
class SelectControl extends ClassicPreset.Control {
    constructor(options = [], initial = null, config = {}) {
        super();
        this.options = options;
        this.value = initial || (options.length > 0 ? options[0].value : null);
        this.label = config.label || "";
    }

    setValue(value) {
        this.value = value;
    }
}

/**
 * Key-Value Pairs Control (for headers, mappings)
 */
class KeyValueControl extends ClassicPreset.Control {
    constructor(initial = [], options = {}) {
        super();
        this.pairs = initial.length > 0 ? initial : [{ key: "", value: "" }];
        this.label = options.label || "";
        this.keyPlaceholder = options.keyPlaceholder || "Key";
        this.valuePlaceholder = options.valuePlaceholder || "Value";
    }

    addPair() {
        this.pairs.push({ key: "", value: "" });
    }

    removePair(index) {
        if (this.pairs.length > 1) {
            this.pairs.splice(index, 1);
        }
    }

    setPair(index, key, value) {
        if (this.pairs[index]) {
            this.pairs[index] = { key, value };
        }
    }
}

// ============================================
// NODE DEFINITIONS
// ============================================

/**
 * HTTP Request Node
 * Configures HTTP requests with URL, method, headers, and body
 */
class HttpRequestNode extends ClassicPreset.Node {
    constructor() {
        super("HTTP Request");
        this.nodeType = "http";

        // Inputs
        this.addInput("data", new ClassicPreset.Input(dataSocket, "Input Data"));

        // Outputs
        this.addOutput("response", new ClassicPreset.Output(dataSocket, "Response"));
        this.addOutput("error", new ClassicPreset.Output(errorSocket, "Error"));

        // Controls
        this.addControl("method", new SelectControl([
            { value: "GET", label: "GET" },
            { value: "POST", label: "POST" },
            { value: "PUT", label: "PUT" },
            { value: "PATCH", label: "PATCH" },
            { value: "DELETE", label: "DELETE" }
        ], "GET", { label: "Method" }));

        this.addControl("url", new TextInputControl("", {
            label: "URL",
            placeholder: "https://api.example.com/endpoint"
        }));

        this.addControl("headers", new KeyValueControl([], {
            label: "Headers",
            keyPlaceholder: "Header name",
            valuePlaceholder: "Header value"
        }));

        this.addControl("body", new TextInputControl("", {
            label: "Request Body",
            placeholder: '{"key": "value"}',
            multiline: true
        }));
    }

    getConfig() {
        return {
            method: this.controls.method.value,
            url: this.controls.url.value,
            headers: this.controls.headers.pairs.filter(p => p.key),
            body: this.controls.body.value
        };
    }
    /**
     * Execute HTTP request - Dataflow worker method
     * @param {Object} inputs - Input data from connected nodes
     * @returns {Object} Output data for connected nodes
     */
    async data(inputs) {
        const config = this.getConfig();
        const inputData = inputs.data?.[0] || {};

        // Interpolate variables in URL and body
        let url = config.url;
        let body = config.body;

        // Simple variable interpolation: {{fieldName}}
        const interpolate = (str, data) => {
            if (!str) return str;
            return str.replace(/\{\{(\w+)\}\}/g, (match, key) => {
                return data[key] !== undefined ? data[key] : match;
            });
        };

        if (inputData && typeof inputData === 'object') {
            url = interpolate(url, inputData);
            body = interpolate(body, inputData);
        }

        // Validate URL
        if (!url || url.trim() === '') {
            console.log('[HTTP] No URL configured - using mock response');
            return {
                response: {
                    _mock: true,
                    message: 'No URL configured. Configure URL in properties panel.',
                    inputData: inputData
                },
                error: null
            };
        }

        // Check if URL starts with http:// or https://
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            console.log('[HTTP] Invalid URL protocol - must be http:// or https://');
            return {
                response: null,
                error: { message: `Invalid URL: must start with http:// or https://. Got: ${url}` }
            };
        }

        try {
            // Build headers object
            const headers = {};
            config.headers.forEach(h => {
                if (h.key) {
                    headers[h.key] = interpolate(h.value, inputData);
                }
            });

            // Make HTTP request
            const fetchOptions = {
                method: config.method,
                headers: headers
            };

            if (['POST', 'PUT', 'PATCH'].includes(config.method) && body) {
                fetchOptions.body = body;
                if (!headers['Content-Type']) {
                    headers['Content-Type'] = 'application/json';
                }
            }

            console.log(`[HTTP] ${config.method} ${url}`);
            const response = await fetch(url, fetchOptions);

            let responseData;
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                responseData = await response.json();
            } else {
                responseData = await response.text();
            }

            if (!response.ok) {
                return {
                    response: null,
                    error: { status: response.status, message: responseData }
                };
            }

            return {
                response: responseData,
                error: null
            };
        } catch (err) {
            console.error('[HTTP] Error:', err);
            return {
                response: null,
                error: { message: err.message }
            };
        }
    }
}

/**
 * Data Validation Node
 * Validates incoming data against defined rules
 */
class DataValidationNode extends ClassicPreset.Node {
    constructor() {
        super("Data Validation");
        this.nodeType = "validation";

        // Inputs
        this.addInput("data", new ClassicPreset.Input(dataSocket, "Input Data"));

        // Outputs
        this.addOutput("valid", new ClassicPreset.Output(dataSocket, "Valid Data"));
        this.addOutput("invalid", new ClassicPreset.Output(errorSocket, "Validation Errors"));

        // Controls
        this.addControl("requiredFields", new TextInputControl("", {
            label: "Required Fields",
            placeholder: "field1, field2, field3"
        }));

        this.addControl("schema", new TextInputControl("", {
            label: "Validation Schema (JSON)",
            placeholder: '{"field": {"type": "string", "minLength": 1}}',
            multiline: true
        }));

        this.addControl("customRules", new KeyValueControl([], {
            label: "Custom Rules",
            keyPlaceholder: "Field path",
            valuePlaceholder: "Rule (regex or expression)"
        }));
    }

    getConfig() {
        return {
            requiredFields: this.controls.requiredFields.value
                .split(",")
                .map(f => f.trim())
                .filter(f => f),
            schema: this.controls.schema.value,
            customRules: this.controls.customRules.pairs.filter(p => p.key)
        };
    }

    /**
     * Validate input data - Dataflow worker method
     * @param {Object} inputs - Input data from connected nodes
     * @returns {Object} Valid data or validation errors
     */
    async data(inputs) {
        const config = this.getConfig();
        const inputData = inputs.data?.[0] || {};
        const errors = [];

        // Check required fields
        config.requiredFields.forEach(field => {
            const value = this.getNestedValue(inputData, field);
            if (value === undefined || value === null || value === '') {
                errors.push({ field, message: `Field '${field}' is required` });
            }
        });

        // Parse and apply schema validation
        if (config.schema) {
            try {
                const schema = JSON.parse(config.schema);
                Object.entries(schema).forEach(([field, rules]) => {
                    const value = this.getNestedValue(inputData, field);

                    // Type checking
                    if (rules.type && value !== undefined) {
                        const actualType = typeof value;
                        if (rules.type === 'array' && !Array.isArray(value)) {
                            errors.push({ field, message: `Expected array, got ${actualType}` });
                        } else if (rules.type !== 'array' && actualType !== rules.type) {
                            errors.push({ field, message: `Expected ${rules.type}, got ${actualType}` });
                        }
                    }

                    // Min length for strings
                    if (rules.minLength && typeof value === 'string' && value.length < rules.minLength) {
                        errors.push({ field, message: `Minimum length is ${rules.minLength}` });
                    }

                    // Min/max for numbers
                    if (rules.min !== undefined && typeof value === 'number' && value < rules.min) {
                        errors.push({ field, message: `Minimum value is ${rules.min}` });
                    }
                    if (rules.max !== undefined && typeof value === 'number' && value > rules.max) {
                        errors.push({ field, message: `Maximum value is ${rules.max}` });
                    }
                });
            } catch (e) {
                errors.push({ field: '_schema', message: 'Invalid schema JSON' });
            }
        }

        // Apply custom regex rules
        config.customRules.forEach(rule => {
            const value = this.getNestedValue(inputData, rule.key);
            if (value !== undefined && typeof value === 'string') {
                try {
                    const regex = new RegExp(rule.value);
                    if (!regex.test(value)) {
                        errors.push({ field: rule.key, message: `Does not match pattern: ${rule.value}` });
                    }
                } catch (e) {
                    errors.push({ field: rule.key, message: `Invalid regex: ${rule.value}` });
                }
            }
        });

        console.log(`[Validation] ${errors.length} errors found`);

        if (errors.length > 0) {
            return {
                valid: null,
                invalid: { errors, data: inputData }
            };
        }

        return {
            valid: inputData,
            invalid: null
        };
    }

    // Helper to get nested object values like "user.profile.name"
    getNestedValue(obj, path) {
        return path.split('.').reduce((current, key) =>
            current && current[key] !== undefined ? current[key] : undefined, obj);
    }
}

/**
 * Data Mapping Node
 * Maps and transforms data fields from source to target structure
 */
class DataMappingNode extends ClassicPreset.Node {
    constructor() {
        super("Data Mapping");
        this.nodeType = "mapping";

        // Inputs
        this.addInput("data", new ClassicPreset.Input(dataSocket, "Input Data"));

        // Outputs
        this.addOutput("mapped", new ClassicPreset.Output(dataSocket, "Mapped Data"));

        // Controls
        this.addControl("mappings", new KeyValueControl([], {
            label: "Field Mappings",
            keyPlaceholder: "Source path (e.g., user.name)",
            valuePlaceholder: "Target path"
        }));

        this.addControl("transform", new SelectControl([
            { value: "none", label: "None" },
            { value: "uppercase", label: "Uppercase" },
            { value: "lowercase", label: "Lowercase" },
            { value: "trim", label: "Trim Whitespace" },
            { value: "number", label: "To Number" },
            { value: "string", label: "To String" },
            { value: "boolean", label: "To Boolean" },
            { value: "json_parse", label: "JSON Parse" },
            { value: "json_stringify", label: "JSON Stringify" }
        ], "none", { label: "Transform Function" }));

        this.addControl("defaultValue", new TextInputControl("", {
            label: "Default Value",
            placeholder: "Value if source is empty"
        }));
    }

    getConfig() {
        return {
            mappings: this.controls.mappings.pairs.filter(p => p.key),
            transform: this.controls.transform.value,
            defaultValue: this.controls.defaultValue.value
        };
    }

    /**
     * Map and transform data - Dataflow worker method
     * @param {Object} inputs - Input data from connected nodes
     * @returns {Object} Transformed/mapped data
     */
    async data(inputs) {
        const config = this.getConfig();
        const inputData = inputs.data?.[0] || {};
        const result = {};

        // Apply field mappings
        config.mappings.forEach(mapping => {
            let value = this.getNestedValue(inputData, mapping.key);

            // Use default if value is empty
            if (value === undefined || value === null || value === '') {
                value = config.defaultValue;
            }

            // Apply transform
            if (value !== undefined && value !== null) {
                value = this.applyTransform(value, config.transform);
            }

            // Set the mapped value
            this.setNestedValue(result, mapping.value, value);
        });

        console.log(`[Mapping] Mapped ${config.mappings.length} fields`);

        return {
            mapped: result
        };
    }

    // Helper to get nested object values
    getNestedValue(obj, path) {
        return path.split('.').reduce((current, key) =>
            current && current[key] !== undefined ? current[key] : undefined, obj);
    }

    // Helper to set nested object values
    setNestedValue(obj, path, value) {
        const keys = path.split('.');
        const lastKey = keys.pop();
        const target = keys.reduce((current, key) => {
            if (!current[key]) current[key] = {};
            return current[key];
        }, obj);
        target[lastKey] = value;
    }

    // Apply transformation function
    applyTransform(value, transform) {
        switch (transform) {
            case 'uppercase':
                return typeof value === 'string' ? value.toUpperCase() : value;
            case 'lowercase':
                return typeof value === 'string' ? value.toLowerCase() : value;
            case 'trim':
                return typeof value === 'string' ? value.trim() : value;
            case 'number':
                return Number(value);
            case 'string':
                return String(value);
            case 'boolean':
                return Boolean(value);
            case 'json_parse':
                try { return JSON.parse(value); } catch { return value; }
            case 'json_stringify':
                return JSON.stringify(value);
            default:
                return value;
        }
    }
}

/**
 * Code Node
 * Executes custom JavaScript code with Monaco editor
 */
class CodeNode extends ClassicPreset.Node {
    constructor() {
        super("Code");
        this.nodeType = "code";

        // Inputs
        this.addInput("data", new ClassicPreset.Input(dataSocket, "Input Data"));

        // Outputs
        this.addOutput("result", new ClassicPreset.Output(dataSocket, "Result"));
        this.addOutput("error", new ClassicPreset.Output(errorSocket, "Error"));

        // Controls
        this.addControl("code", new TextInputControl(`// Nhập code JavaScript
// Input data: biến 'data'
// Return: giá trị output

return {
  message: "Hello from Code Node!",
  inputData: data
};`, {
            label: "Code",
            multiline: true
        }));

        this.addControl("language", new SelectControl([
            { value: "javascript", label: "JavaScript" }
        ], "javascript", { label: "Language" }));
    }

    getConfig() {
        return {
            code: this.controls.code.value,
            language: this.controls.language.value
        };
    }

    /**
     * Execute code - Dataflow worker method
     * @param {Object} inputs - Input data from connected nodes
     * @returns {Object} Execution result or error
     */
    async data(inputs) {
        const config = this.getConfig();
        const inputData = inputs.data?.[0] || {};

        try {
            // Create safe execution context
            const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
            const executeFn = new AsyncFunction('data', config.code);
            
            console.log('[Code] Executing code...');
            const result = await executeFn(inputData);

            return {
                result: result,
                error: null
            };
        } catch (err) {
            console.error('[Code] Execution error:', err);
            return {
                result: null,
                error: { 
                    message: err.message,
                    stack: err.stack
                }
            };
        }
    }
}

// Export for use in app.js
window.WorkflowNodes = {
    DataSocket,
    ErrorSocket,
    dataSocket,
    errorSocket,
    TextInputControl,
    SelectControl,
    KeyValueControl,
    HttpRequestNode,
    DataValidationNode,
    DataMappingNode,
    CodeNode
};
