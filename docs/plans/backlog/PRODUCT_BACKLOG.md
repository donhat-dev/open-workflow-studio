# WORKFLOW PILOT - PRODUCT BACKLOG

> **Version**: 1.1.0
> **Last Updated**: 2025-12-30
> **Target**: SMB Retail/E-commerce (Shopee/TikTok + carriers), >15k orders/day

---

## BACKLOG OVERVIEW

| Epic | Priority | Story Points | % Done | Status |
|------|----------|--------------|--------|--------|
| **E1: Core Infrastructure** | P0 | 34 | 95% | Near Complete |
| **E9: Variable System** | P0 | 19 | 100% | ✅ Done |
| **E2: Node Execution Engine** | P0 | 55 | 60% | In Progress |
| **E3: Node Library** | P0 | 45 | 42% | In Progress |
| **E4: UI/UX Editor** | P1 | 48 | 80% | In Progress |
| **E5: Expression System** | P1 | 24 | 50% | In Progress |
| **E6: Persistence & Storage** | P1 | 26 | 5% | Not Started |
| **E7: Production Features** | P2 | 34 | 0% | Planned |
| **E8: Integrations** | P2 | 40 | 0% | Planned |
| **TOTAL** | | **325** | **50%** | |

---

## E9: VARIABLE SYSTEM (NEW)
> Mutable workflow state management - Sprint 1 Priority
> **Reference**: `workflow_pilot/docs/plans/VARIABLE_SYSTEM_PLAN.md`

| ID | Feature | SP | Priority | % Done | Status | Notes |
|----|---------|----:|----------|-------:|--------|-------|
| **V1** | **Core Infrastructure** | **5** | P0 | **100%** | ✅ Done | |
| V1.1 | ExecutionContext class | 2 | P0 | 100% | ✅ | $vars, $node, $json, $loop |
| V1.2 | Mocks directory structure | 1 | P0 | 100% | ✅ | index.js + empty files |
| V1.3 | MockExecutionEngine | 2 | P0 | 100% | ✅ | Replaced by StackExecutor |
| | | | | | | |
| **V2** | **Variable Service** | **3** | P0 | **100%** | ✅ Done | |
| V2.1 | VariableService | 2 | P0 | 100% | ✅ | Odoo service wrapper |
| V2.2 | Adapter integration | 1 | P0 | 100% | ✅ | Expose to UI layer |
| | | | | | | |
| **V3** | **VariableNode** | **5** | P0 | **100%** | ✅ Done | |
| V3.1 | VariableNode definition | 3 | P0 | 100% | ✅ | set/get/append/merge |
| V3.2 | VariableNode config UI | 2 | P0 | 100% | ✅ | Operation dropdown |
| | | | | | | |
| **V4** | **Expression Enhancement** | **3** | P0 | **100%** | ✅ Done | |
| V4.1 | $vars in expressions | 1 | P0 | 100% | ✅ | Path resolution |
| V4.2 | $loop in expressions | 1 | P0 | 100% | ✅ | Iteration context |
| V4.3 | Expression preview update | 1 | P1 | 100% | ✅ | Show resolved values |
| | | | | | | |
| **V5** | **Loop Enhancement** | **3** | P1 | **100%** | ✅ Done | |
| V5.1 | LoopNode $loop context | 2 | P0 | 100% | ✅ | Iteration state |
| V5.2 | Accumulator option | 1 | P1 | 100% | ✅ | Auto-collect results |

---

## E1: CORE INFRASTRUCTURE
> Foundation layer - Pure JavaScript, no Odoo dependency

| ID | Feature | SP | Priority | % Done | Status | Notes |
|----|---------|----:|----------|-------:|--------|-------|
| **E1.1** | **Core Classes** | **13** | P0 | **100%** | ✅ Done | |
| E1.1.1 | BaseNode class | 3 | P0 | 100% | ✅ | `core/node.js` - toJSON, fromJSON, execute |
| E1.1.2 | Control system | 3 | P0 | 100% | ✅ | `core/control.js` - Text, Select, KeyValue, Number |
| E1.1.3 | Socket types | 2 | P0 | 100% | ✅ | `core/socket.js` - DataSocket, ErrorSocket |
| E1.1.4 | Connection model | 2 | P0 | 100% | ✅ | `core/connection.js` - Edge with metadata |
| E1.1.5 | Dimension config | 1 | P0 | 100% | ✅ | `core/dimensions.js` - Node sizing |
| E1.1.6 | Event emitter | 2 | P0 | 100% | ✅ | Built into WorkflowEditor |
| | | | | | | |
| **E1.2** | **WorkflowEditor** | **8** | P0 | **100%** | ✅ Done | |
| E1.2.1 | Node CRUD | 2 | P0 | 100% | ✅ | Add, remove, update position |
| E1.2.2 | Connection CRUD | 2 | P0 | 100% | ✅ | Add, remove, validate |
| E1.2.3 | Serialization | 2 | P0 | 100% | ✅ | toJSON, fromJSON |
| E1.2.4 | Event system | 2 | P0 | 100% | ✅ | onNodeAdd, onChange, etc. |
| | | | | | | |
| **E1.3** | **Adapter Layer** | **8** | P0 | **100%** | ✅ Done | |
| E1.3.1 | WorkflowAdapter | 3 | P0 | 100% | ✅ | Phase 3 bridge UI↔Core |
| E1.3.2 | Adapter service | 2 | P0 | 100% | ✅ | Odoo service wrapper |
| E1.3.3 | Config proxy methods | 2 | P0 | 100% | ✅ | get/setNodeConfig |
| E1.3.4 | Execute proxy | 1 | P0 | 100% | ✅ | executeNode via adapter |
| | | | | | | |
| **E1.4** | **History Manager** | **5** | P1 | **80%** | 🔄 In Progress | |
| E1.4.1 | Undo/Redo stack | 2 | P1 | 100% | ✅ | `core/history.js` |
| E1.4.2 | Batch operations | 2 | P1 | 100% | ✅ | Group actions |
| E1.4.3 | UI integration | 1 | P1 | 0% | ❌ | Buttons exist, no feedback |

---

## E2: NODE EXECUTION ENGINE
> Workflow runtime - Execute nodes with data flow

| ID | Feature | SP | Priority | % Done | Status | Notes |
|----|---------|----:|----------|-------:|--------|-------|
| **E2.1** | **Basic Executor** | **13** | P0 | **90%** | 🔄 In Progress | |
| E2.1.1 | Topological sort | 3 | P0 | 100% | ✅ | Kahn's algorithm |
| E2.1.2 | Context building | 3 | P0 | 100% | ✅ | $json, $node aggregation |
| E2.1.3 | Execute until node | 3 | P0 | 100% | ✅ | executeUntil(workflow, nodeId) |
| E2.1.4 | Node output storage | 2 | P0 | 100% | ✅ | nodeOutputs Map |
| E2.1.5 | Error handling | 2 | P0 | 60% | 🔄 | Basic catch, no retry |
| | | | | | | |
| **E2.2** | **Stack-Based Executor** | **18** | P0 | **45%** | 🔄 In Progress | |
| E2.2.0 | StackExecutor class (replaces topological sort) | 8 | P0 | 100% | ✅ | Sprint 2 - handles loops/branches |
| E2.2.1 | Execution queue | 5 | P0 | 100% | ✅ | Merged into StackExecutor |
| E2.2.2 | Back-edge routing | 5 | P0 | 50% | 🔄 | Basic loop support done |
| E2.2.3 | Branch routing | 5 | P0 | 50% | 🔄 | IF node routing done |
| E2.2.4 | Multi-input join | 3 | P0 | 0% | ❌ | Wait for all inputs |
| | | | | | | |
| **E2.3** | **Execution State** | **8** | P1 | **25%** | 🔄 In Progress | |
| E2.3.1 | Loop iteration context | 3 | P0 | 0% | ❌ | currentRunIndex, batch data |
| E2.3.2 | Paired item tracking | 3 | P1 | 0% | ❌ | Data lineage |
| E2.3.3 | Execution metadata | 2 | P1 | 100% | ✅ | duration, executedAt |
| | | | | | | |
| **E2.4** | **Advanced Features** | **16** | P2 | **0%** | ❌ Planned | |
| E2.4.1 | Partial execution | 3 | P2 | 0% | ❌ | Skip unchanged nodes |
| E2.4.2 | Retry logic | 5 | P2 | 0% | ❌ | Configurable retry count |
| E2.4.3 | Timeout handling | 3 | P2 | 0% | ❌ | Per-node timeout |
| E2.4.4 | Rate limiting | 5 | P2 | 0% | ❌ | Backpressure control |

---

## E3: NODE LIBRARY
> Built-in node types for workflows

| ID | Feature | SP | Priority | % Done | Status | Notes |
|----|---------|----:|----------|-------:|--------|-------|
| **E3.1** | **Data Nodes** | **10** | P0 | **100%** | ✅ Done | |
| E3.1.1 | HTTP Request | 5 | P0 | 100% | ✅ | GET/POST/PUT/PATCH/DELETE |
| E3.1.2 | Data Validation | 2 | P0 | 100% | ✅ | Required fields, schema |
| E3.1.3 | Data Mapping | 2 | P0 | 100% | ✅ | Transform fields |
| E3.1.4 | Set Data | 1 | P0 | 100% | ✅ | Assign values, merge |
| | | | | | | |
| **E3.2** | **Flow Control Nodes** | **14** | P0 | **10%** | 🔄 In Progress | |
| E3.2.1 | If (Conditional) | 5 | P0 | 10% | 🔄 | Stub only, no execute |
| E3.2.2 | Loop (Iterate) | 5 | P0 | 10% | 🔄 | Stub only, needs state |
| E3.2.3 | Switch (Multi-branch) | 3 | P1 | 0% | ❌ | Not started |
| E3.2.4 | NoOp (Placeholder) | 1 | P0 | 100% | ✅ | Passthrough |
| | | | | | | |
| **E3.3** | **Trigger Nodes** | **10** | P1 | **0%** | ❌ Planned | |
| E3.3.1 | Webhook Trigger | 5 | P1 | 0% | ❌ | Receive HTTP events |
| E3.3.2 | Schedule Trigger | 3 | P1 | 0% | ❌ | Cron-based |
| E3.3.3 | Manual Trigger | 2 | P1 | 0% | ❌ | Button-based start |
| | | | | | | |
| **E3.4** | **Advanced Nodes** | **8** | P2 | **0%** | ❌ Planned | |
| E3.4.1 | Code (JS/Python) | 5 | P2 | 0% | ❌ | Custom code execution |
| E3.4.2 | Delay | 1 | P2 | 0% | ❌ | Wait timer |
| E3.4.3 | Error Handler | 2 | P2 | 0% | ❌ | Catch & process errors |
| | | | | | | |
| **E3.5** | **ExecutionContext Expression Integration** | **3** | P0 | **100%** | ✅ Sprint 1 | unlock $vars usage in nodes |
| E3.5.1 | Data nodes evaluate expressions with ExecutionContext | 3 | P0 | 100% | ✅ | Pass/consume ExecutionContext in execute(); allow $vars in Set/Mapping |

---

## E4: UI/UX EDITOR
> Visual workflow builder interface

| ID | Feature | SP | Priority | % Done | Status | Notes |
|----|---------|----:|----------|-------:|--------|-------|
| **E4.1** | **Canvas** | **12** | P0 | **100%** | ✅ Done | |
| E4.1.1 | Pan & Zoom | 2 | P0 | 100% | ✅ | Mouse wheel + drag |
| E4.1.2 | Grid snapping | 1 | P0 | 100% | ✅ | 20px grid |
| E4.1.3 | Selection box | 2 | P0 | 100% | ✅ | Multi-select drag |
| E4.1.4 | Connection drawing | 3 | P0 | 100% | ✅ | Bezier curves, snapping |
| E4.1.5 | Back-edge rendering | 2 | P0 | 100% | ✅ | Route around bottom |
| E4.1.6 | Drop zone | 2 | P0 | 100% | ✅ | Drag from palette |
| | | | | | | |
| **E4.2** | **Node Rendering** | **8** | P0 | **100%** | ✅ Done | |
| E4.2.1 | Node component | 3 | P0 | 100% | ✅ | Title, icon, body |
| E4.2.2 | Socket component | 2 | P0 | 100% | ✅ | Input/output points |
| E4.2.3 | Quick-add button | 1 | P0 | 100% | ✅ | + on unconnected |
| E4.2.4 | Selection highlight | 2 | P0 | 100% | ✅ | Border + shadow |
| | | | | | | |
| **E4.3** | **Config Panel** | **8** | P0 | **100%** | ✅ Done | |
| E4.3.1 | Parameters tab | 3 | P0 | 100% | ✅ | Control rendering |
| E4.3.2 | Output tab | 2 | P0 | 100% | ✅ | Execution result |
| E4.3.3 | Input data panel | 2 | P0 | 100% | ✅ | Previous node output |
| E4.3.4 | Execute button | 1 | P0 | 100% | ✅ | Run to this node |
| | | | | | | |
| **E4.4** | **Advanced UI** | **10** | P2 | **20%** | 🔄 In Progress | |
| E4.4.1 | Minimap | 3 | P2 | 0% | ❌ | Viewport navigator |
| E4.4.2 | Node search | 2 | P2 | 0% | ❌ | Palette filter |
| E4.4.3 | Keyboard shortcuts | 2 | P2 | 100% | ✅ | Del, Ctrl+C/V, Ctrl+Z |
| E4.4.4 | Connection labels | 2 | P2 | 0% | ❌ | Edge annotations |
| E4.4.5 | Subgraph grouping | 5 | P3 | 0% | ❌ | Collapsible groups |
| | | | | | | |
| **E4.5** | **Expression Builder UX (Major)** | **10** | P0 | **20%** | 🔄 In Progress | High priority, schedule later |
| **E4.5** | **Expression Builder UX (Major)** | **10** | P0 | **100%** | ✅ Done | |
| E4.5.1 | Node-scoped drag/drop from Input panel | 3 | P0 | 100% | ✅ | Dragging from a node section generates `$('n_1').json.key` |
| E4.5.2 | Expressions in KeyValue controls (drop + preview) | 5 | P0 | 100% | ✅ | Enable drop into KeyValue "value" cells + preview |
| E4.5.3 | Expression preview supports full context ($vars/$node/$loop) | 2 | P0 | 100% | ✅ Sprint 1 | Pass full expression context to ExpressionInput |

---

## E5: EXPRESSION SYSTEM
> Dynamic value resolution with n8n-style syntax

| ID | Feature | SP | Priority | % Done | Status | Notes |
|----|---------|----:|----------|-------:|--------|-------|
| **E5.1** | **Template Parsing** | **5** | P0 | **100%** | ✅ Done | |
| E5.1.1 | {{ }} syntax | 2 | P0 | 100% | ✅ | Extract expressions |
| E5.1.2 | Path parsing | 2 | P0 | 100% | ✅ | $json.items[0].name |
| E5.1.3 | Expression mode (=) | 1 | P0 | 100% | ✅ | n8n prefix recognized |
| | | | | | | |
| **E5.2** | **Client Evaluation** | **8** | P1 | **50%** | 🔄 In Progress | |
| E5.2.1 | Simple value lookup | 2 | P1 | 100% | ✅ | Get by path |
| E5.2.2 | String interpolation | 2 | P1 | 100% | ✅ | Multiple {{ }} |
| E5.2.3 | Array indexing | 2 | P1 | 50% | 🔄 | [0], ['key'] partial |
| E5.2.4 | Null handling | 2 | P1 | 0% | ❌ | Default values |
| | | | | | | |
| **E5.3** | **Advanced Expressions** | **8** | P2 | **0%** | ❌ Planned | |
| E5.3.1 | Function library | 3 | P2 | 0% | ❌ | sum, map, filter |
| E5.3.2 | Conditional expressions | 2 | P2 | 0% | ❌ | Ternary operators |
| E5.3.3 | Date/time helpers | 2 | P2 | 0% | ❌ | Format, parse, now |
| E5.3.4 | Backend evaluation | 1 | P2 | 0% | ❌ | Python engine integration |
| | | | | | | |
| **E5.4** | **Node Selector Syntax (n8n-style)** | **3** | P0 | **0%** | ❌ Planned | Option B: `$('n_1').json.key` |
| **E5.4** | **Node Selector Syntax (n8n-style)** | **3** | P0 | **100%** | ✅ Done | |
| E5.4.1 | Support `$('nodeId').json.path` selector | 3 | P0 | 100% | ✅ | Parser/rewriter + evaluation parity (frontend first) |

---

## E6: PERSISTENCE & STORAGE
> Save and restore workflows

| ID | Feature | SP | Priority | % Done | Status | Notes |
|----|---------|----:|----------|-------:|--------|-------|
| **E6.1** | **Client Storage** | **5** | P1 | **100%** | ✅ Done | |
| E6.1.1 | LocalStorage save | 2 | P1 | 100% | ✅ | Auto-save on change |
| E6.1.2 | Export JSON | 2 | P1 | 100% | ✅ | Copy to clipboard |
| E6.1.3 | Legacy migration | 1 | P1 | 100% | ✅ | fromLegacyFormat() |
| | | | | | | |
| **E6.2** | **Backend Storage** | **13** | P1 | **0%** | ❌ Not Started | |
| E6.2.1 | Odoo model | 3 | P1 | 0% | ❌ | ir.model workflow |
| E6.2.2 | CRUD endpoints | 3 | P1 | 0% | ❌ | Save/load/delete |
| E6.2.3 | User permissions | 2 | P1 | 0% | ❌ | Access control |
| E6.2.4 | Folder organization | 2 | P1 | 0% | ❌ | Workflow categories |
| E6.2.5 | Search & filter | 3 | P1 | 0% | ❌ | Find workflows |
| | | | | | | |
| **E6.3** | **Versioning** | **8** | P2 | **0%** | ❌ Planned | |
| E6.3.1 | Version snapshots | 3 | P2 | 0% | ❌ | Save history |
| E6.3.2 | Diff view | 3 | P2 | 0% | ❌ | Compare versions |
| E6.3.3 | Rollback | 2 | P2 | 0% | ❌ | Restore previous |

---

## E7: PRODUCTION FEATURES
> Enterprise-ready capabilities

| ID | Feature | SP | Priority | % Done | Status | Notes |
|----|---------|----:|----------|-------:|--------|-------|
| **E7.1** | **Validation** | **8** | P1 | **0%** | ❌ Planned | |
| E7.1.1 | Connection validation | 2 | P1 | 0% | ❌ | All inputs connected |
| E7.1.2 | Type checking | 3 | P1 | 0% | ❌ | Socket compatibility |
| E7.1.3 | Cycle detection | 2 | P1 | 100% | ✅ | DFS algorithm done |
| E7.1.4 | Pre-run validation | 1 | P1 | 0% | ❌ | Check before execute |
| | | | | | | |
| **E7.2** | **Monitoring** | **10** | P2 | **0%** | ❌ Planned | |
| E7.2.1 | Execution logs | 3 | P2 | 0% | ❌ | Log storage |
| E7.2.2 | Performance metrics | 3 | P2 | 0% | ❌ | Timing, throughput |
| E7.2.3 | Error tracking | 2 | P2 | 0% | ❌ | Failure analytics |
| E7.2.4 | Dashboard | 2 | P2 | 0% | ❌ | Overview UI |
| | | | | | | |
| **E7.3** | **Scaling** | **16** | P2 | **0%** | ❌ Planned | |
| E7.3.1 | Queue workers | 5 | P2 | 0% | ❌ | Celery/RQ backend |
| E7.3.2 | Rate limiting | 3 | P2 | 0% | ❌ | API throttling |
| E7.3.3 | Idempotency | 5 | P2 | 0% | ❌ | Dedupe processing |
| E7.3.4 | Batch processing | 3 | P2 | 0% | ❌ | Bulk operations |

---

## E8: INTEGRATIONS
> Pre-built connectors for e-commerce

| ID | Feature | SP | Priority | % Done | Status | Notes |
|----|---------|----:|----------|-------:|--------|-------|
| **E8.1** | **E-Commerce** | **20** | P2 | **0%** | ❌ Planned | |
| E8.1.1 | Shopee connector | 8 | P2 | 0% | ❌ | Orders, products, shipping |
| E8.1.2 | TikTok Shop | 8 | P2 | 0% | ❌ | Orders, fulfillment |
| E8.1.3 | Lazada connector | 4 | P2 | 0% | ❌ | Basic integration |
| | | | | | | |
| **E8.2** | **Carriers** | **12** | P2 | **0%** | ❌ Planned | |
| E8.2.1 | GHN connector | 4 | P2 | 0% | ❌ | Giao Hang Nhanh |
| E8.2.2 | GHTK connector | 4 | P2 | 0% | ❌ | Giao Hang Tiet Kiem |
| E8.2.3 | Viettel Post | 4 | P2 | 0% | ❌ | VTP API |
| | | | | | | |
| **E8.3** | **Utilities** | **8** | P2 | **0%** | ❌ Planned | |
| E8.3.1 | Slack notifications | 2 | P2 | 0% | ❌ | Webhooks |
| E8.3.2 | Email sender | 3 | P2 | 0% | ❌ | SMTP integration |
| E8.3.3 | Google Sheets | 3 | P2 | 0% | ❌ | Read/write data |

---

## SPRINT RECOMMENDATIONS

### Sprint 1 (Current - 2 weeks)
**Focus: Core Flow Control**

| Task | SP | Assignee |
|------|---:|----------|
| E3.2.1 If Node execute() | 5 | - |
| E2.2.3 Branch routing | 5 | - |
| E3.2.2 Loop Node execute() | 5 | - |
| E2.2.2 Back-edge routing | 5 | - |
| **Total** | **20** | |

### Sprint 2 (2 weeks)
**Focus: Queue Executor**

| Task | SP | Assignee |
|------|---:|----------|
| E2.2.1 Execution queue | 5 | - |
| E2.2.4 Multi-input join | 3 | - |
| E2.3.1 Loop iteration context | 3 | - |
| E2.1.5 Error handling improved | 2 | - |
| E3.3.3 Manual Trigger | 2 | - |
| **Total** | **15** | |

### Sprint 3 (2 weeks)
**Focus: Triggers & Storage**

| Task | SP | Assignee |
|------|---:|----------|
| E3.3.1 Webhook Trigger | 5 | - |
| E6.2.1 Odoo model | 3 | - |
| E6.2.2 CRUD endpoints | 3 | - |
| E7.1.4 Pre-run validation | 1 | - |
| E1.4.3 UI undo/redo feedback | 1 | - |
| **Total** | **13** | |

---

## VELOCITY & PROJECTIONS

| Metric | Value |
|--------|-------|
| **Total Backlog** | 325 SP |
| **Completed** | 154 SP (47%) |
| **Remaining** | 171 SP |
| **Sprint Velocity** (est.) | 15-22 SP |
| **Sprints to Complete** | 8-12 |
| **Estimated Timeline** | 16-24 weeks |

### MVP Milestone (80% core features)
- **Required Points**: ~160 SP completed
- **Remaining for MVP**: ~50 SP
- **Sprints to MVP**: 3-4 (6-8 weeks)

---

## LEGEND

| Symbol | Meaning |
|--------|---------|
| ✅ | Complete (100%) |
| 🔄 | In Progress |
| ❌ | Not Started |
| SP | Story Points (Fibonacci: 1,2,3,5,8,13) |
| P0 | Critical - Blocks core functionality |
| P1 | High - Important for MVP |
| P2 | Medium - Nice to have |
| P3 | Low - Future enhancement |
