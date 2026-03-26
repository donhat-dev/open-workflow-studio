/** @odoo-module **/

/**
 * workflowEditor Store (authoritative graph/UI state)
 *
 * - Wraps WorkflowAdapter for graph mutations
 * - Exposes reactive state.graph and state.ui (viewport/selection/panels/hovered)
 * - Bridges to HistoryManager for undo/redo batching
 */

import { reactive, EventBus, markRaw } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { rpc } from "@web/core/network/rpc";
import { DimensionConfig } from "../core/dimensions";
import {
    HistoryManager,
    createAddNodeAction,
    createRemoveNodeAction,
    createMoveNodeAction,
    createMoveNodesAction,
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
    pruneRecentNodes,
    searchNodes,
    trackNodeUsage,
} from "../utils/node_registry";
import { registerBackendNodeTypes } from "../utils/dynamic_node_factory";

const DEFAULT_UI_STATE = () => ({
    selection: { nodeIds: [], connectionIds: [] },
    viewport: { pan: { x: 0, y: 0 }, zoom: 1 },
    focusNodeRequest: null,
    panels: {
        configOpen: false,
        configNodeId: null,
        menuOpen: false,
        historyOpen: false,
        executionLogOpen: false,
    },
    hoveredConnection: {
        id: null,
        midpoint: { x: 0, y: 0 },
        canvasMidpoint: null,
    },
    readonly: false,
    saving: false,
    executing: false,
    historyPreview: { active: false, revisionId: null },
    executionView: { active: false, runId: null },
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

function createDimensionState(config = {}) {
    const nextConfig = config && typeof config === "object" ? { ...config } : {};
    return {
        config: nextConfig,
        current: markRaw(new DimensionConfig(nextConfig)),
    };
}

export const workflowEditorService = {
    dependencies: ["notification"],

    start(env, { notification }) {
        const history = new HistoryManager();
        const editorBus = new EventBus();
        let adapter = new WorkflowAdapter();
        let versionHash = null;
        let workflowId = null;
        let autoSave = true;
        let focusNodeRequestSeq = 0;
        const historyPreview = {
            active: false,
            revisionId: null,
            originalSnapshot: null,
        };
        const executionView = {
            active: false,
            runId: null,
            originalSnapshot: null,
        };

        const state = reactive({
            // Dynamic getter ensures we always point to the current adapter's state
            get graph() {
                return adapter.state;
            },
            ui: DEFAULT_UI_STATE(),
            /**
             * Unified execution progress tracker.
             * Updated incrementally by bus events (node-by-node) and
             * in bulk when the execute RPC completes.
             * Shape: {
             *     runId: string|null,
             *     status: 'running'|'completed'|'failed',
             *     nodeStatuses: { [nodeId]: 'running'|'success'|'error' },
             *     executedOrder: string[],
             *     executedConnectionIds: string[],
             *     executedConnections: Array<{ connection_id, source, source_socket, target, target_socket, output_index, sequence }>,
             *     nodeResults: Array<{ node_id, output_data, error_message, ... }>,
             *     nodeOutputs: Object|null,
             *     error: string|null,
             *     errorNodeId: string|null,
             *     outputData: any,
             *     inputData: Object,
             *     contextSnapshot: Object|null,
             *     executionCount: number|null,
             * }
             * Reset to null when a new execution starts or graph is mutated.
             */
            executionProgress: null,
            nodeTypes: [],
            /**
             * Pin data map: { [nodeId]: workflow.run.node.id }.
             * Persisted inside snapshot.metadata.pin_data on save.
             */
            pinData: {},
            workflowMetadata: {},
            dimensions: createDimensionState(),
        });

        // Keep reactive history flags in sync for future toolbar bindings.
        history.onChange((info) => {
            state.ui.history = { ...info };
        });

        function bootstrapDimensions(config = {}) {
            state.dimensions = createDimensionState(config);
            return state.dimensions.current;
        }

        bootstrapDimensions();

        // ===============
        // Execution helpers
        // ===============
        function normalizeInputData(inputData) {
            if (inputData && typeof inputData === "object") {
                return inputData;
            }
            return {};
        }

        /**
         * Build a full snapshot (nodes + connections + metadata) from
         * the adapter graph plus store-level data such as pin data.
         * @returns {Object} snapshot suitable for backend save / execute
         */
        function buildFullSnapshot() {
            const base = adapter.toJSON();
            const metadata = { ...(state.workflowMetadata || {}) };
            delete metadata.pinData;
            const pinKeys = Object.keys(state.pinData);
            if (pinKeys.length) {
                metadata.pin_data = { ...state.pinData };
            } else {
                delete metadata.pin_data;
            }
            return { ...base, metadata };
        }

        /**
         * Create a fresh execution progress with idle/running state.
         * All rich fields start empty and get filled when execute completes.
         */
        function createFreshProgress(runId = null) {
            return {
                runId,
                status: 'running',
                nodeStatuses: {},
                executedOrder: [],
                executedConnectionIds: [],
                executedConnections: [],
                executionEvents: [],
                // Rich data — populated when execution finishes
                nodeResults: [],
                nodeOutputs: null,
                error: null,
                errorNodeId: null,
                outputData: null,
                inputData: {},
                contextSnapshot: null,
                executionCount: null,
                durationSeconds: null,
                nodeCountExecuted: null,
            };
        }

        /**
         * Build nodeStatuses map from nodeResults array.
         * @param {Array} nodeResults - [{ node_id, error_message, ... }]
         * @returns {Object} { nodeId: 'success'|'error' }
         */
        function buildNodeStatusesFromResults(nodeResults) {
            const statuses = {};
            for (const r of nodeResults) {
                if (r && r.node_id) {
                    statuses[r.node_id] = r.error_message ? 'error' : 'success';
                }
            }
            return statuses;
        }

        /**
         * Build nodeResults from raw node_outputs (used by executeUntilNode).
         */
        function buildNodeResultsFromOutputs(nodeOutputs, executedOrder) {
            const outputs = nodeOutputs || {};
            const order = Array.isArray(executedOrder) ? executedOrder : [];
            const source = order.length ? order : Object.keys(outputs);
            const seen = new Set();
            const results = [];
            for (let i = source.length - 1; i >= 0; i--) {
                const nodeId = source[i];
                if (seen.has(nodeId)) continue;
                seen.add(nodeId);
                results.push(nodeId);
            }
            results.reverse();
            return results.map((nodeId) => {
                const output = outputs[nodeId] || {};
                return {
                    node_id: nodeId,
                    output_data: output.json,
                    error_message: output.error || null,
                    title: output.title,
                    meta: output.meta || null,
                };
            });
        }

        // ===============
        // Helper selectors (with null checks for safety)
        // ===============
        const getNode = (nodeId) => state.graph.nodes.find((n) => n.id === nodeId) || null;
        const getConnection = (connId) =>
            state.graph.connections.find((c) => c.id === connId) || null;

        // ===============
        // Actions (graph via adapter, UI local)
        // ===============
        const actions = {
            /**
             * Merge final execution data into the current progress.
             * If no progress exists, creates one from scratch.
             */
            setExecutionResult(fields) {
                if (!state.executionProgress) {
                    state.executionProgress = createFreshProgress();
                }
                Object.assign(state.executionProgress, fields);
                // Derive nodeStatuses from nodeResults when not already set
                if (Array.isArray(fields.nodeResults) && fields.nodeResults.length) {
                    Object.assign(
                        state.executionProgress.nodeStatuses,
                        buildNodeStatusesFromResults(fields.nodeResults),
                    );
                }

                if (
                    (!Array.isArray(state.executionProgress.executedConnectionIds)
                        || !state.executionProgress.executedConnectionIds.length)
                    && Array.isArray(state.executionProgress.executedConnections)
                    && state.executionProgress.executedConnections.length
                ) {
                    const executedConnectionIds = [];
                    for (const entry of state.executionProgress.executedConnections) {
                        if (entry && entry.connection_id) {
                            executedConnectionIds.push(entry.connection_id);
                        }
                    }
                    state.executionProgress.executedConnectionIds = executedConnectionIds;
                }

                if (
                    state.executionProgress
                    && (state.executionProgress.status === 'completed'
                        || state.executionProgress.status === 'failed')
                ) {
                    state.ui.panels.executionLogOpen = true;
                }
            },
            replaceExecutionResult(fields) {
                const runId = fields && fields.runId ? fields.runId : null;
                state.executionProgress = createFreshProgress(runId);
                actions.setExecutionResult(fields || {});
            },
            clearExecution() {
                state.executionProgress = null;
            },
            // ---- Bus-driven real-time execution progress ----
            /**
             * Called by workflow_bus_service for batched execution progress.
             * Handles completed nodes, connections, next running node, and final status
             * in a single event — replacing the former node_start / node_done / done triplet.
             * @param {Object} payload
             *   - completed_nodes: [{node_id, status, node_type, node_label}, ...]
             *   - connections: [routed_connection entries]
             *   - next_running_node_id: string|null
             *   - status: 'completed'|'failed'|undefined  (final only)
             *   - error: string|null                       (final only)
             *   - executed_order, executed_connection_ids, executed_connections (final only)
             */
            onExecutionProgress(payload) {
                if (!payload) {
                    return;
                }
                if (!state.executionProgress) {
                    state.executionProgress = createFreshProgress(payload.run_id);
                }
                if (state.executionProgress.runId && payload.run_id && state.executionProgress.runId !== payload.run_id) {
                    return;
                }

                const order = state.executionProgress.executedOrder;

                if (Array.isArray(payload.completed_nodes)) {
                    for (const node of payload.completed_nodes) {
                        if (!node || !node.node_id) {
                            continue;
                        }
                        if (order[order.length - 1] !== node.node_id) {
                            order.push(node.node_id);
                        }
                        state.executionProgress.nodeStatuses[node.node_id] = node.status || 'success';
                    }
                }

                if (Array.isArray(payload.connections)) {
                    for (const conn of payload.connections) {
                        if (!conn || typeof conn !== 'object') {
                            continue;
                        }
                        if (conn.connection_id) {
                            state.executionProgress.executedConnectionIds.push(conn.connection_id);
                        }
                        state.executionProgress.executedConnections.push(conn);
                    }
                }

                if (payload.next_running_node_id) {
                    state.executionProgress.nodeStatuses[payload.next_running_node_id] = 'running';
                }

                if (payload.status) {
                    state.executionProgress.status = payload.status;
                    state.executionProgress.error = payload.error || null;
                    if (Array.isArray(payload.executed_order)) {
                        state.executionProgress.executedOrder = payload.executed_order;
                    }
                    if (Array.isArray(payload.executed_connection_ids)) {
                        state.executionProgress.executedConnectionIds = payload.executed_connection_ids;
                    }
                    if (Array.isArray(payload.executed_connections)) {
                        state.executionProgress.executedConnections = payload.executed_connections;
                    }
                }
            },
            setSaving(value) {
                state.ui.saving = !!value;
            },
            setExecuting(value) {
                state.ui.executing = !!value;
            },
            setNodeTypes(types) {
                state.nodeTypes = Array.isArray(types) ? types : [];
            },
            bootstrapDimensions(config = {}) {
                return bootstrapDimensions(config);
            },
            updateDimensionConfig(configPatch = {}) {
                return bootstrapDimensions({
                    ...(state.dimensions.config || {}),
                    ...(configPatch || {}),
                });
            },
            addNode(type, position) {
                const nodeId = adapter.addNode(type, position);
                if (!nodeId) return null;
                // Graph changed → stale execution highlights no longer valid
                actions.clearExecution();

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
                if (oldPosition && oldPosition.x === position.x && oldPosition.y === position.y) {
                    return;
                }
                adapter.updatePosition(nodeId, position);
                if (oldPosition) {
                    history.push(
                        createMoveNodeAction(adapter, nodeId, oldPosition, position)
                    );
                }
            },

            /**
             * Move many nodes in one history action.
             * @param {Object<string, {x:number, y:number}>} updates
             */
            moveNodes(updates = {}) {
                const entries = Object.entries(updates);
                if (!entries.length) {
                    return;
                }

                const nodeMoves = [];
                for (const [nodeId, position] of entries) {
                    const node = getNode(nodeId);
                    if (!node) {
                        continue;
                    }

                    const oldPosition = { x: node.x, y: node.y };
                    if (oldPosition.x === position.x && oldPosition.y === position.y) {
                        continue;
                    }

                    adapter.updatePosition(nodeId, position);
                    nodeMoves.push({
                        nodeId,
                        oldPosition,
                        newPosition: { x: position.x, y: position.y },
                    });
                }

                if (nodeMoves.length > 0) {
                    history.push(createMoveNodesAction(adapter, nodeMoves));
                }
            },

            /**
             * Move many nodes without creating history entries.
             * Used by drag loops to keep per-frame updates cheap.
             * @param {Object<string, {x:number, y:number}>} updates
             */
            moveNodesTransient(updates = {}) {
                const entries = Object.entries(updates);
                if (!entries.length) {
                    return;
                }

                for (const [nodeId, position] of entries) {
                    const node = getNode(nodeId);
                    if (!node) {
                        continue;
                    }
                    if (node.x === position.x && node.y === position.y) {
                        continue;
                    }
                    adapter.updatePosition(nodeId, position);
                }
            },

            /**
             * Record final multi-node move into history once.
             * @param {Array<{nodeId:string, oldPosition:{x:number,y:number}, newPosition:{x:number,y:number}}>} nodeMoves
             */
            recordMoveNodes(nodeMoves = []) {
                if (!Array.isArray(nodeMoves) || nodeMoves.length === 0) {
                    return;
                }
                history.push(createMoveNodesAction(adapter, nodeMoves));
            },

            removeNode(nodeId) {
                const node = getNode(nodeId);
                if (!node) return false;
                // Graph changed → stale execution highlights no longer valid
                actions.clearExecution();
                // Clean up any pinned data for the removed node
                delete state.pinData[nodeId];

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
                    // Graph changed → stale execution highlights no longer valid
                    actions.clearExecution();
                    history.push(createAddConnectionAction(adapter, conn));
                    return conn.id;
                }
                return null;
            },

            removeConnection(connectionId) {
                const conn = getConnection(connectionId);
                if (!conn) return false;
                // Graph changed → stale execution highlights no longer valid
                actions.clearExecution();

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

            focusNode(nodeId) {
                if (!nodeId) {
                    return;
                }
                state.ui.selection = {
                    nodeIds: [nodeId],
                    connectionIds: [],
                };
                focusNodeRequestSeq += 1;
                state.ui.focusNodeRequest = {
                    nodeId,
                    seq: focusNodeRequestSeq,
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

            setReadonly(value) {
                state.ui.readonly = !!value;
            },

            startHistoryPreview(revisionId, snapshot) {
                if (!snapshot) {
                    return;
                }
                // Mutual exclusion: exit execution view if active
                if (executionView.active) {
                    actions.endExecutionView();
                }
                if (!historyPreview.active) {
                    historyPreview.originalSnapshot = adapter.toJSON();
                }

                historyPreview.active = true;
                historyPreview.revisionId = revisionId || null;
                state.ui.historyPreview = { active: true, revisionId: revisionId || null };
                state.ui.readonly = true;
                state.ui.selection = { nodeIds: [], connectionIds: [] };
                state.ui.hoveredConnection = {
                    id: null,
                    midpoint: { x: 0, y: 0 },
                    canvasMidpoint: null,
                };
                state.ui.panels.configOpen = false;
                state.ui.panels.configNodeId = null;
                state.ui.nodeMenu = {
                    visible: false,
                    x: 0,
                    y: 0,
                    canvasX: 0,
                    canvasY: 0,
                    variant: 'default',
                    connectionContext: null,
                };

                adapter.fromJSON(snapshot);
            },

            endHistoryPreview({ restoreOriginal = true } = {}) {
                if (historyPreview.active && restoreOriginal && historyPreview.originalSnapshot) {
                    adapter.fromJSON(historyPreview.originalSnapshot);
                }

                historyPreview.active = false;
                historyPreview.revisionId = null;
                historyPreview.originalSnapshot = null;
                state.ui.historyPreview = { active: false, revisionId: null };
                state.ui.readonly = false;
                state.ui.selection = { nodeIds: [], connectionIds: [] };
                state.ui.hoveredConnection = {
                    id: null,
                    midpoint: { x: 0, y: 0 },
                    canvasMidpoint: null,
                };
            },

            startExecutionView(runId, snapshot, executionData) {
                if (!snapshot) {
                    return;
                }
                // Mutual exclusion: exit history preview if active
                if (historyPreview.active) {
                    actions.endHistoryPreview();
                }
                if (!executionView.active) {
                    executionView.originalSnapshot = adapter.toJSON();
                }
                executionView.active = true;
                executionView.runId = runId || null;
                state.ui.executionView = { active: true, runId: runId || null };
                state.ui.panels.executionLogOpen = true;
                state.ui.readonly = true;
                state.ui.selection = { nodeIds: [], connectionIds: [] };
                state.ui.hoveredConnection = {
                    id: null,
                    midpoint: { x: 0, y: 0 },
                    canvasMidpoint: null,
                };
                state.ui.panels.configOpen = false;
                state.ui.panels.configNodeId = null;
                state.ui.nodeMenu = {
                    visible: false,
                    x: 0,
                    y: 0,
                    canvasX: 0,
                    canvasY: 0,
                    variant: 'default',
                    connectionContext: null,
                };

                adapter.fromJSON(snapshot);

                // Populate execution highlights from run data
                if (executionData) {
                    actions.replaceExecutionResult(executionData);
                }
            },

            endExecutionView({ restoreOriginal = true, clearExecution = true } = {}) {
                if (executionView.active && restoreOriginal && executionView.originalSnapshot) {
                    adapter.fromJSON(executionView.originalSnapshot);
                }
                executionView.active = false;
                executionView.runId = null;
                executionView.originalSnapshot = null;
                state.ui.executionView = { active: false, runId: null };
                state.ui.readonly = false;
                if (clearExecution) {
                    state.executionProgress = null;
                }
                state.ui.selection = { nodeIds: [], connectionIds: [] };
                state.ui.hoveredConnection = {
                    id: null,
                    midpoint: { x: 0, y: 0 },
                    canvasMidpoint: null,
                };
            },

            copyExecutionToEditor() {
                if (!executionView.active) {
                    return;
                }
                actions.endExecutionView({ restoreOriginal: true, clearExecution: false });
            },

            /**
             * Apply a historical execution run back into the current editor
             * UI state without pinning snapshot payloads.
             *
             * @param {Object} runData Run detail from getRunDetails() or
             *   execution log.
             */
            debugExecution(runData) {
                if (!runData || !Array.isArray(runData.node_results)) {
                    throw new Error("debugExecution requires runData with node_results");
                }
                // Apply historical results back into the current editable UI state.
                if (executionView.active) {
                    actions.endExecutionView({ restoreOriginal: true, clearExecution: true });
                }
                actions.replaceExecutionResult({
                    runId: runData.run_id || runData.id || null,
                    status: runData.status || 'completed',
                    error: runData.error || runData.error_message || null,
                    errorNodeId: runData.error_node_id || null,
                    executedOrder: runData.executed_order || [],
                    executedConnectionIds: runData.executed_connection_ids || [],
                    executedConnections: runData.executed_connections || [],
                    executionEvents: runData.execution_events || [],
                    nodeResults: runData.node_results || [],
                    inputData: runData.input_data || {},
                    contextSnapshot: runData.context_snapshot || null,
                });
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
                if (panelType === "history") {
                    state.ui.panels.historyOpen = true;
                }
                if (panelType === "executionLog") {
                    state.ui.panels.executionLogOpen = true;
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
                if (panelType === "history") {
                    state.ui.panels.historyOpen = false;
                }
                if (panelType === "executionLog") {
                    state.ui.panels.executionLogOpen = false;
                }
            },

            setHoveredConnection({ id = null, midpoint = null, canvasMidpoint = null } = {}) {
                if (!id) {
                    state.ui.hoveredConnection = {
                        id: null,
                        midpoint: { x: 0, y: 0 },
                        canvasMidpoint: null,
                    };
                    return;
                }
                state.ui.hoveredConnection = {
                    id,
                    midpoint: midpoint || { x: 0, y: 0 },
                    canvasMidpoint: canvasMidpoint || null,
                };
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
                // Persist to backend so execution uses the updated snapshot
                editorBus.trigger("save");
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

            // =========================================================
            // Pin Data actions
            // =========================================================

            /**
             * Pin (freeze) output data for a node.
             * On next manual execution the executor will return this data
             * instead of running the node.
             *
             * Accepts either:
             * - A number/string: workflow.run.node ID (reference pin)
             * - An object with output_data: inline data pin (for preview runs)
             *
             * @param {string} nodeId
             * @param {number|string|Object} pinValue  node_run_id or inline data object
             */
            pinNodeData(nodeId, pinValue) {
                if (!nodeId || pinValue === undefined || pinValue === null) {
                    throw new Error("pinNodeData requires nodeId and pinValue");
                }
                let storedValue;
                if (typeof pinValue === 'object' && pinValue !== null) {
                    // Inline data pin (preview execution without persisted record)
                    storedValue = { ...pinValue };
                } else {
                    // Reference pin (workflow.run.node ID)
                    const normalizedNodeRunId = parseInt(pinValue, 10);
                    if (isNaN(normalizedNodeRunId) || normalizedNodeRunId <= 0) {
                        throw new Error(`Invalid nodeRunId for pinNodeData: ${pinValue}`);
                    }
                    storedValue = normalizedNodeRunId;
                }
                state.pinData[nodeId] = storedValue;
                const nextPinData = {
                    ...((state.workflowMetadata && state.workflowMetadata.pin_data) || {}),
                    [nodeId]: storedValue,
                };
                state.workflowMetadata = {
                    ...(state.workflowMetadata || {}),
                    pin_data: nextPinData,
                };
                editorBus.trigger("PIN_DATA:CHANGED", { nodeId, pinned: true });
            },

            /**
             * Unpin a single node so it executes normally again.
             * @param {string} nodeId
             */
            unpinNodeData(nodeId) {
                delete state.pinData[nodeId];
                const nextMetadata = { ...(state.workflowMetadata || {}) };
                const nextPinData = { ...((nextMetadata.pin_data) || {}) };
                delete nextPinData[nodeId];
                if (Object.keys(nextPinData).length) {
                    nextMetadata.pin_data = nextPinData;
                } else {
                    delete nextMetadata.pin_data;
                }
                delete nextMetadata.pinData;
                state.workflowMetadata = nextMetadata;
                editorBus.trigger("PIN_DATA:CHANGED", { nodeId, pinned: false });
            },

            /**
             * Remove all pin data.
             */
            clearAllPinData() {
                const keys = Object.keys(state.pinData);
                for (const k of keys) {
                    delete state.pinData[k];
                }
                const nextMetadata = { ...(state.workflowMetadata || {}) };
                delete nextMetadata.pin_data;
                delete nextMetadata.pinData;
                state.workflowMetadata = nextMetadata;
                editorBus.trigger("PIN_DATA:CHANGED", { nodeId: null, pinned: false });
            },

            /**
             * Check if a node has pinned data.
             * @param {string} nodeId
             * @returns {boolean}
             */
            isNodePinned(nodeId) {
                return nodeId in state.pinData;
            },

            replaceExecutionNodeResult(nodeResult) {
                if (!nodeResult || !nodeResult.node_id) {
                    throw new Error("replaceExecutionNodeResult requires nodeResult.node_id");
                }
                if (!state.executionProgress) {
                    state.executionProgress = createFreshProgress();
                }
                const normalized = { ...nodeResult };
                const replaceItems = (items = []) => {
                    const nextItems = [];
                    let replaced = false;
                    for (const item of items) {
                        if (!item || typeof item !== 'object') {
                            nextItems.push(item);
                            continue;
                        }
                        const matchesByRunId = normalized.node_run_id && item.node_run_id === normalized.node_run_id;
                        const matchesByNode = !normalized.node_run_id && item.node_id === normalized.node_id && item.sequence === normalized.sequence && item.iteration === normalized.iteration;
                        if (matchesByRunId || matchesByNode) {
                            nextItems.push(normalized);
                            replaced = true;
                        } else {
                            nextItems.push(item);
                        }
                    }
                    if (!replaced) {
                        nextItems.push(normalized);
                    }
                    return nextItems;
                };

                state.executionProgress.nodeResults = replaceItems(state.executionProgress.nodeResults || []);
                state.executionProgress.executionEvents = replaceItems(state.executionProgress.executionEvents || []);
                state.executionProgress.nodeStatuses[normalized.node_id] = normalized.error_message ? 'error' : 'success';
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
            async copyText(value, options = {}) {
                const safeLabel = typeof options.label === "string" && options.label.trim()
                    ? options.label.trim()
                    : "Text";
                if (!value) {
                    return false;
                }

                const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : null;
                if (!clipboard || typeof clipboard.writeText !== "function") {
                    notification.add(`Copy ${safeLabel} manually — clipboard API unavailable.`, {
                        type: "warning",
                    });
                    return false;
                }

                try {
                    await clipboard.writeText(value);
                    notification.add(`${safeLabel} copied to clipboard.`, { type: "success" });
                    return true;
                } catch {
                    notification.add(`Failed to copy ${safeLabel}.`, { type: "danger" });
                    return false;
                }
            },
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
            renameNode(nodeId, label) {
                return adapter.setNodeLabel(nodeId, label);
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
                // Reset execution state from any previous session
                actions.clearExecution();
                state.ui.panels.executionLogOpen = false;
                state.ui.executing = false;
                state.ui.executionView = { active: false, runId: null };

                const data = await rpc('/web/dataset/call_kw', {
                    model: 'ir.workflow',
                    method: 'load_workflow',
                    args: [id],
                    kwargs: {},
                });
                adapter.fromJSON(data.draft_snapshot);
                versionHash = data.version_hash;
                workflowId = id;
                autoSave = data.auto_save !== false;
                const rawMetadata = data.draft_snapshot
                    && data.draft_snapshot.metadata
                    && typeof data.draft_snapshot.metadata === 'object'
                    ? JSON.parse(JSON.stringify(data.draft_snapshot.metadata))
                    : {};
                state.workflowMetadata = rawMetadata;
                // Restore pinData references from saved snapshot metadata
                const savedPin = rawMetadata.pin_data || rawMetadata.pinData;
                // Reset then repopulate to keep reactivity
                const oldKeys = Object.keys(state.pinData);
                for (const k of oldKeys) {
                    delete state.pinData[k];
                }
                if (savedPin && typeof savedPin === 'object') {
                    Object.assign(state.pinData, savedPin);
                }
                return data;
            },
            getAutoSave() {
                return autoSave;
            },
            setAutoSave(value) {
                autoSave = Boolean(value);
            },
            async loadNodeTypes() {
                const result = await rpc('/web/dataset/call_kw', {
                    model: 'workflow.type',
                    method: 'get_available_types',
                    args: [],
                    kwargs: {},
                });
                const backendTypes = Array.isArray(result) ? result : [];
                const registeredKeys = registerBackendNodeTypes(backendTypes);
                pruneRecentNodes(registeredKeys);
                adapter.refreshNodeRegistry();
                actions.setNodeTypes(backendTypes);
                return backendTypes;
            },
            async saveWorkflow() {
                const snapshot = buildFullSnapshot();
                const result = await rpc('/web/dataset/call_kw', {
                    model: 'ir.workflow',
                    method: 'save_workflow',
                    args: [[workflowId], snapshot, versionHash],
                    kwargs: {},
                });
                versionHash = result.version_hash;
                history.clear();
                editorBus.trigger('refresh');
                return result;
            },

            async executeWorkflow(inputData = {}) {
                if (!workflowId) {
                    throw new Error('No workflow ID loaded');
                }
                const safeInput = normalizeInputData(inputData);
                // Reset to fresh progress — clears old highlights,
                // bus events will fill nodeStatuses incrementally.
                state.executionProgress = createFreshProgress();
                state.executionProgress.inputData = safeInput;

                const result = await rpc('/workflow_studio/execute', {
                    workflow_id: workflowId,
                    input_data: safeInput,
                });
                if (result && result.run_id) {
                    const run = await rpc(`/workflow_studio/run/${result.run_id}`, {});
                    if (!run || typeof run !== 'object' || run.jsonrpc) {
                        // Run API call itself failed (RPC error / network error)
                        actions.setExecutionResult({
                            runId: result.run_id,
                            status: result.status || 'failed',
                            error: result.error || 'Failed to load run details',
                            inputData: safeInput,
                        });
                        return result;
                    }
                    // run.error is the execution error message (not an API failure);
                    // always populate full nodeResults so config panels show context.
                    actions.setExecutionResult({
                        runId: run.run_id || run.id || result.run_id,
                        status: run.status || result.status || 'completed',
                        error: run.error || run.error_message || result.error || null,
                        errorNodeId: run.error_node_id || null,
                        outputData: run.output_data || null,
                        executedOrder: run.executed_order || result.executed_order || [],
                        executedConnectionIds:
                            run.executed_connection_ids
                            || result.executed_connection_ids
                            || [],
                        executedConnections:
                            run.executed_connections
                            || result.executed_connections
                            || [],
                        executionCount: run.execution_count || null,
                        durationSeconds: run.duration_seconds || result.duration_seconds || null,
                        nodeCountExecuted: run.node_count_executed || null,
                        inputData: run.input_data || safeInput,
                        contextSnapshot: result.context_snapshot || run.context_snapshot || null,
                        executionEvents: run.execution_events || result.execution_events || [],
                        nodeResults: run.node_results || [],
                    });
                    editorBus.trigger('refresh');
                } else if (result && result.error) {
                    actions.setExecutionResult({
                        status: result.status || 'failed',
                        error: result.error,
                        inputData: safeInput,
                    });
                }
                return result;
            },
            async executeUntilNode(targetNodeId, inputData = {}, configOverrides = null) {
                if (!workflowId) {
                    throw new Error('No workflow ID loaded');
                }
                if (!targetNodeId) {
                    throw new Error('Target node ID is required');
                }
                // Reset to fresh progress
                state.executionProgress = createFreshProgress();
                try {
                    const safeInput = normalizeInputData(inputData);
                    state.executionProgress.inputData = safeInput;
                    const result = await rpc('/workflow_studio/execute_until', {
                        workflow_id: workflowId,
                        target_node_id: targetNodeId,
                        input_data: safeInput,
                        snapshot: buildFullSnapshot(),
                        config_overrides: configOverrides,
                    });
                    if (result && (result.status === 'completed' || result.status === 'failed')) {
                        const nodeResults = buildNodeResultsFromOutputs(
                            result.node_outputs,
                            result.executed_order,
                        );
                        actions.setExecutionResult({
                            status: result.status,
                            error: result.error || null,
                            errorNodeId: result.error_node_id || null,
                            executedOrder: result.executed_order || [],
                            executedConnectionIds: result.executed_connection_ids || [],
                            executedConnections: result.executed_connections || [],
                            executionCount: result.execution_count || null,
                            durationSeconds: result.duration_seconds || null,
                            nodeCountExecuted: result.node_count_executed || null,
                            inputData: safeInput,
                            executionEvents: result.execution_events || [],
                            nodeResults,
                            nodeOutputs: result.node_outputs || null,
                            contextSnapshot: result.context_snapshot || null,
                        });
                    }
                    return result;
                } catch (error) {
                    const errorMessage = error && error.message ? error.message : 'Execution failed';
                    actions.setExecutionResult({
                        status: 'failed',
                        error: errorMessage,
                        inputData,
                    });
                    throw error;
                }
            },
            async executeFromNode(startNodeId, inputData = {}) {
                if (!workflowId) {
                    throw new Error('No workflow ID loaded');
                }
                if (!startNodeId) {
                    throw new Error('Start node ID is required');
                }
                const safeInput = normalizeInputData(inputData);
                state.executionProgress = createFreshProgress();
                state.executionProgress.inputData = safeInput;

                const result = await rpc('/workflow_studio/execute_from', {
                    workflow_id: workflowId,
                    node_id: startNodeId,
                    input_data: safeInput,
                });
                if (result && result.run_id) {
                    const run = await rpc(`/workflow_studio/run/${result.run_id}`, {});
                    if (!run || typeof run !== 'object' || run.jsonrpc) {
                        actions.setExecutionResult({
                            runId: result.run_id,
                            status: result.status || 'failed',
                            error: result.error || 'Failed to load run details',
                            inputData: safeInput,
                        });
                        return result;
                    }
                    actions.setExecutionResult({
                        runId: run.run_id || run.id || result.run_id,
                        status: run.status || result.status || 'completed',
                        error: run.error || run.error_message || result.error || null,
                        errorNodeId: run.error_node_id || null,
                        outputData: run.output_data || null,
                        executedOrder: run.executed_order || result.executed_order || [],
                        executedConnectionIds:
                            run.executed_connection_ids
                            || result.executed_connection_ids
                            || [],
                        executedConnections:
                            run.executed_connections
                            || result.executed_connections
                            || [],
                        executionCount: run.execution_count || null,
                        durationSeconds: run.duration_seconds || result.duration_seconds || null,
                        nodeCountExecuted: run.node_count_executed || null,
                        inputData: run.input_data || safeInput,
                        contextSnapshot: result.context_snapshot || run.context_snapshot || null,
                        executionEvents: run.execution_events || result.execution_events || [],
                        nodeResults: run.node_results || [],
                    });
                    editorBus.trigger('refresh');
                } else if (result && result.error) {
                    actions.setExecutionResult({
                        status: result.status || 'failed',
                        error: result.error,
                        inputData: safeInput,
                    });
                }
                return result;
            },
            async getRunDetails(runId) {
                return await rpc(`/workflow_studio/run/${runId}`, {});
            },
            async getNodeRunDetails(nodeRunId) {
                return await rpc(`/workflow_studio/node_run/${nodeRunId}`, {});
            },
            getExecutionResults(){
                return state.executionProgress;
            },
            async resolveRecordRefs(refs = []) {
                const safeRefs = Array.isArray(refs) ? refs : [];
                return await rpc('/workflow_studio/resolve_record_refs', {
                    refs: safeRefs,
                });
            },
            async getTriggerNodeAction(nodeId) {
                if (!workflowId) return false;
                return await rpc('/web/dataset/call_kw', {
                    model: 'ir.workflow',
                    method: 'get_trigger_node_action',
                    args: [[workflowId], nodeId],
                    kwargs: {},
                });
            },
            async getTriggerPanelData(nodeId) {
                if (!workflowId) {
                    throw new Error('No workflow ID loaded');
                }
                return await rpc('/web/dataset/call_kw', {
                    model: 'ir.workflow',
                    method: 'get_trigger_panel_data',
                    args: [[workflowId], nodeId],
                    kwargs: {},
                });
            },
            async activateTriggerNode(nodeId) {
                if (!workflowId) {
                    throw new Error('No workflow ID loaded');
                }
                return await rpc('/web/dataset/call_kw', {
                    model: 'ir.workflow',
                    method: 'activate_trigger_node',
                    args: [[workflowId], nodeId],
                    kwargs: {},
                });
            },
            async deactivateTriggerNode(nodeId) {
                if (!workflowId) {
                    throw new Error('No workflow ID loaded');
                }
                return await rpc('/web/dataset/call_kw', {
                    model: 'ir.workflow',
                    method: 'deactivate_trigger_node',
                    args: [[workflowId], nodeId],
                    kwargs: {},
                });
            },
            async rotateTriggerWebhook(nodeId) {
                if (!workflowId) {
                    throw new Error('No workflow ID loaded');
                }
                return await rpc('/web/dataset/call_kw', {
                    model: 'ir.workflow',
                    method: 'rotate_trigger_webhook',
                    args: [[workflowId], nodeId],
                    kwargs: {},
                });
            },
            async startTriggerWebhookTest(nodeId) {
                if (!workflowId) {
                    throw new Error('No workflow ID loaded');
                }
                return await rpc('/web/dataset/call_kw', {
                    model: 'ir.workflow',
                    method: 'start_trigger_webhook_test',
                    args: [[workflowId], nodeId],
                    kwargs: {},
                });
            },
            async stopTriggerWebhookTest(nodeId) {
                if (!workflowId) {
                    throw new Error('No workflow ID loaded');
                }
                return await rpc('/web/dataset/call_kw', {
                    model: 'ir.workflow',
                    method: 'stop_trigger_webhook_test',
                    args: [[workflowId], nodeId],
                    kwargs: {},
                });
            },
            getWorkflowId() {
                return workflowId;
            },
            getDimensions() {
                return state.dimensions.current;
            },
            copyExecutionToEditor() {
                return actions.copyExecutionToEditor();
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
                getAllNodeTypes: () => getAllNodeTypes(state.nodeTypes),
                getCategories: () => getCategories(),
                getNodeType: (key) => getNodeType(key, state.nodeTypes),
                getNodeClass: (key) => getRegistryNodeClass(key),
                getRecentNodes: (limit) => getRecentNodes(limit),
                searchNodes: (query, options) => searchNodes(query, options, state.nodeTypes),
                trackUsage: (key) => trackNodeUsage(key),
                clearRecentNodes: () => clearRecentNodes(),
            },
        };

    },
};

registry.category("services").add("workflowEditor", workflowEditorService);
