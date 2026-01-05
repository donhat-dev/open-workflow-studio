# Workflow Execution Engine Architecture

> Technical overview of Workflow Pilot's stack-based execution engine

---

## Overview

Workflow Pilot follows **n8n's Stack-Based State Machine** pattern for executing workflows. This document provides a high-level overview of the architecture.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        StackExecutor                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  State:                                                             │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ ExecutionState                                              │    │
│  │                                                             │    │
│  │  • executionStack: [{nodeId, inputData}, ...]               │    │
│  │  • nodeOutputs: Map<nodeId, NodeOutput>                     │    │
│  │  • nodeContext: Map<nodeId, state>  (for loops)             │    │
│  │  • waitingExecution: Map<nodeId, inputs[]>  (for merge)     │    │
│  │  • executedNodes: Set<nodeId>                               │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  Main Loop: executeUntil(workflow, targetNodeId)                    │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  while (executionStack.length > 0) {                        │    │
│  │    1. Pop node from stack                                   │    │
│  │    2. Execute node → get outputs[][]                        │    │
│  │    3. Store result in nodeOutputs                           │    │
│  │    4. If target reached → break                             │    │
│  │    5. Route outputs to child nodes                          │    │
│  │  }                                                          │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Core Concepts

### 1. Stack-Based Execution

Unlike traditional topological sort (Kahn's algorithm), we use a **stack** to dynamically determine execution order:

| Traditional (DAG)        | Stack-Based         |
| ------------------------ | ------------------- |
| Pre-compute order        | Dynamic order       |
| Fails on cycles          | Handles loops       |
| All branches execute     | Data-driven routing |
| Complex for conditionals | Simple & generic    |

### 2. Data-Driven Routing

The engine is **completely generic** - it doesn't know about If/Switch/Loop semantics:

```javascript
// Engine only checks: does this output have data?
for (let i = 0; i < outputs.length; i++) {
    if (outputs[i].length > 0) {
        // Push connected nodes to stack
    }
    // Empty array = skip this branch
}
```

### 3. Node Output Format

All nodes return a **2D array** `outputs[][]`:

```javascript
// If Node example
return {
    outputs: [
        [inputData],  // Socket 0: true branch
        []            // Socket 1: false branch (skipped)
    ]
};

// Loop Node example (more items remaining)
return {
    outputs: [
        [currentItem],  // Socket 0: loop body
        []              // Socket 1: done (not yet)
    ]
};

// HTTP Node example
return {
    outputs: [[
        { json: response1 },
        { json: response2 }
    ]]
};
```

---

## Execution Flow

### Simple Linear Flow

```
A → B → C

Stack evolution:
1. [A]           ← initial
2. []            ← A executed, push B
3. [B]
4. []            ← B executed, push C
5. [C]
6. []            ← C executed, done
```

### Branching (If Node)

```
     ┌── B (true)
A → If
     └── C (false)

If condition = true:
Stack: [A] → [If] → [B] → [] (C never pushed)

If condition = false:
Stack: [A] → [If] → [C] → [] (B never pushed)
```

### Loop

```
    ┌─────────┐
    ↓         │
A → Loop → Body → Merge ← Loop (done)
              ↑
              └── back-edge

Iteration 1:
Stack: [A] → [Loop] → [Body] → [Loop] → ...

Last iteration:
Stack: [Loop] → [Merge] → []
(Loop outputs to "done" socket, not "loop")
```

---

## Key Classes

### `ExecutionState`

```javascript
class ExecutionState {
    executionStack = [];      // Nodes to execute
    nodeOutputs = new Map();  // Results from executed nodes
    nodeContext = new Map();  // Persistent state (for loops)
    waitingExecution = new Map();  // Multi-input sync
    executedNodes = new Set();
    iterationCount = 0;       // Infinite loop detection
    maxIterations = 1000;
}
```

### `NodeOutput`

```javascript
/**
 * @typedef {Object} NodeOutput
 * @property {Array<Array<any>>} outputs - 2D array per socket
 * @property {any} json - First output item (convenience)
 * @property {string} [branch] - 'true' | 'false' for conditionals
 * @property {string} [error] - Error message if failed
 * @property {Object} [meta] - Metadata (duration, etc.)
 */
```

### `StackExecutor`

```javascript
class StackExecutor {
    executeUntil(workflow, targetNodeId, options);
    getNodeOutput(nodeId);
    isExecuting();
    getContext();
    reset();
}
```

---

## Socket Mapping

### Standard Node

```
┌─────────────┐
│   HTTP      │──────○ output [0]
│  Request    │
└─────────────┘

outputs: [[items]]
```

### If Node

```
        ┌────○ true  [0]
┌────────┤
│   If   │
└────────┤
        └────○ false [1]

Condition TRUE:  outputs: [[data], []]
Condition FALSE: outputs: [[], [data]]
```

### Loop Node (SplitInBatches Pattern)

```
        ┌────○ done [0]   ─┐
┌────────┤                  │
│  Loop  │                  │ exit to downstream
└────────┤                  │
        └────○ loop [1] ←──┘ back-edge

// n8n SplitInBatches pattern:
// Output 0 = "done" (all results when complete)
// Output 1 = "loop" (current batch for iteration)

Iterating:  outputs: [[], [currentBatch]]     → loop output
Done:       outputs: [[processedItems], []]   → done output
```

**State (nodeContext):**
- `items`: remaining items to process
- `processedItems`: accumulated results from loop body
- `currentRunIndex`: current iteration number

### Switch Node

```
        ┌────○ case0 [0]
        │
┌────────┼────○ case1 [1]
│ Switch │
└────────┼────○ case2 [2]
        │
        └────○ default [3]

outputs: [[], [data], [], []]  // matches case1
```

---

## Implementation References

| Component         | File                                                  |
| ----------------- | ----------------------------------------------------- |
| Stack Executor    | `workflow_pilot/static/src/mocks/stack_executor.js`   |
| Execution Context | `workflow_pilot/static/src/core/context.js`           |
| Expression Utils  | `workflow_pilot/static/src/utils/expression_utils.js` |

---

## ADR References

- [ADR-001: Stack-Based Execution Engine](./ADR/001-execution-engine.md)
- [ADR-002: Node Output Format](./ADR/002-node-output-format.md)
- [ADR-003: Loop Node Mechanism](./ADR/003-loop-node-mechanism.md)

---

## External References

- [n8n Execution Engine Research](../../../n8n_execution_deep_technical.md)
- [n8n WorkflowExecute.ts](https://github.com/n8n-io/n8n/blob/master/packages/core/src/WorkflowExecute.ts)
