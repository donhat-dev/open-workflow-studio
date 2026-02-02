/** @odoo-module **/

import { registry } from "@web/core/registry";
import { BaseNode, DataSocket, ErrorSocket } from '../core/node';
import { TextInputControl, SelectControl, KeyValueControl, CodeControl } from '../core/control';

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

}

// Self-register data nodes to Odoo registry (continued after VariableNode below)
registry.category("workflow_node_types").add("validation", DataValidationNode);
registry.category("workflow_node_types").add("set_data", SetDataNode);

/**
 * VariableNode - Set/Get workflow variables (_vars)
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
            placeholder: '{{ _json.data }} or static value',
            multiline: true,
        }));
    }

}

// Register VariableNode
registry.category("workflow_node_types").add("variable", VariableNode);

/**
 * CodeNode - Execute Python code (backend)
 *
 * Uses backend safe_eval with access to:
 * - _json / _input: Input data from previous node
 * - _vars: Workflow variables
 * - _node: Access to other node outputs
 * - result: Output variable
 */
export class CodeNode extends BaseNode {
    static nodeType = 'code';
    static label = 'Code';
    static icon = 'fa-code';
    static category = 'transform';
    static description = 'Execute Python code (set result for output)';

    constructor() {
        super();

        // Inputs
        this.addInput('data', DataSocket, 'Input Data');

        // Outputs
        this.addOutput('output', DataSocket, 'Output');

        // Code editor control
        this.addControl('code', new CodeControl('code', {
            label: 'Python Code',
            height: 250,
            placeholder: "result = _json.get('value')",
            language: 'python',
        }));
    }

}

// Register CodeNode
registry.category("workflow_node_types").add("code", CodeNode);
