# VARIABLE SYSTEM IMPLEMENTATION PLAN

> **Version**: 1.0.0
> **Created**: 2024-12-29
> **Status**: Planning
> **Priority**: P0 - Core Feature

---

## 1. OVERVIEW

### 1.1. Problem Statement

Current node-based workflow lacks proper variable management:
- No dedicated mutable state for accumulation patterns
- Loop results require workaround with Merge nodes
- Cross-node data reference is verbose (`$node['NodeName'].json.field`)
- No clear separation between mutable variables and immutable step outputs

### 1.2. Goals

1. Introduce `$vars` namespace for mutable workflow variables
2. Maintain `$node` / `$json` for backward compatibility
3. Add `$loop` context for iteration state
4. Create VariableNode for explicit variable operations
5. Prepare mock infrastructure for future backend migration

### 1.3. Non-Goals

- Changing execution model (stays DAG-based)
- Backend implementation (mocks only for now)
- Parallel execution support

---

## 2. ARCHITECTURE

### 2.1. Context Namespaces

```
ExecutionContext
├── $vars      (NEW) Mutable workflow variables
│   ├── result: { order_line: [] }
│   ├── counter: 0
│   └── ...user-defined...
│
├── $node      (EXISTING) Immutable node outputs
│   ├── 'HTTP Request': { json: {...} }
│   ├── 'Search Product': { json: {...} }
│   └── ...
│
├── $json      (EXISTING) Previous node output shortcut
│
└── $loop      (NEW) Loop iteration context
    ├── item: current item
    ├── index: current index (0-based)
    ├── total: total items
    ├── isFirst: boolean
    └── isLast: boolean
```

### 2.2. Component Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        FRONTEND (OWL)                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐ │
│  │  VariableNode   │    │  LoopNode       │    │ Other Nodes     │ │
│  │  (UI Component) │    │  (Enhanced)     │    │                 │ │
│  └────────┬────────┘    └────────┬────────┘    └────────┬────────┘ │
│           │                      │                      │          │
│           └──────────────────────┼──────────────────────┘          │
│                                  │                                 │
│                                  ▼                                 │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │                    WorkflowAdapter                            │ │
│  │                    (Bridge UI ↔ Core)                         │ │
│  └───────────────────────────────┬───────────────────────────────┘ │
│                                  │                                 │
└──────────────────────────────────┼─────────────────────────────────┘
                                   │
┌──────────────────────────────────┼─────────────────────────────────┐
│                        CORE LAYER                                  │
├──────────────────────────────────┼─────────────────────────────────┤
│                                  ▼                                 │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │                 ExecutionContext                              │ │
│  │  { $vars: {}, $node: {}, $json: {}, $loop: null }            │ │
│  └───────────────────────────────┬───────────────────────────────┘ │
│                                  │                                 │
│                                  ▼                                 │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │                 MockExecutionEngine                           │ │
│  │  (static/src/mocks/execution_engine.js)                       │ │
│  │                                                               │ │
│  │  Future: Replace with backend Python engine                   │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. DATA STRUCTURES

### 3.1. ExecutionContext

```javascript
/**
 * @typedef {Object} ExecutionContext
 * @property {Object} $vars - Mutable workflow variables
 * @property {Object} $node - Immutable node outputs (keyed by node ID)
 * @property {Object} $json - Previous node output (shortcut)
 * @property {LoopContext|null} $loop - Current loop context
 */

/**
 * @typedef {Object} LoopContext
 * @property {*} item - Current iteration item
 * @property {number} index - Current index (0-based)
 * @property {number} total - Total items in collection
 * @property {boolean} isFirst - Is first iteration
 * @property {boolean} isLast - Is last iteration
 */
```

### 3.2. Variable Operations

```javascript
/**
 * @typedef {Object} VariableOperation
 * @property {'set'|'get'|'append'|'merge'|'increment'|'decrement'|'delete'} type
 * @property {string} name - Variable name (supports dot notation: 'result.order_line')
 * @property {*} [value] - Value for set/append/merge operations
 */
```

### 3.3. VariableNode Config

```javascript
/**
 * VariableNode configuration structure
 */
const VariableNodeConfig = {
    operation: 'set',           // Operation type
    variableName: 'result',     // Variable name
    variablePath: '',           // Optional nested path (e.g., 'order_line')
    value: '{{ $json.data }}',  // Expression or static value
    valueType: 'expression',    // 'expression' | 'static' | 'json'
};
```

---

## 4. FILE STRUCTURE

```
workflow_pilot/static/src/
├── core/
│   ├── context.js              (NEW) ExecutionContext class
│   └── ...existing...
│
├── mocks/                      (NEW) Mock services for future backend
│   ├── index.js                Export all mocks
│   ├── execution_engine.js     Mock workflow executor
│   ├── variable_store.js       Mock variable persistence
│   └── odoo_rpc.js             Mock Odoo RPC calls
│
├── nodes/
│   ├── variable_node.js        (NEW) Variable operations node
│   ├── loop_node.js            (NEW/ENHANCED) Loop with context
│   └── ...existing...
│
├── services/
│   ├── variable_service.js     (NEW) Variable management service
│   └── ...existing...
│
└── utils/
    ├── expression_utils.js     (ENHANCE) Add $vars, $loop support
    └── ...existing...
```

---

## 5. IMPLEMENTATION TASKS

### Phase 1: Core Infrastructure (5 SP)

| ID | Task | SP | Priority | Notes |
|----|------|---:|----------|-------|
| V1.1 | Create `core/context.js` | 2 | P0 | ExecutionContext class |
| V1.2 | Create `mocks/` directory structure | 1 | P0 | Index + empty files |
| V1.3 | Create `mocks/execution_engine.js` | 2 | P0 | Basic mock executor |

**Deliverables:**
- ExecutionContext with $vars, $node, $json, $loop
- Mock execution engine that uses context
- Unit tests for context operations

### Phase 2: Variable Service (3 SP)

| ID | Task | SP | Priority | Notes |
|----|------|---:|----------|-------|
| V2.1 | Create `services/variable_service.js` | 2 | P0 | Odoo service wrapper |
| V2.2 | Integrate with WorkflowAdapter | 1 | P0 | Expose to UI layer |

**Deliverables:**
- VariableService with get/set/append/merge operations
- Integration with adapter service pattern

### Phase 3: VariableNode (5 SP)

| ID | Task | SP | Priority | Notes |
|----|------|---:|----------|-------|
| V3.1 | Create `nodes/variable_node.js` | 3 | P0 | Node definition + controls |
| V3.2 | Create VariableNode UI (config panel) | 2 | P0 | Operation selector, value input |

**Deliverables:**
- VariableNode with set/get/append/merge/increment operations
- Config panel with operation dropdown, variable name input, value expression

### Phase 4: Expression Enhancement (3 SP)

| ID | Task | SP | Priority | Notes |
|----|------|---:|----------|-------|
| V4.1 | Add $vars to expression_utils.js | 1 | P0 | Path resolution |
| V4.2 | Add $loop to expression_utils.js | 1 | P0 | Iteration context |
| V4.3 | Update ExpressionInput preview | 1 | P1 | Show resolved values |

**Deliverables:**
- Expression parser supports `{{ $vars.result.order_line }}`
- Expression parser supports `{{ $loop.item.sku }}`
- Preview shows resolved values in UI

### Phase 5: Loop Enhancement (3 SP)

| ID | Task | SP | Priority | Notes |
|----|------|---:|----------|-------|
| V5.1 | Enhance LoopNode with $loop context | 2 | P0 | Iteration state |
| V5.2 | Add accumulator option to LoopNode | 1 | P1 | Auto-collect results |

**Deliverables:**
- LoopNode populates $loop context during iteration
- Optional built-in accumulator (avoid manual Variable nodes)

---

## 6. DETAILED SPECIFICATIONS

### 6.1. ExecutionContext Class

```javascript
// core/context.js

/**
 * ExecutionContext - Manages workflow execution state
 *
 * Namespaces:
 * - $vars: Mutable variables (user-defined)
 * - $node: Immutable node outputs
 * - $json: Shortcut to previous node output
 * - $loop: Current loop iteration context
 */
export class ExecutionContext {
    constructor() {
        this._vars = {};
        this._nodeOutputs = {};
        this._currentNodeId = null;
        this._loopStack = [];  // Support nested loops
    }

    // ============================================
    // VARIABLES ($vars)
    // ============================================

    getVariable(path) {
        return this._resolvePath(this._vars, path);
    }

    setVariable(path, value) {
        this._setPath(this._vars, path, value);
    }

    appendVariable(path, value) {
        const arr = this.getVariable(path) || [];
        if (!Array.isArray(arr)) {
            throw new Error(`Cannot append to non-array: ${path}`);
        }
        arr.push(value);
        this.setVariable(path, arr);
    }

    mergeVariable(path, value) {
        const obj = this.getVariable(path) || {};
        if (typeof obj !== 'object' || Array.isArray(obj)) {
            throw new Error(`Cannot merge into non-object: ${path}`);
        }
        this.setVariable(path, { ...obj, ...value });
    }

    // ============================================
    // NODE OUTPUTS ($node, $json)
    // ============================================

    setNodeOutput(nodeId, output) {
        this._nodeOutputs[nodeId] = output;
        this._currentNodeId = nodeId;
    }

    getNodeOutput(nodeId) {
        return this._nodeOutputs[nodeId];
    }

    get $json() {
        return this._nodeOutputs[this._currentNodeId] || {};
    }

    // ============================================
    // LOOP CONTEXT ($loop)
    // ============================================

    pushLoop(collection) {
        this._loopStack.push({
            collection,
            index: 0,
            total: collection.length,
        });
    }

    popLoop() {
        return this._loopStack.pop();
    }

    get $loop() {
        const current = this._loopStack[this._loopStack.length - 1];
        if (!current) return null;

        return {
            item: current.collection[current.index],
            index: current.index,
            total: current.total,
            isFirst: current.index === 0,
            isLast: current.index === current.total - 1,
        };
    }

    advanceLoop() {
        const current = this._loopStack[this._loopStack.length - 1];
        if (current) {
            current.index++;
            return current.index < current.total;
        }
        return false;
    }

    // ============================================
    // EXPRESSION CONTEXT
    // ============================================

    /**
     * Get full context for expression evaluation
     */
    toExpressionContext() {
        return {
            $vars: this._vars,
            $node: this._nodeOutputs,
            $json: this.$json,
            $loop: this.$loop,
        };
    }

    // ============================================
    // PRIVATE HELPERS
    // ============================================

    _resolvePath(obj, path) {
        if (!path) return obj;
        const parts = path.split('.');
        let current = obj;
        for (const part of parts) {
            if (current === null || current === undefined) return undefined;
            current = current[part];
        }
        return current;
    }

    _setPath(obj, path, value) {
        if (!path) {
            throw new Error('Path required for setPath');
        }
        const parts = path.split('.');
        let current = obj;
        for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i];
            if (!(part in current)) {
                current[part] = {};
            }
            current = current[part];
        }
        current[parts[parts.length - 1]] = value;
    }
}
```

### 6.2. MockExecutionEngine

```javascript
// mocks/execution_engine.js

/**
 * MockExecutionEngine - Frontend mock for workflow execution
 *
 * This mock will be replaced by backend Python engine in production.
 * Maintains same interface for seamless migration.
 *
 * Backend Migration Path:
 * 1. Create Python WorkflowEngine class with same methods
 * 2. Create RPC endpoints: /workflow/execute, /workflow/execute_node
 * 3. Replace mock calls with RPC calls in services
 */

import { ExecutionContext } from '../core/context';

export class MockExecutionEngine {
    constructor() {
        this.context = null;
        this.isExecuting = false;
    }

    /**
     * Execute workflow up to target node
     *
     * @param {Object} workflow - { nodes: [], connections: [] }
     * @param {string} targetNodeId - Stop after this node
     * @param {Object} options - { onNodeStart, onNodeComplete, onError }
     * @returns {Promise<ExecutionContext>}
     *
     * Backend equivalent:
     *   POST /workflow/execute
     *   Body: { workflow_json, target_node_id }
     */
    async executeUntil(workflow, targetNodeId, options = {}) {
        this.context = new ExecutionContext();
        this.isExecuting = true;

        try {
            const executionOrder = this._topologicalSort(workflow);
            const targetIndex = executionOrder.indexOf(targetNodeId);

            for (let i = 0; i <= targetIndex; i++) {
                const nodeId = executionOrder[i];
                const node = workflow.nodes.find(n => n.id === nodeId);

                options.onNodeStart?.(nodeId);

                // Check if loop node
                if (node.type === 'loop') {
                    await this._executeLoop(node, workflow, options);
                } else {
                    const result = await this._executeNode(node, options);
                    this.context.setNodeOutput(nodeId, result);
                }

                options.onNodeComplete?.(nodeId, this.context.getNodeOutput(nodeId));
            }

            return this.context;
        } catch (error) {
            options.onError?.(error);
            throw error;
        } finally {
            this.isExecuting = false;
        }
    }

    /**
     * Execute single node
     * @private
     */
    async _executeNode(node, options) {
        // Get node executor from registry
        const executor = this._getNodeExecutor(node.type);
        const expressionContext = this.context.toExpressionContext();

        // Resolve config expressions
        const resolvedConfig = this._resolveExpressions(node.config, expressionContext);

        // Execute
        return await executor.execute(resolvedConfig, expressionContext);
    }

    /**
     * Execute loop node with context
     * @private
     */
    async _executeLoop(loopNode, workflow, options) {
        const expressionContext = this.context.toExpressionContext();
        const collection = this._resolveExpression(loopNode.config.collection, expressionContext);

        if (!Array.isArray(collection)) {
            throw new Error(`Loop collection must be array, got: ${typeof collection}`);
        }

        this.context.pushLoop(collection);

        // Get nodes inside loop (between loop node and its end)
        const loopBodyNodes = this._getLoopBodyNodes(loopNode, workflow);

        // Iterate
        do {
            for (const bodyNode of loopBodyNodes) {
                const result = await this._executeNode(bodyNode, options);
                this.context.setNodeOutput(bodyNode.id, result);
            }
        } while (this.context.advanceLoop());

        this.context.popLoop();
    }

    /**
     * Topological sort for execution order
     * @private
     */
    _topologicalSort(workflow) {
        // ... existing Kahn's algorithm implementation
    }

    // ... other private methods
}

// Singleton instance
export const mockExecutionEngine = new MockExecutionEngine();
```

### 6.3. VariableNode Definition

```javascript
// nodes/variable_node.js

import { BaseNode, DataSocket } from '../core/node';
import { SelectControl, TextInputControl } from '../core/control';

/**
 * VariableNode - Manage workflow variables
 *
 * Operations:
 * - set: Set variable value
 * - get: Get variable value (output)
 * - append: Append to array variable
 * - merge: Merge into object variable
 * - increment: Add to number variable
 * - decrement: Subtract from number variable
 * - delete: Remove variable
 */
export class VariableNode extends BaseNode {
    static nodeType = 'variable';
    static label = 'Variable';
    static icon = 'fa-database';
    static category = 'core';
    static description = 'Set, get, or modify workflow variables';

    constructor() {
        super();

        // Inputs
        this.addInput('trigger', DataSocket, 'Trigger');

        // Outputs
        this.addOutput('value', DataSocket, 'Value');

        // Controls
        this.addControl('operation', new SelectControl('operation', {
            label: 'Operation',
            options: [
                { value: 'set', label: 'Set Variable' },
                { value: 'get', label: 'Get Variable' },
                { value: 'append', label: 'Append to Array' },
                { value: 'merge', label: 'Merge into Object' },
                { value: 'increment', label: 'Increment Number' },
                { value: 'decrement', label: 'Decrement Number' },
                { value: 'delete', label: 'Delete Variable' },
            ],
            default: 'set',
        }));

        this.addControl('variableName', new TextInputControl('variableName', {
            label: 'Variable Name',
            placeholder: 'result',
        }));

        this.addControl('variablePath', new TextInputControl('variablePath', {
            label: 'Path (optional)',
            placeholder: 'order_line',
        }));

        this.addControl('value', new TextInputControl('value', {
            label: 'Value',
            placeholder: '{{ $json.data }} or static value',
            multiline: true,
        }));
    }

    /**
     * Execute variable operation
     *
     * @param {Object} input - Input data (unused for variables)
     * @param {ExecutionContext} context - Execution context with $vars
     */
    async execute(input, context) {
        const config = this.getConfig();
        const fullPath = config.variablePath
            ? `${config.variableName}.${config.variablePath}`
            : config.variableName;

        switch (config.operation) {
            case 'set':
                context.setVariable(fullPath, config.value);
                return config.value;

            case 'get':
                return context.getVariable(fullPath);

            case 'append':
                context.appendVariable(fullPath, config.value);
                return context.getVariable(fullPath);

            case 'merge':
                context.mergeVariable(fullPath, config.value);
                return context.getVariable(fullPath);

            case 'increment':
                const incVal = (context.getVariable(fullPath) || 0) + (config.value || 1);
                context.setVariable(fullPath, incVal);
                return incVal;

            case 'decrement':
                const decVal = (context.getVariable(fullPath) || 0) - (config.value || 1);
                context.setVariable(fullPath, decVal);
                return decVal;

            case 'delete':
                const current = context.getVariable(config.variableName);
                if (config.variablePath && current) {
                    delete current[config.variablePath];
                } else {
                    context.setVariable(config.variableName, undefined);
                }
                return null;

            default:
                throw new Error(`Unknown operation: ${config.operation}`);
        }
    }
}
```

---

## 7. MOCK INFRASTRUCTURE

### 7.1. Purpose

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    MOCK INFRASTRUCTURE PURPOSE                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  WHY MOCKS?                                                                 │
│  ──────────                                                                 │
│  • Develop frontend without backend dependency                             │
│  • Define clear interface contract for backend                             │
│  • Enable unit testing without Odoo server                                 │
│  • Smooth migration path when backend is ready                             │
│                                                                             │
│  MIGRATION PATH:                                                            │
│  ───────────────                                                           │
│  Phase 1: Frontend uses mocks directly                                     │
│  Phase 2: Create backend Python equivalents                                │
│  Phase 3: Create RPC endpoints                                             │
│  Phase 4: Replace mock calls with RPC calls                                │
│  Phase 5: Remove mocks (or keep for testing)                               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 7.2. Mock Files Structure

```javascript
// mocks/index.js
export { MockExecutionEngine, mockExecutionEngine } from './execution_engine';
export { MockVariableStore } from './variable_store';
export { MockOdooRPC } from './odoo_rpc';

// mocks/variable_store.js
/**
 * MockVariableStore - Simulates variable persistence
 *
 * Backend equivalent: workflow.variable model or Redis cache
 */
export class MockVariableStore {
    constructor() {
        this._store = new Map();
    }

    async save(workflowId, variables) {
        this._store.set(workflowId, JSON.parse(JSON.stringify(variables)));
    }

    async load(workflowId) {
        return this._store.get(workflowId) || {};
    }

    async clear(workflowId) {
        this._store.delete(workflowId);
    }
}

// mocks/odoo_rpc.js
/**
 * MockOdooRPC - Simulates Odoo RPC calls
 *
 * Backend equivalent: Direct ORM calls
 */
export class MockOdooRPC {
    async search(model, domain, options = {}) {
        console.log(`[MockRPC] search ${model}`, domain);
        // Return mock data based on model
        return this._getMockData(model, 'search', { domain, ...options });
    }

    async create(model, values) {
        console.log(`[MockRPC] create ${model}`, values);
        return { id: Date.now(), ...values };
    }

    async write(model, ids, values) {
        console.log(`[MockRPC] write ${model}`, ids, values);
        return true;
    }

    _getMockData(model, operation, params) {
        // Mock data registry
        const mockData = {
            'product.product': {
                search: [{ id: 1, name: 'Product 1', default_code: 'PROD1' }],
            },
            'res.partner': {
                search: [{ id: 1, name: 'Customer 1', email: 'customer@test.com' }],
            },
        };
        return mockData[model]?.[operation] || [];
    }
}
```

---

## 8. TESTING STRATEGY

### 8.1. Unit Tests

```javascript
// tests/context.test.js
describe('ExecutionContext', () => {
    describe('$vars', () => {
        test('setVariable creates nested path', () => {
            const ctx = new ExecutionContext();
            ctx.setVariable('result.order_line', []);
            expect(ctx.getVariable('result')).toEqual({ order_line: [] });
        });

        test('appendVariable adds to array', () => {
            const ctx = new ExecutionContext();
            ctx.setVariable('items', [1, 2]);
            ctx.appendVariable('items', 3);
            expect(ctx.getVariable('items')).toEqual([1, 2, 3]);
        });
    });

    describe('$loop', () => {
        test('pushLoop creates iteration context', () => {
            const ctx = new ExecutionContext();
            ctx.pushLoop([{a: 1}, {a: 2}]);
            expect(ctx.$loop.item).toEqual({a: 1});
            expect(ctx.$loop.index).toBe(0);
            expect(ctx.$loop.isFirst).toBe(true);
        });

        test('advanceLoop updates context', () => {
            const ctx = new ExecutionContext();
            ctx.pushLoop([{a: 1}, {a: 2}]);
            ctx.advanceLoop();
            expect(ctx.$loop.item).toEqual({a: 2});
            expect(ctx.$loop.isLast).toBe(true);
        });
    });
});
```

### 8.2. Integration Tests

```javascript
// tests/variable_node.test.js
describe('VariableNode', () => {
    test('accumulation pattern', async () => {
        const ctx = new ExecutionContext();
        const node = new VariableNode();

        // Initialize
        node.setConfig({ operation: 'set', variableName: 'result', value: { items: [] }});
        await node.execute({}, ctx);

        // Append in loop
        node.setConfig({ operation: 'append', variableName: 'result', variablePath: 'items', value: 'item1' });
        await node.execute({}, ctx);

        node.setConfig({ operation: 'append', variableName: 'result', variablePath: 'items', value: 'item2' });
        await node.execute({}, ctx);

        expect(ctx.getVariable('result.items')).toEqual(['item1', 'item2']);
    });
});
```

---

## 9. TIMELINE

| Phase | Tasks | SP | Duration | Dependencies |
|-------|-------|---:|----------|--------------|
| **Phase 1** | Core Infrastructure | 5 | 3 days | - |
| **Phase 2** | Variable Service | 3 | 2 days | Phase 1 |
| **Phase 3** | VariableNode | 5 | 3 days | Phase 2 |
| **Phase 4** | Expression Enhancement | 3 | 2 days | Phase 1 |
| **Phase 5** | Loop Enhancement | 3 | 2 days | Phase 4 |
| **Total** | | **19** | **~2 weeks** | |

---

## 10. SUCCESS CRITERIA

- [ ] ExecutionContext class passes all unit tests
- [ ] VariableNode can set/get/append/merge variables
- [ ] Expressions support `$vars.name` and `$loop.item`
- [ ] Loop node populates `$loop` context
- [ ] Mock execution engine runs sample workflow
- [ ] No regression in existing node execution
- [ ] Documentation updated

---

## 11. RISKS & MITIGATIONS

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Expression parser complexity | Medium | Medium | Incremental enhancement, thorough testing |
| Backend interface mismatch | High | Low | Define clear interface contract in mocks |
| Performance with many variables | Low | Low | Use efficient data structures |
| Nested loop complexity | Medium | Medium | Limit nesting depth, clear error messages |

---

## APPENDIX A: EXPRESSION EXAMPLES

```javascript
// Variable access
{{ $vars.result }}                    // Get entire variable
{{ $vars.result.order_line }}         // Get nested path
{{ $vars.result.order_line[0] }}      // Get array item
{{ $vars.counter + 1 }}               // Expression with variable

// Loop context
{{ $loop.item }}                      // Current item
{{ $loop.item.sku }}                  // Item property
{{ $loop.index }}                     // Current index
{{ $loop.isLast ? 'Done' : 'More' }}  // Conditional

// Combined
{{ $vars.result.order_line.length }}  // Array length
{{ $loop.item.qty * $loop.item.price }} // Calculation
```

---

## APPENDIX B: BACKEND INTERFACE CONTRACT

```python
# Future backend implementation should match this interface

class WorkflowEngine:
    """
    Python equivalent of MockExecutionEngine
    """

    def execute_until(self, workflow_json: dict, target_node_id: str,
                      context: dict = None) -> dict:
        """
        Execute workflow up to target node

        Args:
            workflow_json: Serialized workflow {nodes: [], connections: []}
            target_node_id: Stop after this node
            context: Optional initial context {$vars: {}}

        Returns:
            ExecutionResult {
                context: {$vars: {}, $node: {}},
                outputs: {node_id: output},
                error: str | None
            }
        """
        pass

    def execute_node(self, node_json: dict, context: dict) -> dict:
        """
        Execute single node
        """
        pass


class VariableStore:
    """
    Python equivalent of MockVariableStore
    """

    def save(self, workflow_id: int, variables: dict) -> None:
        pass

    def load(self, workflow_id: int) -> dict:
        pass

    def clear(self, workflow_id: int) -> None:
        pass
```
