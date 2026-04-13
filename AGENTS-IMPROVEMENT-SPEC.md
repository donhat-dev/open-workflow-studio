# AGENTS.md Improvement Spec

**Audited:** 2026-04-13  
**Auditor:** Ona  
**Scope:** `AGENTS.md`, `CONTINUITY.md`, `.ona/`, `knowledge/`, `docs/plans/ADR/`

---

## 1. What's Good

- **Reference-validity rule is self-enforcing.** The "every convention must have a concrete reference" meta-rule is the strongest part of the document. It creates a forcing function for keeping rules honest.
- **Anti-patterns table is well-structured.** Four forbidden patterns with clear rationale, impact, and source. The "Out-of-date / Needs Verification" sub-section is an honest acknowledgement of drift.
- **Architecture diagrams are accurate.** The service-oriented, hook-based, and node self-registration ASCII diagrams match the actual code structure in `workflow_studio/static/src/`.
- **SCSS load order is correct and verified.** The `primary_variables → secondary_variables → bootstrap_overridden → shared_primitives` order matches `__manifest__.py:19-47`.
- **OWL patterns are actionable.** `useCommand`, `useHotkey`, `useActiveElement`, `useExternalListener` entries each have a concrete in-repo file reference alongside the Odoo core reference.
- **`knowledge/` directory exists** with useful pattern documents (`lf_web_studio_patterns.md`, `editor_canvas_refactor_mistakes.md`) that complement AGENTS.md.

---

## 2. What's Wrong (Errors)

### 2.1 Broken / Unreachable References

| Rule | Claimed Source | Actual State |
|------|---------------|--------------|
| File naming, Module header, Template naming, Manifest assets, Feature gating, Reactive components, Service injection, SubEnv, Component lifecycle, RPC pattern | `.sisyphus/notepads/phase2-frontend-store/learnings.md` | **Directory does not exist** in this repo. |
| Bus usage, Props updates, External listeners, Observer cleanup, Command palette, Scoped hotkeys, UI active element | `C:\Users\ODOO\Documents\GitHub\18EE-NS\odoo\addons\...` | **Windows absolute paths** — unreachable in any non-Windows or non-local environment. |
| Expression syntax, Best practice priority, Compatibility | `AGENTS.md:78-78`, `AGENTS.md:79-79`, `AGENTS.md:80-80` | **Self-referential** — these line numbers point to the "Implementation & Environment Validation" section, not to the rules being cited. The actual lines are 95–97. |
| Node config auto-save | `node_config_panel.js:701-718` | Debounce logic is at lines **1709–1727**, not 701–718. |
| Bus usage (secondary refs) | `workflow_editor_app.js:55-55` | Line 55 is an import statement, not bus usage. |
| t-props | `workflow_node.xml:5-5, 19-19, 23-23` | Line 5 is the `<t t-name>` declaration. `t-props` first appears at line 6 (`CanvasNodeToolbar`) and line 22 (`WorkflowSocket`). |
| SCSS architecture, SCSS usage, UI taxonomy | `docs/plans/ADR/007-ui-design-system-governance.md` | **File does not exist** — ADR-007 is missing from `docs/plans/ADR/`. |
| Planning decisions (execution model, state persistence, etc.) | `.octto/ses_jk44phap.json` | **Directory does not exist** in this repo. |
| Cross-agent coordination | `PROCESS_COUNCIL_LOG.md` | **File does not exist** in this repo. |

### 2.2 Structural Errors

- **`manifest__.py` typo in STRUCTURE section.** The file is `__manifest__.py`, not `manifest__.py`.
- **`data_panel/` listed as a component subdirectory** in the STRUCTURE tree, but the actual path is `components/data_panel/` — the tree shows it as a sibling of `editor_canvas/` and `expression/`, which is correct, but the label `data_panel/` in the tree is missing its full path context.
- **`nodes/` directory is incomplete in STRUCTURE.** The tree implies a richer node library, but `workflow_studio/static/src/nodes/` only contains: `data_nodes.js`, `flow_nodes.js`, `http_request.js`, `manual_trigger.js`, `index.js`. Trigger nodes (schedule, record event, webhook) are not in `nodes/` — they are backend-only runners.
- **WHERE TO LOOK table has broken paths.** `workflow_studio\n/static/src/store/workflow_store.js` — the `\n` is a literal newline artifact from copy-paste, making the path unreadable.
- **`stock_barcode` and `lf_web_studio` listed as WHERE TO LOOK references.** `stock_barcode` is an Odoo core addon not in this repo. `lf_web_studio` is referenced in `docker-compose.yml` as a volume mount but does not exist in the repo root. These are external references with no local fallback.

### 2.3 Stale / Misleading Content

- **COMMANDS section is Windows-only.** The Odoo server restart command uses a hardcoded Windows PID file path (`C:\Users\ODOO\Documents\GitHub\18EE-NS\odoo-hrm.pid`). The actual dev environment is Docker Compose (`docker-compose.yml`). The correct restart is `docker compose restart odoo`.
- **Persistent Memory section references Cline/Copilot tooling** (`memory-bank/`, `.clinerules/`) that does not exist in this repo. The `memory-bank/` directory is mentioned as the "primary durable memory" but was never created.
- **`CONTINUITY.md` is described as "temporary"** but has grown to 50+ KB and contains the most current project state. Its retirement condition ("until explicitly retired") is undefined.
- **Planning Decisions section cites `.octto/ses_jk44phap.json`** for execution model, retry strategy, etc. This file does not exist. These decisions are partially captured in `docs/plans/ADR/001-execution-engine.md` and `docs/plans/ADR/008-hybrid-trigger-architecture.md`.

---

## 3. What's Missing

### 3.1 No Testing Conventions
The repo has Python tests (`workflow_studio/tests/`, `workflow_studio_queue_job/tests/`) using `odoo.tests.common.TransactionCase` with `@tagged`. AGENTS.md has zero guidance on:
- How to run tests locally (command, database target)
- Which tags to use (`post_install`, `-at_install`, custom tags)
- Where to put new tests
- Whether JS tests exist or are planned

### 3.2 No Git / Contribution Workflow
No guidance on:
- Branch naming conventions
- Commit message format
- PR process or review requirements
- Whether to squash, rebase, or merge

### 3.3 No Python Backend Conventions
The backend has significant Python code (`workflow_executor.py`, runners, models) but AGENTS.md covers only JS/OWL patterns. Missing:
- Odoo model conventions (`_name`, `_inherit`, `_description`)
- Runner interface contract (what methods a runner must implement)
- Error handling in runners (raise vs return error dict)
- Linting tools in use (`.ruff.toml`, `.pylintrc` exist but are not mentioned)

### 3.4 No Docker / Dev Environment Setup
The project runs via Docker Compose but AGENTS.md has no guidance on:
- How to start the dev environment (`docker compose up`)
- How to restart after Python changes (`docker compose restart odoo`)
- How to access logs (`docker compose logs -f odoo`)
- Environment variables (`.env` file location, required vars)

### 3.5 No Error Handling Conventions
No guidance on:
- Frontend: how to surface errors to users (notification vs dialog vs console)
- Backend: when to raise `UserError` vs `ValidationError` vs return error payload
- Expression evaluation errors: how they propagate from backend to frontend

### 3.6 `knowledge/` Directory Not Referenced
`knowledge/` contains four useful files (`lf_web_studio_patterns.md`, `lf_web_studio_deep_patterns.md`, `editor_canvas_refactor_mistakes.md`, `history.md`) that are not mentioned anywhere in AGENTS.md. Agents have no way to discover them.

### 3.7 ADR-007 Is Missing
`docs/plans/ADR/007-ui-design-system-governance.md` is referenced 8 times in AGENTS.md but does not exist. Either the file was deleted or never committed. The SCSS and UI taxonomy rules that cite it have no valid backing reference.

---

## 4. Concrete Improvement Spec

### Priority 1 — Fix Broken References (Correctness)

**P1-A: Replace `.sisyphus/` references with in-repo equivalents**

For each rule citing `.sisyphus/notepads/phase2-frontend-store/learnings.md` or `decisions.md`, replace the source with the nearest verifiable in-repo file. Candidates:
- `knowledge/lf_web_studio_patterns.md` — covers service layer, state patterns
- `knowledge/editor_canvas_refactor_mistakes.md` — covers component anti-patterns
- `docs/plans/ADR/004-editor-state-architecture.md` — covers state architecture decisions
- The actual source file in `workflow_studio/static/src/` where the pattern is implemented

If no in-repo equivalent exists, mark the rule as `[unverified — no local source]` rather than citing a missing file.

**P1-B: Replace Windows absolute paths with Odoo GitHub URLs**

For OWL framework rules citing `C:\Users\ODOO\Documents\GitHub\18EE-NS\odoo\addons\...`, replace with the equivalent GitHub permalink on `https://github.com/odoo/odoo/blob/18.0/addons/...`. Example:

```
# Before
`C:\Users\ODOO\Documents\GitHub\18EE-NS\odoo\addons\web\static\src\search\search_bar\search_bar.js:84-85`

# After
`https://github.com/odoo/odoo/blob/18.0/addons/web/static/src/search/search_bar/search_bar.js#L84-L85`
```

**P1-C: Fix self-referencing line numbers**

Change `AGENTS.md:78-78`, `AGENTS.md:79-79`, `AGENTS.md:80-80` to `AGENTS.md:95-97` (the actual lines where those rules appear), or better: replace with the ADR or commit that established each rule.

**P1-D: Fix `node_config_panel.js` line reference**

Change `node_config_panel.js:701-718` → `node_config_panel.js:1709-1727`.

**P1-E: Fix manifest filename typo**

In the STRUCTURE section, change `manifest__.py` → `__manifest__.py`.

**P1-F: Fix `\n` artifacts in WHERE TO LOOK paths**

All paths like `workflow_studio\n/static/src/...` should be `workflow_studio/static/src/...` (single line, forward slash).

**P1-G: Resolve ADR-007 gap**

Either:
- Restore `docs/plans/ADR/007-ui-design-system-governance.md` from git history, or
- Move the SCSS/UI taxonomy rules' sources to `docs/plans/ADR/008-hybrid-trigger-architecture.md` or a new ADR, or
- Mark all 8 references as `[ADR-007 missing — verify before applying]`

**P1-H: Replace `.octto/` and `PROCESS_COUNCIL_LOG.md` references**

Remove or replace Planning Decisions sources. Point to the actual ADRs:
- Execution model → `docs/plans/ADR/001-execution-engine.md`
- Loop mechanism → `docs/plans/ADR/003-loop-node-mechanism.md`
- Hybrid triggers → `docs/plans/ADR/008-hybrid-trigger-architecture.md`

Remove the `PROCESS_COUNCIL_LOG.md` reference entirely (file does not exist; no replacement needed unless multi-agent coordination is active).

---

### Priority 2 — Fix Structural Errors (Accuracy)

**P2-A: Update STRUCTURE tree**

```
# Current (wrong)
│   └───manifest__.py

# Fix
│   └───__manifest__.py
```

Update `nodes/` listing to reflect actual files:
```
└── nodes/            # Node type definitions
    ├── data_nodes.js
    ├── flow_nodes.js
    ├── http_request.js
    ├── manual_trigger.js
    └── index.js
```

Note that trigger nodes (schedule, record event, webhook) are backend-only runners in `models/runners/`, not frontend node classes.

**P2-B: Fix WHERE TO LOOK external references**

Replace:
```
| Component patterns | `stock_barcode/static/src/components/main.js` | ...
| Service patterns   | `lf_web_studio/static/src/studio_service.js`  | ...
```

With in-repo equivalents:
```
| Component patterns | `workflow_studio/static/src/components/workflow_node.js` | t-props, reactive state from service |
| Service patterns   | `workflow_studio/static/src/store/workflow_store.js`     | Registry-based, bus-driven           |
```

Or add a note: `[external — not in this repo; see knowledge/lf_web_studio_patterns.md for extracted patterns]`.

**P2-C: Fix COMMANDS section**

Replace the Windows-only PID restart command with Docker Compose commands:

```bash
# Restart Odoo after Python changes
docker compose restart odoo

# View live logs
docker compose logs -f odoo

# Full restart (if config changed)
docker compose down && docker compose up -d
```

Remove the PowerShell block entirely.

---

### Priority 3 — Add Missing Sections (Completeness)

**P3-A: Add Testing Conventions section**

```markdown
## TESTING

### Python (Backend)
- Tests live in `workflow_studio/tests/` and `workflow_studio_queue_job/tests/`
- Use `odoo.tests.common.TransactionCase` for database tests
- Tag with `@tagged("post_install", "-at_install")` for standard post-install tests
- Run via Odoo test runner: `python odoo-bin -d <db> --test-enable --stop-after-init -i workflow_studio`
- Linting: `ruff check .` (config: `.ruff.toml`), `pylint` (config: `.pylintrc`)

### JavaScript (Frontend)
- No JS test suite currently exists. Planned for Phase 2.
```

**P3-B: Add Python Backend Conventions section**

```markdown
### Python Backend

| Area | Convention | Source |
|------|-----------|--------|
| **Runner interface** | Each runner must implement `run(self, node, context)` returning `{"output": ..., "status": "success"|"error"}` | `workflow_studio/models/runners/base.py` |
| **Error handling** | Runners return error dict; raise `UserError` only for user-facing validation | `workflow_studio/models/runners/base.py` |
| **Model naming** | `ir.workflow`, `workflow.run`, `workflow.node` — prefix with `ir.` for core models | `workflow_studio/models/ir_workflow.py` |
| **Linting** | `ruff` for style/imports, `pylint` with `.pylintrc-mandatory` for structural checks | `.ruff.toml`, `.pylintrc-mandatory` |
```

**P3-C: Add Dev Environment section**

```markdown
## DEV ENVIRONMENT

### Start
```bash
docker compose up -d
```

### Restart after Python changes
```bash
docker compose restart odoo
```

### Logs
```bash
docker compose logs -f odoo
```

### Config
- Copy `docker/.env.example` → `docker/.env` and set required vars
- `ODOO_SOURCE_PATH`: path to Odoo 18 EE source
- `ODOO_PORT`: default 8069
```

**P3-D: Reference `knowledge/` directory**

Add to WHERE TO LOOK:

```
| OWL/service patterns (extracted) | `knowledge/lf_web_studio_patterns.md`         | Service layer, state encapsulation |
| Canvas refactor lessons           | `knowledge/editor_canvas_refactor_mistakes.md` | Anti-patterns from past refactors  |
| History/undo patterns             | `knowledge/history.md`                         | HistoryManager usage               |
```

**P3-E: Clarify `CONTINUITY.md` status**

Add a clear statement:

```markdown
### CONTINUITY.md
`CONTINUITY.md` is the active project context ledger. It is NOT temporary — treat it as the primary source for current sprint goals, active decisions, and in-flight work. Update it when:
- A sprint goal changes
- A significant architectural decision is made
- A feature is completed or abandoned
```

Or, if the intent is to retire it in favor of `memory-bank/`, create `memory-bank/` with the standard files and update AGENTS.md to point there.

---

### Priority 4 — Structural Improvements (Maintainability)

**P4-A: Add a "Last Verified" column to convention tables**

Each row in the Project-Specific Rules and OWL Framework tables should have a date or commit hash indicating when the reference was last verified. This makes drift visible.

**P4-B: Split AGENTS.md into focused sections**

At 280+ lines, AGENTS.md is approaching the size where agents skip sections. Consider splitting:
- `AGENTS.md` — meta-rules, structure, where to look (keep short, ~80 lines)
- `docs/conventions/frontend.md` — OWL, SCSS, component patterns
- `docs/conventions/backend.md` — Python, runners, models
- `docs/conventions/dev-environment.md` — Docker, restart, testing

**P4-C: Remove "Persistent Memory / Cline" section or act on it**

The Persistent Memory section references Cline, GitHub Copilot, and `memory-bank/` — none of which are set up in this repo. Either:
- Create `memory-bank/` with the standard files and populate them, or
- Remove the section and replace with a single line: `CONTINUITY.md is the project memory ledger.`

The current state (section present, infrastructure absent) creates confusion for any agent that reads it.

---

## 5. Summary Table

| ID | Category | Severity | Action |
|----|----------|----------|--------|
| P1-A | Broken ref (`.sisyphus/`) | High | Replace with in-repo equivalents |
| P1-B | Broken ref (Windows paths) | High | Replace with GitHub permalinks |
| P1-C | Wrong line numbers (self-ref) | Medium | Fix to actual lines 95–97 |
| P1-D | Wrong line number (`node_config_panel`) | Medium | Fix to 1709–1727 |
| P1-E | Typo (`manifest__.py`) | Low | Fix to `__manifest__.py` |
| P1-F | Path artifacts (`\n`) | Low | Fix to single-line paths |
| P1-G | Missing ADR-007 | High | Restore file or mark references invalid |
| P1-H | Missing `.octto/`, `PROCESS_COUNCIL_LOG.md` | Medium | Replace with actual ADR references |
| P2-A | Inaccurate STRUCTURE tree | Medium | Update nodes listing, fix manifest name |
| P2-B | External repo references in WHERE TO LOOK | Medium | Replace with in-repo equivalents |
| P2-C | Windows-only COMMANDS | High | Replace with Docker Compose commands |
| P3-A | Missing testing conventions | Medium | Add TESTING section |
| P3-B | Missing Python backend conventions | Medium | Add Python Backend section |
| P3-C | Missing dev environment setup | High | Add DEV ENVIRONMENT section |
| P3-D | `knowledge/` not referenced | Low | Add to WHERE TO LOOK |
| P3-E | `CONTINUITY.md` status unclear | Medium | Clarify or retire |
| P4-A | No "last verified" dates | Low | Add column to convention tables |
| P4-B | AGENTS.md too long | Low | Consider splitting into focused files |
| P4-C | Cline/memory-bank section is dead weight | Medium | Remove or implement |
