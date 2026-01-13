# Product Roadmap

> Workflow Pilot - Quarterly milestones and release plan

---

## Roadmap Overview

```
═══════════════════════════════════════════════════════════════════════════════
                              WORKFLOW PILOT ROADMAP
═══════════════════════════════════════════════════════════════════════════════

  PHASE 1 (MVP)              PHASE 2 (Beta)           PHASE 3 (Production)
  ═══════════════            ══════════════           ══════════════════════

  [████████░░] 38%           [░░░░░░░░░░] 0%          [░░░░░░░░░░] 0%

  • Core Infrastructure ✓    • Backend Storage         • E-Commerce Connectors
  • Basic Execution ◐        • Webhook Triggers        • Carrier Integrations
  • Node Library ◐           • Pre-run Validation      • Queue Workers
  • UI/UX Editor ◐           • Odoo Integration        • Rate Limiting
  • Expression System ◐                                • Monitoring Dashboard

  Est: 6-8 weeks             Est: 6 weeks             Est: 8-10 weeks
  ───────────────            ────────────             ─────────────────────
  Sprint 1-4                 Sprint 5-7               Sprint 8-12

═══════════════════════════════════════════════════════════════════════════════
Legend: ✓ Done  ◐ In Progress  ○ Not Started
═══════════════════════════════════════════════════════════════════════════════
```

---

## Phase 1: MVP

**Goal**: Functional workflow editor with basic execution
**Epics**: E1, E2, E3 (partial), E4, E5
**Target**: 160 SP completed (~50 SP remaining)

### Milestones

| Milestone | Epic Tasks | SP | Status |
|-----------|------------|---:|--------|
| **M1.1** Core Complete | E1.1-E1.4 | 34 | 95% ✓ |
| **M1.2** Basic Executor | E2.1 | 13 | 90% ◐ |
| **M1.3** Flow Control | E2.2, E3.2 | 32 | 5% ○ |
| **M1.4** Canvas & UI | E4.1-E4.3 | 28 | 100% ✓ |
| **M1.5** Expressions | E5.1-E5.2 | 13 | 75% ◐ |
| **M1.6** Python Engine MVP (Hybrid) | E10.1-E10.4 | 24 | 0% ○ |

### MVP Checklist

- [x] Create/edit/delete nodes on canvas
- [x] Draw connections between nodes
- [x] Pan/zoom/selection
- [x] Execute HTTP requests
- [x] Data validation & mapping
- [x] Basic {{ }} expressions
- [ ] Python executeUntil RPC (hybrid flag)
- [ ] Backend returns context snapshot ($vars/$node/$json/$input/$loop)
- [ ] If/Loop node execution
- [ ] Branch/back-edge routing
- [ ] Queue-based executor
- [ ] Multi-input join

### Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Queue executor complexity | High | ADR-001 documents approach |
| Loop infinite execution | Medium | Iteration limits |
| Expression eval security | Medium | Sandbox evaluation |

---

## Phase 2: Beta

**Goal**: Production-ready with Odoo integration
**Epics**: E6, E7.1, E3.3
**Target**: Sprint 5-7

### Milestones

| Milestone | Epic Tasks | SP | Status |
|-----------|------------|---:|--------|
| **M2.1** Backend Storage | E6.2 | 13 | 0% ○ |
| **M2.2** Triggers | E3.3 | 10 | 0% ○ |
| **M2.3** Validation | E7.1 | 8 | 25% ○ |

### Beta Checklist

- [ ] Save/load workflows to Odoo
- [ ] User permissions & access control
- [ ] Webhook trigger nodes
- [ ] Schedule trigger nodes
- [ ] Connection validation
- [ ] Type checking
- [ ] Pre-run validation

### Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Odoo version compatibility | High | Test on 16, 17, 18 |
| Webhook security | High | Token validation |
| Data migration | Medium | Version snapshots |

---

## Phase 3: Production

**Goal**: Enterprise-ready with integrations
**Epics**: E7.2-E7.3, E8
**Target**: Sprint 8-12

### Milestones

| Milestone | Epic Tasks | SP | Status |
|-----------|------------|---:|--------|
| **M3.1** Monitoring | E7.2 | 10 | 0% ○ |
| **M3.2** Scaling | E7.3 | 16 | 0% ○ |
| **M3.3** E-Commerce | E8.1 | 20 | 0% ○ |
| **M3.4** Carriers | E8.2 | 12 | 0% ○ |

### Production Checklist

- [ ] Execution logging
- [ ] Performance metrics
- [ ] Error tracking dashboard
- [ ] Celery/RQ queue workers
- [ ] Rate limiting & throttling
- [ ] Idempotency/dedupe
- [ ] Shopee connector
- [ ] TikTok Shop connector
- [ ] GHN/GHTK carriers

### Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| API rate limits | High | Backpressure control |
| Order volume (15k/day) | High | Queue workers + scaling |
| Third-party API changes | Medium | Connector abstraction |

---

## Timeline Projection

```
Sprint | Phase   | Focus                        | Target SP
-------|---------|------------------------------|----------
1      | MVP     | Flow Control Nodes           | 20
2      | MVP     | Queue Executor               | 15
3      | MVP     | Python Engine MVP + RPC      | 18
4      | MVP     | Hybrid integration + parity  | 12
-------|---------|------------------------------|----------
5      | Beta    | Backend Storage              | 15
6      | Beta    | Odoo Integration             | 15
7      | Beta    | Testing + Stabilization      | 10
-------|---------|------------------------------|----------
8-12   | Prod    | Integrations + Scaling       | 60-80
```

---

## Release Notes Template

### Version X.Y.Z (Phase N)

**Release Date**: YYYY-MM-DD

**New Features**:
- Feature 1
- Feature 2

**Improvements**:
- Improvement 1

**Bug Fixes**:
- Fix 1

**Breaking Changes**:
- None

---

## Reference

- **Backlog**: [PRODUCT_BACKLOG.md](./backlog/PRODUCT_BACKLOG.md)
- **Sprint Planning**: [Sprint Plans](./sprint/)
- **Velocity**: [VELOCITY_TRACKER.md](./VELOCITY_TRACKER.md)
