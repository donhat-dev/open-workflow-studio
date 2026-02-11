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
| **E10.1.1** | Define RPC contract: `execute_until(workflow_id, node_id, input_data)` | 3 | P0 | 🟢 Done |
| **E10.2.1** | Python ExecutionContext + snapshot serialization | 5 | P0 | 🟢 Done |
| **E10.3.1** | Python StackExecutor: executeUntil loop + stop at target | 5 | P0 | 🟡 In Progress |

### P0 — Node Runners (Minimum Set)

| Task ID | Description | SP | Priority | Status |
|---------|-------------|---:|----------|--------|
| **E10.4.1** | HTTP Request runner (timeout + basic errors) | 3 | P0 | 🚫 Deferred |
| **E10.4.2** | Variable runner (set/get/append/merge) | 2 | P0 | 🚫 Deferred |
| **E10.4.3** | Set Data / Mapping runner (expressions parity) | 3 | P0 | 🚫 Deferred |

### P1 — Hybrid UI wiring

| Task ID | Description | SP | Priority | Status |
|---------|-------------|---:|----------|--------|
| **E10.5.1** | Frontend `workflow_runtime_service` calling RPC | 3 | P1 | 🟡 In Progress |
| **E10.5.2** | Use backend context snapshot for Expression preview + Input panel | 3 | P1 | 🟡 In Progress |

### P1 — Stateless Node Definitions

| Task ID | Description | SP | Priority | Status |
|---------|-------------|---:|----------|--------|
| **S3.1** | Remove/disable frontend `.execute()` in node definitions (schema-only) | 5 | P1 | 🟡 In Progress |
| **S3.2** | Adapter `executeNode` routes to runtime service (no coreNode.execute) | 3 | P1 | 🟡 Planned |

---

## OUT OF SCOPE (Defer)
- Full queue workers / retries / rate limit (Production features)
- Full connector library (Shopee/TikTok/Carriers)
- Node runner registry (HTTP/Variable/Set data) is deferred beyond Sprint 4; preview execution focus remains backend + UI integration.
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

## RECENT PROGRESS (Jan 28-29, 2026)
- **Manual trigger node + expression syntax** – Phase 4 MVP (commit `e444c01`): added `ManualTriggerNode`, `json.field` support, LucideIcon toolbar touch-up, introduced `useEditor` hook + `workflowEditor.nodes`. This maps to **S3.1** (stateless node definitions) and the goal of decoupling frontend execution.
- **Payload-aware preview button + UI wiring** – commit `119e382`: execute button wired into NodeConfigPanel/NodeMenu, backend payload handling, editor expression tweaks. Supports **E10.5.1/2** (hybrid UI + context preview) and improves parity with the JS executor.
- **`execute_until` endpoint** – commit `9f534f6`: new controller + Python executor wiring for preview runs, feeding `workflowEditor.state.execution`. Directly advances **E10.1.1**, **E10.2.1**, and **E10.3.1**.

## PROGRESS ASSESSMENT
- **Sprint 4 Targets**: ~40% complete. Backend execution (E10.*) now has RPC + executor pieces in place, UI wiring is in progress, node registry refactor pivoted from frontend execution to calling backend. Remaining work centers on snapshot consumption in the UI, parity checks, and ensuring `workflowEditor` toggles between runtimes cleanly.
- **Confidence**: Medium. Core primitives exist, but UI/UX integration (NodeConfigPanel preview + expression panel) still requires testing + polish before declaring the sprint done.

## PERFORMANCE VALIDATION UPDATE (Feb 10, 2026)
- **Trace files**
  - Baseline editor: `tmp/perf_baseline_editor.json`
  - Pre-patch stress (expanded loop payload): `tmp/perf_node_panel_stress.json`
  - Toggle/collapse validation: `tmp/perf_toggle_loop_section.json`
  - Post-patch validation: `tmp/perf_node_panel_post_patch.json`
- **Measured outcome (same loop-node config scenario)**
  - INP: `1117ms` (pre-patch stress) → `55ms` (post-patch)
  - CLS: `0.00` (unchanged)
  - DOM footprint in panel view: ~`467` elements / ~`15` `.json-tree-node` by default; ~`439` / ~`3` when collapsed
- **Interpretation**
  - Main bottleneck was eager rendering of deep JSON trees in NodeConfigPanel.
  - Depth-aware + size-aware lazy expansion in `JsonTreeNode` removed most presentation delay and stabilized interaction latency.
  - No new JS/Owl runtime errors observed in post-patch console checks (only existing minor accessibility warnings).

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

---

## NOTES (Out of Scope)
- Working tree change: `workflow.run` sequence moved to `workflow_pilot/data/data.xml` and registered in manifest (not part of Sprint 4 scope).
