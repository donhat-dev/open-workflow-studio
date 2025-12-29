/** @odoo-module **/

import { registry } from "@web/core/registry";
import { BaseNode, DataSocket, ErrorSocket } from '../core/node';
import { TextInputControl, SelectControl, KeyValueControl } from '../core/control';
import { evaluateExpression, hasExpressions } from '@workflow_pilot/utils/expression_utils';

/**
 * Resolve expression in value using context
 */
function resolveValue(value, context) {
    if (!value || typeof value !== 'string') return value;
    if (!hasExpressions(value)) return value;

    const result = evaluateExpression(value, context);
    return result.error ? value : result.value;
}

/**
 * DataValidationNode - Validates incoming data against rules
 */
export class DataValidationNode extends BaseNode {
    static nodeType = 'validation';
    static label = 'Data Validation';
    static icon = 'fa-check-circle';
    static category = 'transform';
    static description = 'Validate data against rules';

    constructor() {
        super();

        // Inputs
        this.addInput('data', DataSocket, 'Input Data');

        // Outputs
        this.addOutput('valid', DataSocket, 'Valid Data');
        this.addOutput('invalid', ErrorSocket, 'Validation Errors');

        // Controls
        this.addControl('requiredFields', new TextInputControl('requiredFields', {
            label: 'Required Fields',
            placeholder: 'field1, field2, field3',
        }));

        this.addControl('schema', new TextInputControl('schema', {
            label: 'Validation Schema (JSON)',
            placeholder: '{"field": {"type": "string", "minLength": 1}}',
            multiline: true,
        }));

        this.addControl('customRules', new KeyValueControl('customRules', {
            label: 'Custom Rules',
            keyPlaceholder: 'Field path',
            valuePlaceholder: 'Regex pattern',
        }));
    }

    async execute(inputData = {}) {
        const config = this.getConfig();
        const errors = [];

        // Check required fields
        if (config.requiredFields) {
            const fields = config.requiredFields.split(',').map(f => f.trim());
            for (const field of fields) {
                if (!(field in inputData) || !inputData[field]) {
                    errors.push({ field, error: 'Required field missing' });
                }
            }
        }

        return {
            valid: errors.length === 0,
            data: inputData,
            errors,
        };
    }
}

/**
 * SetDataNode - Create/set data using expressions (n8n Set node)
 */
export class SetDataNode extends BaseNode {
    static nodeType = 'set_data';
    static label = 'Set Data';
    static icon = 'fa-pencil';
    static category = 'transform';
    static description = 'Set or transform data fields';

    constructor() {
        super();

        // Inputs
        this.addInput('data', DataSocket, 'Input Data');

        // Outputs
        this.addOutput('output', DataSocket, 'Output Data');

        // Controls - Key/Value pairs for field assignment
        this.addControl('fields', new KeyValueControl('fields', {
            label: 'Fields to Set',
            keyPlaceholder: 'Field name',
            valuePlaceholder: 'Value or {{ expression }}',
        }));

        this.addControl('keepOnlySet', new SelectControl('keepOnlySet', {
            label: 'Output Mode',
            options: [
                { value: 'merge', label: 'Merge with input' },
                { value: 'replace', label: 'Only set fields' },
            ],
            default: 'merge',
        }));
    }

    async execute(inputData = {}) {
        const config = this.getConfig();
        const context = { $json: inputData, $input: inputData };

        // Build output data
        let output = {};

        // Start with input if merging
        if (config.keepOnlySet !== 'replace') {
            output = { ...inputData };
        }

        // Set fields from config
        const fields = config.fields || [];
        for (const { key, value } of fields) {
            if (key) {
                output[key] = resolveValue(value, context);
            }
        }

        return output;
    }
}

/**
 * DataMappingNode - Maps and transforms data fields
 */
export class DataMappingNode extends BaseNode {
    static nodeType = 'mapping';
    static label = 'Data Mapping';
    static icon = 'fa-exchange';
    static category = 'transform';
    static description = 'Map and transform data fields';

    constructor() {
        super();

        // Inputs
        this.addInput('data', DataSocket, 'Input Data');

        // Outputs
        this.addOutput('mapped', DataSocket, 'Mapped Data');

        // Controls
        this.addControl('mappings', new KeyValueControl('mappings', {
            label: 'Field Mappings',
            keyPlaceholder: 'Target field',
            valuePlaceholder: '{{ $json.source.field }}',
        }));

        this.addControl('transform', new SelectControl('transform', {
            label: 'Transform Function',
            options: [
                { value: 'none', label: 'None' },
                { value: 'uppercase', label: 'Uppercase' },
                { value: 'lowercase', label: 'Lowercase' },
                { value: 'trim', label: 'Trim Whitespace' },
                { value: 'number', label: 'To Number' },
                { value: 'string', label: 'To String' },
                { value: 'boolean', label: 'To Boolean' },
                { value: 'json_parse', label: 'JSON Parse' },
                { value: 'json_stringify', label: 'JSON Stringify' },
            ],
            default: 'none',
        }));

        this.addControl('defaultValue', new TextInputControl('defaultValue', {
            label: 'Default Value',
            placeholder: 'Value if source is empty',
        }));
    }

    async execute(inputData = {}) {
        const config = this.getConfig();
        const context = { $json: inputData, $input: inputData };
        const output = {};

        // Apply mappings
        const mappings = config.mappings || [];
        for (const { key, value } of mappings) {
            if (key) {
                let resolvedValue = resolveValue(value, context);

                // Apply transform
                if (config.transform && config.transform !== 'none') {
                    resolvedValue = this._applyTransform(resolvedValue, config.transform);
                }

                // Apply default if empty
                if ((resolvedValue === null || resolvedValue === undefined || resolvedValue === '')
                    && config.defaultValue) {
                    resolvedValue = config.defaultValue;
                }

                output[key] = resolvedValue;
            }
        }

        return output;
    }

    _applyTransform(value, transform) {
        if (value === null || value === undefined) return value;

        switch (transform) {
            case 'uppercase':
                return String(value).toUpperCase();
            case 'lowercase':
                return String(value).toLowerCase();
            case 'trim':
                return String(value).trim();
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

// Self-register all data nodes to Odoo registry
registry.category("workflow_node_types").add("validation", DataValidationNode);
registry.category("workflow_node_types").add("set_data", SetDataNode);
registry.category("workflow_node_types").add("mapping", DataMappingNode);
