# ADR-001: Queue-based vs Topological Execution Engine

> Decision on workflow execution strategy for loops and branches

---

## Status

**Proposed**

---

## Context

Workflow Pilot needs to execute workflows containing:
- **Linear flows**: A → B → C (simple data passing)
- **Branches**: If/Switch nodes with multiple output paths
- **Loops**: Iterate over arrays, repeat until condition

The current implementation uses **topological sort (Kahn's algorithm)** which works for DAGs (Directed Acyclic Graphs) but cannot handle:
1. **Back-edges**: Loop nodes that revisit previous nodes
2. **Conditional paths**: Only one branch should execute based on condition
3. **Multi-output routing**: If node returns data on specific output index

Research on n8n's execution engine (see `n8n-research.md`) shows they use a **stack-based approach** with explicit routing.

---

## Decision

Implement a **Queue-based execution engine** with the following characteristics:

### Core Design
```javascript
class ExecutionQueue {
    queue = [];        // Nodes to execute
    executed = Set();  // Already executed node IDs
    nodeOutputs = {};  // Store outputs per node

    async execute(workflow, startNodeId) {
        this.queue.push(startNodeId);

        while (this.queue.length > 0) {
            const nodeId = this.queue.shift();
            const node = workflow.getNode(nodeId);

            // Build context from upstream outputs
            const context = this.buildContext(node);

            // Execute node
            const result = await node.execute(context);

            // Route to next nodes based on output
            this.routeOutput(node, result);
        }
    }

    routeOutput(node, result) {
        // For If/Switch: result.outputIndex determines path
        // For Loop: may re-queue same node or move to "done" output
        // For regular: queue all downstream nodes
    }
}
```

### Key Behaviors

1. **Branch Routing (If/Switch)**
   - Node returns `{ outputIndex: 0, data: {...} }`
   - Only downstream nodes connected to that output are queued
   - Other branches are skipped

2. **Loop Handling**
   - Loop node maintains internal state (`currentIndex`, `batchData`)
   - On each iteration: outputs to "loop" socket, re-queues itself
   - On completion: outputs to "done" socket, moves forward

3. **Multi-Input Join**
   - Nodes with multiple inputs wait for all inputs
   - Use `pendingInputs` counter per node
   - Only queue when all inputs received

---

## Consequences

### Positive
- Handles loops and branches correctly
- Matches n8n's proven execution model
- Enables partial execution (run from any node)
- Supports async/parallel node execution in future
- Clear separation of routing logic

### Negative
- More complex than topological sort
- Requires node state management for loops
- Need to handle infinite loop detection
- Memory overhead for large workflows

### Neutral
- Existing topological sort can remain as fallback for simple DAGs
- Loop nodes need `SplitInBatches` pattern implementation
- Migration path: Queue executor becomes primary, topo sort deprecated

---

## Alternatives Considered

### Option A: Enhanced Topological Sort
Modify current Kahn's algorithm to handle cycles.

**Pros**:
- Less code change
- Simpler mental model

**Cons**:
- Topological sort fundamentally cannot handle cycles
- Would need cycle detection + separate handling
- Conditional routing still awkward

### Option B: Recursive Execution
Execute nodes recursively, following connections.

**Pros**:
- Simple implementation
- Natural for tree structures

**Cons**:
- Stack overflow risk for long chains
- Hard to pause/resume execution
- Complex state management

### Option C: Event-Driven / Reactive
Use RxJS-style streams for data flow.

**Pros**:
- Elegant for streaming data
- Good backpressure handling

**Cons**:
- Over-engineered for simple workflows
- Learning curve
- Bundle size increase

---

## Implementation Plan

1. **Phase 1**: Implement basic queue executor (E2.2.1)
   - Queue data structure
   - Simple forward routing

2. **Phase 2**: Branch routing (E2.2.3)
   - If node outputIndex handling
   - Skip inactive branches

3. **Phase 3**: Loop support (E2.2.2, E3.2.2)
   - Loop node state management
   - Back-edge re-queuing
   - Iteration limits (prevent infinite loops)

4. **Phase 4**: Multi-input join (E2.2.4)
   - Pending input tracking
   - Wait-for-all semantics

---

## References

- [n8n-research.md](../../../n8n-research.md) - Stack-based execution analysis
- [PRODUCT_BACKLOG.md](../../../PRODUCT_BACKLOG.md) - E2.2 Queue-Based Executor tasks
- [n8n Source: WorkflowExecute.ts](https://github.com/n8n-io/n8n/blob/master/packages/core/src/WorkflowExecute.ts)

---

## Metadata

| Field | Value |
|-------|-------|
| **Date** | 2025-12-29 |
| **Author** | Claude Code |
| **Reviewers** | - |
| **Related ADRs** | - |
| **Related Tasks** | E2.2.1, E2.2.2, E2.2.3, E2.2.4, E3.2.1, E3.2.2 |
