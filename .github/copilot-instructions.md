# Copilot instructions (workflow_automation_builder)

## Big picture (what we’re building)
- A **workflow + integration builder** that will become an **Odoo-native module** (future “native iPaaS”).
- Target use case: **SMB retail/e-commerce** (Shopee/TikTok + carriers), **near real-time**, **\>15k orders/day** (+ stock/picking transactions).
- Key differentiator vs generic tools: production-grade **throughput**, **rate-limit/backpressure**, **idempotency/dedupe**, **observability** (accept Redis/queue/OTel/etc.).

## Project conventions (must follow)
- **Language**: Vietnamese in conversation, English for code/docs.
- **Fail-First**: no optional chaining (`?.`) for service/dependency access.
- **State mutation**: service is single source of truth; mutate via `workflowEditor.actions.*` only.
- **Expressions**: only evaluate inside `{{ ... }}`.
- **Manual save**: no autosave.
- **Module header**: `/** @odoo-module **/` required on all JS files.
- **File naming**: `snake_case.js` for files, `PascalCase` for classes.
- **Template naming**: `module.template_name` (e.g., `workflow_pilot.workflow_editor_app`).
- **Manifest assets**: use glob patterns; asset order: libs → registries → services → core → nodes → utils → components.
- **SCSS architecture**: shared module styling tokens live in `workflow_studio/static/src/scss/`; load them in order `primary_variables.scss` → `secondary_variables.scss` → `bootstrap_overridden.scss` before component SCSS.
- **SCSS usage**: shared colors/shadows/radii should be declared as `$wf-*` tokens in the shared SCSS layer; component SCSS should consume those tokens instead of repeating hardcoded/fallback values.
- **Feature gating**: gate disabled features with a const flag + early return; keep services registered.
- **Bus usage**: use bus for global events (save/execute) and scoped model/service events; prefer direct actions/callbacks for local UI.
- **Clipboard**: use `workflowEditor` service (not adapter).
- **Notifications**: `display_notification` for sticky execution notices; dialog for internal errors.
- **Execution state**: store execution results in `workflowEditor.state.execution`.
- **Publish behavior**: publish does not auto-execute.
- **Node types**: seeded via XML; manual trigger is a start node (no inputs).
- **Node runners**: keep under `models/runners/`.
- **t-props**: bundle complex/long props (including callbacks) via `t-props`.

## OWL framework patterns
- Use `useState(service.state)`; avoid duplicate graph state.
- Use `useService("serviceName")` (no optional chaining).
- Use `useSubEnv({ bus, workflowEditor })` for context.
- Use `onMounted` for async init; `onWillUpdateProps` when props change.
- Use `useExternalListener` for DOM/global events to ensure cleanup.
- Disconnect observers (e.g., `ResizeObserver`) on unmount.
- Use `useCommand` for discoverable actions (Save, Run, Undo/Redo); auto-registers in Ctrl+K palette with hotkey display.
- Use `useHotkey` for navigation/continuous keys (arrow move, Delete, Escape); set `allowRepeat` for held keys, `area` for scope.
- Use `useActiveElement(refName)` to scope hotkeys/commands to a component subtree; prevents conflicts with Odoo forms/dialogs.

## Odoo integration patterns
- ORM via `this.env.orm.call(model, method, args, kwargs)`.
- Client actions: workflow id from `this.props.action.context.active_id`.

## Human-confirmation MCP usage
- Treat `human-confirmation` MCP as the primary channel for **human-in-the-loop confirmations and runtime user-state checks** during implementation, debugging, and testing when the answer must come from the user instead of from code or logs.
- Before asking the user to approve, answer, or fill a form through `human-confirmation`, first use normal code/runtime inspection to gather everything the workspace can already prove (logs, API responses, DB state, local server status, active route/tool behavior). Do **not** ask the user for facts that can be verified directly from the repo or runtime.
- When the workflow depends on whether the user is currently available, check availability first via `is_user_focus` / `is_user_awake` before sending a disruptive realtime/modal/form prompt.
- Match the MCP interaction type to the job:
	- `ask_realtime_question` for short blocking confirmations/branching decisions.
	- `ask_modal_questions` for minor-to-medium structured text input.
	- `ask_form_questions` for richer async surveys or when the user may respond later.
- If you need environment/runtime facts that only the user can confirm (for example: which local instance they are looking at, whether a Discord/form prompt appeared, or whether credentials belong to the intended account), prefer a focused `human-confirmation` prompt over guessing.
- Do not overuse `human-confirmation` MCP for routine progress chatter. Use it only when the user’s answer changes the implementation, validation path, or debugging conclusion.
- When a `human-confirmation` interaction affects the technical conclusion, record the verified outcome in `CONTINUITY.md` so later turns do not rely on memory or assumptions.

## Anti-patterns (forbidden)
- Optional chaining `?.` for services/dependencies.
- Duplicate state in `useState` (single source of truth).
- Autosave.
- Raw `window` keyboard listeners (`window.addEventListener("keydown", ...)`); use `useCommand`/`useHotkey` instead.

## Continuity Ledger (compaction-safe)
Maintain a single Continuity Ledger for this workspace in `CONTINUITY.md`. The ledger is the canonical session briefing designed to survive context compaction; do not rely on earlier chat text unless it's reflected in the ledger.

### How it works
- At the start of every assistant turn: read `CONTINUITY.md`, update it to reflect the latest goal/constraints/decisions/state, then proceed with the work.
- Update `CONTINUITY.md` again whenever any of these change: goal, constraints/assumptions, key decisions, progress state (Done/Now/Next), or important tool outcomes.
- Keep it short and stable: facts only, no transcripts. Prefer bullets. Mark uncertainty as **UNCONFIRMED** (never guess).
- If you notice missing recall or a compaction/summary event: refresh/rebuild the ledger from visible context, mark gaps **UNCONFIRMED**, ask up to 1-3 targeted questions, then continue.

### `functions.update_plan` vs the Ledger
- `functions.update_plan` is for short-term execution scaffolding while you work (a small 3-7 step plan with pending/in_progress/completed).
- `CONTINUITY.md` is for long-running continuity across compaction (the “what/why/current state”), not a step-by-step task list.
- Keep them consistent: when the plan or state changes, update the ledger at the intent/progress level (not every micro-step).

### In replies
- Begin with a brief **Ledger Snapshot** (Goal + Now/Next + Open Questions). Print the full ledger only when it materially changes or when the user asks.

### `CONTINUITY.md` format (keep headings)
- Goal (incl. success criteria):
- Constraints/Assumptions:
- Key decisions:
- State:
- Done:
- Now:
- Next:
- Open questions (UNCONFIRMED if needed):
- Working set (files/ids/commands):

## Non-goals (for this repo)
- Don’t attempt to fully implement Odoo add-on packaging here; this workspace is for UI/renderer experiments and Rete learning.
