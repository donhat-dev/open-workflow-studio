# SPRINT 1 PLANNING
> **Focus**: Variable System POC + Core Flow Control Foundation
> **Duration**: 2 Weeks
> **Status**: ✅ COMPLETE
> **Updated**: 2025-12-30 - Added Sprint 1 bugfix ticket (ExecutionContext wiring for VariableNode)

---

## GOALS
1. **[NEW] POC Variable System** - Core infrastructure for mutable workflow state ✅
2. **[NEW] ExecutionContext** - Unified context with $vars, $node, $json, $loop namespaces ✅
3. **[NEW] Mock Execution Engine** - Foundation for frontend-only development ✅
4. Prepare foundation for If/Loop nodes (deferred full implementation to Sprint 2)

## SCOPE

### Variable System POC (Priority) - ✅ COMPLETE

| Task ID | Description | SP | Priority | Assignee | Status |
|---------|-------------|---:|----------|----------|--------|
| **V1.1** | Create `core/context.js` (ExecutionContext) | 2 | P0 | - | ✅ Done |
| **V1.2** | Create `mocks/` directory structure | 1 | P0 | - | ✅ Done |
| **V1.3** | Create `mocks/execution_engine.js` | 2 | P0 | - | ✅ Done |
| **V2.1** | Create `services/variable_service.js` | 2 | P0 | - | ✅ Done |
| **V2.2** | Integrate with WorkflowAdapter | 1 | P0 | - | ✅ Done |
| **V2.3** | Bugfix: executor uses ExecutionContext for $vars/$node/$json | 1 | P0 | - | ✅ Done |
| **V4.1** | Add $vars to expression_utils.js | 1 | P0 | - | ✅ Done |
| **V4.2** | Add $loop to expression_utils.js | 1 | P0 | - | ✅ Done |
| **V7** | Create tests/ directory with unit tests | - | P0 | - | ✅ Done |
| | **Subtotal Variable POC** | **11** | | | ✅ |

### Flow Control Foundation - ✅ COMPLETE

| Task ID | Description | SP | Priority | Assignee | Status |
|---------|-------------|---:|----------|----------|--------|
| **E3.2.1** | If Node execute() - full implementation | 3 | P1 | - | ✅ Done |
| **E3.2.2** | Loop Node execute() - full implementation | 3 | P1 | - | ✅ Done |
| **BONUS** | VariableNode with set/get/append/merge | - | P0 | - | ✅ Done |
| **BONUS** | Variable Inspector sidebar panel | - | P1 | - | ✅ Done |
| **BONUS** | ExpressionInput preview supports full context ($vars/$node) | 2 | P0 | - | ✅ Done |
| **BONUS** | Data nodes (Set/Mapping) evaluate with ExecutionContext | 3 | P0 | - | ✅ Done |
| | **Subtotal Flow Control** | **11** | | | ✅ |

| | **SPRINT TOTAL** | **22** | | | ✅ **COMPLETE** |

### Deferred to Sprint 2

| Task ID | Description | SP | Notes |
|---------|-------------|---:|-------|
| E2.2.2 | Back-edge routing | 5 | Needs Variable System first |
| E2.2.3 | Branch routing | 5 | Needs Variable System first |
| V5.1-V5.2 | Loop Enhancement | 3 | After POC validation |

## DELIVERABLES
- ✨ `ExecutionContext` class with $vars, $node, $json, $loop namespaces
- ✨ `MockExecutionEngine` for frontend-only workflow execution
- ✨ `VariableService` Odoo service for variable management
- ✨ Expression parser supporting `{{ $vars.name }}` and `{{ $loop.item }}`
- 📦 Basic If/Loop node stubs with placeholder execute()

## SUCCESS CRITERIA
- [x] ExecutionContext can get/set/append/merge variables
- [x] MockExecutionEngine can execute simple linear workflow
- [x] Expressions resolve $vars and $loop references
- [x] All new code has JSDoc documentation
- [x] No regression in existing node execution

---

## BUGFIX LOG

### S1-BUG-01 — VariableNode does not persist $vars when executed via workflowExecutorService

**Type**: Bugfix (unplanned, Sprint 1)

**SP**: 1

**Severity**: High (blocks VariableNode + Variable Inspector end-to-end)

**Affected Area**:
- UI: NodeConfigPanel → executorService.executeUntil() → App Variable Inspector refresh
- Execution: workflowExecutorService context construction

#### Repro Steps
1. Add `HTTP Request` node and `Set Variable` node.
2. Connect HTTP → Set Variable.
3. Configure `Set Variable`:
	 - operation: `set`
	 - variableName: `data`
	 - value: `{{ $json.body.data }}`
4. Execute via NodeConfigPanel (Execute button).
5. Observe Variable Inspector.

#### Actual
- Node execution result returns `{ json, meta, error }` but `$vars` stays empty.
- `VariableNode.execute(input, context)` receives a plain object context (no methods), so:
	- `hasContextMethods === false`
	- `setVariable()` never runs
- Variable Inspector reads `$vars` via `workflowAdapter.getExpressionContext()` (backed by `workflowVariable`), which was never mutated.

#### Expected
- `$vars.data` is set after executing VariableNode.
- Variable Inspector shows `$vars` updated immediately.

#### Root Cause
`workflowExecutorService.buildContextForNode()` returns a plain JS object:
`{ $node, $json }`.

This context is passed into node execution, but VariableNode requires a real `ExecutionContext` instance (methods: `setVariable/getVariable/...`).

#### Fix (Sprint 1 Quick Fix)
- Make `workflowExecutorService` depend on `workflowVariable` and create a fresh `ExecutionContext` at the start of `executeUntil()`.
- Execute all nodes with the same `ExecutionContext` instance.
- After each node:
	- Persist node output into `ExecutionContext` via `workflowVariable.setNodeOutput()` so `$json/$node` stay in sync.

**Files changed**:
- `workflow_pilot/static/src/services/workflow_executor_service.js`

#### Verification
- Execute workflow up to VariableNode via NodeConfigPanel.
- Confirm `workflowVariable.getExpressionContext().$vars` contains the variable.

#### Follow-ups (Sprint 2)
- FIXME: consolidate `workflowExecutorService` logic by delegating to `MockExecutionEngine` as the single source of execution truth.

## RISKS
| Risk | Impact | Mitigation |
|------|--------|------------|
| Expression parser complexity | Medium | Incremental enhancement, thorough testing |
| Context interface changes | Medium | Define clear interface contract early |
| Scope creep from VariableNode UI | Low | Defer UI to Sprint 2, focus on core |

## DEPENDENCY
- **Reference**: `workflow_pilot/docs/plans/VARIABLE_SYSTEM_PLAN.md` for detailed specs
- **ADR-001**: Execution engine architecture applies to MockExecutionEngine

---

## DAILY STANDUP NOTES

### Day 1 (2024-12-29)
- Sprint replanned to prioritize Variable System POC
- Original If/Loop routing deferred - requires Variable System foundation
- Reference: VARIABLE_SYSTEM_PLAN.md created with full specifications

### Day 2 (2025-12-30)
- Fixed S1-BUG-01: VariableNode now persists $vars via ExecutionContext
- Bonus: ExpressionInput preview wired with full context ($vars/$node/$loop)
- Bonus: SetDataNode/DataMappingNode now evaluate expressions with ExecutionContext
- Backlog items added for n8n-style node selector (E5.4) and Expression Builder UX (E4.5)
- All Sprint 1 success criteria verified ✅
- Sprint 1 closed; ready for Sprint 2 planning
