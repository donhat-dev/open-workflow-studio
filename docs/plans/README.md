# Project Management Hub

> **Workflow Pilot** - Project planning and tracking documentation

---

## Quick Links

| Document | Description |
|----------|-------------|
| [Sprint Plans](./sprint/) | Current sprint board & history |
| [ROADMAP.md](./ROADMAP.md) | Quarterly milestones & release plan |
| [VELOCITY_TRACKER.md](./VELOCITY_TRACKER.md) | Burndown charts & metrics |
| [ADR/](./ADR/) | Architecture Decision Records |
| [PRODUCT_BACKLOG.md](./backlog/PRODUCT_BACKLOG.md) | Master backlog (source of truth) |

---

## Project Status Overview

| Metric | Value |
|--------|-------|
| **Total Backlog** | 290 SP |
| **Completed** | 110 SP (38%) |
| **Remaining** | 180 SP |
| **Sprint Velocity** | 15-20 SP |
| **Sprints to MVP** | 3-4 |

---

## Document Relationships

```
PRODUCT_BACKLOG.md (Source of Truth)
        │
        ├──► Sprint Plans (in ./sprint/)
        │    └── References task IDs (E1.x, E2.x, etc.)
        │
        ├──► ROADMAP.md
        │    └── Maps Epics to Phases
        │
        ├──► VELOCITY_TRACKER.md
        │    └── Extracts completion metrics
        │
        └──► ADR/
             └── Documents technical decisions
```

---

## How to Use

### Sprint Planning
1. Review [PRODUCT_BACKLOG.md](./backlog/PRODUCT_BACKLOG.md) for prioritized tasks
2. Create/Update plans in [./sprint/](./sprint/)
3. Update status daily (To Do → In Progress → Done)
4. Record velocity in [VELOCITY_TRACKER.md](./VELOCITY_TRACKER.md)

### Architecture Decisions
1. Use [ADR/000-template.md](./ADR/000-template.md) for new decisions
2. Number sequentially (001, 002, ...)
3. Update [ADR/README.md](./ADR/README.md) index

### Roadmap Updates
1. Update milestones when Epic completion changes
2. Adjust phase dates based on velocity
3. Update risk matrix as needed

---

## Legend

| Symbol | Meaning |
|--------|---------|
| SP | Story Points |
| MVP | Minimum Viable Product |
| ADR | Architecture Decision Record |
| E# | Epic reference (see PRODUCT_BACKLOG.md) |
