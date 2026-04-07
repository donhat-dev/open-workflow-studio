<p align="center">
  <img src="workflow_studio/static/description/icon.png" alt="Workflow Studio" width="80" />
</p>

<h1 align="center">Open Workflow Studio</h1>

<p align="center">
  <strong>The first Odoo-native workflow builder.</strong><br />
  Build, execute, and monitor business automation workflows — visually — without leaving Odoo.
</p>

<p align="center">
  <a href="#architecture">Architecture</a> ·
  <a href="#features">Features</a> ·
  <a href="#getting-started">Getting Started</a> ·
  <a href="#node-types">Node Types</a> ·
  <a href="#roadmap">Roadmap</a> ·
  <a href="#license">License</a>
</p>

---

## What is this?

Workflow Studio is an Odoo module (`workflow_studio`) that brings a visual, node-based automation builder into Odoo's backend. Design complex workflows on a drag-and-drop canvas, configure triggers, and let a stack-based execution engine handle the rest.

No external tools. No context-switching. No sync headaches.

## DISCLAIMER: This module is in active development and not yet production-ready. Expect breaking changes, incomplete features, and rough edges. Contributions and feedback are welcome!

## Screenshots
<p align="center">
  <img src="docs\description\dashboard.png" alt="Workflow Editor Screenshot" width="800" />
</p>
<p align="center">
  <img src="docs\description\demo-flow-design.png" alt="Execution Log Screenshot" width="800" />
</p>
<p align="center">
  <img src="docs\description\execution-results.png" alt="Execution Log Screenshot" width="800" />
</p>
<p align="center">
  <img src="docs\description\kanban-view-with-summary.png" alt="Execution Log Screenshot" width="800" />
</p>

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                     Frontend (OWL)                   │
│                                                      │
│  ┌──────────┐  ┌───────────┐  ┌──────────────────┐   │
│  │  Editor  │  │  Node     │  │  Execution Log   │   │
│  │  Canvas  │  │  Config   │  │  Panel           │   │
│  └────┬─────┘  └─────┬─────┘  └─────────┬────────┘   │
│       │              │                  │            │
│       └──────────┬───┘──────────────────┘            │
│                  │                                   │
│       ┌──────────▼──────────┐                        │
│       │  workflowEditor     │  ← single source of    │
│       │  service (store)    │    truth for all state │
│       └──────────┬──────────┘                        │
└──────────────────┼───────────────────────────────────┘
                   │ RPC
┌──────────────────▼───────────────────────────────────┐
│                   Backend (Python)                   │
│                                                      │
│  ┌──────────┐  ┌───────────┐  ┌──────────────────┐   │
│  │ Workflow │  │ Execution │  │  Trigger Bridge  │   │
│  │ Models   │  │ Engine    │  │  (ADR-008)       │   │
│  └──────────┘  └─────┬─────┘  └─────────┬────────┘   │
│                      │                  │            │
│              ┌───────▼──────────────────▼──────┐     │
│              │        Node Runners             │     │
│              │  http · if · switch · loop · …  │     │
│              └─────────────────────────────────┘     │
└──────────────────────────────────────────────────────┘
```

**Key design decisions** are captured as Architecture Decision Records in [`docs/plans/ADR/`](docs/plans/ADR/):

| ADR | Decision | Status |
|-----|----------|--------|
| [001](docs/plans/ADR/001-execution-engine.md) | Stack-based state machine execution engine | Accepted |
| [002](docs/plans/ADR/002-node-output-format.md) | Node output format — 2D array (`outputs[][]`) | Accepted |
| [003](docs/plans/ADR/003-loop-node-mechanism.md) | Loop node — SplitInBatches iterator pattern | Accepted |
| [004](docs/plans/ADR/004-editor-state-architecture.md) | Centralized editor state via `workflowEditor` service | Proposed |
| [005](docs/plans/ADR/005-zero-trust-polp.md) | Zero Trust + Principle of Least Privilege | Accepted |
| [006](docs/plans/ADR/006-version-history.md) | Patch-based version history (50-version FIFO) | Accepted |
| [008](docs/plans/ADR/008-hybrid-trigger-architecture.md) | Hybrid trigger architecture (cron, webhook, automation) | Accepted |
| [009](docs/plans/ADR/009-content-addressed-storage.md) | Content-Addressed Storage for Workflow Data Deduplication | Accepted |

## Features

### Visual Canvas Editor
- Drag-and-drop node placement on an infinite canvas
- Orthogonal connection routing between nodes
- Multi-node selection, drag, and keyboard shortcuts
- Undo/redo with command batching
- Node palette for quick node creation

### Execution Engine
- Stack-based state machine — supports branches, loops, merges
- Per-node runners with typed input/output contracts
- Expression evaluation inside `{{ ... }}` blocks
- Step-level execution history and error inspection

### Trigger System
- **Manual trigger** — launch from the operator panel
- **Schedule trigger** — `ir.cron` based recurring execution
- **Webhook trigger** — UUID-routed public endpoints
- **Record event trigger** — `base.automation` integration

### Security
- Row-level security on all workflow operations
- `run_as_user` execution context — never superuser
- SafeEnvProxy sandboxing for expression evaluation
- Secret brokering — credentials resolved at runtime, never in workflow JSON

## Node Types

### Triggers
| Node | Runner | Description |
|------|--------|-------------|
| Manual Trigger | `noop_runner` | Start node for operator-initiated runs |
| Schedule Trigger | `schedule_trigger_runner` | Cron-based recurring activation |
| Webhook Trigger | `webhook_trigger_runner` | Inbound HTTP event capture |
| Record Event | `record_event_trigger_runner` | Odoo model event listener |

### Logic & Flow
| Node | Runner | Description |
|------|--------|-------------|
| IF | `if_runner` | Boolean condition branching |
| Switch | `switch_runner` | Multi-path routing by value |
| Loop | `loop_runner` | SplitInBatches iterator with re-queuing |
| Validation | `validation_runner` | Data validation gate |

### Actions
| Node | Runner | Description |
|------|--------|-------------|
| HTTP Request | `http_runner` | External API calls |
| Record Operation | `record_operation_runner` | Odoo CRUD operations |
| Code | `code_runner` | Custom Python expressions |
| Variable | `variable_runner` | Set/transform workflow variables |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | OWL 2 (Odoo Web Library), SCSS, Dagre layout |
| Backend | Python 3, Odoo 18 ORM, PostgreSQL |
| Execution | Stack-based engine with node runners |
| Triggers | ir.cron, base.automation, JSON controllers |
| Design System | Editorial Carbon — Space Grotesk, JetBrains Mono, `--wf-*` tokens |

## Getting Started

### Prerequisites
- Odoo 18 Enterprise Edition
- Python 3.10+
- PostgreSQL 14+

### Installation

1. Clone this repository into your Odoo addons path:
   ```bash
   git clone https://github.com/donhat-dev/workflow_automation_builder.git
   ```

2. Add the path to your Odoo config:
   ```ini
   [options]
   addons_path = /path/to/workflow_automation_builder,...
   ```

3. Update the module list and install:
   ```
   Settings → Apps → Update Apps List → Search "Workflow Studio" → Install
   ```

### Dependencies
- `base`, `web`, `mail`, `bus` (core Odoo modules)
- `base_automation` (optional — for record event triggers)

## Project Structure

```
workflow_studio/
├── static/src/
│   ├── app/                  # WorkflowEditorApp entry point
│   ├── store/                # workflowEditor service (central state)
│   ├── components/
│   │   ├── editor_canvas/    # Main canvas + interaction hooks
│   │   ├── data_panel/       # Node config sidebar
│   │   ├── expression/       # Expression input system
│   │   ├── dashboard/        # Workflow dashboard overlays
│   │   └── execution_log_panel/  # Run history inspector
│   ├── services/             # Odoo service wrappers
│   ├── core/                 # Execution graph, node classes
│   ├── nodes/                # Node type definitions
│   ├── utils/                # Pure utilities (geometry, expressions)
│   └── scss/                 # Design tokens & shared primitives
├── models/
│   ├── ir_workflow.py        # Main workflow model
│   ├── workflow_executor.py  # Stack-based execution engine
│   ├── workflow_node.py      # Node persistence
│   ├── workflow_trigger.py   # Trigger bridge model
│   ├── workflow_run.py       # Execution run records
│   └── runners/              # Per-node execution logic
├── controllers/              # JSON routes (execute, webhooks)
├── views/                    # Backend list/form/kanban views
├── data/                     # XML seed data (node types)
└── security/                 # Access rules and groups
```

## Roadmap

### Phase 1 — MVP *(in progress, ~100%)*
- [x] Stack-based execution engine
- [x] Visual node editor (OWL canvas)
- [x] Manual + Schedule + Webhook triggers
- [x] HTTP Request, IF/Switch, Loop nodes
- [x] Expression system (`{{ $json.field }}`)
- [x] Execution run history & step inspector

### Phase 2 — Beta
- Patch-based version control (ADR-006)
- Zero Trust security model (ADR-005)
- Queue-job async execution
- Error boundaries & retry policies
- Record event triggers (base.automation)
- Observability & debugging tools

### Phase 3 — Production
- Sub-workflow invocations
- Community node registry
- Workflow templates & cloning
- Rate limiting & resource quotas
- Multi-company isolation
- Enterprise audit & compliance

## Contributing

This project is in alpha. If you're interested in contributing, start by reading the [Architecture Decision Records](docs/plans/ADR/) to understand the design rationale.

## License

[MIT](LICENSE) © donhat-dev
