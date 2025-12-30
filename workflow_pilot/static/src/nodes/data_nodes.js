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

// Self-register data nodes to Odoo registry (continued after VariableNode below)
registry.category("workflow_node_types").add("validation", DataValidationNode);
registry.category("workflow_node_types").add("set_data", SetDataNode);
registry.category("workflow_node_types").add("mapping", DataMappingNode);

/**
 * VariableNode - Set/Get workflow variables ($vars)
 * 
 * Operations:
 * - set: Set a variable value (with expression support)
 * - get: Read a variable value
 * - append: Append to array variable
 * - merge: Merge object into variable
 * - increment: Add to numeric variable
 * - delete: Remove a variable
 */
export class VariableNode extends BaseNode {
    static nodeType = 'variable';
    static label = 'Set Variable';
    static icon = 'fa-cube';
    static category = 'data';
    static description = 'Set or get workflow variables';

    constructor() {
        super();

        // Inputs
        this.addInput('trigger', DataSocket, 'Trigger');

        // Outputs
        this.addOutput('output', DataSocket, 'Output');

        // Controls
        this.addControl('operation', new SelectControl('operation', {
            label: 'Operation',
            options: [
                { value: 'set', label: 'Set' },
                { value: 'get', label: 'Get' },
                { value: 'append', label: 'Append to Array' },
                { value: 'merge', label: 'Merge Object' },
                { value: 'increment', label: 'Increment' },
                { value: 'delete', label: 'Delete' },
            ],
            defaultValue: 'set',
        }));

        this.addControl('variableName', new TextInputControl('variableName', {
            label: 'Variable Name',
            placeholder: 'e.g., result.order_lines',
        }));

        this.addControl('value', new TextInputControl('value', {
            label: 'Value (supports expressions)',
            placeholder: '{{ $json.data }} or static value',
            multiline: true,
        }));
    }

    /**
     * Execute variable operation
     * @param {Object} inputData - Input from previous node
     * @param {ExecutionContext} context - ExecutionContext instance with $vars, $json, etc.
     * @returns {Object} Output data
     */
    async execute(inputData = {}, context = null) {
        const config = this.getConfig();
        const operation = config.operation || 'set';
        const varName = config.variableName || '';
        let value = config.value;

        if (!varName) {
            return { error: 'Variable name is required', success: false };
        }

        // Get expression context for resolving expressions
        const exprContext = context?.toExpressionContext?.() || context || {};

        // Resolve expression in value if context provided
        if (value && typeof value === 'string' && value.includes('{{')) {
            value = resolveValue(value, exprContext);
        }

        // Parse JSON if value looks like JSON
        if (typeof value === 'string') {
            try {
                if (value.startsWith('{') || value.startsWith('[')) {
                    value = JSON.parse(value);
                }
            } catch {
                // Keep as string
            }
        }

        let result = { success: true, operation, variable: varName };

        // Use context methods if available (ExecutionContext instance)
        const hasContextMethods = context && typeof context.setVariable === 'function';

        switch (operation) {
            case 'set':
                if (hasContextMethods) context.setVariable(varName, value);
                result.value = value;
                break;

            case 'get':
                result.value = hasContextMethods ? context.getVariable(varName) : undefined;
                break;

            case 'append':
                if (hasContextMethods) context.appendVariable(varName, value);
                result.value = hasContextMethods ? context.getVariable(varName) : [];
                break;

            case 'merge':
                if (hasContextMethods && typeof value === 'object') {
                    context.mergeVariable(varName, value);
                }
                result.value = hasContextMethods ? context.getVariable(varName) : value;
                break;

            case 'increment':
                const increment = parseFloat(value) || 1;
                result.value = hasContextMethods ? context.incrementVariable(varName, increment) : increment;
                break;

            case 'delete':
                if (hasContextMethods) context.deleteVariable(varName);
                result.value = null;
                break;

            default:
                result.error = `Unknown operation: ${operation}`;
                result.success = false;
        }

        return result;
    }
}

// Register VariableNode
registry.category("workflow_node_types").add("variable", VariableNode);
