/** @odoo-module **/

/**
 * workflowEditor Store (authoritative graph/UI state)
 *
 * - Wraps WorkflowAdapter for graph mutations
 * - Exposes reactive state.graph and state.ui (viewport/selection/panels/hovered)
 * - Bridges to HistoryManager for undo/redo batching
 */

import { reactive, EventBus } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { rpc } from "@web/core/network/rpc";
import {
    HistoryManager,
    createAddNodeAction,
    createRemoveNodeAction,
    createMoveNodeAction,
    createAddConnectionAction,
    createRemoveConnectionAction,
} from "../core/history";
import { WorkflowAdapter } from "../core/adapter";
import {
    clearRecentNodes,
    getAllNodeTypes,
    getCategories,
    getNodeClass as getRegistryNodeClass,
    getNodeType,
    getRecentNodes,
    searchNodes,
    trackNodeUsage,
} from "../utils/node_registry";

const DEFAULT_UI_STATE = () => ({
    selection: { nodeIds: [], connectionIds: [] },
    viewport: { pan: { x: 0, y: 0 }, zoom: 1 },
    panels: { configOpen: false, configNodeId: null, menuOpen: false },
    hoveredConnection: null,
    history: { canUndo: false, canRedo: false },
    // NodeMenu state (source of truth)
    nodeMenu: {
        visible: false,
        x: 0,           // Screen X position
        y: 0,           // Screen Y position
        canvasX: 0,     // Canvas X position for node creation
        canvasY: 0,     // Canvas Y position for node creation
        variant: 'default', // 'default' or 'large'
        connectionContext: null, // { connectionId, position } for inserting node
    },
});

export const workflowEditorService = {
    dependencies: [],

    start() {
        const history = new HistoryManager();
        const editorBus = new EventBus();
        let adapter = new WorkflowAdapter();
        let versionHash = null;
        let workflowId = null;

        const state = reactive({
            // Dynamic getter ensures we always point to the current adapter's state
            get graph() {
                return adapter.state;
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
                const nodeId = adapter.addNode(type, position);
                if (!nodeId) return null;

                const config = adapter.getNodeConfig(nodeId);
                history.push(
                    createAddNodeAction(adapter, { id: nodeId, type, position, config })
                );

                // n8n-style Loop Auto-Creation Pattern
                // When spawning a Loop node, also create a NoOp placeholder + cycle connections
                if (type === 'loop') {
                    const LOOP_OFFSET_Y = 160;
                    const noopId = adapter.addNode('noop', {
                        x: position.x + 80,
                        y: position.y + LOOP_OFFSET_Y,
                    });

                    if (noopId) {
                        const noopConfig = adapter.getNodeConfig(noopId);
                        history.push(createAddNodeAction(adapter, {
                            id: noopId, type: 'noop',
                            position: { x: position.x + 80, y: position.y + LOOP_OFFSET_Y },
                            config: noopConfig
                        }));

                        // Loop.loop → NoOp.data
                        const conn1 = adapter.addConnection(nodeId, 'loop', noopId, 'data');
                        if (conn1) history.push(createAddConnectionAction(adapter, conn1));

                        // NoOp.result → Loop.data (back-edge)
                        const conn2 = adapter.addConnection(noopId, 'result', nodeId, 'data');
                        if (conn2) history.push(createAddConnectionAction(adapter, conn2));
                    }
                }

                return nodeId;
            },

            moveNode(nodeId, position) {
                const node = getNode(nodeId);
                const oldPosition = node ? { x: node.x, y: node.y } : null;
                adapter.updatePosition(nodeId, position);
                if (oldPosition) {
                    history.push(
                        createMoveNodeAction(adapter, nodeId, oldPosition, position)
                    );
                }
            },

            removeNode(nodeId) {
                const node = getNode(nodeId);
                if (!node) return false;

                const relatedConnections = state.graph.connections.filter(
                    (c) => c.source === nodeId || c.target === nodeId
                );
                const config = adapter.getNodeConfig(nodeId);
                const nodeData = {
                    id: node.id,
                    type: node.type,
                    position: { x: node.x, y: node.y },
                    config,
                };

                adapter.removeNode(nodeId);
                history.push(
                    createRemoveNodeAction(adapter, nodeData, relatedConnections)
                );
                return true;
            },

            addConnection(source, sourceHandle, target, targetHandle) {
                const conn = adapter.addConnection(
                    source,
                    sourceHandle,
                    target,
                    targetHandle
                );
                if (conn) {
                    history.push(createAddConnectionAction(adapter, conn));
                    return conn.id;
                }
                return null;
            },

            removeConnection(connectionId) {
                const conn = getConnection(connectionId);
                if (!conn) return false;

                adapter.removeConnection(connectionId);
                history.push(createRemoveConnectionAction(adapter, conn));
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

            /**
             * Zoom to a specific level (clamped to 0.1 - 2.0)
             * @param {number} level - Target zoom level
             */
            zoomTo(level) {
                const clamped = Math.max(0.1, Math.min(2, level));
                state.ui.viewport.zoom = clamped;
            },

            /**
             * Zoom by a delta amount
             * @param {number} delta - Amount to add to current zoom
             */
            zoomBy(delta) {
                const newZoom = Math.max(0.1, Math.min(2, state.ui.viewport.zoom + delta));
                state.ui.viewport.zoom = newZoom;
            },

            /**
             * Pan by delta amounts
             * @param {number} deltaX 
             * @param {number} deltaY 
             */
            panBy(deltaX, deltaY) {
                state.ui.viewport.pan.x += deltaX;
                state.ui.viewport.pan.y += deltaY;
            },

            /**
             * Reset viewport to default (100% zoom, origin pan)
             */
            resetViewport() {
                state.ui.viewport = { pan: { x: 0, y: 0 }, zoom: 1 };
            },

            openPanel(panelType, context = {}) {
                if (panelType === "config") {
                    state.ui.panels.configOpen = true;
                    state.ui.panels.configNodeId = context.nodeId || null;
                    // State is read directly by EditorCanvas via isConfigPanelOpen getter
                }
                if (panelType === "menu") {
                    state.ui.panels.menuOpen = true;
                }
            },

            closePanel(panelType) {
                if (panelType === "config") {
                    state.ui.panels.configOpen = false;
                    state.ui.panels.configNodeId = null;
                    // State is read directly by EditorCanvas via isConfigPanelOpen getter
                }
                if (panelType === "menu") {
                    state.ui.panels.menuOpen = false;
                }
            },

            setHoveredConnection(connId, midpoint) {
                state.ui.hoveredConnection = connId
                    ? { id: connId, midpoint: midpoint || null }
                    : null;
            },

            /**
             * Open NodeMenu at specified position
             * @param {Object} config - Menu configuration
             * @param {number} config.x - Screen X position
             * @param {number} config.y - Screen Y position  
             * @param {number} config.canvasX - Canvas X position for node creation
             * @param {number} config.canvasY - Canvas Y position for node creation
             * @param {string} [config.variant='default'] - 'default' or 'large'
             * @param {Object} [config.connectionContext=null] - { connectionId, position } for inserting node
             */
            openNodeMenu({ x, y, canvasX, canvasY, variant = 'default', connectionContext = null }) {
                state.ui.nodeMenu = {
                    visible: true,
                    x,
                    y,
                    canvasX,
                    canvasY,
                    variant,
                    connectionContext,
                };
            },

            /**
             * Close NodeMenu
             */
            closeNodeMenu() {
                state.ui.nodeMenu = {
                    visible: false,
                    x: 0,
                    y: 0,
                    canvasX: 0,
                    canvasY: 0,
                    variant: 'default',
                    connectionContext: null,
                };
            },

            /**
             * Toggle node disabled state
             * Disabled nodes are skipped during execution and shown with reduced opacity
             * @param {string} nodeId
             */
            toggleDisable(nodeId) {
                const currentMeta = adapter.getNodeMeta(nodeId) || {};
                const isDisabled = !currentMeta.disabled;
                adapter.setNodeMeta(nodeId, { disabled: isDisabled });
                editorBus.trigger("NODE:DISABLED_CHANGED", { nodeId, disabled: isDisabled });
            },

            /**
             * Check if a node is disabled
             * @param {string} nodeId
             * @returns {boolean}
             */
            isNodeDisabled(nodeId) {
                const meta = adapter.getNodeMeta(nodeId);
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
            setAdapter(nextAdapter) {
                adapter = nextAdapter;
            },
            getAdapter() {
                return adapter;
            },
            getNodeConfig(nodeId) {
                return adapter.getNodeConfig(nodeId);
            },
            setNodeConfig(nodeId, config) {
                return adapter.setNodeConfig(nodeId, config);
            },
            getNodeControls(nodeId) {
                return adapter.getNodeControls(nodeId);
            },
            getNodeMeta(nodeId) {
                return adapter.getNodeMeta(nodeId);
            },
            setNodeMeta(nodeId, metaPatch) {
                return adapter.setNodeMeta(nodeId, metaPatch);
            },
            setControlValue(nodeId, controlKey, value) {
                return adapter.setControlValue(nodeId, controlKey, value);
            },
            updatePosition(nodeId, position) {
                return adapter.updatePosition(nodeId, position);
            },
            removeNode(nodeId) {
                return adapter.removeNode(nodeId);
            },
            addNode(type, position) {
                return adapter.addNode(type, position);
            },
            addNodeWithId(type, position, forcedId, config) {
                return adapter.addNodeWithId(type, position, forcedId, config);
            },
            addConnection(source, sourceHandle, target, targetHandle) {
                return adapter.addConnection(source, sourceHandle, target, targetHandle);
            },
            removeConnection(connectionId) {
                return adapter.removeConnection(connectionId);
            },
            getNodeClass(type) {
                return adapter.getNodeClass(type);
            },
            async loadWorkflow(id) {
                const data = await rpc('/web/dataset/call_kw', {
                    model: 'ir.workflow',
                    method: 'load_workflow',
                    args: [id],
                    kwargs: {},
                });
                adapter.fromJSON(data.draft_snapshot);
                versionHash = data.version_hash;
                workflowId = id;
                return data;
            },
            async saveWorkflow() {
                const snapshot = adapter.toJSON();
                const result = await rpc('/web/dataset/call_kw', {
                    model: 'ir.workflow',
                    method: 'save_workflow',
                    args: [[workflowId], snapshot, versionHash],
                    kwargs: {},
                });
                versionHash = result.version_hash;
                history.clear();
                return result;
            },
            async publishWorkflow() {
                // Ensure latest snapshot is persisted first
                await this.saveWorkflow();
                const result = await rpc('/web/dataset/call_kw', {
                    model: 'ir.workflow',
                    method: 'action_publish',
                    args: [[workflowId]],
                    kwargs: {},
                });
                return result;
            },
            async executeWorkflow(inputData = {}) {
                if (!workflowId) {
                    throw new Error('No workflow ID loaded');
                }
                const result = await rpc('/workflow_pilot/execute', {
                    workflow_id: workflowId,
                    input_data: inputData,
                });
                return result;
            },
            getWorkflowId() {
                return workflowId;
            },
            hasUnsavedChanges() {
                return history.canUndo();
            },
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
            nodes: {
                getAllNodeTypes: () => getAllNodeTypes(),
                getCategories: () => getCategories(),
                getNodeType: (key) => getNodeType(key),
                getNodeClass: (key) => getRegistryNodeClass(key),
                getRecentNodes: (limit) => getRecentNodes(limit),
                searchNodes: (query, options) => searchNodes(query, options),
                trackUsage: (key) => trackNodeUsage(key),
                clearRecentNodes: () => clearRecentNodes(),
            },
        };

    },
};

registry.category("services").add("workflowEditor", workflowEditorService);
