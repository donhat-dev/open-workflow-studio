# ADR-004: Editor State Architecture (Studio-like Patterns)

> Canonical editor state management inspired by Odoo Studio patterns

---

## Status

**Proposed**

---

## Context

The current editor architecture has several pain points:
- **Distributed state**: UI state (selection, viewport, panels) scattered across components using `useState`
- **Prop drilling**: Many callback props flowing through component hierarchy (EditorCanvas → WorkflowNode → ...socket)
- **Event bus as state store**: Some mutations happen ad-hoc in event listeners, not through a unified action system
- **Scalability concerns**: Adding multi-editor/multi-tab support becomes difficult without centralized state
- **History integration**: Undo/redo exists but not cleanly integrated with UI state mutations

We need to follow **Odoo Studio patterns** (seen in `lf_web_studio/static/src/client_action/`) to achieve:
- Canonical state in a service
- Thin, reactive components
- Event bus for intent/lifecycle only
- Pure utils for business logic
- Reusable "behavior hooks" for DOM behaviors

---

## Decision

Implement a **workflowEditor service** (Odoo registry service) as the single source of truth:

### 1. Service Structure

```javascript
// workflow_editor_service.js
export class WorkflowEditorService extends Service {
    state = {
        graph: {
            nodes: [],      // All nodes
            connections: [] // All edges
        },
        ui: {
            selection: { nodeIds: [], connectionIds: [] },
            viewport: { pan: { x, y }, zoom },
            panels: {
                configOpen: false,
                menuOpen: false,
                configNodeId: null
            },
            hoveredConnection: null
        }
    };

    actions = {
        // Graph mutations
        addNode(node) { /* batch-safe */ },
        moveNode(nodeId, position) { /* batch-safe */ },
        removeNode(nodeId) { /* batch-safe */ },
        addConnection(source, target, ...) { /* batch-safe */ },
        removeConnection(connId) { /* batch-safe */ },

        // UI mutations
        select(nodeIds, connectionIds) { /* batch-safe */ },
        setViewport(pan, zoom) { /* batch-safe */ },
        openPanel(panelType, context) { /* batch-safe */ },
        closePanel(panelType) { /* batch-safe */ },
        setHoveredConnection(connId) { /* batch-safe */ },

        // Batch operations
        beginBatch() { /* defer history */ },
        endBatch() { /* commit to history */ },

        // History
        undo() { /* replay from history */ },
        redo() { /* replay from history */ }
    };

    // Computed selectors (like Redux selectors)
    getNode(nodeId) { /* pure */ }
    getSelectedNodes() { /* pure */ }
    getCanvasState() { /* pure */ }
}
```

### 2. Per-Editor Scoping via useSubEnv

Each editor instance (future: multi-tab) gets its own service instance injected via `useSubEnv`:

```javascript
// EditorApp component
export class EditorApp extends Component {
    setup() {
        // Create service instance for this editor
        const workflowEditor = new WorkflowEditorService();
        const editorBus = EventBus();

        // Inject into sub-environment
        useSubEnv({
            workflowEditor,
            editorBus
        });
    }
}
```

Enables future multi-editor/multi-tab without state collision.

### 3. Event Bus = Intent + Lifecycle Only

The bus carries **user actions and lifecycle events**, NOT state mutations:

```javascript
// Bus events (examples)
editorBus.trigger('node:drag:start', { nodeId, position });
editorBus.trigger('node:drag:move', { nodeId, delta });
editorBus.trigger('node:drag:end', { nodeId });
editorBus.trigger('connection:draw', { source, target });
editorBus.trigger('key:delete', { selected });

// Listener example
editorBus.on('node:drag:end', (data) => {
    // Do NOT mutate state directly; call service action
    workflowEditor.actions.moveNode(data.nodeId, data.finalPosition);
});
```

This is **NOT** a state store—it's a communication channel for plugins and behaviors.

### 4. Components Are Thin and Reactive

Editor-layer components render from service state and emit intents. They only receive identity/config props (e.g., `nodeId`) and do not accept callback props.

```javascript
export class EditorCanvas extends Component {
    setup() {
        this.workflowEditor = useService('workflowEditor');
        this.editorBus = useEnv().editorBus; // injected via useSubEnv (per editor instance)
    }

    // Read from service state
    get nodes() { return this.workflowEditor.state.graph.nodes; }
    get selection() { return this.workflowEditor.state.ui.selection; }

    // Emit intent → listener converts to action
    onNodeMouseDown(nodeId, event) {
        this.editorBus.trigger('node:drag:start', { nodeId });
    }

    // Or call action directly for simple mutations
    onNodeSelect(nodeId) {
        this.workflowEditor.actions.select([nodeId], []);
    }
}
```

No `useState` for graph/selection/viewport. All state reads from service.

**Widget-layer exception**: small inputs/selects may still use local callback props like `onChange` (Studio-style), but these callbacks must stay local (no deep prop drilling) and must route mutations through `workflowEditor.actions.*`.

### 5. Studio-like Behavior Hooks

Reusable hooks handle DOM setup/cleanup with OWL patterns:

```javascript
// hooks/use_node_drag.js
export function useNodeDrag(nodeId, editorBus) {
    const ref = useRef('nodeElement');

    onMounted(() => {
        const el = ref.el;
        let startPos = null;

        el.addEventListener('mousedown', (e) => {
            startPos = { x: e.clientX, y: e.clientY };
            editorBus.trigger('node:drag:start', { nodeId });
        });

        document.addEventListener('mousemove', (e) => {
            if (startPos) {
                const delta = { x: e.clientX - startPos.x, y: e.clientY - startPos.y };
                editorBus.trigger('node:drag:move', { nodeId, delta });
            }
        });

        document.addEventListener('mouseup', () => {
            if (startPos) {
                editorBus.trigger('node:drag:end', { nodeId });
            }
        });
    });
}
```

Used in components:
```javascript
useNodeDrag(nodeId, editorBus);
```

### 6. Pure Utils for Business Logic

Geometry, selection, drag logic in separate utils/ files:

```javascript
// utils/geometry.js
export function calculateDistance(p1, p2) { /* ... */ }
export function pointInBbox(point, bbox) { /* ... */ }
export function rotateBezier(curve, angle) { /* ... */ }

// utils/selection.js
export function isInSelectionBox(node, box) { /* ... */ }
export function multiSelect(existing, node, event) { /* ... */ }

// utils/drag.js
export function throttleMove(callback, interval) { /* ... */ }
```

No component imports; pure functions tested independently.

---

## Consequences

### Positive
- **Single source of truth**: All graph/UI state in one service; no prop drilling
- **Testability**: Service logic and utils tested without components
- **Extensibility**: Plugins hook into editorBus for intent events
- **Multi-editor ready**: Each editor instance has its own service; no collision
- **History integration**: All mutations go through service → automatic undo/redo
- **Clean component code**: Components reduce to render + event emission
- **Studio patterns**: Proven architecture from Odoo Studio; familiar to Odoo devs

### Negative
- **Service complexity**: More code in service; careful to keep it organized
- **Learning curve**: Team needs to understand useSubEnv + reactive state patterns
- **Bus discipline**: Easy to fall back into ad-hoc mutations if not careful (lint rules needed)

### Neutral
- **Slight latency**: Service actions slightly more overhead than direct mutations (negligible for UI)
- **Dev tools**: Harder to trace state changes without Redux DevTools-like instrumentation (future)

---

## Alternatives Considered

### Option A: Keep distributed useState + improve prop drilling
Uses component-local state with better prop naming.

**Pros**:
- Minimal refactoring
- Smaller immediate scope

**Cons**:
- Still fragile with multi-editor support
- Hard to implement undo/redo cleanly
- Event bus still acts as de-facto state store
- Prop drilling remains a pain point

**Rejected**: Doesn't solve root problem.

### Option B: Redux-like state management (full reducer pattern)
Use Pinia or Redux for state.

**Pros**:
- Industry standard patterns
- Redux DevTools integration
- Mature ecosystem

**Cons**:
- Heavyweight for a single editor component
- Requires Odoo service wrapper anyway
- Less familiar to Odoo developers
- N8n uses custom patterns, not Redux

**Rejected**: Overkill; Studio patterns are sufficient.

### Option C: RxJS-based reactive model
Use RxJS observables for state streams.

**Pros**:
- Fully reactive; natural for event-driven UI
- Powerful for complex state flows

**Cons**:
- Steeper learning curve
- Adds new dependency
- OWL doesn't naturally integrate with RxJS

**Rejected**: Too much complexity for current needs.

---

## Implementation Strategy

**Phase 1**: Create workflowEditor service with state + actions + history integration.

**Phase 2**: Refactor EditorCanvas to read/write via service; move drag/connect to emit bus intents.

**Phase 3**: Extract behavior hooks (useNodeDrag, useConnection) and pure utils (geometry, selection).

**Phase 4**: Refactor panels (NodeConfigPanel, NodeMenu, ConnectionToolbar) to service-driven.

**Dev stability**: Keep dev.html?debug=assets functional throughout; test incrementally.

---

## References

- [Odoo Studio Client Action](../../../lf_web_studio/static/src/client_action/)
- [n8n Editor Architecture](https://n8n.io) (reference for event bus patterns)
- [PRODUCT_BACKLOG.md](../backlog/PRODUCT_BACKLOG.md#e46-editor-state-architecture-refactor-studio-like) - E4.6 epic
- [SPRINT_3_PLAN.md](../sprint/SPRINT_3_PLAN.md) - Implementation plan

---

## Metadata

| Field | Value |
|-------|-------|
| **Date** | 2026-01-13 |
| **Author** | Workflow Pilot Team |
| **Reviewers** | (Pending) |
| **Related ADRs** | ADR-001 (StackExecutor), ADR-002 (Node Output) |
| **Related Tasks** | E4.6.1, E4.6.2, E4.6.3, E4.6.4, E4.6.5, E4.6.6 |
| **Epic** | E4.6: Editor State Architecture Refactor |
