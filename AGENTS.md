# WORKFLOW AUTOMATION BUILDER

**Updated:** 2026-04-13
**Commit:** 5f83dfe

---

## STRUCTURE

```
workflow_studio/                  # Core workflow editor + backend execution
├── static/src/
│   ├── app/                      # WorkflowEditorApp entry
│   ├── store/                    # Central UI store (workflowEditor service)
│   ├── components/               # OWL UI components
│   │   ├── editor_canvas/        # Main canvas + hooks/
│   │   ├── data_panel/           # Input data sidebar
│   │   ├── expression/           # Expression input system
│   │   └── ...                   # node_config_panel, workflow_node, etc.
│   ├── services/                 # Odoo services + RPC wrappers
│   ├── core/                     # Execution engine, graph logic
│   ├── utils/                    # Pure utilities (geometry, expressions)
│   └── nodes/                    # Frontend node type definitions
│       ├── data_nodes.js         # Data manipulation nodes
│       ├── flow_nodes.js         # Flow control nodes (if, loop, switch)
│       ├── http_request.js       # HTTP request node
│       ├── manual_trigger.js     # Manual trigger node
│       └── index.js              # Node registry entry point
├── controllers/                  # JSON routes (execute, execute_until)
├── models/                       # Backend models
│   └── runners/                  # Per-node execution logic (one file per node type)
├── views/                        # Backend list/form/kanban views
├── data/                         # XML data (node types, sequences)
└── __manifest__.py               # Odoo module manifest
```

> **Note:** Trigger nodes (schedule, record event, webhook) are backend-only runners
> in `models/runners/`. They do not have corresponding frontend node classes in `nodes/`.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|--------|
| Core architecture | `workflow_studio/static/src/store/workflow_store.js` | Central state, actions, undo/redo |
| Canvas behavior | `workflow_studio/static/src/components/editor_canvas/` | Main canvas, hooks orchestration |
| Node system | `workflow_studio/static/src/core/node.js` + `workflow_studio/static/src/nodes/` | BaseNode class, node types |
| Expression engine | `workflow_studio/static/src/utils/expression_utils.js` | n8n-style parsing (`{{ $json.field }}`) |
| Backend execution | `workflow_studio/models/workflow_executor.py` | Stack executor + expression evaluation |
| Node runners | `workflow_studio/models/runners/` | Per-node execution logic |
| Runner base class | `workflow_studio/models/runners/base.py` | BaseNodeRunner interface + SmartExpressionResolver |
| Controllers | `workflow_studio/controllers/main.py` | JSON routes (`execute`, `execute_until`) |
| Backend views | `workflow_studio/views/` | workflow.type/workflow.run views |
| Component patterns | `workflow_studio/static/src/components/workflow_node.js` | t-props, reactive state from service |
| Service patterns | `workflow_studio/static/src/store/workflow_store.js` | Registry-based, bus-driven |
| OWL/service patterns (extracted) | `knowledge/lf_web_studio_patterns.md` | Service layer, state encapsulation |
| Canvas refactor lessons | `knowledge/editor_canvas_refactor_mistakes.md` | Anti-patterns from past refactors |
| History/undo patterns | `knowledge/history.md` | HistoryManager usage |

## CONVENTIONS

### Reference Validity (Applies to all rules)

- Every convention/anti-pattern MUST include a concrete reference (`file+line`, file-only for stable documents or current-document/section references, or URL). If the reference is missing, invalid, or indicates the rule is deprecated, treat it as out-of-date and do not apply it; propose an update to `AGENTS.md`.
  - Source: `AGENTS.md` (Reference Validity section)

### Project Memory

- `CONTINUITY.md` is the active project context ledger — current sprint goals, active decisions, in-flight work. Update it when a sprint goal changes, a significant architectural decision is made, or a feature is completed or abandoned.
  - Source: `CONTINUITY.md:1-30`
- Treat long-lived knowledge like memory: store facts with citations, verify just-in-time before use, and refresh or correct when citations drift.
  - Source: `AGENTS.md` (this section)

### Implementation & Environment Validation

- During implementation and debugging, explicitly reason about three things before concluding a fix: (1) the intended logic/behavior, (2) the actual failure observed during testing, and (3) environment/runtime facts that may explain the gap.
  - Source: `AGENTS.md` (this section)
- When behavior may depend on local runtime context, quickly gather the relevant environment facts instead of assuming them. Examples: which container is running, active port/URL, current database target, whether credentials/config were loaded, whether a process/session is stale.
  - Source: `AGENTS.md` (this section)
- Never guess sensitive environment details (usernames, passwords, tokens, local instance identity). Verify, ask, or mark the gap explicitly.
  - Source: `AGENTS.md` (this section)

### Project-Specific Rules

| Area | Convention | Source |
|------|-----------|--------|
| **Language** | Vietnamese in conversation, English for code/docs | `CONTINUITY.md:9-12` |
| **Fail-First** | No optional chaining (`?.`) for service/dependency access | `knowledge/editor_canvas_refactor_mistakes.md`; `docs/plans/ADR/004-editor-state-architecture.md` |
| **State mutation** | Service is single source of truth; mutations via `workflowEditor.actions.*` only | `workflow_studio/static/src/store/workflow_store.js:83-90`; `docs/plans/ADR/004-editor-state-architecture.md` |
| **Expressions** | Expressions only evaluate inside `{{ ... }}` | `workflow_studio/static/src/utils/expression_utils.js` |
| **Expression syntax (backend)** | No translation/legacy support; pass expression content as-is and rely on data-model wrappers for dot access | `workflow_studio/models/runners/base.py:23-100` |
| **Best practice priority** | Prefer native language/framework patterns (e.g., descriptors/data model) over regex parsing; warn if deviating | `workflow_studio/models/runners/base.py:23-100` |
| **Compatibility** | New/refactored features should not keep backward compatibility when an equivalent exists; prefer ADR-aligned design | `docs/plans/ADR/004-editor-state-architecture.md` |
| **Node config auto-save** | Node config auto-saves to adapter (local mem, debounced 300ms); backend save only on explicit Save/Run | `workflow_studio/static/src/components/node_config_panel.js:1709-1727` |
| **File naming** | `snake_case.js` for files, `PascalCase` for classes | `workflow_studio/static/src/store/workflow_store.js`; `workflow_studio/static/src/core/node.js` |
| **Module header** | `/** @odoo-module **/` required on all JS files | `workflow_studio/static/src/store/workflow_store.js:1` |
| **Template naming** | `module.template_name` (e.g., `workflow_studio.workflow_editor_app`) | `workflow_studio/static/src/components/workflow_node.xml:3` |
| **Manifest assets** | Use glob patterns; asset order: libs → registries → services → core → nodes → utils → components | `workflow_studio/__manifest__.py:19-60` |
| **SCSS architecture** | Shared module styling contracts live in `workflow_studio/static/src/scss/`; load them in order `primary_variables.scss` → `secondary_variables.scss` → `bootstrap_overridden.scss` → `shared_primitives.scss` before component SCSS. | `workflow_studio/__manifest__.py:40-50`; `workflow_studio/static/src/scss/primary_variables.scss:1-26`; `workflow_studio/static/src/scss/secondary_variables.scss:1-41`; `workflow_studio/static/src/scss/shared_primitives.scss:1-365` |
| **SCSS usage** | Shared colors/shadows/radii/states should be declared as `$wf-*` tokens in the shared SCSS layer; reusable visual contracts (shells/actions/helpers/status/list patterns) should live in `shared_primitives.scss`; component SCSS should consume those contracts instead of repeating hardcoded values. | `workflow_studio/static/src/scss/primary_variables.scss:1-26`; `workflow_studio/static/src/scss/secondary_variables.scss:1-41`; `workflow_studio/static/src/scss/shared_primitives.scss:1-365` |
| **UI taxonomy** | Use `wf-tab-nav` for peer navigation, `wf-segmented-toggle` for local mutually exclusive states/filters (including Input/Output visibility), `wf-status-badge` for compact state labels, and `wf-inline-banner` / `wf-helper-text` for feedback layers. | `workflow_studio/static/src/scss/shared_primitives.scss:24-70,109-185,282-335` |
| **Feature gating** | Gate disabled features with a const flag + early return; keep services registered | `knowledge/editor_canvas_refactor_mistakes.md` |
| **Bus usage** | Use bus for global events (e.g., save/execute) and scoped model/service events. Prefer direct actions/callbacks for local UI. | `workflow_studio/static/src/store/workflow_store.js:85`; `workflow_studio/static/src/app/workflow_editor_app.js:63-72` |
| **Clipboard** | Clipboard uses `workflowEditor` service (not adapter) | `CONTINUITY.md:18-18` |
| **Notifications** | Use `display_notification` for sticky execution notices; dialog for internal errors | `CONTINUITY.md:16-17` |
| **Execution state** | Execution results stored in `workflowEditor.state.execution` | `CONTINUITY.md:16-16` |
| **Publish behavior** | Publish does not auto-execute | `CONTINUITY.md:6-6` |
| **Node types** | Node types seeded via XML; manual trigger is a start node (no inputs) | `workflow_studio/data/workflow_type_data.xml`; `workflow_studio/static/src/nodes/manual_trigger.js` |
| **Node runners** | Keep per-node runners under `models/runners/`; each must subclass `BaseNodeRunner` and implement `execute(node_config, input_data, context)` | `workflow_studio/models/runners/base.py:240-260` |
| **t-props** | Bundle complex/long props (including callbacks) via `t-props` to keep templates clean | `workflow_studio/static/src/components/workflow_node.xml:6,20,27` |

### OWL Framework

| Component | Pattern | Source |
|-----------|---------|--------|
| **Reactive components** | Use `useState(service.state)`; avoid duplicate graph state | `knowledge/editor_canvas_refactor_mistakes.md`; `docs/plans/ADR/004-editor-state-architecture.md` |
| **Service injection** | `useService("serviceName")` (no optional chaining) | `workflow_studio/static/src/app/workflow_editor_app.js:1-15` |
| **SubEnv** | Use `useSubEnv({ bus, workflowEditor })` for context | `workflow_studio/static/src/app/workflow_editor_app.js:63-70` |
| **Component lifecycle** | Use `onMounted` for async initialization | `workflow_studio/static/src/app/workflow_editor_app.js` |
| **Props updates** | Use `onWillUpdateProps` to avoid stale state when props change | https://github.com/odoo/odoo/blob/18.0/addons/web_studio/static/src/client_action/view_editor/view_editor.js#L25-L31 |
| **External listeners** | Use `useExternalListener` for DOM/global events to ensure cleanup | https://github.com/odoo/odoo/blob/18.0/addons/web/static/src/search/search_bar/search_bar.js#L84-L85 |
| **Observer cleanup** | Disconnect observers (e.g., `ResizeObserver`) on unmount | https://github.com/odoo/odoo/blob/18.0/addons/web/static/src/views/list/column_width_hook.js#L531-L535 |
| **Command palette** | Use `useCommand` for discoverable actions (Save, Run, Undo/Redo); auto-registers in Ctrl+K palette with hotkey display | `workflow_studio/static/src/components/editor_canvas/hooks/use_workflow_commands.js`; https://github.com/odoo/odoo/blob/18.0/addons/web/static/src/core/commands/command_hook.js#L15-L22 |
| **Scoped hotkeys** | Use `useHotkey` for navigation/continuous keys (arrow move, Delete, Escape); set `allowRepeat` for held keys, `area` for scope | `workflow_studio/static/src/components/editor_canvas/hooks/use_workflow_commands.js`; https://github.com/odoo/odoo/blob/18.0/addons/web/static/src/core/hotkeys/hotkey_hook.js#L12-L14 |
| **UI active element** | Use `useActiveElement(refName)` to scope hotkeys/commands to a component subtree; prevents conflicts with Odoo forms/dialogs | `workflow_studio/static/src/components/editor_canvas.js`; https://github.com/odoo/odoo/blob/18.0/addons/web/static/src/core/ui/ui_service.js#L28-L30 |

### Odoo Integration

| Area | Convention | Source |
|------|-----------|--------|
| **RPC pattern** | Use `/web/dataset/call_kw` with `{ model, method, args, kwargs }` | `knowledge/lf_web_studio_patterns.md` |
| **Client actions** | Workflow id comes from `this.props.action.context.active_id` | `workflow_studio/static/src/app/workflow_editor_app.js` |

## ANTI-PATTERNS (THIS PROJECT)

| Pattern | Why Forbidden | Impact | Source |
|---------|--------------|--------|--------|
| **Optional chaining `?.`** | Hides errors, makes debugging harder | Violates Fail-First principle | `knowledge/editor_canvas_refactor_mistakes.md`; `docs/plans/ADR/004-editor-state-architecture.md` |
| **Duplicate state in `useState`** | Creates sync issues, breaks single source of truth | State divergence | `docs/plans/ADR/004-editor-state-architecture.md`; `knowledge/editor_canvas_refactor_mistakes.md` |
| **Workflow-level autosave** | Workflow-level auto-save to server is forbidden; node config auto-save is local (adapter layer only) | Data loss risk | `workflow_studio/static/src/components/node_config_panel.js:1709-1727` |
| **Raw `window` keyboard listeners** | Bypasses Odoo hotkey priority/scoping; use `useCommand`/`useHotkey` instead | Conflicts with dialogs, forms, overlay hotkeys | `workflow_studio/static/src/components/editor_canvas/hooks/use_workflow_commands.js` |

### Out-of-date / Needs Verification (do not apply)

- No prop callbacks in editor layer (out-of-date; parent-child callback props allowed as needed)
- Local graph state mutation prohibition (no valid reference found)
- Non-technical comments prohibition (no valid reference found)
- Business logic in components prohibition (no valid reference found)
- Event naming `NAMESPACE:ACTION` (no valid reference found)
- Service registry rule (no valid reference found)
- Known violations list from previous AGENTS (no valid reference found)

## UNIQUE STYLES

These patterns are illustrative; verify in code before applying.

### Service-Oriented Architecture

```
Central State → workflowEditor Service
    ├─ Graph State (nodes, connections)
    ├─ UI State (viewport, selection, panels)
    ├─ Actions (moveNode, addConnection, select)
    ├─ History (Undo/Redo with batching)
    └─ EventBus (intents like save/run)

Components → Read from state, call actions
    ├─ EditorCanvas: Main orchestrator
    ├─ WorkflowNode: Individual nodes
    ├─ NodeConfigPanel: Sidebar
    └─ CanvasNodeToolbar: Context menu
```

### Hook-Based Behavior Extraction

```
Component → setup() → Initialize Hooks
    ├─ useViewport → Coordinate transforms
    ├─ useConnectionDrawing → Rubber-band UI
    ├─ useMultiNodeDrag → Drag coordination
    ├─ useConnectionCulling → Performance optimization
    └─ useGestures → Pan/zoom/selection
```

### Node Self-Registration

```
nodes/http_request.js → class HttpRequestNode extends BaseNode
    → static nodeType = 'http'
    → static label, icon, category
    → constructor() → addInput(), addOutput()
    → registry.category("workflow_node_types").add("http", HttpRequestNode)
```

### t-props Bundle Pattern

```javascript
// Component class
getWorkflowNodeProps(node) {
    return {
        node,
        onDragStart: (id, ev) => this.multiNodeDrag.onNodeDragStart({ id, event: ev }),
        onExecute: (id) => this.workflowEditor.actions.execute([id]),
        // ... 8+ more props bundled
    };
}

// XML template
<WorkflowNode t-props="getWorkflowNodeProps(node)"/>
```

### Command & Hotkey Integration

```
EditorCanvas → setup()
    ├─ useCommand("Save", ..., { hotkey: "control+s", category: "Workflow" })
    ├─ useCommand("Execute", ..., { hotkey: "control+enter", category: "Workflow" })
    ├─ useCommand("Undo", ..., { hotkey: "control+z", category: "Workflow" })
    ├─ useCommand("Redo", ..., { hotkey: "control+shift+z", category: "Workflow" })
    ├─ useCommand("Select All", ..., { hotkey: "control+a", category: "Workflow" })
    ├─ useHotkey("delete", ..., { bypassEditableProtection: false })
    ├─ useHotkey("arrowup", ..., { allowRepeat: true })
    └─ useHotkey("arrowdown|arrowleft|arrowright", ..., { allowRepeat: true })

Scoping: Editor receives focus via tabindex="0"; hotkeys fire only
         when canvas area is active. Dialogs/overlays auto-suppress.
```

Source: `workflow_studio/static/src/components/editor_canvas/hooks/use_workflow_commands.js`

## DEV ENVIRONMENT

The project runs via Docker Compose. The Odoo source is mounted read-only; custom addons are mounted read-write for live editing.

### Start

```bash
docker compose up -d
```

### Restart after Python changes

```bash
docker compose restart odoo
```

### View logs

```bash
docker compose logs -f odoo
```

### Access

Default: `http://localhost:8069` (port configurable via `ODOO_PORT` in `docker/.env`)

### Config

Set in `docker/.env`:
- `ODOO_SOURCE_PATH` — path to Odoo 18 EE source
- `ODOO_PORT` — default `8069`
- `DEBUGPY_PORT` — default `5678`

> For XML/QWeb/JS/SCSS changes, no restart is needed — assets are reloaded on next page load.

## TESTING

### Python (Backend)

Tests live in `workflow_studio/tests/` and `workflow_studio_queue_job/tests/`.

- Use `odoo.tests.common.TransactionCase` for database tests.
- Tag with `@tagged("post_install", "-at_install")` for standard post-install tests.
- Run via Odoo test runner inside the container:
  ```bash
  docker compose exec odoo python odoo-bin -d <db> --test-enable --stop-after-init -i workflow_studio
  ```

### Linting

```bash
# Python style + imports
ruff check .

# Python structural checks
pylint --rcfile=.pylintrc workflow_studio/
```

Config files: `.ruff.toml`, `.pylintrc`, `.pylintrc-mandatory`

### JavaScript (Frontend)

No JS test suite currently exists. Planned for Phase 2.

## PYTHON BACKEND CONVENTIONS

| Area | Convention | Source |
|------|-----------|--------|
| **Runner interface** | Each runner must subclass `BaseNodeRunner` and implement `execute(self, node_config, input_data, context)` returning a dict with `outputs` (2D array) and `json` (first output item) | `workflow_studio/models/runners/base.py:240-260` |
| **Expression resolution** | Use `SmartExpressionResolver` (available as `self.resolver` on all runners); `=`-prefixed strings are expression mode, `{{ ... }}` inside are template markers | `workflow_studio/models/runners/base.py:23-100` |
| **Error handling** | Runners raise `odoo.exceptions.UserError` for user-facing validation errors; return error payload dict for execution-level errors | `workflow_studio/models/runners/base.py` |
| **Model naming** | Core models use `ir.workflow` prefix; run/node models use `workflow.*` prefix | `workflow_studio/models/ir_workflow.py`; `workflow_studio/models/workflow_run.py` |
| **Linting** | `ruff` for style/imports (config: `.ruff.toml`); `pylint` with `.pylintrc-mandatory` for structural checks | `.ruff.toml`; `.pylintrc-mandatory` |

## NOTES

### Key Constraints & Assumptions (verified)

- **Fail-First**: Surface errors immediately vs silent failures | `knowledge/editor_canvas_refactor_mistakes.md`
- **E4.6 Discipline**: Editor components read state from service, never duplicate graph state | `docs/plans/ADR/004-editor-state-architecture.md`
- **Save policy**: Node config auto-saves to adapter (local mem, debounced 300ms); backend save only on explicit Save/Run | `workflow_studio/static/src/components/node_config_panel.js:1709-1727`
- **Expressions**: Only evaluate inside `{{ ... }}` | `workflow_studio/static/src/utils/expression_utils.js`
- **Publish**: Publish does not auto-execute | `CONTINUITY.md:6-6`

### Planning Decisions (not enforced; validate before use)

These decisions are captured in ADRs — verify the ADR status before applying:

- Execution model: stack-based executor | `docs/plans/ADR/001-execution-engine.md`
- Loop mechanism | `docs/plans/ADR/003-loop-node-mechanism.md`
- Editor state architecture | `docs/plans/ADR/004-editor-state-architecture.md`
- Hybrid trigger architecture | `docs/plans/ADR/008-hybrid-trigger-architecture.md`
- Content-addressed storage | `docs/plans/ADR/009-content-addressed-storage.md`
