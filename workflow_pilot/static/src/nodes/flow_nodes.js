/** @odoo-module **/

import { registry } from "@web/core/registry";
import { BaseNode, DataSocket } from '../core/node';
import { TextInputControl, SelectControl } from '../core/control';
import { evaluateExpression, hasExpressions } from '@workflow_pilot/utils/expression_utils';

/**
 * LoopNode - SplitInBatches Pattern (n8n style)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Iterates over array items in batches. Uses NodeHelpers for persistent state.
 *
 * Outputs:
 *   - done [0]: All processed items when complete
 *   - loop [1]: Current batch for iteration
 *
 * Controls:
 *   - inputItems: Expression to select items (e.g., {{ $json.data.items }})
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
            placeholder: '{{ $json.response.data.items }}',
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

    /**
     * Execute loop - SplitInBatches pattern
     *
     * STATELESS node - uses helpers for:
     *   - getContext(): persistent state across iterations
     *   - getNodeParameter(): resolved config values from engine
     *   - getInputData(): input from previous node
     *
     * Engine resolves expressions BEFORE calling execute().
     * inputItems config contains resolved array (not expression string).
     *
     * @param {Object} inputData - Input from previous node
     * @param {Object} expressionContext - Expression context (optional, for fallback)
     * @param {Object} executionContext - Full ExecutionContext
     * @param {NodeHelpers} helpers - n8n-style context helpers
     * @returns {Object} { outputs: [[done], [loop]], json, meta }
     */
    async execute(inputData = {}, expressionContext = null, executionContext = null, helpers = null) {
        // ═══════════════════════════════════════════════════════════════
        // Get RESOLVED params from helpers (engine already resolved expressions)
        // ═══════════════════════════════════════════════════════════════
        const batchSize = parseInt(helpers?.getNodeParameter('batchSize', 1)) || 1;
        const shouldReset = helpers?.getNodeParameter('reset', 'false') === 'true';

        // inputItems is ALREADY RESOLVED by engine (array, not expression string)
        const inputItems = helpers?.getNodeParameter('inputItems', null);

        // Get persistent context via helpers
        const nodeContext = helpers?.getContext('node') ?? {};

        // ═══════════════════════════════════════════════════════════════
        // PHASE A: First Run or Reset - Initialize State
        // ═══════════════════════════════════════════════════════════════
        if (nodeContext.items === undefined || shouldReset) {
            // Determine items source:
            // 1. inputItems config (if user specified expression, engine resolved it)
            // 2. Otherwise use full inputData
            let items = inputItems ?? inputData;

            // Normalize to array
            if (!Array.isArray(items)) {
                if (items && typeof items === 'object') {
                    // Try common array properties
                    items = items.items || items.data || items.records || [items];
                } else {
                    items = items ? [items] : [];
                }
            }

            // Initialize context
            nodeContext.items = [...items];
            nodeContext.processedItems = [];
            nodeContext.currentRunIndex = 0;
            nodeContext.totalItems = items.length;
            nodeContext.sourceData = inputData;

            // Splice first batch
            const firstBatch = nodeContext.items.splice(0, batchSize);

            helpers?.log?.('debug', `Loop started: ${nodeContext.totalItems} items, batch=${batchSize}`);

            if (firstBatch.length > 0) {
                return {
                    outputs: [[], firstBatch],  // [done=empty, loop=batch]
                    json: firstBatch.length === 1 ? firstBatch[0] : firstBatch,
                    meta: {
                        iteration: 1,
                        total: Math.ceil(nodeContext.totalItems / batchSize),
                        executedAt: new Date().toISOString(),
                    }
                };
            }

            // Empty collection → immediate done
            helpers?.clearContext?.();
            return {
                outputs: [[inputData], []],
                json: inputData,
                meta: { completed: true, iterations: 0, executedAt: new Date().toISOString() }
            };
        }

        // ═══════════════════════════════════════════════════════════════
        // PHASE B: Subsequent Runs - Continue Iteration
        // ═══════════════════════════════════════════════════════════════
        nodeContext.currentRunIndex++;

        // Accumulate processed items from loop body
        if (inputData && inputData !== nodeContext.sourceData) {
            const itemsToAdd = Array.isArray(inputData) ? inputData : [inputData];
            nodeContext.processedItems.push(...itemsToAdd);
        }

        // Splice next batch
        const nextBatch = nodeContext.items.splice(0, batchSize);

        // ═══════════════════════════════════════════════════════════════
        // PHASE C: Routing Decision
        // ═══════════════════════════════════════════════════════════════
        if (nextBatch.length === 0) {
            // All items processed → done output
            const allResults = [...nodeContext.processedItems];
            const iterations = nodeContext.currentRunIndex;

            helpers?.log?.('debug', `Loop complete: ${iterations} iterations, ${allResults.length} results`);
            helpers?.clearContext?.();

            return {
                outputs: [allResults, []],
                json: allResults,
                meta: { completed: true, iterations, executedAt: new Date().toISOString() }
            };
        }

        // More items → loop output
        return {
            outputs: [[], nextBatch],
            json: nextBatch.length === 1 ? nextBatch[0] : nextBatch,
            meta: {
                iteration: nodeContext.currentRunIndex + 1,
                remaining: nodeContext.items.length,
                executedAt: new Date().toISOString(),
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

    /**
     * Pass through data unchanged
     * @returns {Object} n8n-compatible outputs format
     */
    async execute(inputData = {}) {
        return {
            outputs: [[inputData]],
            json: inputData,
        };
    }
}

// Self-register all flow nodes to Odoo registry
// NOTE: CodeNode is registered in data_nodes.js (full implementation with Monaco editor)
registry.category("workflow_node_types").add("loop", LoopNode);
registry.category("workflow_node_types").add("if", IfNode);
registry.category("workflow_node_types").add("noop", NoOpNode);

