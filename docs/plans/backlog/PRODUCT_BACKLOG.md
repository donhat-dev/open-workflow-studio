# WORKFLOW PILOT - PRODUCT BACKLOG

> **Version**: 1.2.0
> **Last Updated**: 2026-03-05
> **Target**: SMB Retail/E-commerce (Shopee/TikTok + carriers), >15k orders/day

---

## BACKLOG OVERVIEW

| Epic                            | Priority | Story Points | % Done  | Status        |
| ------------------------------- | -------- | ------------ | ------- | ------------- |
| **E1: Core Infrastructure**     | P0       | 34           | 95%     | Near Complete |
| **E9: Variable System**         | P0       | 19           | 100%    | ✅ Done        |
| **E2: Node Execution Engine**   | P0       | 55           | 68%     | In Progress   |
| **E10: Python Runtime Engine**  | P0       | 40           | 65%     | In Progress   |
| **E3: Node Library**            | P0       | 45           | 60%     | In Progress   |
| **E4: UI/UX Editor**            | P1       | 48           | 86%     | In Progress   |
| **E4.6: Editor State Refactor** | P1       | 32           | 70%     | 🔄 In Progress |
| **E5: Expression System**       | P1       | 24           | 66%     | In Progress   |
| **E6: Persistence & Storage**   | P1       | 26           | 55%     | In Progress   |
| **E7: Production Features**     | P2       | 34           | 28%     | In Progress   |
| **E8: Integrations**            | P2       | 40           | 0%      | Planned       |
| **TOTAL**                       |          | **357**      | **65%** |               |

> Note (2026-01): E2 (JS StackExecutor) remains a *prototype track* for UX/learning.
> The production direction is E10: backend-owned execution in Python with a hybrid/feature-flagged integration.
> Update basis (2026-03-05): commit evidence from `2026-01-06..2026-03-05` on `workflow_pilot` + `workflow_studio` runtime/UI/backend paths.

### Recent Commit Highlights

- **2026-03-05** `99dd04b` — Added record/recordset UI expansion path (`RecordBadge`, JSON tree integration, backend resolve API/tests).
- **2026-02-13** `70ad2f7` — Refactored key/value input UX pipeline, removing `InputAutoComplete` from key flows.
- **2026-02-12** `46fba96` — Added Runs tab/history enhancements, HTTP suggestion metadata, and expanded backend/frontend runtime wiring.
- **2026-02-11** `29f986f` — Performance optimization pass across executor/context/runtime + UI rendering improvements.
- **2026-02-10** `9c81829` — Renamed module track to `workflow_studio`, consolidated runtime/editor architecture.
- **2026-02-03** `2fdfc0e` — Zero-trust backend execution hardening (security proxies/runners/contracts).
- **2026-01-29** `9f534f6` — Added `execute_until` backend path for preview execution.
- **2026-01-28** `8a4bafc` — Introduced Phase 4 backend execution engine foundation.

### Commit → Epic Mapping (Evidence Matrix)

| Date | Commit | Primary Epics | Key Evidence (files) | Impact Summary |
| --- | --- | --- | --- | --- |
| 2026-03-05 | `99dd04b` | E4, E10 | `workflow_studio/static/src/components/data_panel/RecordBadge.*`, `workflow_studio/controllers/main.py`, `workflow_studio/tests/test_record_output_refs.py` | Record/recordset expand UX + backend resolve path + tests |
| 2026-02-13 | `70ad2f7` | E4, E5 | `workflow_studio/static/src/components/control_renderer.*`, `workflow_studio/static/src/components/controls/*`, `workflow_studio/static/src/components/node_config_panel.*` | Key-value input UX refactor and expression-entry consistency |
| 2026-02-12 | `46fba96` | E4, E5, E10 | `workflow_studio/static/src/components/workflow_history_panel/*`, `workflow_studio/static/src/utils/input_suggestion_utils.js`, `workflow_studio/models/runners/http_runner.py` | Runs/history UX + suggestion metadata + backend runner expansion |
| 2026-02-11 | `29f986f` | E7, E10 | `workflow_studio/models/workflow_executor.py`, `workflow_studio/models/context_objects.py`, `workflow_studio/models/workflow_run.py` | Runtime and performance optimization across executor/context |
| 2026-02-10 | `9c81829` | E4.6, E10 | `workflow_studio/static/src/store/workflow_store.js`, `workflow_studio/models/runners/*`, `workflow_studio/models/workflow_executor.py` | Consolidated architecture under `workflow_studio`, service/runtime maturation |
| 2026-02-10 | `0ec4e46` | E2, E4, E10 | `workflow_pilot/models/workflow_executor.py`, `workflow_pilot/static/src/components/workflow_node.*`, `workflow_pilot/static/src/services/workflow_bus_service.js` | Execution tracking + UI feedback loop integration |
| 2026-02-09 | `1a49fad` | E2, E4, E10 | `workflow_pilot/controllers/main.py`, `workflow_pilot/models/workflow_executor.py`, `workflow_pilot/static/src/store/workflow_store.js` | Execution visualization and contract propagation |
| 2026-02-09 | `71a8b3c` | E5, E10 | `workflow_pilot/models/context_objects.py`, `workflow_pilot/models/runners/code_runner.py` | `_input` parity fix for code evaluation context |
| 2026-02-07 | `887ea5d` | E4, E6 | `workflow_pilot/static/src/components/workflow_history_panel/*`, `workflow_pilot/static/src/components/node_config_panel.*` | History panel and node/panel UX refactor |
| 2026-02-05 | `1841862` | E6 | `workflow_pilot/models/workflow_milestone.py`, `workflow_pilot/models/workflow_diff_utils.py`, `workflow_pilot/static/src/components/workflow_history_dialog/*` | Version history and milestone model introduction |
| 2026-02-03 | `2fdfc0e` | E7, E10 | `workflow_pilot/models/security/*`, `workflow_pilot/models/workflow_executor.py`, `workflow_pilot/models/runners/*` | Zero-trust backend runtime hardening |
| 2026-02-02 | `9b14d32` | E3, E10 | `workflow_pilot/models/runners/*`, `workflow_pilot/models/workflow_executor.py`, `workflow_pilot/data/workflow_type_data.xml` | Backend runner registry baseline and node execution wiring |
| 2026-01-29 | `9f534f6` | E2, E10 | `workflow_pilot/controllers/main.py`, `workflow_pilot/models/ir_workflow.py`, `workflow_pilot/models/workflow_executor.py` | `execute_until` preview execution API |
| 2026-01-28 | `e444c01` | E3, E5 | `workflow_pilot/data/workflow_type_data.xml`, `workflow_pilot/static/src/nodes/manual_trigger.js`, `workflow_pilot/static/src/utils/expression_utils.js` | Manual trigger and expression syntax expansion |
| 2026-01-28 | `8a4bafc` | E10 | `workflow_pilot/models/workflow_executor.py`, `workflow_pilot/models/ir_workflow.py`, `workflow_pilot/controllers/main.py` | Phase 4 backend execution engine bootstrap |

> Scope note: This matrix emphasizes commits with direct backlog impact and intentionally excludes merge-only housekeeping commits.

---

## E10: PYTHON RUNTIME ENGINE (NEW)
> Backend execution engine (Odoo/Python) + UI integration (hybrid flag)
> Goal: Move execution/state machine/context off the frontend while keeping the editor UI stateless.

| ID        | Feature                                          |     SP | Priority | % Done | Status    | Notes                                            |
| --------- | ------------------------------------------------ | -----: | -------- | -----: | --------- | ------------------------------------------------ |
| **E10.1** | **Execution API Contract**                       |  **5** | P0       | **80%** | 🔄 In Progress | API/response contracts implemented across controllers/schemas (`9f534f6`, `4d4ec8a`, `0ec4e46`) |
| E10.1.1   | `execute_until(workflow_id, node_id, input)` RPC |      3 | P0       |   100% | ✅         | Added and integrated in backend flow (`9f534f6`) |
| E10.1.2   | Trace/Run IDs + minimal metadata                 |      2 | P1       |    50% | 🔄         | Run metadata and history endpoints expanded (`46fba96`, `29f986f`) |
|           |                                                  |        |          |        |           |                                                  |
| **E10.2** | **Python ExecutionContext**                      |  **8** | P0       | **70%** | 🔄 In Progress | Context wrappers and safe resolution in active use (`2fdfc0e`, `94a170f`, `29f986f`) |
| E10.2.1   | Context object + serialization                   |      5 | P0       |    70% | 🔄         | Context object and snapshot payloads are used by run/execution views |
| E10.2.2   | Loop/branch state primitives                     |      3 | P0       |    65% | 🔄         | Loop/branch runtime state and routing implemented in executor/runners |
|           |                                                  |        |          |        |           |                                                  |
| **E10.3** | **Python Stack Executor MVP**                    | **13** | P0       | **75%** | 🔄 In Progress | Backend executor became primary production track (`8a4bafc`, `9b14d32`, `29f986f`) |
| E10.3.1   | Graph execution loop (executeUntil)              |      5 | P0       |    85% | 🔄         | Execution loop + stop-at-node flow implemented and iterated |
| E10.3.2   | Branch routing (If)                              |      4 | P0       |    70% | 🔄         | IF routing exists in runner/executor paths       |
| E10.3.3   | Loop routing (Loop)                              |      4 | P0       |    70% | 🔄         | Loop runner/runtime behavior in place; further hardening pending |
|           |                                                  |        |          |        |           |                                                  |
| **E10.4** | **Node Runner Registry (MVP set)**               |  **8** | P0       | **68%** | 🔄 In Progress | Multi-runner backend registry active (`9b14d32`, `2fdfc0e`, `9c81829`) |
| E10.4.1   | HTTP Request runner                              |      3 | P0       |    80% | 🔄         | HTTP runner continuously improved (`46fba96`, `29f986f`) |
| E10.4.2   | Variable runner (set/get/append/merge)           |      2 | P0       |    50% | 🔄         | Variable runner exists; production hardening pending |
| E10.4.3   | Set Data / Mapping runner                        |      3 | P0       |    60% | 🔄         | Data/expression execution parity partially integrated |
|           |                                                  |        |          |        |           |                                                  |
| **E10.5** | **Hybrid UI Integration**                        |  **6** | P0       | **55%** | 🔄 In Progress | UI now consumes backend execution state/run details across panels/canvas |
| E10.5.1   | `workflow_runtime_service` (frontend)            |      3 | P0       |    60% | 🔄         | Adapter/store/controller integration is active (naming and service layout still evolving) |
| E10.5.2   | Context snapshot caching for preview             |      3 | P0       |    50% | 🔄         | Run snapshot/history-driven preview available (`46fba96`, `29f986f`) |

---

## E9: VARIABLE SYSTEM (NEW)
> Mutable workflow state management - Sprint 1 Priority
> **Reference**: `workflow_pilot/docs/plans/VARIABLE_SYSTEM_PLAN.md`

| ID     | Feature                    |    SP | Priority |   % Done | Status | Notes                      |
| ------ | -------------------------- | ----: | -------- | -------: | ------ | -------------------------- |
| **V1** | **Core Infrastructure**    | **5** | P0       | **100%** | ✅ Done |                            |
| V1.1   | ExecutionContext class     |     2 | P0       |     100% | ✅      | $vars, $node, $json, $loop |
| V1.2   | Mocks directory structure  |     1 | P0       |     100% | ✅      | index.js + empty files     |
| V1.3   | MockExecutionEngine        |     2 | P0       |     100% | ✅      | Replaced by StackExecutor  |
|        |                            |       |          |          |        |                            |
| **V2** | **Variable Service**       | **3** | P0       | **100%** | ✅ Done |                            |
| V2.1   | VariableService            |     2 | P0       |     100% | ✅      | Odoo service wrapper       |
| V2.2   | Adapter integration        |     1 | P0       |     100% | ✅      | Expose to UI layer         |
|        |                            |       |          |          |        |                            |
| **V3** | **VariableNode**           | **5** | P0       | **100%** | ✅ Done |                            |
| V3.1   | VariableNode definition    |     3 | P0       |     100% | ✅      | set/get/append/merge       |
| V3.2   | VariableNode config UI     |     2 | P0       |     100% | ✅      | Operation dropdown         |
|        |                            |       |          |          |        |                            |
| **V4** | **Expression Enhancement** | **3** | P0       | **100%** | ✅ Done |                            |
| V4.1   | $vars in expressions       |     1 | P0       |     100% | ✅      | Path resolution            |
| V4.2   | $loop in expressions       |     1 | P0       |     100% | ✅      | Iteration context          |
| V4.3   | Expression preview update  |     1 | P1       |     100% | ✅      | Show resolved values       |
|        |                            |       |          |          |        |                            |
| **V5** | **Loop Enhancement**       | **3** | P1       | **100%** | ✅ Done |                            |
| V5.1   | LoopNode $loop context     |     2 | P0       |     100% | ✅      | Iteration state            |
| V5.2   | Accumulator option         |     1 | P1       |     100% | ✅      | Auto-collect results       |

---

## E1: CORE INFRASTRUCTURE
> Foundation layer - Pure JavaScript, no Odoo dependency

| ID       | Feature              |     SP | Priority |   % Done | Status        | Notes                                              |
| -------- | -------------------- | -----: | -------- | -------: | ------------- | -------------------------------------------------- |
| **E1.1** | **Core Classes**     | **13** | P0       | **100%** | ✅ Done        |                                                    |
| E1.1.1   | BaseNode class       |      3 | P0       |     100% | ✅             | `core/node.js` - toJSON, fromJSON, execute         |
| E1.1.2   | Control system       |      3 | P0       |     100% | ✅             | `core/control.js` - Text, Select, KeyValue, Number |
| E1.1.3   | Socket types         |      2 | P0       |     100% | ✅             | `core/socket.js` - DataSocket, ErrorSocket         |
| E1.1.4   | Connection model     |      2 | P0       |     100% | ✅             | `core/connection.js` - Edge with metadata          |
| E1.1.5   | Dimension config     |      1 | P0       |     100% | ✅             | `core/dimensions.js` - Node sizing                 |
| E1.1.6   | Event emitter        |      2 | P0       |     100% | ✅             | Built into WorkflowEditor                          |
|          |                      |        |          |          |               |                                                    |
| **E1.2** | **WorkflowEditor**   |  **8** | P0       | **100%** | ✅ Done        |                                                    |
| E1.2.1   | Node CRUD            |      2 | P0       |     100% | ✅             | Add, remove, update position                       |
| E1.2.2   | Connection CRUD      |      2 | P0       |     100% | ✅             | Add, remove, validate                              |
| E1.2.3   | Serialization        |      2 | P0       |     100% | ✅             | toJSON, fromJSON                                   |
| E1.2.4   | Event system         |      2 | P0       |     100% | ✅             | onNodeAdd, onChange, etc.                          |
|          |                      |        |          |          |               |                                                    |
| **E1.3** | **Adapter Layer**    |  **8** | P0       | **100%** | ✅ Done        |                                                    |
| E1.3.1   | WorkflowAdapter      |      3 | P0       |     100% | ✅             | Phase 3 bridge UI↔Core                             |
| E1.3.2   | Adapter service      |      2 | P0       |     100% | ✅             | Odoo service wrapper                               |
| E1.3.3   | Config proxy methods |      2 | P0       |     100% | ✅             | get/setNodeConfig                                  |
| E1.3.4   | Execute proxy        |      1 | P0       |     100% | ✅             | executeNode via adapter                            |
|          |                      |        |          |          |               |                                                    |
| **E1.4** | **History Manager**  |  **5** | P1       |  **80%** | 🔄 In Progress |                                                    |
| E1.4.1   | Undo/Redo stack      |      2 | P1       |     100% | ✅             | `core/history.js`                                  |
| E1.4.2   | Batch operations     |      2 | P1       |     100% | ✅             | Group actions                                      |
| E1.4.3   | UI integration       |      1 | P1       |       0% | ❌             | Buttons exist, no feedback                         |

---

## E2: NODE EXECUTION ENGINE
> Workflow runtime - Execute nodes with data flow

| ID       | Feature                                         |     SP | Priority |  % Done | Status        | Notes                             |
| -------- | ----------------------------------------------- | -----: | -------- | ------: | ------------- | --------------------------------- |
| **E2.1** | **Basic Executor**                              | **13** | P0       | **90%** | 🔄 In Progress |                                   |
| E2.1.1   | Topological sort                                |      3 | P0       |    100% | ✅             | Kahn's algorithm                  |
| E2.1.2   | Context building                                |      3 | P0       |    100% | ✅             | $json, $node aggregation          |
| E2.1.3   | Execute until node                              |      3 | P0       |    100% | ✅             | executeUntil(workflow, nodeId)    |
| E2.1.4   | Node output storage                             |      2 | P0       |    100% | ✅             | nodeOutputs Map                   |
| E2.1.5   | Error handling                                  |      2 | P0       |     60% | 🔄             | Basic catch, no retry             |
|          |                                                 |        |          |         |               |                                   |
| **E2.2** | **Stack-Based Executor**                        | **18** | P0       | **45%** | 🔄 In Progress |                                   |
| E2.2.0   | StackExecutor class (replaces topological sort) |      8 | P0       |    100% | ✅             | Sprint 2 - handles loops/branches |
| E2.2.1   | Execution queue                                 |      5 | P0       |    100% | ✅             | Merged into StackExecutor         |
| E2.2.2   | Back-edge routing                               |      5 | P0       |     50% | 🔄             | Basic loop support done           |
| E2.2.3   | Branch routing                                  |      5 | P0       |     50% | 🔄             | IF node routing done              |
| E2.2.4   | Multi-input join                                |      3 | P0       |      0% | ❌             | Wait for all inputs               |
|          |                                                 |        |          |         |               |                                   |
| **E2.3** | **Execution State**                             |  **8** | P1       | **25%** | 🔄 In Progress |                                   |
| E2.3.1   | Loop iteration context                          |      3 | P0       |      0% | ❌             | currentRunIndex, batch data       |
| E2.3.2   | Paired item tracking                            |      3 | P1       |      0% | ❌             | Data lineage                      |
| E2.3.3   | Execution metadata                              |      2 | P1       |    100% | ✅             | duration, executedAt              |
|          |                                                 |        |          |         |               |                                   |
| **E2.4** | **Advanced Features**                           | **16** | P2       |  **0%** | ❌ Planned     |                                   |
| E2.4.1   | Partial execution                               |      3 | P2       |      0% | ❌             | Skip unchanged nodes              |
| E2.4.2   | Retry logic                                     |      5 | P2       |      0% | ❌             | Configurable retry count          |
| E2.4.3   | Timeout handling                                |      3 | P2       |      0% | ❌             | Per-node timeout                  |
| E2.4.4   | Rate limiting                                   |      5 | P2       |      0% | ❌             | Backpressure control              |

---

## E3: NODE LIBRARY
> Built-in node types for workflows

| ID       | Feature                                               |     SP | Priority |   % Done | Status        | Notes                                                                  |
| -------- | ----------------------------------------------------- | -----: | -------- | -------: | ------------- | ---------------------------------------------------------------------- |
| **E3.1** | **Data Nodes**                                        | **10** | P0       | **100%** | ✅ Done        |                                                                        |
| E3.1.1   | HTTP Request                                          |      5 | P0       |     100% | ✅             | GET/POST/PUT/PATCH/DELETE                                              |
| E3.1.2   | Data Validation                                       |      2 | P0       |     100% | ✅             | Required fields, schema                                                |
| E3.1.3   | Data Mapping                                          |      2 | P0       |     100% | ✅             | Transform fields                                                       |
| E3.1.4   | Set Data                                              |      1 | P0       |     100% | ✅             | Assign values, merge                                                   |
|          |                                                       |        |          |          |               |                                                                        |
| **E3.2** | **Flow Control Nodes**                                | **14** | P0       |  **70%** | 🔄 In Progress | Backend runners for If/Loop are active; Switch is partial             |
| E3.2.1   | If (Conditional)                                      |      5 | P0       |      80% | 🔄             | If runner integrated with backend execution path                       |
| E3.2.2   | Loop (Iterate)                                        |      5 | P0       |      80% | 🔄             | Loop runner + iteration/runtime handling implemented                   |
| E3.2.3   | Switch (Multi-branch)                                 |      3 | P1       |      20% | 🔄             | Switch runner scaffold exists; branch semantics need further QA        |
| E3.2.4   | NoOp (Placeholder)                                    |      1 | P0       |     100% | ✅             | Passthrough                                                            |
|          |                                                       |        |          |          |               |                                                                        |
| **E3.3** | **Trigger Nodes**                                     | **10** | P1       |  **30%** | 🔄 In Progress | Manual trigger shipped; webhook/schedule pending                       |
| E3.3.1   | Webhook Trigger                                       |      5 | P1       |       0% | ❌             | Receive HTTP events                                                    |
| E3.3.2   | Schedule Trigger                                      |      3 | P1       |       0% | ❌             | Cron-based                                                             |
| E3.3.3   | Manual Trigger                                        |      2 | P1       |     100% | ✅             | Added to type data/editor flows (`e444c01`)                            |
|          |                                                       |        |          |          |               |                                                                        |
| **E3.4** | **Advanced Nodes**                                    |  **8** | P2       |  **45%** | 🔄 In Progress | Code/custom runtime path is live in backend track                      |
| E3.4.1   | Code (JS/Python)                                      |      5 | P2       |      70% | 🔄             | Code runner + safe-eval context hardened (`2fdfc0e`, `71a8b3c`)       |
| E3.4.2   | Delay                                                 |      1 | P2       |       0% | ❌             | Wait timer                                                             |
| E3.4.3   | Error Handler                                         |      2 | P2       |      30% | 🔄             | Error contracts/run-state visibility improved in execution API         |
|          |                                                       |        |          |          |               |                                                                        |
| **E3.5** | **ExecutionContext Expression Integration**           |  **3** | P0       | **100%** | ✅ Sprint 1    | unlock $vars usage in nodes                                            |
| E3.5.1   | Data nodes evaluate expressions with ExecutionContext |      3 | P0       |     100% | ✅             | Pass/consume ExecutionContext in execute(); allow $vars in Set/Mapping |

---

## E4: UI/UX EDITOR
> Visual workflow builder interface

| ID       | Feature                                                     |     SP | Priority |   % Done | Status        | Notes                                    |
| -------- | ----------------------------------------------------------- | -----: | -------- | -------: | ------------- | ---------------------------------------- |
| **E4.1** | **Canvas**                                                  | **12** | P0       | **100%** | ✅ Done        |                                          |
| E4.1.1   | Pan & Zoom                                                  |      2 | P0       |     100% | ✅             | Mouse wheel + drag                       |
| E4.1.2   | Grid snapping                                               |      1 | P0       |     100% | ✅             | 20px grid                                |
| E4.1.3   | Selection box                                               |      2 | P0       |     100% | ✅             | Multi-select drag                        |
| E4.1.4   | Connection drawing                                          |      3 | P0       |     100% | ✅             | Bezier curves, snapping                  |
| E4.1.5   | Back-edge rendering                                         |      2 | P0       |     100% | ✅             | Route around bottom                      |
| E4.1.6   | Drop zone                                                   |      2 | P0       |     100% | ✅             | Drag from palette                        |
|          |                                                             |        |          |          |               |                                          |
| **E4.2** | **Node Rendering**                                          |  **8** | P0       | **100%** | ✅ Done        |                                          |
| E4.2.1   | Node component                                              |      3 | P0       |     100% | ✅             | Title, icon, body                        |
| E4.2.2   | Socket component                                            |      2 | P0       |     100% | ✅             | Input/output points                      |
| E4.2.3   | Quick-add button                                            |      1 | P0       |     100% | ✅             | + on unconnected                         |
| E4.2.4   | Selection highlight                                         |      2 | P0       |     100% | ✅             | Border + shadow                          |
|          |                                                             |        |          |          |               |                                          |
| **E4.3** | **Config Panel**                                            |  **8** | P0       | **100%** | ✅ Done        |                                          |
| E4.3.1   | Parameters tab                                              |      3 | P0       |     100% | ✅             | Control rendering                        |
| E4.3.2   | Output tab                                                  |      2 | P0       |     100% | ✅             | Execution result                         |
| E4.3.3   | Input data panel                                            |      2 | P0       |     100% | ✅             | Previous node output                     |
| E4.3.4   | Execute button                                              |      1 | P0       |     100% | ✅             | Run to this node                         |
|          |                                                             |        |          |          |               |                                          |
| **E4.4** | **Advanced UI**                                             | **10** | P2       |  **45%** | 🔄 In Progress | History panel, command/hotkey, execution-view UX advanced significantly |
| E4.4.1   | Minimap                                                     |      3 | P2       |       0% | ❌             | Viewport navigator                       |
| E4.4.2   | Node search                                                 |      2 | P2       |       0% | ❌             | Palette filter                           |
| E4.4.3   | Keyboard shortcuts                                          |      2 | P2       |     100% | ✅             | Del, Ctrl+C/V, Ctrl+Z                    |
| E4.4.4   | Connection labels                                           |      2 | P2       |      40% | 🔄             | Connection execution visualization is now available                    |
| E4.4.5   | Subgraph grouping                                           |      5 | P3       |       0% | ❌             | Collapsible groups                       |
|          |                                                             |        |          |          |               |                                          |
| **E4.5** | **Expression Builder UX (Major)**                           | **10** | P0       | **100%** | ✅ Done        |                                          |
| **E4.6** | **Editor State Architecture Refactor (Studio-like)**        | **32** | P0       |  **70%** | 🔄 In Progress | Service-driven migration progressed strongly after Sprint 3             |
| E4.6.1   | workflowEditor service (reactive state + actions + history) |      8 | P0       |     100% | ✅             | Canonical graph/ui state                 |
| E4.6.2   | Per-editor useSubEnv + scoped editorBus                     |      6 | P0       |      20% | 🔄             | Scoped runtime patterns introduced, full multi-editor isolation pending |
| E4.6.3   | Refactor EditorCanvas to service-driven                     |      6 | P0       |      80% | 🔄             | Most interaction flows moved to service/actions                         |
| E4.6.4   | Refactor panels/menu/toolbar to service-driven              |      6 | P0       |      95% | 🔄             | Config/history/toolbar mostly service-driven                            |
| E4.6.5   | Extract Studio-like hooks + pure utils                      |      4 | P0       |      70% | 🔄             | Hooks/util extraction completed for major canvas behaviors              |
| E4.6.6   | Undo/redo batching + UI feedback                            |      2 | P0       |      60% | 🔄             | Batching and user feedback improved, final polish pending               |

---

## E5: EXPRESSION SYSTEM
> Dynamic value resolution with n8n-style syntax

| ID       | Feature                                  |    SP | Priority |   % Done | Status        | Notes                                                |
| -------- | ---------------------------------------- | ----: | -------- | -------: | ------------- | ---------------------------------------------------- |
| **E5.1** | **Template Parsing**                     | **5** | P0       | **100%** | ✅ Done        |                                                      |
| E5.1.1   | {{ }} syntax                             |     2 | P0       |     100% | ✅             | Extract expressions                                  |
| E5.1.2   | Path parsing                             |     2 | P0       |     100% | ✅             | $json.items[0].name                                  |
| E5.1.3   | Expression mode (=)                      |     1 | P0       |     100% | ✅             | n8n prefix recognized                                |
|          |                                          |       |          |          |               |                                                      |
| **E5.2** | **Client Evaluation**                    | **8** | P1       |  **70%** | 🔄 In Progress | Expression UX and context handling improved in editor/runtime           |
| E5.2.1   | Simple value lookup                      |     2 | P1       |     100% | ✅             | Get by path                                          |
| E5.2.2   | String interpolation                     |     2 | P1       |     100% | ✅             | Multiple {{ }}                                       |
| E5.2.3   | Array indexing                           |     2 | P1       |      80% | 🔄             | Indexing/data-panel handling improved through context/runtime fixes     |
| E5.2.4   | Null handling                            |     2 | P1       |      30% | 🔄             | Partial guardrails in runtime context and schema handling               |
|          |                                          |       |          |          |               |                                                      |
| **E5.3** | **Advanced Expressions**                 | **8** | P2       |  **25%** | 🔄 In Progress | Backend-side expression execution/safety path is now active             |
| E5.3.1   | Function library                         |     3 | P2       |       0% | ❌             | sum, map, filter                                     |
| E5.3.2   | Conditional expressions                  |     2 | P2       |       0% | ❌             | Ternary operators                                    |
| E5.3.3   | Date/time helpers                        |     2 | P2       |       0% | ❌             | Format, parse, now                                   |
| E5.3.4   | Backend evaluation                       |     1 | P2       |      80% | 🔄             | Python runtime path in production track (`2fdfc0e`, `9b14d32`, `29f986f`) |
|          |                                          |       |          |          |               |                                                      |
| **E5.4** | **Node Selector Syntax (n8n-style)**     | **3** | P0       | **100%** | ✅ Done        |                                                      |
| E5.4.1   | Support `$('nodeId').json.path` selector |     3 | P0       |     100% | ✅             | Parser/rewriter + evaluation parity (frontend first) |

---

## E6: PERSISTENCE & STORAGE
> Save and restore workflows

| ID       | Feature             |     SP | Priority |   % Done | Status        | Notes               |
| -------- | ------------------- | -----: | -------- | -------: | ------------- | ------------------- |
| **E6.1** | **Client Storage**  |  **5** | P1       | **100%** | ✅ Done        |                     |
| E6.1.1   | LocalStorage save   |      2 | P1       |     100% | ✅             | Auto-save on change |
| E6.1.2   | Export JSON         |      2 | P1       |     100% | ✅             | Copy to clipboard   |
| E6.1.3   | Legacy migration    |      1 | P1       |     100% | ✅             | fromLegacyFormat()  |
|          |                     |        |          |          |               |                     |
| **E6.2** | **Backend Storage** | **13** | P1       |  **45%** | 🔄 In Progress | Core persistence path exists for workflow/run data |
| E6.2.1   | Odoo model          |      3 | P1       |     100% | ✅             | Models for workflow, run, node output are in active use |
| E6.2.2   | CRUD endpoints      |      3 | P1       |      80% | 🔄             | Load/save/run details endpoints integrated into UI        |
| E6.2.3   | User permissions    |      2 | P1       |      70% | 🔄             | Access groups/rules expanded in backend track             |
| E6.2.4   | Folder organization |      2 | P1       |       0% | ❌             | Workflow categories |
| E6.2.5   | Search & filter     |      3 | P1       |      60% | 🔄             | Type/run views include search/filter progression          |
| E6.2.6   | Workflow run sequence|      1 | P1       |     100% | ✅ Done        | Added `workflow.run` sequence data + manifest entry |
|          |                     |        |          |          |               |                     |
| **E6.3** | **Versioning**      |  **8** | P2       |  **65%** | 🔄 In Progress | History panel and milestone/version model introduced (`1841862`, `64d33cc`, `887ea5d`) |
| E6.3.1   | Version snapshots   |      3 | P2       |      80% | 🔄             | Snapshot/history storage model integrated in UI/backend   |
| E6.3.2   | Diff view           |      3 | P2       |      60% | 🔄             | Diff utilities and history UX path present                |
| E6.3.3   | Rollback            |      2 | P2       |      50% | 🔄             | Restore flow exists, still needs production hardening     |

---

## E7: PRODUCTION FEATURES
> Enterprise-ready capabilities

| ID       | Feature               |     SP | Priority | % Done | Status    | Notes                |
| -------- | --------------------- | -----: | -------- | -----: | --------- | -------------------- |
| **E7.1** | **Validation**        |  **8** | P1       | **32%** | 🔄 In Progress | Runtime/graph validation is partially implemented |
| E7.1.1   | Connection validation |      2 | P1       |    20% | 🔄         | Connection path validation improved through execution contracts |
| E7.1.2   | Type checking         |      3 | P1       |    20% | 🔄         | Socket/index contract and runtime guardrails added |
| E7.1.3   | Cycle detection       |      2 | P1       |   100% | ✅         | DFS algorithm done   |
| E7.1.4   | Pre-run validation    |      1 | P1       |    30% | 🔄         | Pre-execution checks expanded with run/contract enforcement |
|          |                       |        |          |        |           |                      |
| **E7.2** | **Monitoring**        | **10** | P2       | **35%** | 🔄 In Progress | Run-node traces, durations, status and failure context are now persisted |
| E7.2.1   | Execution logs        |      3 | P2       |    60% | 🔄         | Workflow/run node logging and views are available       |
| E7.2.2   | Performance metrics   |      3 | P2       |    45% | 🔄         | Duration/perf tracking improved in executor/runtime      |
| E7.2.3   | Error tracking        |      2 | P2       |    35% | 🔄         | Error-node contracts and failure payloads preserved      |
| E7.2.4   | Dashboard             |      2 | P2       |     0% | ❌         | Overview UI          |
|          |                       |        |          |        |           |                      |
| **E7.3** | **Scaling**           | **16** | P2       | **20%** | 🔄 In Progress | Batching/transaction strategy evolved; queue/idempotency remains pending |
| E7.3.1   | Queue workers         |      5 | P2       |    20% | 🔄         | Queue-job direction established but not fully productized |
| E7.3.2   | Rate limiting         |      3 | P2       |    10% | 🔄         | Design/runtime hooks present; full throttling policy pending |
| E7.3.3   | Idempotency           |      5 | P2       |     0% | ❌         | Dedupe processing    |
| E7.3.4   | Batch processing      |      3 | P2       |    35% | 🔄         | Execution batching optimizations shipped in runtime       |

---

## E8: INTEGRATIONS
> Pre-built connectors for e-commerce

| ID       | Feature             |     SP | Priority | % Done | Status    | Notes                      |
| -------- | ------------------- | -----: | -------- | -----: | --------- | -------------------------- |
| **E8.1** | **E-Commerce**      | **20** | P2       | **0%** | ❌ Planned |                            |
| E8.1.1   | Shopee connector    |      8 | P2       |     0% | ❌         | Orders, products, shipping |
| E8.1.2   | TikTok Shop         |      8 | P2       |     0% | ❌         | Orders, fulfillment        |
| E8.1.3   | Lazada connector    |      4 | P2       |     0% | ❌         | Basic integration          |
|          |                     |        |          |        |           |                            |
| **E8.2** | **Carriers**        | **12** | P2       | **0%** | ❌ Planned |                            |
| E8.2.1   | GHN connector       |      4 | P2       |     0% | ❌         | Giao Hang Nhanh            |
| E8.2.2   | GHTK connector      |      4 | P2       |     0% | ❌         | Giao Hang Tiet Kiem        |
| E8.2.3   | Viettel Post        |      4 | P2       |     0% | ❌         | VTP API                    |
|          |                     |        |          |        |           |                            |
| **E8.3** | **Utilities**       |  **8** | P2       | **0%** | ❌ Planned |                            |
| E8.3.1   | Slack notifications |      2 | P2       |     0% | ❌         | Webhooks                   |
| E8.3.2   | Email sender        |      3 | P2       |     0% | ❌         | SMTP integration           |
| E8.3.3   | Google Sheets       |      3 | P2       |     0% | ❌         | Read/write data            |

---

## LEGEND

| Symbol | Meaning                                |
| ------ | -------------------------------------- |
| ✅      | Complete (100%)                        |
| 🔄      | In Progress                            |
| ❌      | Not Started                            |
| SP     | Story Points (Fibonacci: 1,2,3,5,8,13) |
| P0     | Critical - Blocks core functionality   |
| P1     | High - Important for MVP               |
| P2     | Medium - Nice to have                  |
| P3     | Low - Future enhancement               |
