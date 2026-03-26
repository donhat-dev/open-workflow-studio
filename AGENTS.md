# WORKFLOW AUTOMATION BUILDER

**Generated:** 2026-01-29
**Commit:** 524fd9e
**Branch:** (not available)

---

## STRUCTURE

```
workflow_automation_builder/
├── workflow_studio
|           # Core workflow editor + backend execution
│   ├── static/src/
│   │   ├── app/              # WorkflowEditorApp entry
│   │   ├── store/            # Central UI store (workflowEditor)
│   │   ├── components/       # OWL UI components
│   │   │   ├── editor_canvas/       # Main canvas + hooks/
│   │   │   ├── data_panel/          # Node config sidebar
│   │   │   └── expression/          # Expression input system
│   │   ├── services/         # Odoo services + RPC wrappers
│   │   ├── core/             # Execution engine, graph logic
│   │   ├── utils/            # Pure utilities (geometry, expressions)
│   │   └── nodes/            # Node type definitions
│   ├───controllers/          # JSON routes (execute, execute_until)
│   ├───models/               # Backend models
│   │   └───runners/          # Node runners (http, if, loop, ...)
│   ├───views/                # Backend list/form/kanban views
│   ├───data/                 # XML data (node types, sequences)
│   └───manifest__.py       # Odoo module manifest
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|--------|
| Core architecture | `workflow_studio
/static/src/store/workflow_store.js` | Central state, actions, undo/redo |
| Canvas behavior | `workflow_studio
/static/src/components/editor_canvas/` | Main canvas, hooks orchestration |
| Node system | `workflow_studio
/static/src/core/node.js` + `workflow_studio
/static/src/nodes/` | BaseNode class, node types |
| Expression engine | `workflow_studio
/static/src/utils/expression_utils.js` | n8n-style parsing (`{{ $json.field }}`) |
| Backend execution | `workflow_studio
/models/workflow_executor.py` | Stack executor + expression evaluation |
| Node runners | `workflow_studio
/models/runners/` | Per-node execution logic |
| Controllers | `workflow_studio
/controllers/main.py` | JSON routes (`execute`, `execute_until`) |
| Backend views | `workflow_studio
/views/` | workflow.type/workflow.run views |
| Component patterns | `stock_barcode/static/src/components/main.js` | t-props, Model-as-Source-of-Truth |
| Service patterns | `lf_web_studio/static/src/studio_service.js` | Registry-based, bus-driven |

## CONVENTIONS

### Reference Validity (Applies to all rules)

- Every convention/anti-pattern MUST include a concrete reference (file+line or URL). If the reference is missing, invalid, or indicates the rule is deprecated, treat it as out-of-date and do not apply it; propose an update to `AGENTS.md`.
  - Source: `AGENTS.md` (this section)

### Persistent Memory (Repo-scoped)

- Treat long-lived knowledge like memory: store facts with citations, verify just-in-time before use, and refresh or correct when citations drift.
  - Source: https://github.blog/ai-and-ml/github-copilot/building-an-agentic-memory-system-for-github-copilot/
- For Cline-style workflows, treat the repo-local `memory-bank/` as the durable structured project memory. Keep project-defining context there in the standard Memory Bank files, and refresh the relevant file whenever requirements, architecture, constraints, or delivery state materially change.
  - Source: https://docs.cline.bot/features/memory-bank; https://github.com/cline/prompts/blob/main/.clinerules/memory-bank.md
- Keep `CONTINUITY.md` as a temporary bridge / compatibility ledger during the migration. Until it is explicitly retired, mirror critical ongoing context there as needed so existing Copilot-oriented workflows continue to function while `memory-bank/` becomes the primary durable memory.
  - Source: `CONTINUITY.md:4-4,22-22,29-29,42-42`
- Keep Memory Bank files concise and curated: favor short authoritative summaries, trim stale detail, and avoid transcript-style bloat or unnecessary duplication across files.
  - Source: https://docs.cline.bot/features/memory-bank; https://github.com/cline/prompts/blob/main/.clinerules/temporal-memory-bank.md

### Implementation & Environment Validation

- During implementation and debugging, explicitly reason about three things before concluding a fix: (1) the intended logic/behavior, (2) the actual failure observed during testing, and (3) environment/runtime facts that may explain the gap.
    - Source: `AGENTS.md` (this section)
- When behavior may depend on local runtime context, quickly gather the relevant environment facts instead of assuming them. Examples: which local/server instance is actually running, active base URL/tunnel, current database or workspace target, current user/account context, whether credentials/config were loaded, and whether a local process/session is stale.
    - Source: `AGENTS.md` (this section)
- Prefer MCP-assisted quick gathering for that runtime context whenever possible (status/history tools, local service probes, dashboard/API checks, focused questions to the user). Use targeted human confirmation only for facts MCP/tools cannot verify directly.
    - Source: `AGENTS.md` (this section)
- Never guess sensitive environment details (for example usernames, passwords, tokens, local instance identity, or which machine/process is serving traffic). Verify, ask, or mark the gap explicitly.
    - Source: `AGENTS.md` (this section)

### Project-Specific Rules

| Area | Convention | Source |
|-------|-----------|--------|
| **Language** | Vietnamese in conversation, English for code/docs | `CONTINUITY.md:9-12` |
| **Fail-First** | No optional chaining (`?.`) for service/dependency access | `.sisyphus/notepads/phase2-frontend-store/learnings.md:14-19, 58-60`; `.sisyphus/notepads/phase2-frontend-store/decisions.md:168-179` |
| **State mutation** | Service is single source of truth; mutations via `workflowEditor.actions.*` only | `CONTINUITY.md:10-12` |
| **Expressions** | Expressions only evaluate inside `{{ ... }}` | `CONTINUITY.md:12-12` |
| **Expression syntax (backend)** | No translation/legacy support; pass expression content as-is and rely on data-model wrappers for dot access | `AGENTS.md:78-78` |
| **Best practice priority** | Prefer native language/framework patterns (e.g., descriptors/data model) over regex parsing; warn if deviating | `AGENTS.md:79-79` |
| **Compatibility** | New/refactored features should not keep backward compatibility when equivalent exists; prefer ADR-aligned design | `AGENTS.md:80-80` |
| **Node config auto-save** | Node config auto-saves to adapter (local mem, debounced 300ms); backend save only on explicit Save/Run | `workflow_studio
/static/src/components/node_config_panel.js:701-718` |
| **File naming** | `snake_case.js` for files, `PascalCase` for classes | `.sisyphus/notepads/phase2-frontend-store/learnings.md:52-55` |
| **Module header** | `/** @odoo-module **/` required on all JS files | `.sisyphus/notepads/phase2-frontend-store/learnings.md:58-60` |
| **Template naming** | `module.template_name` (e.g., `workflow_studio
.workflow_editor_app`) | `.sisyphus/notepads/phase2-frontend-store/learnings.md:14-15` |
| **Manifest assets** | Use glob patterns; asset order: libs → registries → services → core → nodes → utils → components | `.sisyphus/notepads/phase2-frontend-store/learnings.md:20-23`; `.sisyphus/notepads/phase2-frontend-store/decisions.md:78-90` |
| **SCSS architecture** | Shared module styling contracts live in `workflow_studio/static/src/scss/`; load them in order `primary_variables.scss` → `secondary_variables.scss` → `bootstrap_overridden.scss` → `shared_primitives.scss` before component SCSS. | `workflow_studio/__manifest__.py:19-47`; `workflow_studio/static/src/scss/primary_variables.scss:1-26`; `workflow_studio/static/src/scss/secondary_variables.scss:1-41`; `workflow_studio/static/src/scss/bootstrap_overridden.scss:1-15`; `workflow_studio/static/src/scss/shared_primitives.scss:1-365`; `docs/plans/ADR/007-ui-design-system-governance.md:57-85` |
| **SCSS usage** | Shared colors/shadows/radii/states should be declared as `$wf-*` tokens in the shared SCSS layer, while reusable visual contracts (shells/actions/helpers/status/list patterns) should live in `shared_primitives.scss`; component SCSS should consume those contracts instead of repeating hardcoded/fallback values. | `workflow_studio/static/src/scss/primary_variables.scss:1-26`; `workflow_studio/static/src/scss/secondary_variables.scss:1-41`; `workflow_studio/static/src/scss/shared_primitives.scss:1-365`; `docs/plans/ADR/007-ui-design-system-governance.md:57-85,149-164` |
| **UI taxonomy** | Use `wf-tab-nav` for peer navigation, `wf-segmented-toggle` for local mutually exclusive states/filters (including Input/Output visibility), `wf-status-badge` for compact state labels, and `wf-inline-banner` / `wf-helper-text` for feedback layers. | `docs/plans/ADR/007-ui-design-system-governance.md:92-164`; `workflow_studio/static/src/scss/shared_primitives.scss:24-70,109-185,282-335` |
| **Feature gating** | Gate disabled features with a const flag + early return; keep services registered | `.sisyphus/notepads/phase2-frontend-store/learnings.md:25-29`; `.sisyphus/notepads/phase2-frontend-store/decisions.md:53-75` |
| **Bus usage** | Use bus for global events (e.g., save/execute) and scoped model/service events (model bus, search model). Prefer direct actions/callbacks for local UI. | `workflow_studio
/static/src/app/workflow_editor_app.js:55-55`; `C:\Users\ODOO\Documents\GitHub\18EE-NS\odoo\addons\web\static\src\model\model.js:161-167`; `C:\Users\ODOO\Documents\GitHub\18EE-NS\odoo\addons\web\static\src\search\search_bar\search_bar.js:78-82`; `C:\Users\ODOO\Documents\GitHub\18EE-NS\odoo\addons\point_of_sale\static\src\app\utils\input_popups\number_popup.js:40-42` |
| **Clipboard** | Clipboard uses `workflowEditor` service (not adapter) | `CONTINUITY.md:18-18` |
| **Notifications** | Use `display_notification` for sticky execution notices; dialog for internal errors | `CONTINUITY.md:16-17` |
| **Execution state** | Execution results stored in `workflowEditor.state.execution` | `CONTINUITY.md:16-16` |
| **Publish behavior** | Publish does not auto-execute | `CONTINUITY.md:6-6` |
| **Node types** | Node types seeded via XML; manual trigger is a start node (no inputs) | `.sisyphus/plans/phase4-manual-trigger.md:31-52, 95-116` |
| **Node runners** | Keep per-node runners under `models/runners/` | `CONTINUITY.md:19-19` |
| **t-props** | Bundle complex/long props (including callbacks) via `t-props` to keep templates clean | `workflow_studio
/static/src/components/workflow_node.xml:5-5, 19-19, 23-23` |

### OWL Framework

| Component | Pattern | Source |
|-----------|----------|--------|
| **Reactive components** | Use `useState(service.state)`; avoid duplicate graph state | `.sisyphus/notepads/phase2-frontend-store/learnings.md:40-44, 96-99` |
| **Service injection** | `useService("serviceName")` (no optional chaining) | `.sisyphus/notepads/phase2-frontend-store/learnings.md:14-19, 58-60` |
| **SubEnv** | Use `useSubEnv({ bus, workflowEditor })` for context | `.sisyphus/notepads/phase2-frontend-store/learnings.md:16-17` |
| **Component lifecycle** | Use `onMounted` for async initialization | `.sisyphus/notepads/phase2-frontend-store/learnings.md:17-18` |
| **Props updates** | Use `onWillUpdateProps` to avoid stale state when props change | `C:\Users\ODOO\Documents\GitHub\18EE-NS\odoo\addons\web_studio\static\src\client_action\view_editor\view_editor.js:25-31` |
| **External listeners** | Use `useExternalListener` for DOM/global events to ensure cleanup | `C:\Users\ODOO\Documents\GitHub\18EE-NS\odoo\addons\web\static\src\search\search_bar\search_bar.js:84-85` |
| **Observer cleanup** | Disconnect observers (e.g., `ResizeObserver`) on unmount | `C:\Users\ODOO\Documents\GitHub\18EE-NS\odoo\addons\web\static\src\views\list\column_width_hook.js:531-535` |
| **Command palette** | Use `useCommand` for discoverable actions (Save, Run, Undo/Redo); auto-registers in Ctrl+K palette with hotkey display | `C:\Users\ODOO\Documents\GitHub\18EE-NS\odoo\addons\web\static\src\core\commands\command_hook.js:15-22`; `workflow_studio
/static/src/components/editor_canvas/hooks/use_workflow_commands.js` |
| **Scoped hotkeys** | Use `useHotkey` for navigation/continuous keys (arrow move, Delete, Escape); set `allowRepeat` for held keys, `area` for scope | `C:\Users\ODOO\Documents\GitHub\18EE-NS\odoo\addons\web\static\src\core\hotkeys\hotkey_hook.js:12-14`; `workflow_studio
/static/src/components/editor_canvas/hooks/use_workflow_commands.js` |
| **UI active element** | Use `useActiveElement(refName)` to scope hotkeys/commands to a component subtree; prevents conflicts with Odoo forms/dialogs | `C:\Users\ODOO\Documents\GitHub\18EE-NS\odoo\addons\web\static\src\core\ui\ui_service.js:28-30`; `workflow_studio
/static/src/components/editor_canvas.js` |

### Odoo Integration

| Area | Convention | Source |
|-------|-----------|--------|
| **RPC pattern** | Use `/web/dataset/call_kw` with `{ model, method, args, kwargs }` | `.sisyphus/notepads/phase2-frontend-store/learnings.md:7-12`; `.sisyphus/notepads/phase2-frontend-store/decisions.md:102-123` |
| **Client actions** | Workflow id comes from `this.props.action.context.active_id` | `.sisyphus/notepads/phase2-frontend-store/learnings.md:18-19` |

## ANTI-PATTERNS (THIS PROJECT)

| Pattern | Why Forbidden | Impact | Source |
|---------|---------------|--------|--------|
| **Optional chaining `?.`** | Hides errors, makes debugging harder | Violates Fail-First principle | `.sisyphus/notepads/phase2-frontend-store/learnings.md:91-95`; `.sisyphus/notepads/phase2-frontend-store/decisions.md:168-179` |
| **Duplicate state in `useState`** | Creates sync issues, breaks single source of truth | State divergence | `.sisyphus/notepads/phase2-frontend-store/learnings.md:96-99` |
| **Workflow-level autosave** | Workflow-level auto-save to server is forbidden; node config auto-save is local (adapter layer only) | `workflow_studio
/static/src/components/node_config_panel.js:701-718` |
| **Raw `window` keyboard listeners** | Bypasses Odoo hotkey priority/scoping; use `useCommand`/`useHotkey` instead | Conflicts with dialogs, forms, overlay hotkeys | `workflow_studio
/static/src/components/editor_canvas/hooks/use_workflow_commands.js` |

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
    └─ EventBus (intents like NODE:EXECUTE)

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

### Command & Hotkey Integration (PdfManager Pattern)

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

## COMMANDS

### Odoo Server Restart (On-Demand)
Use this command to restart the Odoo server after making Python code changes.

```powershell
python -c """
import os
import signal
PID_FILE = os.path.join('C:\\Users\\ODOO\\Documents\\GitHub\\18EE-NS\\odoo-hrm.pid')
if os.path.exists(PID_FILE):
    with open(PID_FILE, 'r') as f:
        pid = int(f.read().strip())
        os.kill(pid, signal.SIGTERM)
else:
    print('PID file not found. Is the server running?')

"""
```
- Use explicit restart only when necessary.
- For XML/QWeb/JS/SCSS changes, no restart is needed.

## NOTES

### Key Constraints & Assumptions (verified)
- **Fail-First**: Surface errors immediately vs silent failures | `.sisyphus/notepads/phase2-frontend-store/learnings.md:58-60`
- **E4.6 Discipline**: Editor components read state from service, never duplicate graph state | `.sisyphus/notepads/phase2-frontend-store/learnings.md:96-99`
- **Save policy**: Node config auto-saves to adapter (local mem, debounced 300ms); backend save only on explicit Save/Run | `workflow_studio
/static/src/components/node_config_panel.js:701-718`
- **Expressions**: Only evaluate inside `{{ ... }}` | `CONTINUITY.md:12-12`
- **Publish**: Publish does not auto-execute | `CONTINUITY.md:6-6`

### Planning Decisions (not enforced; validate before use)
- Execution model: Odoo queue_job | `.octto/ses_jk44phap.json:8-44`
- State persistence: checkpoint model | `.octto/ses_jk44phap.json:50-87`
- Retry strategy: exponential backoff | `.octto/ses_jk44phap.json:92-129`
- Rate limiting: queue-based throttling | `.octto/ses_jk44phap.json:134-171`
- Transactions: single-tx | `.octto/ses_jk44phap.json:176-213`
- Observability: full-stack | `.octto/ses_jk44phap.json:218-255`

### Cross-Agent Coordination
- **Process Council**: Follow `PROCESS_COUNCIL_LOG.md` for multi-agent handoffs
- **Continuity Ledger**: Maintain `CONTINUITY.md` as a temporary compatibility ledger during the Cline Memory Bank migration; keep critical active context there until it is explicitly retired.
  - Source: `CONTINUITY.md:4-4,22-22,29-29,42-42`
