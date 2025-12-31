# SPRINT 2 PLANNING
> **Focus**: Expression Builder UX + n8n-style Node Selector + Executor Consolidation
> **Duration**: 2 Weeks
> **Status**: ✅ COMPLETE
> **Created**: 2025-12-30
> **Updated**: 2025-12-30 - Completed E5.4.1, E4.5.1, E4.5.2, S2.1

---

## GOALS
1. **n8n-style Node Selector** - Support `$('n_1').json.key` syntax for cross-node references
2. **Node-scoped Drag/Drop** - INPUT panel drag generates correct node-specific expressions
3. **Executor Consolidation** - Refactor `workflowExecutorService` to delegate to `MockExecutionEngine`
4. **KeyValue Expression Support** - Enable expression inputs in KeyValue controls (Set/Mapping nodes)

## SCOPE

### n8n-style Expression Syntax (Priority)

| Task ID | Description | SP | Priority | Assignee | Status |
|---------|-------------|---:|----------|----------|--------|
| **E5.4.1** | Support `$('nodeId').json.path` selector | 3 | P0 | - | ✅ Done |
| | **Subtotal Expression Syntax** | **3** | | | |

### Expression Builder UX

| Task ID | Description | SP | Priority | Assignee | Status |
|---------|-------------|---:|----------|----------|--------|
| **E4.5.1** | Node-scoped drag/drop from Input panel | 3 | P0 | - | ✅ Done |
| **E4.5.2** | Expressions in KeyValue controls (drop + preview) | 5 | P0 | - | ✅ Done |
| | **Subtotal Expression UX** | **8** | | | |

### Executor Consolidation (Tech Debt)

| Task ID | Description | SP | Priority | Assignee | Status |
|---------|-------------|---:|----------|----------|--------|
| **S2.1** | Refactor workflowExecutorService → delegate to MockExecutionEngine | 3 | P1 | - | ✅ Done |
| | **Subtotal Consolidation** | **3** | | | |

### Optional / Stretch Goals

| Task ID | Description | SP | Priority | Assignee | Status |
|---------|-------------|---:|----------|----------|--------|
| **E2.2.2** | Back-edge routing (loop revisit) | 5 | P1 | - | ❌ Stretch |
| **E2.2.3** | Branch routing (If multi-output) | 5 | P1 | - | ❌ Stretch |
| **V5.1** | LoopNode $loop context integration | 2 | P1 | - | ❌ Stretch |

| | **SPRINT COMMITTED** | **14** | | | |
| | **SPRINT STRETCH** | **12** | | | |

## DELIVERABLES
- ✨ Expression parser recognizes `$('nodeId').json.path` syntax
- ✨ INPUT panel drag produces node-specific expressions (not just `$json`)
- ✨ KeyValue controls support expression drop/preview
- 🔧 Single execution engine (MockExecutionEngine as source of truth)

## SUCCESS CRITERIA
- [x] `$('n_1').json.body.data` resolves correctly in preview and runtime
- [x] Drag from ancestor node section produces `$('n_1').json.key` expression
- [x] KeyValue "value" cells accept expression drop and show preview
- [x] workflowExecutorService delegates to MockExecutionEngine
- [x] No regression in existing Variable/If/Loop node execution

## DEPENDENCIES
- Sprint 1 ✅ (Variable System POC complete)
- E4.5.3 ✅ (Expression preview with full context)
- E3.5.1 ✅ (Data nodes use ExecutionContext)

## RISKS
| Risk | Impact | Mitigation |
|------|--------|------------|
| Parser complexity for `$()` syntax | Medium | Preprocessor/rewriter approach, not full parser |
| Backend parity for expressions | Medium | Document frontend-first, defer Python engine |
| KeyValue UX complexity | Low | Incremental: drop first, then preview |

---

## NOTES
- Sprint 2 picks up high-priority E4/E5 items added during Sprint 1
- Executor consolidation addresses FIXME from S1-BUG-01
- Back-edge/branch routing deferred as stretch goals
