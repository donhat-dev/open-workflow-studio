# ADR-001: Stack-Based State Machine Execution Engine

> Decision on workflow execution strategy following n8n's proven architecture

---

## Status

**Accepted ✅**

---

## Context

Workflow Pilot needs to execute workflows containing:
- **Linear flows**: A → B → C (simple data passing)
- **Branches**: If/Switch nodes with multiple output paths
- **Loops**: Iterate over arrays, repeat until condition
- **Multi-input synchronization**: Merge nodes waiting for multiple branches

The initial proposal considered queue-based execution. After deeper research into n8n's execution engine (see `n8n_execution_deep_technical.md`), we've adopted their **Stack-Based State Machine** pattern.

### Key Insight from n8n
n8n doesn't use traditional DAG (Directed Acyclic Graph) algorithms. Instead, they use a **Stack-Based State Machine** - a state machine driven by a stack queue that processes nodes dynamically based on data flow.

---

## Decision

Implement a **Stack-Based State Machine** execution engine following n8n's architecture:

### Core Architecture

```
┌─────────────────────────────────────┐
│    StackExecutor                    │
│                                     │
│  Properties:                        │
│  - executionStack: IExecuteData[]   │
│  - nodeOutputs: Map<nodeId, result> │
│  - waitingExecution: {...}          │
│  - nodeContext: Map<nodeId, state>  │
│                                     │
│  Core Method:                       │
│  executeUntil()                     │
│  └─ while loop: consume stack       │
└─────────────────────────────────────┘
```

### Main Flow

```
1. executeUntil() → Push start node(s) to stack
2. While stack not empty:
   a. Pop node from executionStack
   b. Prepare input data (gather from upstream)
   c. Create execution context
   d. node.execute(context) → returns output[][]
   e. Record result in nodeOutputs
   f. routeOutputs() → push child nodes based on output
   g. Next iteration
3. Stack empty OR target reached → execution finishes
```

### Implementation

```javascript
class StackExecutor {
    state = new ExecutionState();

    async executeUntil(workflow, targetNodeId, options) {
        // Push start nodes to stack
        const startNodes = this._findStartNodes(workflow);
        for (const nodeId of startNodes) {
            this.state.executionStack.push({
                nodeId,
                inputData: options.initialData || {}
            });
        }

        // Process stack until empty or target reached
        while (this.state.executionStack.length > 0) {
            const { nodeId, inputData } = this.state.executionStack.pop();
            const node = workflow.nodes.find(n => n.id === nodeId);

            // Execute node
            const result = await this._executeNode(node, inputData, workflow, options);

            // Store result
            this.state.nodeOutputs.set(nodeId, result);

            // Check if target reached
            if (nodeId === targetNodeId) break;

            // Route outputs to child nodes
            this._routeOutputs(node, result, workflow);
        }

        return this.context;
    }

    _routeOutputs(node, result, workflow) {
        const outputs = result.outputs || [[result.json]];

        for (let outputIndex = 0; outputIndex < outputs.length; outputIndex++) {
            const outputData = outputs[outputIndex];

            // KEY: Empty array = skip this output socket
            if (!outputData || outputData.length === 0) {
                continue;  // Branch is dead
            }

            // Find connections from this output socket
            const connections = workflow.connections.filter(c =>
                c.source === node.id && c.sourceHandle === socketName
            );

            // Push child nodes to stack
            for (const conn of connections) {
                this.state.executionStack.push({
                    nodeId: conn.target,
                    inputData: outputData[0]
                });
            }
        }
    }
}
```

### Key Behaviors

#### 1. Data-Driven Routing (Logic Mù)

Flow direction is determined **100% by data**, not by engine logic. The engine is generic and doesn't need to know about If/Switch/Loop specifics.

```javascript
// If Node returns 2D array:
[
  [item1, item2, item3],  // Output 0: items matching condition
  [item4, item5]          // Output 1: items NOT matching
]

// Engine logic (generic):
for (let outputIndex = 0; outputIndex < outputs.length; outputIndex++) {
  const items = outputs[outputIndex];
  
  if (items.length > 0) {  // Only schedule if has data
    // Push connected nodes to stack
  }
  // If items.length === 0: Branch is skipped
}
```

#### 2. Node Output Format

All nodes return `outputs[][]` - a 2D array where:
- **First dimension**: Output socket index
- **Second dimension**: Array of items for that socket

See [ADR-002](./002-node-output-format.md) for detailed specification.

#### 3. Branch Routing (If/Switch)

- Node returns `outputs[outputIndex] = [data]`
- Only downstream nodes connected to non-empty outputs are pushed to stack
- Empty outputs skip their branches entirely

#### 4. Loop Handling

- Loop node maintains internal state (`currentIndex`, `items`)
- Each iteration: outputs to "loop" socket (index 0), node re-queues itself
- On completion: outputs to "done" socket (index 1), moves forward

#### 5. Multi-Input Synchronization (Merge Node)

- Nodes with multiple inputs wait for all inputs using `waitingExecution` map
- Only pushed to stack when all inputs have arrived
- See ADR-002 for merge semantics

---

## Consequences

### Positive
- **Proven pattern**: Matches n8n's battle-tested execution model
- **Generic engine**: Adding new node types doesn't require engine changes
- **Correct branching**: IF/Switch naturally handled by empty outputs
- **Loop support**: Back-edges work via re-queuing
- **Partial execution**: Can run from any node for debugging
- **Pause/resume**: Wait nodes inject state and resume later

### Negative
- More complex than topological sort
- Requires node state management for loops
- Need infinite loop detection (max iterations)
- Memory overhead for large workflows

### Neutral
- Existing topological sort deprecated in favor of stack executor
- Node writers must understand `outputs[][]` format

---

## Implementation Reference

Current implementation: [`stack_executor.js`](../../../workflow_pilot/static/src/mocks/stack_executor.js)

Key classes:
- `ExecutionState`: Internal state for a single execution run
- `StackExecutor`: Main executor with `executeUntil()` method
- `NodeOutput`: Result format with `outputs[][]`

---

## References

- [n8n_execution_deep_technical.md](../../../../Downloads/n8n_execution_deep_technical.md) - Deep analysis of n8n execution
- [ADR-002: Node Output Format](./002-node-output-format.md) - Output format specification
- [n8n Source: WorkflowExecute.ts](https://github.com/n8n-io/n8n/blob/master/packages/core/src/WorkflowExecute.ts)

---

## Metadata

| Field             | Value                                          |
| ----------------- | ---------------------------------------------- |
| **Date**          | 2025-12-29 (Proposed) → 2026-01-05 (Accepted)  |
| **Author**        | Claude Code                                    |
| **Reviewers**     | -                                              |
| **Related ADRs**  | ADR-002                                        |
| **Related Tasks** | E2.2.1, E2.2.2, E2.2.3, E2.2.4, E3.2.1, E3.2.2 |
