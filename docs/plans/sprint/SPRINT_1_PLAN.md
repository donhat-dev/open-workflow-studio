# SPRINT 1 PLANNING
> **Focus**: Core Flow Control (If/Loop) & Routing
> **Duration**: 2 Weeks
> **Status**: Planning

---

## GOALS
1. Implement execution logic for conditional branching (If Node)
2. Implement execution logic for loops (Loop Node)
3. Support back-edge routing for loops in the execution engine
4. Support branch routing for conditional paths

## SCOPE

| Task ID | Description | SP | Priority | Assignee | Status |
|---------|-------------|---:|----------|----------|--------|
| **E3.2.1** | **If Node execute()** | 5 | P0 | - | To Do |
| **E2.2.3** | **Branch routing** | 5 | P0 | - | To Do |
| **E3.2.2** | **Loop Node execute()** | 5 | P0 | - | To Do |
| **E2.2.2** | **Back-edge routing** | 5 | P0 | - | To Do |
| | **TOTAL** | **20** | | | |

## DELIVERABLES
- `IfNode` capable of evaluating conditions and returning data on specific output ports
- `LoopNode` capable of iterating over array data
- `MockExecutionEngine` updated to handle non-linear flows (branches and cycles)

## RISKS
- **Cycle Detection**: Ensuring infinite loops are prevented or handled gracefully.
- **State Management**: Managing context inside loops (variables, current item).

---

## DAILY STANDUP NOTES

### Day 1
- Sprint started.
- Focus on `IfNode` logic first.
