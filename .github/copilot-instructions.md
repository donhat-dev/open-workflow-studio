# Copilot Instructions for Open Workflow Studio

## Development commands

The primary dev environment is Docker Compose with Odoo 18 EE mounted into the container.

### Start and runtime

```bash
docker compose up -d
docker compose logs -f odoo
docker compose restart odoo
```

- Use `docker compose restart odoo` after Python changes.
- JS/XML/SCSS changes are live-loaded on refresh through Odoo assets.

### Module update

```bash
docker compose exec odoo python /opt/odoo/source/odoo-bin -c /etc/odoo/odoo.conf -u workflow_studio --stop-after-init
docker compose exec odoo python /opt/odoo/source/odoo-bin -c /etc/odoo/odoo.conf -u workflow_studio_queue_job --stop-after-init
```

### Lint and formatting

```bash
pre-commit run -a

ruff check --fix workflow_studio/ workflow_studio_queue_job/
ruff format workflow_studio/ workflow_studio_queue_job/

pylint_odoo --rcfile=.pylintrc workflow_studio workflow_studio_queue_job
pylint_odoo --rcfile=.pylintrc-mandatory workflow_studio workflow_studio_queue_job
```

### SCSS sanity check

```bash
python check_scss.py
```

### Backend tests

Run all tests for the core addon:

```bash
docker compose exec odoo python /opt/odoo/source/odoo-bin -c /etc/odoo/odoo.conf -d <db> --test-enable --stop-after-init -i workflow_studio
```

Run all tests for the queue-job integration addon:

```bash
docker compose exec odoo python /opt/odoo/source/odoo-bin -c /etc/odoo/odoo.conf -d <db> --test-enable --stop-after-init -i workflow_studio_queue_job
```

Run a single test method:

```bash
docker compose exec odoo python /opt/odoo/source/odoo-bin -c /etc/odoo/odoo.conf -d <db> --test-enable --stop-after-init -i workflow_studio --test-tags=/workflow_studio:TestSmartExpressionResolver.test_prefixed_expr_full_template_int
```

Another useful single-test example for the optional addon:

```bash
docker compose exec odoo python /opt/odoo/source/odoo-bin -c /etc/odoo/odoo.conf -d <db> --test-enable --stop-after-init -i workflow_studio_queue_job --test-tags=/workflow_studio_queue_job:TestWorkflowQueueJobIntegration.test_automated_trigger_launch_enqueues_queue_job
```

There is no separate JS test suite in this repository today; backend tests run through Odoo's test runner.

### UI automation

Playwright MCP is configured for VS Code/Copilot in `.vscode/mcp.json`.

- Use the repo-level Odoo wrapper scripts in `package.json` for runtime decisions (`npm run odoo:up`, `odoo:restart`, `odoo:update:studio`, `odoo:update:queue`).
- The repo MCP config uses the GitHub Docs / VS Code `servers` schema, attaches to the current Chrome session through Playwright extension mode, and runs from the repo-local `@playwright/mcp` install instead of `npx`.
- For browser-driven Odoo validation, also read `.github/instructions/odoo-ui-playwright.instructions.md`.

## High-level architecture

This repository contains two Odoo addons:

- `workflow_studio`: the core workflow editor, runtime, trigger bridge, and UI
- `workflow_studio_queue_job`: optional `queue_job` integration for asynchronous automated trigger runs

### Frontend

- The Odoo client action starts in `workflow_studio/static/src/app/workflow_editor_app.js`.
- The `workflowEditor` service in `static/src/store/workflow_store.js` is the frontend source of truth for graph state, UI state, execution state, history, and workflow metadata.
- OWL components read from that service and call service actions; they should not maintain duplicate graph state.
- Backend node types are loaded at runtime and registered on the frontend through the dynamic node factory instead of being hardcoded in JS.

### Backend

- `ir.workflow` is the main model. It uses a dual-snapshot design:
  - `draft_snapshot` is the editable working copy
  - `published_snapshot` is the execution copy
- Execution reads snapshots, not UI cache records. `workflow.node` and `workflow.connection` are mainly persisted mirrors for UI queries and related features.
- `workflow.type` defines node types, schemas, icons, and custom runtime metadata. Built-ins are seeded from XML; custom runtime nodes are record-driven.
- `workflow.trigger` is the bridge between trigger nodes in the graph and Odoo activation records such as `ir.cron`, `base.automation`, and webhook UUID routes.
- `workflow_studio/controllers/main.py` exposes JSON endpoints for execute / execute-until / webhook-related flows and normalizes execution results back to the frontend.
- `workflow_studio/models/workflow_executor.py` is the stack-based execution engine. It builds the graph, instantiates per-node runners, tracks node outputs and variables, persists run data, and emits batched bus progress updates.
- Per-node behavior lives in `workflow_studio/models/runners/`. Every runner subclasses `BaseNodeRunner`.

### Queue-job extension

- `workflow_studio_queue_job` hooks into the workflow execution event pipeline instead of re-implementing execution.
- Automated trigger launches can be intercepted and enqueued; manual UI runs and webhook test calls stay synchronous.
- Queue metadata is stored on `workflow.run`.

## Key conventions

- Read `CONTINUITY.md` before making non-trivial changes. It is the active ledger for current goals, recent decisions, and in-flight work.
- Follow the ADRs in `docs/plans/ADR/` when behavior and older docs disagree; the repo intentionally favors ADR-aligned refactors over backward-compatibility shims.
- The `workflowEditor` service is the only frontend source of truth. Mutate editor state through `workflowEditor.actions.*` rather than copying graph data into local component state.
- Do not use optional chaining for service or dependency access in the editor code. This repo follows a fail-first style and prefers explicit failures over hidden `undefined` flows.
- Expression handling is strict:
  - only `=`-prefixed strings enter expression mode
  - only `{{ ... }}` segments inside that body are evaluated
  - bare `{{ ... }}` stays literal
  - `=_json.id` is a literal string, not an evaluated expression
- Node config auto-save is local and debounced in the adapter/editor layer. Backend persistence happens on explicit Save/Run, not on every field edit.
- Treat node types as backend-driven records. If you add or change a node type, update `workflow.type` data/schema and the runtime/registry flow instead of assuming a static frontend-only definition.
- Custom runtime nodes must use the `x_` prefix and define a custom runtime backend (`python_code` or `python_callable`) plus the required security group.
- JS files use `/** @odoo-module **/`. Template names follow `module.template_name`. JS file names are `snake_case.js`.
- Asset ordering matters in `__manifest__.py`: libs/registries/app/store/services/core/utils/shared SCSS/component/view assets are loaded in a deliberate order.
- Shared styling belongs in `workflow_studio/static/src/scss/` as `$wf-*` tokens and reusable primitives. Component SCSS should consume those shared contracts instead of repeating hardcoded values.
- Use Odoo hooks such as `useCommand`, `useHotkey`, `useActiveElement`, `useBus`, and `useSubEnv` for editor interactions; avoid raw `window` keyboard listeners.
