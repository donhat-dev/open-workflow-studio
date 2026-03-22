/** @odoo-module **/

/**
 * @core - Pure JavaScript class, no Odoo dependencies.
 *         Can be used outside Odoo environment.
 */

/**
 * Control - Base class for node configuration UI elements
 * 
 * Controls represent configurable parameters within a node
 * (text inputs, selects, key-value pairs, etc.)
 */
export class Control {
    /**
     * @param {string} key - Unique identifier within the node
     * @param {Object} options
     * @param {string} options.label - Display label
     * @param {*} options.default - Default value
     */
    constructor(key, options = {}) {
        this.key = key;
        this.type = 'base';
        this.label = options.label || key;
        this.value = options.default !== undefined ? options.default : null;
        this.suggestions = Array.isArray(options.suggestions) ? options.suggestions : [];
        this.valueSuggestions = Array.isArray(options.valueSuggestions) ? options.valueSuggestions : [];
        this.expressionSuggestions = Array.isArray(options.expressionSuggestions) ? options.expressionSuggestions : [];
        this.suggestionsByKey = options.suggestionsByKey && typeof options.suggestionsByKey === 'object'
            ? options.suggestionsByKey
            : null;
    }

    setValue(value) {
        this.value = value;
    }

    getValue() {
        return this.value;
    }

    /**
     * Serialize control to JSON
     */
    toJSON() {
        return {
            key: this.key,
            type: this.type,
            value: this.value,
        };
    }

    /**
     * Restore control value from JSON
     */
    fromJSON(data) {
        if (data.value !== undefined) {
            this.value = data.value;
        }
    }
}

// ============================================
// CONTROL IMPLEMENTATIONS
// ============================================

/**
 * TextInputControl - Single/multi-line text input
 */
export class TextInputControl extends Control {
    constructor(key, options = {}) {
        super(key, options);
        this.type = 'text';
        this.placeholder = options.placeholder || '';
        this.multiline = options.multiline || false;
    }
}

/**
 * SelectControl - Dropdown select
 */
export class SelectControl extends Control {
    /**
     * @param {string} key
     * @param {Object} options
     * @param {Array<{value: string, label: string}>} options.options - Select options
     */
    constructor(key, options = {}) {
        super(key, options);
        this.type = 'select';
        this.options = options.options || [];
        // Set default to first option if not provided
        if (this.value === null && this.options.length > 0) {
            this.value = this.options[0].value;
        }
    }
}

/**
 * KeyValueControl - Dynamic key-value pair list
 * Used for headers, mappings, custom fields
 */
export class KeyValueControl extends Control {
    constructor(key, options = {}) {
        super(key, options);
        this.type = 'keyvalue';
        this.keyPlaceholder = options.keyPlaceholder || 'Key';
        this.valuePlaceholder = options.valuePlaceholder || 'Value';

        // Default to one empty pair with unique ID
        if (!this.value || !Array.isArray(this.value)) {
            this._nextId = 1;
            this.value = [{ id: this._nextId++, key: '', value: '' }];
        } else {
            // Calculate _nextId from max existing ID to avoid duplicates
            const maxId = this.value.reduce((max, p) => Math.max(max, p.id || 0), 0);
            this._nextId = maxId + 1;
            // Ensure existing values have IDs
            this.value = this.value.map(p => ({
                id: p.id || this._nextId++,
                key: p.key || '',
                value: p.value || '',
            }));
        }
    }

    addPair() {
        // Create new array reference for reactivity
        this.value = [...this.value, { id: this._nextId++, key: '', value: '' }];
        return this.value;
    }

    removePair(index) {
        if (this.value.length > 1) {
            // Create new array reference for reactivity
            this.value = this.value.filter((_, i) => i !== index);
        }
        return this.value;
    }

    setPair(index, key, value) {
        if (this.value[index]) {
            // Create new array reference for reactivity
            this.value = this.value.map((p, i) =>
                i === index ? { ...p, key, value } : p
            );
        }
        return this.value;
    }

    /**
     * Get non-empty pairs for processing
     */
    getPairs() {
        return this.value.filter(p => p.key);
    }
}

/**
 * NumberControl - Numeric input
 */
export class NumberControl extends Control {
    constructor(key, options = {}) {
        super(key, options);
        this.type = 'number';
        this.min = options.min;
        this.max = options.max;
        this.step = options.step || 1;
        if (this.value === null) {
            this.value = options.default || 0;
        }
    }
}

/**
 * CheckboxControl - Boolean toggle
 */
export class CheckboxControl extends Control {
    constructor(key, options = {}) {
        super(key, options);
        this.type = 'checkbox';
        if (this.value === null) {
            this.value = options.default || false;
        }
    }
}

/**
 * CodeControl - Code editor (Monaco-based)
 * For writing code with syntax highlighting and autocomplete
 */
export class CodeControl extends Control {
    constructor(key, options = {}) {
        super(key, options);
        this.type = 'code';
        this.language = options.language || 'python';
        this.height = options.height || 200;
        this.placeholder = options.placeholder || 'result = _json';
        if (this.value === null) {
            this.value = options.default || '';
        }
    }
}

/**
 * AuthControl - Authentication configuration
 * Stores auth type + related fields as a structured object
 */
export class AuthControl extends Control {
    constructor(key, options = {}) {
        super(key, options);
        this.type = 'auth';
        if (this.value === null) {
            this.value = { type: 'none' };
        }
    }
}

/**
 * BodyTypeControl - HTTP body with content type selection
 * Stores content type + body value as a structured object
 */
export class BodyTypeControl extends Control {
    constructor(key, options = {}) {
        super(key, options);
        this.type = 'body_type';
        if (this.value === null) {
            this.value = { content_type: 'none', body: '', form_data: [] };
        }
    }
}

/**
 * QueryParamsControl - URL query parameters
 * Stores array of { key, value, enabled } objects
 */
export class QueryParamsControl extends Control {
    constructor(key, options = {}) {
        super(key, options);
        this.type = 'query_params';
        if (!this.value || !Array.isArray(this.value)) {
            this._nextId = 1;
            this.value = [{ id: this._nextId++, key: '', value: '', enabled: true }];
        } else {
            const maxId = this.value.reduce((max, p) => Math.max(max, p.id || 0), 0);
            this._nextId = maxId + 1;
            this.value = this.value.map(p => ({
                id: p.id || this._nextId++,
                key: p.key || '',
                value: p.value || '',
                enabled: p.enabled !== false,
            }));
        }
    }
}

// Export control registry
export const ControlRegistry = {
    text: TextInputControl,
    select: SelectControl,
    keyvalue: KeyValueControl,
    number: NumberControl,
    checkbox: CheckboxControl,
    code: CodeControl,
    auth: AuthControl,
    body_type: BodyTypeControl,
    query_params: QueryParamsControl,
};

