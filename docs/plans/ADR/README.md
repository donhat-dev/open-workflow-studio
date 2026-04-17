# Architecture Decision Records

> Technical decisions and their rationale for Workflow Pilot

---

## ADR Index

| ID                                      | Title                                   | Status         | Date       |
| --------------------------------------- | --------------------------------------- | -------------- | ---------- |
| [ADR-000](./000-template.md)            | Template                                | -              | -          |
| [ADR-001](./001-execution-engine.md)    | Stack-Based State Machine Execution     | **Accepted ✅** | 2026-01-05 |
| [ADR-002](./002-node-output-format.md)  | Node Output Format - 2D Array Structure | **Accepted ✅** | 2026-01-05 |
| [ADR-003](./003-loop-node-mechanism.md) | Loop Node - SplitInBatches Pattern      | **Accepted ✅** | 2026-01-05 |
| [ADR-004](./004-editor-state-architecture.md) | Editor State Architecture (Studio-like Patterns) | **Proposed 🟡** | 2026-01-13 |
| [ADR-005](./005-zero-trust-polp.md)     | Zero Trust + PoLP for Execution & Access | **Accepted ✅** | 2026-02-02 |
| [ADR-006](./006-version-history.md)     | Workflow Version History (Parent-Object Patch) | **Accepted ✅** | 2026-02-04 |
| [ADR-008](./008-hybrid-trigger-architecture.md) | Hybrid Realtime Trigger Architecture | **Accepted ✅** | 2026-02-07 |
| [ADR-009](./009-content-addressed-storage.md) | Content-Addressed Storage for Workflow Data Deduplication | **Accepted ✅** | 2026-03-30 |
| [ADR-010](./010-workflow-connector-workspace-and-node-bridge-architecture.md) | Workflow Connector Workspace and Node-Bridge Architecture | **Proposed 🟡** | 2026-04-15 |
| [ADR-011](./011-workflow-connector-mapping-presets-and-canonical-translation.md) | Workflow Connector Mapping Presets and Canonical Translation | **Proposed 🟡** | 2026-04-15 |
| [ADR-012](./012-workflow-connector-transaction-and-exchange-lifecycle.md) | Workflow Connector Transaction and Exchange Lifecycle | **Proposed 🟡** | 2026-04-15 |

---

## Core Architecture Summary

### Execution Engine (ADR-001)

Workflow Pilot uses a **Stack-Based State Machine** following n8n's architecture:

```
┌─────────────────────────────────────┐
│    StackExecutor                    │
│                                     │
│  1. Push start node(s) to stack     │
│  2. While stack not empty:          │
│     a. Pop node                     │
│     b. Execute → get outputs[][]    │
│     c. Route outputs to children    │
│  3. Target reached → done           │
└─────────────────────────────────────┘
```

### Node Output Format (ADR-002)

All nodes return a **2D array** `outputs[][]`:

```javascript
{
    outputs: [
        [item1, item2],  // Socket 0: e.g., "true" branch
        [item3],         // Socket 1: e.g., "false" branch
    ]
}
```

- **First dimension**: Output socket index
- **Second dimension**: Array of items for that socket
- **Empty array** `[]` = skip that branch (data-driven routing)

### Loop Node Mechanism (ADR-003)

Loop node is a **Stateful Iterator** following n8n's SplitInBatches pattern:

```
State (nodeContext):
  items: [remaining items]
  processedItems: [accumulated results]
  currentIndex: N

Routing:
  Has items? → return [[], [batch]]     → "loop" output
  No items?  → return [[results], []]   → "done" output
```

The loop "exits" naturally when `outputs[1]` (loop) is empty - no special engine logic needed.

---

## What is an ADR?

An Architecture Decision Record (ADR) captures an important architectural decision along with its context and consequences.

### When to Create an ADR
- Significant technical decisions that affect multiple components
- Trade-offs between different approaches
- Decisions that would be hard to reverse
- Patterns that should be followed project-wide

### ADR Lifecycle

```
Proposed → Accepted → Deprecated
              ↓
         Superseded (by new ADR)
```

---

## Quick Start

1. Copy [000-template.md](./000-template.md)
2. Rename to `NNN-short-title.md` (next number)
3. Fill in all sections
4. Add entry to this index
5. Get team review

---

## Reference

- [PRODUCT_BACKLOG.md](../backlog/PRODUCT_BACKLOG.md) - Technical context
- [n8n_execution_deep_technical.md](../../../../Downloads/n8n_execution_deep_technical.md) - Execution engine research
- [stack_executor.js](../../../workflow_pilot/static/src/mocks/stack_executor.js) - Implementation
