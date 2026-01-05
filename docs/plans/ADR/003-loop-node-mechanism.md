# ADR-003: Loop Node Mechanism - SplitInBatches Pattern

> Stateful iterator node following n8n's SplitInBatches pattern

---

## Status

**Accepted ✅**

---

## Context

Workflow Pilot needs a Loop node that:
1. Iterates over a collection of items
2. Returns items in batches for processing
3. Allows "loop body" nodes to process each batch
4. Signals completion when all items processed

The challenge: nodes are stateless functions, but loops require state (current index, remaining items).

### n8n's Solution

n8n solves this with the `SplitInBatches` node which:
- Uses external `nodeContext` to persist state between runs
- Returns different outputs based on remaining items
- Relies on **Stack-Based Execution** to re-queue itself

Reference: [SplitInBatchesV3.node.ts](https://github.com/n8n-io/n8n/blob/master/packages/nodes-base/nodes/SplitInBatches/v3/SplitInBatchesV3.node.ts)

---

## Decision

Implement Loop Node as a **Stateful Iterator** following n8n's SplitInBatches pattern.

### Architecture Overview

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Loop Node Mechanism                              │
├────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  External State (nodeContext):                                          │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  {                                                               │   │
│  │    items: [...],           // Remaining items to process        │   │
│  │    processedItems: [...],  // Results from loop body            │   │
│  │    currentRunIndex: 0,     // Current iteration                 │   │
│  │    maxRunIndex: 10,        // Total iterations                  │   │
│  │    done: false,            // Completion flag                   │   │
│  │  }                                                               │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  Output Routing:                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                                                                   │  │
│  │   Has items remaining?                                            │  │
│  │        │                                                          │  │
│  │        ├── YES: return [[], [currentBatch]]                       │  │
│  │        │        └─► Output 1 "loop" → loop body nodes             │  │
│  │        │                                                          │  │
│  │        └── NO:  return [[processedItems], []]                     │  │
│  │                 └─► Output 0 "done" → exit nodes                  │  │
│  │                                                                   │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└────────────────────────────────────────────────────────────────────────┘
```

### Execution Flow

```
Workflow Graph:
                    ┌──────────────────────────────────┐
                    │                                   │
                    ▼                                   │
Input → [Loop Node] ── loop ──► [Process] ── [Merge] ──┘
              │                                  
              └── done ──► [Output]
              

Execution Sequence (5 items, batch=1):

Step 1: Loop Node (first run)
  - nodeContext.items = [item1, item2, item3, item4, item5]
  - Splice batch: [item1]
  - nodeContext.items = [item2, item3, item4, item5]  (remaining)
  - Return: [[], [item1]]  → "loop" output
  - Stack: push Process node

Step 2: Process Node
  - Receives: item1
  - Processes, returns: [processedItem1]
  - Stack: push Merge node

Step 3: Merge Node
  - Receives: processedItem1
  - Forwards to Loop Node (back-edge)
  - Stack: push Loop Node

Step 4: Loop Node (2nd run)
  - nodeContext EXISTS (not first run)
  - Splice next batch: [item2]
  - nodeContext.items = [item3, item4, item5]
  - nodeContext.processedItems = [processedItem1, ...]
  - Return: [[], [item2]]  → "loop" output
  - Continue...

Step 9: Loop Node (5th run - LAST)
  - Splice last batch: [item5]
  - nodeContext.items = []  (empty!)
  - processedItems = [all 5 processed items]
  - Return: [[processedItems], []]  → "done" output
  - Stack: push Output node (exit loop)

Step 10: Output Node
  - Receives: all processed items
  - Workflow complete
```

### Core Implementation

```javascript
async executeLoopNode(node, inputData, context) {
    const config = node.config || {};
    const batchSize = config.batchSize || 1;
    
    // Get persistent context for this node
    let nodeContext = this.state.nodeContext.get(node.id);
    
    // ══════════════════════════════════════════════════════════════
    // PHASE A: First Run - Initialize State
    // ══════════════════════════════════════════════════════════════
    if (nodeContext === undefined || config.reset === true) {
        // Resolve collection from input or expression
        const items = this._resolveCollection(inputData, config);
        
        nodeContext = {
            items: [...items],              // Copy of all items
            processedItems: [],             // Results accumulator
            currentRunIndex: 0,             // Iteration counter
            maxRunIndex: Math.ceil(items.length / batchSize),
            done: false
        };
    }
    // ══════════════════════════════════════════════════════════════
    // PHASE B: Subsequent Runs - Continue Iteration
    // ══════════════════════════════════════════════════════════════
    else {
        nodeContext.currentRunIndex += 1;
        
        // Accumulate processed items from previous iteration
        if (inputData && inputData.length > 0) {
            nodeContext.processedItems.push(...inputData);
        }
    }
    
    // Splice next batch from remaining items
    const batchItems = nodeContext.items.splice(0, batchSize);
    
    // Save updated context
    this.state.nodeContext.set(node.id, nodeContext);
    
    // ══════════════════════════════════════════════════════════════
    // PHASE C: Routing Decision
    // ══════════════════════════════════════════════════════════════
    if (batchItems.length === 0) {
        // All items processed → exit via "done" output
        nodeContext.done = true;
        this.state.nodeContext.delete(node.id);  // Clean up
        
        return {
            outputs: [
                nodeContext.processedItems,  // Output 0: "done" - all results
                []                           // Output 1: "loop" - empty
            ],
            meta: { completed: true, iterations: nodeContext.maxRunIndex }
        };
    }
    
    // More items remain → continue via "loop" output
    nodeContext.done = false;
    
    return {
        outputs: [
            [],           // Output 0: "done" - empty
            batchItems    // Output 1: "loop" - current batch
        ],
        meta: { 
            iteration: nodeContext.currentRunIndex + 1,
            remaining: nodeContext.items.length 
        }
    };
}
```

### Socket Mapping

| Output Index | Name   | When Used           | Data                                     |
| ------------ | ------ | ------------------- | ---------------------------------------- |
| 0            | `done` | All items processed | `processedItems[]` (accumulated results) |
| 1            | `loop` | Items remaining     | `currentBatch[]` (next batch to process) |

### n8n Source Reference

From `SplitInBatchesV3.node.ts` lines 155-162:

```typescript
if (returnItems.length === 0) {
    nodeContext.done = true;
    return [nodeContext.processedItems, []];  // DONE output gets data
}

nodeContext.done = false;
return [[], returnItems];  // LOOP output gets data
```

---

## Key Mechanisms

### 1. External State via `nodeContext`

The loop node stores its state **outside** the function scope:

```javascript
// Engine provides persistent context per node
const nodeContext = this.state.nodeContext.get(node.id);

// Node modifies context
nodeContext.items.splice(0, batchSize);
nodeContext.currentRunIndex++;

// Engine preserves context across runs
this.state.nodeContext.set(node.id, nodeContext);
```

### 2. Back-Edge Re-queuing

The "loop" output connects back to the Loop node (via Merge/direct connection):

```
Loop ──► Body ──► Merge ──┐
  ▲                        │
  └────────────────────────┘  (back-edge)
```

When Merge routes to Loop node:
1. Engine pushes Loop node to stack
2. Loop node executes again (not first run)
3. Loop node checks existing `nodeContext`
4. Continues iteration

### 3. Data-Driven Exit

No special engine logic needed - the loop "exits" naturally:

```javascript
// When items exhausted:
return [
    [processedItems],  // Output 0 "done" HAS data → connected nodes execute
    []                 // Output 1 "loop" EMPTY → back-edge NOT followed
];
```

The engine just sees "output index 1 is empty" and doesn't push loop body nodes.

---

## Consequences

### Positive

- **No special engine logic**: Loop is just another node
- **Predictable behavior**: Same routing rules as If/Switch
- **Batch control**: User configures batch size
- **Result accumulation**: `processedItems` collects all iterations
- **Reset capability**: Can restart loop via `reset` option

### Negative

- **State management complexity**: Must carefully manage `nodeContext`
- **Memory for large collections**: All items cached in context
- **Back-edge requirement**: Workflow must connect loop output back

### Neutral

- Infinite loop protection handled by engine's `maxIterations`
- Context cleanup important to prevent memory leaks

---

## Workflow Pilot Implementation

### Current: `stack_executor.js`

```javascript
async _executeLoopNode(node, inputData, expressionContext, startTime) {
    const config = node.config || {};
    let loopCtx = this.state.nodeContext.get(node.id);

    if (!loopCtx) {
        // First execution: resolve collection
        let collection = resolveCollection(inputData, config);
        
        loopCtx = {
            currentIndex: 0,
            items: collection,
            maxIndex: collection.length
        };
    }

    const currentItem = loopCtx.items[loopCtx.currentIndex];
    loopCtx.currentIndex++;
    this.state.nodeContext.set(node.id, loopCtx);

    if (loopCtx.currentIndex < loopCtx.maxIndex) {
        // More items → "loop" output
        return {
            outputs: [[currentItem], []],
            meta: { iteration: loopCtx.currentIndex }
        };
    } else {
        // Done → "done" output
        this.state.nodeContext.delete(node.id);
        return {
            outputs: [[], [currentItem]],
            meta: { completed: true }
        };
    }
}
```

### Proposed Enhancement

Align with n8n's pattern:
- Use `.splice()` for batch extraction
- Accumulate `processedItems` from loop body
- Support `batchSize` parameter
- Add `reset` option

---

## References

- [ADR-001: Stack-Based Execution Engine](./001-execution-engine.md)
- [ADR-002: Node Output Format](./002-node-output-format.md)
- [n8n SplitInBatchesV3.node.ts](https://github.com/n8n-io/n8n/blob/master/packages/nodes-base/nodes/SplitInBatches/v3/SplitInBatchesV3.node.ts)
- [stack_executor.js](../../../workflow_pilot/static/src/mocks/stack_executor.js)

---

## Metadata

| Field             | Value            |
| ----------------- | ---------------- |
| **Date**          | 2026-01-05       |
| **Author**        | Claude Code      |
| **Reviewers**     | -                |
| **Related ADRs**  | ADR-001, ADR-002 |
| **Related Tasks** | E2.2.2, E3.2.2   |
