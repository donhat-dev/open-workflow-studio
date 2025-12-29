# Architecture Decision Records

> Technical decisions and their rationale for Workflow Pilot

---

## ADR Index

| ID | Title | Status | Date |
|----|-------|--------|------|
| [ADR-000](./000-template.md) | Template | - | - |
| [ADR-001](./001-execution-engine.md) | Queue-based vs Topological Execution | Proposed | 2025-12-29 |

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

- [PRODUCT_BACKLOG.md](../../../PRODUCT_BACKLOG.md) - Technical context
- [n8n-research.md](../../../n8n-research.md) - Execution engine research
