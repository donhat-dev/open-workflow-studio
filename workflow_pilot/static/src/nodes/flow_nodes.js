/** @odoo-module **/

import { registry } from "@web/core/registry";
import { BaseNode, DataSocket } from '../core/node';
import { TextInputControl, SelectControl } from '../core/control';

/**
 * LoopNode - SplitInBatches Pattern (n8n style)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Iterates over array items in batches (execution handled by backend runner).
 *
 * Outputs:
 *   - done [0]: All processed items when complete
 *   - loop [1]: Current batch for iteration
 *
 * Controls:
 *   - inputItems: Expression to select items (e.g., {{ _json.data.items }})
 *   - batchSize: Number of items per iteration (default: 1)
 *   - reset: Reset loop on re-entry
 *
 * Reference: n8n/packages/nodes-base/nodes/SplitInBatches/v3/SplitInBatchesV3.node.ts
 */
export class LoopNode extends BaseNode {
    static nodeType = 'loop';
    static label = 'Loop Over Items';
    static icon = 'fa-repeat';
    static category = 'flow';
    static description = 'Iterate over array items in batches';

    constructor() {
        super();

        // Inputs
        this.addInput('data', DataSocket, 'Data');

        // Outputs - n8n order: done=0, loop=1
        this.addOutput('done', DataSocket, 'Done');
        this.addOutput('loop', DataSocket, 'Loop');

        // Controls
        this.addControl('inputItems', new TextInputControl('inputItems', {
            label: 'Input Items',
            placeholder: '{{ _json.response.data.items }}',
        }));

        this.addControl('batchSize', new TextInputControl('batchSize', {
            label: 'Batch Size',
            placeholder: '1',
        }));

        this.addControl('reset', new SelectControl('reset', {
            label: 'Reset',
            options: [
                { value: 'false', label: 'No' },
                { value: 'true', label: 'Yes' },
            ],
            defaultValue: 'false',
        }));
    }

}

/**
 * IfNode - Conditional branching
 * 
 * Routes data to "true" or "false" output based on condition.
 * 
 * Inputs: data
 * Outputs: true, false
 */
export class IfNode extends BaseNode {
    static nodeType = 'if';
    static label = 'If';
    static icon = 'split';
    static category = 'flow';
    static description = 'Route data based on condition';

    constructor() {
        super();

        // Inputs
        this.addInput('data', DataSocket, 'Data');

        // Outputs - conditional routing
        this.addOutput('true', DataSocket, 'True');
        this.addOutput('false', DataSocket, 'False');

        // Controls for condition configuration
        this.addControl('leftOperand', new TextInputControl('leftOperand', {
            label: 'Left Operand',
            placeholder: '{{ _vars.count }} or {{ _json.status }}',
        }));

        this.addControl('operator', new SelectControl('operator', {
            label: 'Operator',
            options: [
                { value: 'eq', label: 'Equals (==)' },
                { value: 'neq', label: 'Not Equals (!=)' },
                { value: 'gt', label: 'Greater Than (>)' },
                { value: 'gte', label: 'Greater or Equal (>=)' },
                { value: 'lt', label: 'Less Than (<)' },
                { value: 'lte', label: 'Less or Equal (<=)' },
                { value: 'contains', label: 'Contains' },
                { value: 'startsWith', label: 'Starts With' },
                { value: 'endsWith', label: 'Ends With' },
                { value: 'empty', label: 'Is Empty' },
                { value: 'notEmpty', label: 'Is Not Empty' },
                { value: 'truthy', label: 'Is Truthy' },
                { value: 'falsy', label: 'Is Falsy' },
            ],
            defaultValue: 'eq',
        }));

        this.addControl('rightOperand', new TextInputControl('rightOperand', {
            label: 'Right Operand',
            placeholder: 'Value to compare against',
        }));
    }

}

/**
 * SwitchNode - Multi-branch routing (equality match)
 *
 * Routes data to one of three case outputs or default.
 */
export class SwitchNode extends BaseNode {
    static nodeType = 'switch';
    static label = 'Switch';
    static icon = 'fa-random';
    static category = 'flow';
    static description = 'Route data based on matching cases';

    constructor() {
        super();

        this.addInput('data', DataSocket, 'Data');

        this.addOutput('case_1', DataSocket, 'Case 1');
        this.addOutput('case_2', DataSocket, 'Case 2');
        this.addOutput('case_3', DataSocket, 'Case 3');
        this.addOutput('default', DataSocket, 'Default');

        this.addControl('switchValue', new TextInputControl('switchValue', {
            label: 'Switch Value',
            placeholder: '{{ _json.status }}',
        }));

        this.addControl('case1', new TextInputControl('case1', {
            label: 'Case 1',
            placeholder: 'Value to match',
        }));

        this.addControl('case2', new TextInputControl('case2', {
            label: 'Case 2',
            placeholder: 'Value to match',
        }));

        this.addControl('case3', new TextInputControl('case3', {
            label: 'Case 3',
            placeholder: 'Value to match',
        }));
    }

}

/**
 * NoOpNode - Placeholder / pass-through node
 * Used for debugging or as placeholder in auto-creation
 */
export class NoOpNode extends BaseNode {
    static nodeType = 'noop';
    static label = 'Replace Me';
    static icon = 'fa-circle-o';
    static category = 'flow';
    static description = 'Placeholder node';

    constructor() {
        super();

        this.addInput('data', DataSocket, 'Data');
        this.addOutput('result', DataSocket, 'Result');
    }

}

// Self-register all flow nodes to Odoo registry
// NOTE: CodeNode is registered in data_nodes.js (full implementation with Monaco editor)
registry.category("workflow_node_types").add("loop", LoopNode);
registry.category("workflow_node_types").add("if", IfNode);
registry.category("workflow_node_types").add("switch", SwitchNode);
registry.category("workflow_node_types").add("noop", NoOpNode);

