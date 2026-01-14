# SPRINT 3 PLANNING
> **Focus**: Editor State Architecture Refactor (Studio-like patterns)
> **Duration**: 2 Weeks
> **Status**: 🟢 IN PROGRESS (50%)
> **Created**: 2026-01-13
> **Related**: E4.6 refactor epic

---

## GOALS
1. **Canonical editor state service**: workflowEditor as single source of truth for graph and UI state.
2. **Service-driven architecture**: All mutations via service actions; UI is thin and reactive.
3. **Studio-like patterns**: useSubEnv for editor scoping, behavior hooks for DOM, pure utils for logic.
4. **Event bus as intent-only**: Bus carries drag/connect/key events; listeners call service actions, never mutate state directly.

---

## SCOPE (Committed)

### P0 — Service Foundation (E4.6.1)

| Task ID      | Description                                                                                                                 |   SP | Priority | Status |
| ------------ | --------------------------------------------------------------------------------------------------------------------------- | ---: | -------- | ------ |
| **E4.6.1.1** | Create `workflow_editor_service.js` as authoritative graph/UI store; wrap adapter graph to avoid dual sources               |    4 | P0       | ✅ Done |
| **E4.6.1.2** | Implement service actions (add/move/remove node, add/remove connection, select, set viewport) that delegate through adapter |    3 | P0       | ✅ Done |
| **E4.6.1.3** | Integrate history (undo/redo batching) bridging service actions with existing HistoryManager/adapter                        |    1 | P0       | ✅ Done |
| **E4.6.1.4** | Scaffold per-editor env & editorBus minimally                                                                               |    1 | P0       | ✅ Done |

### P0 — Per-Editor Scoping (E4.6.2)

| Task ID      | Description                                                            |   SP | Priority | Status    |
| ------------ | ---------------------------------------------------------------------- | ---: | -------- | --------- |
| **E4.6.2.1** | Use useSubEnv to inject workflowEditor + editorBus per editor instance |    3 | P0       | ✅ Done    |
| **E4.6.2.2** | Ensure dev playground supports multiple editors in future              |    2 | P0       | 🟡 Planned |
| **E4.6.2.3** | editorBus: lightweight intent/lifecycle events                         |    1 | P0       | ✅ Done    |

### P0 — EditorCanvas Refactor (E4.6.3)

| Task ID      | Description                                                           |   SP | Priority | Status    |
| ------------ | --------------------------------------------------------------------- | ---: | -------- | --------- |
| **E4.6.3.1** | Remove nodes/connections callback props; read from service state      |    2 | P0       | ✅ Done    |
| **E4.6.3.2** | Move pan/zoom/selection logic to service actions                      |    2 | P0       | 🟡 Planned |
| **E4.6.3.3** | Refactor drag/connect workflows to emit bus intents → service actions |    2 | P0       | 🟡 Planned |

### P0 — Panels & Menu Refactor (E4.6.4)

| Task ID      | Description                                                                    |   SP | Priority | Status    |
| ------------ | ------------------------------------------------------------------------------ | ---: | -------- | --------- |
| **E4.6.4.1** | NodeConfigPanel: read node config from service, emit config changes as actions |    2 | P0       | ✅ Done    |
| **E4.6.4.2** | NodeMenu: read visibility from service, emit selection/open/close as actions   |    2 | P0       | ✅ Done    |
| **E4.6.4.3** | ConnectionToolbar: thin UI, all state from service                             |    2 | P0       | 🟡 Planned |

### P0 — Hooks & Utils (E4.6.5)

| Task ID      | Description                                                                                        |   SP | Priority | Status    |
| ------------ | -------------------------------------------------------------------------------------------------- | ---: | -------- | --------- |
| **E4.6.5.1** | Extract Studio-like behavior hooks: useNodeDrag, useConnection, useViewport (attach DOM listeners) |    2 | P0       | 🟡 Planned |
| **E4.6.5.2** | Pure utils: geometry (distance, bbox), selection (multiSelect), drag (throttle move)               |    2 | P0       | 🟡 Planned |

### P1 — History & Feedback (E4.6.6)

| Task ID      | Description                                                          |   SP | Priority | Status    |
| ------------ | -------------------------------------------------------------------- | ---: | -------- | --------- |
| **E4.6.6.1** | Service batch operations: beginBatch/endBatch for undo/redo grouping |    1 | P1       | 🟡 Planned |
| **E4.6.6.2** | UI feedback: undo/redo buttons tied to service history state         |    1 | P1       | 🟡 Planned |

---

## OUT OF SCOPE (Defer)
- Minimap / advanced UI polish
- Performance optimization (virtualization, etc.)
- Multi-tab editor support (architecture prepared, not implemented)

---

## DELIVERABLES
- `workflow_editor_service.js` registered with Odoo registry, fully reactive
- EditorCanvas + all panels using service state instead of props/callbacks
- Dev playground (dev.html?debug=assets) functional with service-driven architecture
- Clean ADR documenting architectural decisions

---

## SUCCESS CRITERIA
- All node mutations (add/move/remove) go through service actions
- All UI state (selection/viewport/panels) managed by service
- Undo/redo working with proper batching
- Dev playground maintains same visual behavior as before refactor
- No prop-based callbacks; all communication via service actions + bus intents

---

## PHASES

### Phase 1: Service Implementation (Done)
- Create workflowEditor service as authoritative store (graph/UI)
- Implement actions delegating through adapter; history integration
- Scaffold per-editor env + editorBus (bus now injected via dev_demo_app)

### Phase 2: EditorCanvas & Scoping (In Progress)
- useSubEnv injection in main app (Done)
- Refactor WorkflowNode to read/write via service (Done)
- Complete EditorCanvas cleanup (callback removal)

### Phase 3: Panels & Hooks (Partially Started)
- Refactor NodeConfigPanel, NodeMenu (Done)
- Refactor ConnectionToolbar
- Extract behavior hooks (useNodeDrag, etc.)
- Extract pure utils (geometry, selection)

### Phase 4 (Days 9-10): Polish & Testing
- End-to-end testing on dev playground
- Undo/redo validation
- Documentation + ADR

---

## RISKS
| Risk                                  | Impact | Mitigation                                          |
| ------------------------------------- | ------ | --------------------------------------------------- |
| Breaking existing UI during refactor  | High   | Incremental refactoring + frequent test on dev.html |
| Service performance with large graphs | Medium | Avoid deep reactivity; use computed selectors       |
| Bus event listener explosion          | Medium | Enforce "bus → action" pattern; lint rules          |

---

## DISCIPLINE RULES (AGENTS.md Update)
- ✋ **No prop callbacks**: Components emit bus intents or call service actions; never introduce callback props
- 📍 **Service is source of truth**: All graph/UI state lives in workflowEditor; components read from it
- 🚌 **Bus is intent-only**: Bus carries user actions (drag, connect, keys); listeners translate to service actions
- 🧮 **Pure utils**: Geometry, selection, drag logic in separate utils/ files; no component coupling
- 🪝 **Behavior hooks**: useNodeDrag, useConnection etc. handle DOM setup/cleanup; no inline listeners

