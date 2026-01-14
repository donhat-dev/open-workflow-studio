# SPRINT 4 PLANNING
> **Focus**: Python Engine MVP (executeUntil) + Hybrid UI Integration + Stateless Node Definitions
> **Duration**: 2 Weeks
> **Status**: 🟡 PLANNED
> **Created**: 2026-01-13

---

## GOALS
1. **Python executeUntil MVP**: backend executes workflow up to a target node and returns outputs + context snapshot.
2. **Hybrid feature flag**: UI can switch between JS prototype executor and Python executor.
3. **Stateless UI nodes**: node definitions become schema-only (no frontend `.execute()` coupling).

---

## SCOPE (Committed)

### P0 — Backend Runtime MVP

| Task ID | Description | SP | Priority | Status |
|---------|-------------|---:|----------|--------|
| **E10.1.1** | Define RPC contract: `execute_until(workflow_id, node_id, input_data)` | 3 | P0 | 🟡 Planned |
| **E10.2.1** | Python ExecutionContext + snapshot serialization | 5 | P0 | 🟡 Planned |
| **E10.3.1** | Python StackExecutor: executeUntil loop + stop at target | 5 | P0 | 🟡 Planned |

### P0 — Node Runners (Minimum Set)

| Task ID | Description | SP | Priority | Status |
|---------|-------------|---:|----------|--------|
| **E10.4.1** | HTTP Request runner (timeout + basic errors) | 3 | P0 | 🟡 Planned |
| **E10.4.2** | Variable runner (set/get/append/merge) | 2 | P0 | 🟡 Planned |
| **E10.4.3** | Set Data / Mapping runner (expressions parity) | 3 | P0 | 🟡 Planned |

### P1 — Hybrid UI wiring

| Task ID | Description | SP | Priority | Status |
|---------|-------------|---:|----------|--------|
| **E10.5.1** | Frontend `workflow_runtime_service` calling RPC | 3 | P1 | 🟡 Planned |
| **E10.5.2** | Use backend context snapshot for Expression preview + Input panel | 3 | P1 | 🟡 Planned |

### P1 — Stateless Node Definitions

| Task ID | Description | SP | Priority | Status |
|---------|-------------|---:|----------|--------|
| **S3.1** | Remove/disable frontend `.execute()` in node definitions (schema-only) | 5 | P1 | 🟡 Planned |
| **S3.2** | Adapter `executeNode` routes to runtime service (no coreNode.execute) | 3 | P1 | 🟡 Planned |

---

## OUT OF SCOPE (Defer)
- Full queue workers / retries / rate limit (Production features)
- Full connector library (Shopee/TikTok/Carriers)
- Multi-input join semantics

---

## DELIVERABLES
- Backend endpoint executes workflow up to node and returns:
  - `node_outputs` (by node id)
  - `context_snapshot` (`$vars`, `$node`, `$json`, `$input`, `$loop`)
  - `meta` (duration, executedAt, run_id)
- UI can toggle Python executor without breaking the editor.
- Node registry becomes schema-only (execution moved to Python runners).

---

## SUCCESS CRITERIA
- Execute from NodeConfigPanel returns consistent output and populates preview snapshot.
- Drag/drop expressions still work and preview uses last backend snapshot.
- Parity check: for the MVP node set, Python output matches JS prototype for same workflow.

---

## RISKS
| Risk | Impact | Mitigation |
|------|--------|------------|
| Output parity differences (JS vs Python) | High | Start with small node set + golden workflows |
| Expression evaluation mismatch | Medium | Define canonical expression semantics early |
| Odoo RPC latency affects UX | Medium | Cache snapshots + show run status |
