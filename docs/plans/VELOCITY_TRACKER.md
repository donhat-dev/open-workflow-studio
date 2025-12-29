# Velocity Tracker

> Sprint velocity, burndown, and capacity metrics for Workflow Pilot

---

## Current Metrics

| Metric | Value |
|--------|------:|
| **Total Backlog** | 290 SP |
| **Completed** | 110 SP |
| **Remaining** | 180 SP |
| **Progress** | 38% |
| **Target Velocity** | 15-20 SP/sprint |
| **Sprints to Complete** | 9-12 |

---

## Velocity Chart

```
SP Completed per Sprint
═══════════════════════════════════════════════════════════════════════════════

40 │                                                    Target: 15-20 SP
   │
35 │
   │
30 │
   │
25 │
   │
20 │ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ Target High
   │
15 │ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ Target Low
   │
10 │
   │
 5 │
   │
 0 └──────┬──────┬──────┬──────┬──────┬──────┬──────┬──────┬──────┬──────
         S1     S2     S3     S4     S5     S6     S7     S8     S9    S10
                                   Sprint

Legend: ████ Completed   ░░░░ Committed (not done)
```

---

## Sprint Velocity History

| Sprint | Committed | Completed | Velocity | Trend |
|--------|----------:|----------:|---------:|-------|
| Pre-Sprint | - | 110 | - | Baseline |
| Sprint 1 | 20 | - | - | Current |
| Sprint 2 | - | - | - | Planned |
| Sprint 3 | - | - | - | Planned |

### Velocity Trend
- **Average Velocity**: TBD (after 3 sprints)
- **Best Sprint**: TBD
- **Worst Sprint**: TBD

---

## Burndown Chart

### Overall Project Burndown

```
Remaining SP
═══════════════════════════════════════════════════════════════════════════════

200 │●
    │ ╲
180 │  ╲                                               ← Current: 180 SP
    │   ╲
160 │    ╲ ● ● ● ● ● ● ● ● ● ● ● ● ● ●
    │         ╲                       ╲
140 │          ╲                       ╲
    │           ╲                       ╲
120 │            ╲                       ╲
    │             ╲                       ╲
100 │              ╲                       ╲
    │               ╲                       ╲
 80 │                ╲                       ╲
    │                 ╲                       ╲
 60 │                  ╲                       ╲         MVP Target
    │                   ● ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─●        (50 SP remaining)
 40 │
    │
 20 │
    │
  0 └─────┬─────┬─────┬─────┬─────┬─────┬─────┬─────┬─────┬─────┬─────┬─────
         S1    S2    S3    S4    S5    S6    S7    S8    S9   S10   S11   S12

Legend: ● Actual   ─ ─ Ideal (20 SP/sprint)
```

### MVP Burndown (50 SP to MVP)

```
Remaining SP to MVP
═══════════════════════════════════════════════════════════════════════════════

 50 │●
    │ ╲
 40 │  ╲
    │   ╲
 30 │    ╲
    │     ╲
 20 │      ╲
    │       ╲
 10 │        ╲
    │         ╲
  0 └──────────●──────────●──────────●──────────●
              S1         S2         S3         S4

Legend: ● Target milestones (MVP in 3-4 sprints)
```

---

## Epic Progress

| Epic | Total SP | Completed | % |
|------|------:|---------:|--:|
| E1: Core Infrastructure | 34 | 32 | 95% |
| E2: Execution Engine | 55 | 22 | 40% |
| E3: Node Library | 42 | 19 | 45% |
| E4: UI/UX Editor | 38 | 28 | 75% |
| E5: Expression System | 21 | 9 | 50% |
| E6: Persistence | 26 | 5 | 5% |
| E7: Production Features | 34 | 0 | 0% |
| E8: Integrations | 40 | 0 | 0% |

### Epic Completion Visualization

```
E1 ████████████████████████████████████████████████░░░ 95%
E2 ████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 40%
E3 ██████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 45%
E4 ██████████████████████████████████████░░░░░░░░░░░░ 75%
E5 █████████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░ 50%
E6 ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  5%
E7 ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  0%
E8 ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  0%
```

---

## Capacity Planning

### Team Capacity
| Resource | Hours/Sprint | SP Capacity |
|----------|------------:|------------:|
| Dev 1 | 40 | ~10 SP |
| Dev 2 | 40 | ~10 SP |
| **Total** | **80** | **~20 SP** |

### Velocity Factors
- **Complexity**: Higher for E2 (execution engine)
- **Dependencies**: E2.2 blocks E3.2 implementation
- **Technical debt**: None significant currently

---

## Predictions

### MVP Completion
- **Remaining for MVP**: ~50 SP
- **At 15 SP/sprint**: 3-4 sprints
- **At 20 SP/sprint**: 2-3 sprints

### Full Project Completion
- **Remaining**: 180 SP
- **At 15 SP/sprint**: 12 sprints
- **At 20 SP/sprint**: 9 sprints

---

## Update Instructions

After each sprint:
1. Update velocity history table
2. Add data point to burndown chart
3. Recalculate predictions
4. Update epic progress bars

---

## Reference

- **Backlog**: [PRODUCT_BACKLOG.md](./backlog/PRODUCT_BACKLOG.md)
- **Sprint Details**: [Sprint Plans](./sprint/)
- **Roadmap**: [ROADMAP.md](./ROADMAP.md)
