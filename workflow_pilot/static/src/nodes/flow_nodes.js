/** @odoo-module **/

import { registry } from "@web/core/registry";
import { BaseNode, DataSocket } from '../core/node';
import { TextInputControl, SelectControl } from '../core/control';
import { evaluateExpression, hasExpressions } from '@workflow_pilot/utils/expression_utils';

/**
 * LoopNode - Iterates over array items
 * 
 * n8n-style loop: processes items one at a time,
 * outputs "Loop" for each iteration, "Done" when complete.
 * 
 * Inputs: data (array to iterate)
 * Outputs: loop (current item), done (completion signal)
 */
export class LoopNode extends BaseNode {
    static nodeType = 'loop';
    static label = 'Loop Over Items';
    static icon = 'fa-repeat';
    static category = 'flow';
    static description = 'Iterate over array items one at a time';

    constructor() {
        super();

        // Inputs
        this.addInput('data', DataSocket, 'Data');

        // Outputs - n8n style dual output
        this.addOutput('done', DataSocket, 'Done');
        this.addOutput('loop', DataSocket, 'Loop');

        // Controls for collection expression
        this.addControl('collection', new TextInputControl('collection', {
            label: 'Collection Expression',
            placeholder: '{{ $json.items }} or {{ $vars.orderLines }}',
        }));

        this.addControl('accumulate', new SelectControl('accumulate', {
            label: 'Accumulate Results',
            options: [
                { value: 'false', label: 'No' },
                { value: 'true', label: 'Yes' },
            ],
            defaultValue: 'false',
        }));
    }

    /**
     * Execute loop - resolve collection from expression
     * Returns n8n-compatible outputs[][] format for stack-based execution.
     *
     * @param {Object} inputData - Input from previous node
     * @param {Object} context - Expression context with $vars, $json, etc.
     * @param {Object} executionContext - Full ExecutionContext (optional, for nodeContext)
     * @returns {Object} { outputs: [][], json, collection, accumulate, total, meta }
     */
    async execute(inputData = {}, context = null, executionContext = null) {
        const config = this.getConfig();
        let collection = [];

        // Resolve collection expression
        const collectionExpr = config.collection || '';

        if (collectionExpr && context) {
            if (hasExpressions(collectionExpr)) {
                const result = evaluateExpression(collectionExpr, context);
                collection = result.error ? [] : result.value;
            } else {
                // Try to get from $json or inputData directly
                collection = inputData.items || inputData.data || inputData;
            }
        } else if (inputData) {
            // Default: use input data as collection
            collection = Array.isArray(inputData) ? inputData : (inputData.items || inputData.data || []);
        }

        // Ensure collection is array
        if (!Array.isArray(collection)) {
            collection = collection ? [collection] : [];
        }

        // For stack-based execution: return first item on loop output
        // The StackExecutor handles iteration state
        const firstItem = collection.length > 0 ? collection[0] : null;

        return {
            // n8n-compatible: outputs[0]=loop, outputs[1]=done
            outputs: collection.length > 0 ? [[firstItem], []] : [[], [inputData]],
            json: firstItem || inputData,
            collection,
            accumulate: config.accumulate === 'true',
            total: collection.length,
            meta: {
                executedAt: new Date().toISOString()
            }
        };
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
    static icon = 'fa-code-branch';
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
            placeholder: '{{ $vars.count }} or {{ $json.status }}',
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

    /**
     * Execute condition evaluation
     * Returns n8n-compatible outputs[][] format for stack-based execution.
     *
     * @param {Object} inputData - Input from previous node
     * @param {Object} context - Expression context with $vars, $json, etc.
     * @param {Object} executionContext - Full ExecutionContext (optional)
     * @returns {Object} { outputs: [][], json, result, branch, left, right, operator, meta }
     */
    async execute(inputData = {}, context = null, executionContext = null) {
        const config = this.getConfig();
        const operator = config.operator || 'eq';

        // Resolve left operand
        let left = config.leftOperand || '';
        if (context && hasExpressions(left)) {
            const result = evaluateExpression(left, context);
            left = result.error ? left : result.value;
        }

        // Resolve right operand
        let right = config.rightOperand || '';
        if (context && hasExpressions(right)) {
            const result = evaluateExpression(right, context);
            right = result.error ? right : result.value;
        }

        // Parse numbers if both look like numbers
        if (!isNaN(left) && !isNaN(right) && left !== '' && right !== '') {
            left = parseFloat(left);
            right = parseFloat(right);
        }

        // Evaluate condition
        let conditionResult = false;

        switch (operator) {
            case 'eq':
                conditionResult = left == right;
                break;
            case 'neq':
                conditionResult = left != right;
                break;
            case 'gt':
                conditionResult = left > right;
                break;
            case 'gte':
                conditionResult = left >= right;
                break;
            case 'lt':
                conditionResult = left < right;
                break;
            case 'lte':
                conditionResult = left <= right;
                break;
            case 'contains':
                conditionResult = String(left).includes(String(right));
                break;
            case 'startsWith':
                conditionResult = String(left).startsWith(String(right));
                break;
            case 'endsWith':
                conditionResult = String(left).endsWith(String(right));
                break;
            case 'empty':
                conditionResult = left === '' || left === null || left === undefined ||
                    (Array.isArray(left) && left.length === 0) ||
                    (typeof left === 'object' && Object.keys(left).length === 0);
                break;
            case 'notEmpty':
                conditionResult = !(left === '' || left === null || left === undefined ||
                    (Array.isArray(left) && left.length === 0) ||
                    (typeof left === 'object' && Object.keys(left).length === 0));
                break;
            case 'truthy':
                conditionResult = Boolean(left);
                break;
            case 'falsy':
                conditionResult = !left;
                break;
            default:
                conditionResult = false;
        }

        // n8n-compatible outputs: outputs[0]=true branch, outputs[1]=false branch
        const outputs = conditionResult
            ? [[inputData], []]   // TRUE: data to first output, nothing to second
            : [[], [inputData]];  // FALSE: nothing to first, data to second

        return {
            outputs,
            json: inputData,
            result: conditionResult,
            branch: conditionResult ? 'true' : 'false',
            left,
            right,
            operator,
            inputData,
            meta: {
                executedAt: new Date().toISOString()
            }
        };
    }
}

/**
 * CodeNode - Custom code execution
 * 
 * Allows users to write custom transformation logic.
 * Execution happens in Python backend.
 */
export class CodeNode extends BaseNode {
    static nodeType = 'code';
    static label = 'Code';
    static icon = 'fa-code';
    static category = 'transform';
    static description = 'Execute custom code';

    constructor() {
        super();

        // Inputs
        this.addInput('data', DataSocket, 'Input');

        // Outputs
        this.addOutput('result', DataSocket, 'Result');
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
registry.category("workflow_node_types").add("loop", LoopNode);
registry.category("workflow_node_types").add("if", IfNode);
registry.category("workflow_node_types").add("code", CodeNode);
registry.category("workflow_node_types").add("noop", NoOpNode);
