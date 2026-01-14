/** @odoo-module **/

/**
 * workflowEditor Service (authoritative graph/UI state)
 *
 * - Wraps WorkflowAdapter for graph mutations
 * - Exposes reactive state.graph and state.ui (viewport/selection/panels/hovered)
 * - Bridges to HistoryManager for undo/redo batching
 */

import { reactive, EventBus } from "@odoo/owl";
import { registry } from "@web/core/registry";
import {
    HistoryManager,
    createAddNodeAction,
    createRemoveNodeAction,
    createMoveNodeAction,
    createAddConnectionAction,
    createRemoveConnectionAction,
} from "../core/history";

const DEFAULT_UI_STATE = () => ({
    selection: { nodeIds: [], connectionIds: [] },
    viewport: { pan: { x: 0, y: 0 }, zoom: 1 },
    panels: { configOpen: false, configNodeId: null, menuOpen: false },
    hoveredConnection: null,
    history: { canUndo: false, canRedo: false },
});

export const workflowEditorService = {
    dependencies: ["workflowAdapter"],

    start(env, { workflowAdapter }) {
        const history = new HistoryManager();
        const editorBus = new EventBus();

        const state = reactive({
            // Dynamic getter ensures we always point to the current adapter's state
            get graph() {
                return workflowAdapter.state;
            },
            ui: DEFAULT_UI_STATE(),
        });

        // Keep reactive history flags in sync for future toolbar bindings.
        history.onChange((info) => {
            state.ui.history = { ...info };
        });

        // ===============
        // Helper selectors (with null checks for safety)
        // ===============
        const getNode = (nodeId) => state.graph?.nodes?.find((n) => n.id === nodeId) || null;
        const getConnection = (connId) => state.graph?.connections?.find((c) => c.id === connId) || null;

        // ===============
        // Actions (graph via adapter, UI local)
        // ===============
        const actions = {
            addNode(type, position) {
                const nodeId = workflowAdapter.addNode(type, position);
                if (!nodeId) return null;

                const config = workflowAdapter.getNodeConfig(nodeId);
                history.push(
                    createAddNodeAction(workflowAdapter, { id: nodeId, type, position, config })
                );

                // n8n-style Loop Auto-Creation Pattern
                // When spawning a Loop node, also create a NoOp placeholder + cycle connections
                if (type === 'loop') {
                    const LOOP_OFFSET_Y = 160;
                    const noopId = workflowAdapter.addNode('noop', {
                        x: position.x + 80,
                        y: position.y + LOOP_OFFSET_Y,
                    });

                    if (noopId) {
                        const noopConfig = workflowAdapter.getNodeConfig(noopId);
                        history.push(createAddNodeAction(workflowAdapter, {
                            id: noopId, type: 'noop',
                            position: { x: position.x + 80, y: position.y + LOOP_OFFSET_Y },
                            config: noopConfig
                        }));

                        // Loop.loop → NoOp.data
                        const conn1 = workflowAdapter.addConnection(nodeId, 'loop', noopId, 'data');
                        if (conn1) history.push(createAddConnectionAction(workflowAdapter, conn1));

                        // NoOp.result → Loop.data (back-edge)
                        const conn2 = workflowAdapter.addConnection(noopId, 'result', nodeId, 'data');
                        if (conn2) history.push(createAddConnectionAction(workflowAdapter, conn2));
                    }
                }

                return nodeId;
            },

            moveNode(nodeId, position) {
                const node = getNode(nodeId);
                const oldPosition = node ? { x: node.x, y: node.y } : null;
                workflowAdapter.updatePosition(nodeId, position);
                if (oldPosition) {
                    history.push(
                        createMoveNodeAction(workflowAdapter, nodeId, oldPosition, position)
                    );
                }
            },

            removeNode(nodeId) {
                const node = getNode(nodeId);
                if (!node) return false;

                const relatedConnections = state.graph.connections.filter(
                    (c) => c.source === nodeId || c.target === nodeId
                );
                const config = workflowAdapter.getNodeConfig(nodeId);
                const nodeData = {
                    id: node.id,
                    type: node.type,
                    position: { x: node.x, y: node.y },
                    config,
                };

                workflowAdapter.removeNode(nodeId);
                history.push(
                    createRemoveNodeAction(workflowAdapter, nodeData, relatedConnections)
                );
                return true;
            },

            addConnection(source, sourceHandle, target, targetHandle) {
                const conn = workflowAdapter.addConnection(
                    source,
                    sourceHandle,
                    target,
                    targetHandle
                );
                if (conn) {
                    history.push(createAddConnectionAction(workflowAdapter, conn));
                    return conn.id;
                }
                return null;
            },

            removeConnection(connectionId) {
                const conn = getConnection(connectionId);
                if (!conn) return false;

                workflowAdapter.removeConnection(connectionId);
                history.push(createRemoveConnectionAction(workflowAdapter, conn));
                return true;
            },

            select(nodeIds = [], connectionIds = []) {
                state.ui.selection = {
                    nodeIds: Array.from(new Set(nodeIds)),
                    connectionIds: Array.from(new Set(connectionIds)),
                };
            },

            setViewport({ pan, zoom }) {
                const nextPan = pan || state.ui.viewport.pan;
                const nextZoom = typeof zoom === "number" ? zoom : state.ui.viewport.zoom;
                state.ui.viewport = { pan: { ...nextPan }, zoom: nextZoom };
            },

            openPanel(panelType, context = {}) {
                if (panelType === "config") {
                    state.ui.panels.configOpen = true;
                    state.ui.panels.configNodeId = context.nodeId || null;
                    // [STUDIO PATTERN] Notify via bus so EditorCanvas can sync
                    editorBus.trigger("PANEL:CONFIG_OPENED", { nodeId: context.nodeId });
                }
                if (panelType === "menu") {
                    state.ui.panels.menuOpen = true;
                    editorBus.trigger("PANEL:MENU_OPENED", {});
                }
            },

            closePanel(panelType) {
                if (panelType === "config") {
                    state.ui.panels.configOpen = false;
                    state.ui.panels.configNodeId = null;
                    editorBus.trigger("PANEL:CONFIG_CLOSED", {});
                }
                if (panelType === "menu") {
                    state.ui.panels.menuOpen = false;
                    editorBus.trigger("PANEL:MENU_CLOSED", {});
                }
            },

            setHoveredConnection(connId, midpoint) {
                state.ui.hoveredConnection = connId
                    ? { id: connId, midpoint: midpoint || null }
                    : null;
            },

            /**
             * Toggle node disabled state
             * Disabled nodes are skipped during execution and shown with reduced opacity
             * @param {string} nodeId
             */
            toggleDisable(nodeId) {
                const currentMeta = workflowAdapter.getNodeMeta(nodeId) || {};
                const isDisabled = !currentMeta.disabled;
                workflowAdapter.setNodeMeta(nodeId, { disabled: isDisabled });
                editorBus.trigger("NODE:DISABLED_CHANGED", { nodeId, disabled: isDisabled });
            },

            /**
             * Check if a node is disabled
             * @param {string} nodeId
             * @returns {boolean}
             */
            isNodeDisabled(nodeId) {
                const meta = workflowAdapter.getNodeMeta(nodeId);
                return meta.disabled === true;
            },

            beginBatch() {
                history.startBatch();
            },

            endBatch(description) {
                history.commitBatch(description);
            },

            undo() {
                return history.undo();
            },

            redo() {
                return history.redo();
            },
        };

        return {
            state,
            bus: editorBus,
            actions,
            history: {
                undo: () => history.undo(),
                redo: () => history.redo(),
                canUndo: () => history.canUndo(),
                canRedo: () => history.canRedo(),
                onChange: (cb) => history.onChange(cb),
                beginBatch: () => history.startBatch(),
                endBatch: (description) => history.commitBatch(description),
            },
            selectors: {
                getNode,
                getConnection,
                getNodes: () => state.graph.nodes,
                getConnections: () => state.graph.connections,
            },
        };
    },
};

registry.category("services").add("workflowEditor", workflowEditorService);
