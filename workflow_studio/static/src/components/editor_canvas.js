/** @odoo-module **/

import { Component, useRef, useState, useExternalListener, onMounted, onPatched, onWillUnmount, onWillUpdateProps, useEnv } from "@odoo/owl";
import { useBus, useService } from "@web/core/utils/hooks";
import { WorkflowNode } from "./workflow_node";
import { NodeMenu } from "./node_menu";
import { ConnectionToolbar } from "./connection_toolbar";
import { ConfigPanelDialog } from "./config_panel_dialog";
import { DimensionConfig, detectConnectionType } from "../core/dimensions";
import { getConnectionPath as calculateConnectionPath } from "./editor_canvas/utils/connection_path";
import { calculateTidyPositions } from "./editor_canvas/utils/layout";
import { useCanvasGestures, useConnectionDrawing, useMultiNodeDrag, useWorkflowCommands, useConnectionCulling, useClipboard, useViewport } from "./editor_canvas/hooks";
import {
    getLatestNodeResultForNodeIds,
    getLatestNodeResultsByNodeIds,
    getStructuralParentIds,
    getStructuralPredecessorIds,
} from "@workflow_studio/utils/graph_utils";

/**
 * EditorCanvas Component
 * 
 * Main canvas for the workflow editor. Manages node positions, selection,
 * and drag-drop from palette.
 * Reads graph state from workflowEditor service via env.
 */
export class EditorCanvas extends Component {
    static template = "workflow_studio.editor_canvas";
    static components = { WorkflowNode, NodeMenu, ConnectionToolbar };

    static props = {
        // Graph data (required for standalone/widget mode, ignored in editor mode)
        // Minimal: { nodes: [], connections: [] }
        graphData: { type: Object, optional: true },
        // Initial viewport (optional)
        initialViewport: { type: Object, optional: true },
        // Execution results (optional - enables execution highlighting)
        executionData: { type: Object, optional: true },
        // Dimension configuration for node sizing
        dimensionConfig: { type: Object, optional: true },
        // Readonly mode - disables all editing features
        readonly: { type: Boolean, optional: true },
    };

    setup() {
        this.rootRef = useRef("root");
        this.svgRef = useRef("svgConnections");
        this.contentRef = useRef("content");
        this.env = useEnv();

        this._mouseMoveFrame = null;
        this._connectionHoverTimeout = null;
        this._justCompletedSelectionTimeout = null;
        this._deferredInsertNodeTimeout = null;
        this._deferredConnectTimeout = null;
        this._connectionToolbarPropsCache = null;
        this._nodeMenuPropsCache = null;
        this._nodeActionCallbacksCache = null;
        this._selectionSetSource = null;
        this._selectionSetCache = new Set();
        this._connectedOutputsSource = null;
        this._connectedOutputsSetCache = new Set();
        this._dimensionsConfigSource = null;
        this._dimensionsCache = null;
        this._executedConnectionIdsSource = null;
        this._executedConnectionIdsCache = null;
        this._executedConnectionIdsLength = 0;
        this._lastExecutedOrderLength = 0;
        this._lastFocusNodeRequest = null;
        this._removeConfigPanelDialog = null;
        this._configPanelDialogNodeId = null;

        // Determine operating mode FIRST (before any state/hooks)
        // Mode 1: Editor Mode - service exists, no graphData prop
        // Mode 2: Widget/Viewer Mode - graphData prop provided (service optional)
        const hasEditorService = !!this.env.workflowEditor;
        const hasGraphDataProp = !!this.props.graphData;
        const initialReadonly = !!this.props.readonly;

        // Store mode flags (immutable after setup)
        this._mode = hasGraphDataProp ? 'widget' : (hasEditorService ? 'editor' : 'error');
        // Get editor service (Fail-First in editor mode)
        if (this._mode === 'editor') {
            this.editor = this.env.workflowEditor;
            if (!this.editor) {
                throw new Error('[EditorCanvas] Editor mode requires workflowEditor service in env');
            }
            this.actionService = useService("action");
            this.dialogService = useService("dialog");
        } else {
            this.editor = this.env.workflowEditor || null;
            this.actionService = null;
            this.dialogService = null;
        }

        // Local state for widget mode (or fallback defaults if service state unavailable)
        this.state = useState({
            readonly: initialReadonly,
            // Graph data (widget mode only - editor mode reads from service)
            graph: this.props.graphData || { nodes: [], connections: [] },
            // UI defaults for widget mode
            ui: {
                viewport: this.props.initialViewport || { pan: { x: 0, y: 0 }, zoom: 1 },
                selection: { nodeIds: [], connectionIds: [] },
                hoveredConnection: { id: null, midpoint: { x: 0, y: 0 }, canvasMidpoint: null },
                panels: { configOpen: false, configNodeId: null },
                focusNodeRequest: null,
                nodeMenu: { visible: false, x: 0, y: 0, canvasX: 0, canvasY: 0, variant: 'default', connectionContext: null },
                history: { canUndo: false, canRedo: false },
            },
            // Execution data (widget mode)
            execution: this.props.executionData || null,
        });

        this.localUi = useState({
            fitMenuOpen: false,
        });

        // Bind to editor service state (editor mode) for reactivity
        this.editorState = this.isEditorMode ? useState(this.editor.state) : null;

        // Expression context builder (editor mode only)
        const buildExecutionContext = this.isEditorMode ? this._createExecutionContextBuilder() : null;

        // Node config actions - only available in editor mode
        this.nodeConfigActions = this.isEditorMode ? {
            getControls: (nodeId) => this.editor.getNodeControls(nodeId),
            getNodeMeta: (nodeId) => this.editor.getNodeMeta(nodeId),
            setNodeMeta: (nodeId, meta) => this.editor.setNodeMeta(nodeId, meta),
            renameNode: (nodeId, label) => this.editor.renameNode(nodeId, label),
            openNodeConfig: (nodeId) => this.onNodeOpenConfig(nodeId),
            getNodeConfig: (nodeId) => this.editor.getNodeConfig(nodeId),
            getExpressionContext: (options) => buildExecutionContext ? buildExecutionContext(options) : null,
            buildContextForNode: () => ({
                _node: {}, _json: {}, _input: { item: null, json: null },
                _execution: null, _workflow: null,
            }),
            executeUntilNode: (nodeId, inputData = {}, configOverrides = null) =>
                this.editor.executeUntilNode(nodeId, inputData, configOverrides),
            executeFromNode: (nodeId, inputData = {}) => this.editor.executeFromNode(nodeId, inputData),
            setNodeConfig: (nodeId, values) => this.editor.setNodeConfig(nodeId, values),
            pinNodeData: (nodeId, nodeRunId) => this.editor.actions.pinNodeData(nodeId, nodeRunId),
            unpinNodeData: (nodeId) => this.editor.actions.unpinNodeData(nodeId),
            isNodePinned: (nodeId) => this.editor.actions.isNodePinned(nodeId),
            replaceExecutionNodeResult: (nodeResult) => this.editor.actions.replaceExecutionNodeResult(nodeResult),
            saveWorkflow: () => this.editor.saveWorkflow(),
            getNodeRunDetails: (nodeRunId) => this.editor.getNodeRunDetails(nodeRunId),
            getTriggerPanelData: (nodeId) => this.editor.getTriggerPanelData(nodeId),
            activateTriggerNode: (nodeId) => this.editor.activateTriggerNode(nodeId),
            deactivateTriggerNode: (nodeId) => this.editor.deactivateTriggerNode(nodeId),
            rotateTriggerWebhook: (nodeId) => this.editor.rotateTriggerWebhook(nodeId),
            startTriggerWebhookTest: (nodeId) => this.editor.startTriggerWebhookTest(nodeId),
            stopTriggerWebhookTest: (nodeId) => this.editor.stopTriggerWebhookTest(nodeId),
            openTriggerNodeRecord: async (nodeId) => {
                const action = await this.editor.getTriggerNodeAction(nodeId);
                if (action) {
                    this.actionService.doAction(action);
                }
            },
            resolveRecordRefs: (...args) => {
                // Proxy for record ref resolution
                if (this.editor.resolveRecordRefs) {
                    return this.editor.resolveRecordRefs(...args);
                }
                return null;
            },
        } : null;

        if (this.isEditorMode) {
            this.onSave = () => this.env.bus.trigger("save");
            this.onRun = () => this.env.bus.trigger("run");
        }

        // Viewport setter for widget mode
        const setViewportLocal = this._mode === 'widget' ? (viewportUpdate) => {
            if (viewportUpdate.pan) {
                this.state.ui.viewport.pan = { ...this.state.ui.viewport.pan, ...viewportUpdate.pan };
            }
            if (viewportUpdate.zoom !== undefined) {
                this.state.ui.viewport.zoom = viewportUpdate.zoom;
            }
        } : null;

        // Initialize Viewport Hook (zoom, pan, coordinate conversion) - MUST be first
        this.viewportHook = useViewport({
            editor: this.isEditorMode ? this.editor : null,
            rootRef: this.rootRef,
            getDimensions: () => this.dimensions,
            readonly: this.isReadonly,
            getReadonly: () => this.isReadonly,
            initialViewport: this.props.initialViewport,
        });

        // Initialize Canvas Gestures Hook (pan/selection box)
        this.gestures = useCanvasGestures({
            editor: this.isEditorMode ? this.editor : null,
            rootRef: this.rootRef,
            getViewport: () => this.viewportHook.getViewport(),
            getCanvasPosition: (ev) => this.viewportHook.getCanvasPosition(ev),
            onViewRectUpdate: () => this.viewportHook.updateViewRect(),
            getDimensions: () => this.dimensions,
            getReadonly: () => this.isReadonly,
            setViewport: setViewportLocal,
            getNodes: () => this.nodes,
        });

        // Initialize editing hooks only in editor mode (readonly handled at runtime)
        if (this.isEditorMode) {
            // Initialize Connection Drawing Hook
            this.connectionDrawing = useConnectionDrawing({
                editor: this.editor,
                getCanvasPosition: (ev) => this.viewportHook.getCanvasPosition(ev),
                getSocketPositionForNode: (node, key, type) => this.getSocketPositionForNode(node, key, type),
                getNodes: () => this.nodes,
                openNodeMenu: (config) => { this.editor.actions.openNodeMenu(config); },
                getReadonly: () => this.isReadonly,
            });

            // Initialize Multi-Node Drag Hook
            this.multiNodeDrag = useMultiNodeDrag({
                editor: this.editor,
                getNodes: () => this.nodes,
                getZoom: () => this.viewportHook.getViewport().zoom,
                getViewport: () => this.viewportHook.getViewport(),
                onViewRectUpdate: () => this.viewportHook.updateViewRect(),
                rootRef: this.rootRef,
                getReadonly: () => this.isReadonly,
            });

            // Initialize Workflow Commands Hook (Ctrl+K palette + scoped hotkeys)
            useWorkflowCommands({
                editor: this.editor,
                getNodes: () => this.nodes,
                getReadonly: () => this.isReadonly,
                onSave: this.onSave,
                onRun: this.onRun,
                getRootEl: () => this.rootRef.el,
            });

            // Initialize Clipboard Hook (Copy/Paste)
            useClipboard({
                editor: this.editor,
                getNodes: () => this.nodes,
                getConnections: () => this.connections,
                getSelection: () => this.editorUiState.selection,
                getReadonly: () => this.isReadonly,
                getRootEl: () => this.rootRef.el,
            });
        } else {
            // Readonly stubs - static objects (no reactivity needed)
            this.connectionDrawing = {
                state: { isConnecting: false, snappedSocket: null },
                handleMouseMove: () => { },
                cancelConnection: () => { },
            };
            this.multiNodeDrag = {
                handleMouseMove: () => false,
                handleMouseUp: () => false,
            };
        }

        // Initialize Connection Culling Hook (pure, works in all modes)
        this.connectionCulling = useConnectionCulling({
            getNodes: () => this.nodes,
            getConnections: () => this.connections,
            getViewRect: () => this.viewportHook.viewRect,
            getSocketPosition: (node, key, type) => this.getSocketPositionForNode(node, key, type),
        });

        // Resize observer to update viewport on window resize
        this._resizeObserver = new ResizeObserver(() => {
            this.viewportHook.updateViewRect();
            this._dismissConnectionToolbar();
        });
        onMounted(() => {
            if (this.rootRef.el) {
                this._resizeObserver.observe(this.rootRef.el);
            }
            // Debug handle for QA – accessible as window.canvas in browser console
            window.canvas = this;
            this._syncConfigPanelDialog();
        });
        onWillUnmount(() => {
            this._resizeObserver.disconnect();
            this._removeActiveConfigDialog();
            if (this._mouseMoveFrame) {
                cancelAnimationFrame(this._mouseMoveFrame);
                this._mouseMoveFrame = null;
            }
            if (this._connectionHoverTimeout) {
                clearTimeout(this._connectionHoverTimeout);
                this._connectionHoverTimeout = null;
            }
            if (this._justCompletedSelectionTimeout) {
                clearTimeout(this._justCompletedSelectionTimeout);
                this._justCompletedSelectionTimeout = null;
            }
            if (this._deferredInsertNodeTimeout) {
                clearTimeout(this._deferredInsertNodeTimeout);
                this._deferredInsertNodeTimeout = null;
            }
            if (this._deferredConnectTimeout) {
                clearTimeout(this._deferredConnectTimeout);
                this._deferredConnectTimeout = null;
            }
        });

        onPatched(() => {
            const request = this.uiState.focusNodeRequest;
            if (!request || request === this._lastFocusNodeRequest) {
                this._syncConfigPanelDialog();
                return;
            }
            this._lastFocusNodeRequest = request;
            this.viewportHook.panToNode(request.nodeId, this.nodes);
            this._syncConfigPanelDialog();
        });

        useBus(this.env.bus, "execution-log:focus-node", (payload) => {
            if (!payload || !payload.nodeId) {
                return;
            }
            this.viewportHook.panToNode(payload.nodeId, this.nodes);
        });

        // Global mouse listeners
        useExternalListener(document, "mousemove", this.onDocumentMouseMove.bind(this));
        useExternalListener(document, "mouseup", this.onDocumentMouseUp.bind(this));
        useExternalListener(document, "mousedown", this.onDocumentMouseDown.bind(this));

        this.isDebug = typeof odoo !== "undefined" && odoo.debug;
        window.canvas = this.isDebug ? this : null;

        onWillUpdateProps((nextProps) => {
            const nextReadonly = !!nextProps.readonly;
            if (nextReadonly !== this.state.readonly) {
                this.setReadonly(nextReadonly);
            }
        });
    }

    // ========================================
    // HELPER METHODS (Internal)
    // ========================================

    /**
     * Create expression context builder function (editor mode only)
     * Returns a function that builds execution context for NodeConfigPanel
     * @returns {Function} buildExecutionContext(options) => ExpressionContext
     */
    _createExecutionContextBuilder() {
        const normalizeItems = (value) => {
            if (Array.isArray(value)) return value;
            if (value === null || value === undefined) return [];
            return [value];
        };

        const buildInputContext = (value) => {
            const itemsValue = normalizeItems(value);
            const inputContext = {
                item: itemsValue[0] || value,
                json: value,
                items: itemsValue,
            };
            if (value && typeof value === "object" && !Array.isArray(value)) {
                return {
                    ...value,
                    ...inputContext,
                };
            }
            return inputContext;
        };

        const buildNodeOutputView = (output) => {
            const jsonValue = output;
            const itemsValue = normalizeItems(jsonValue);
            const itemValue = itemsValue.length ? itemsValue[0] : jsonValue;
            return { json: jsonValue, item: itemValue, items: itemsValue };
        };

        const emptyContext = () => ({
            _vars: {}, _node: {}, _json: {}, _loop: null,
            _input: buildInputContext(null),
            _execution: null, _workflow: null, _now: null, _today: null,
        });

        return (options) => {
            const execution = (options && options.execution) || this.executionState || null;
            if (!execution) return emptyContext();

            const snapshot = execution.contextSnapshot || null;
            if (!snapshot) return emptyContext();

            const nodeResults = (options && options.nodeResults) || execution.nodeResults || [];
            const nodeId = (options && options.nodeId) || null;
            const workflow = this.workflowData;
            const structuralPredecessorIds = nodeId
                ? getStructuralPredecessorIds(workflow, nodeId)
                : [];
            const structuralPredecessorIdSet = new Set(structuralPredecessorIds);
            const structuralParentIds = nodeId
                ? getStructuralParentIds(workflow, nodeId)
                : [];

            const wrappedNode = {};
            if (Array.isArray(nodeResults) && nodeResults.length) {
                const sourceResults = nodeId
                    ? getLatestNodeResultsByNodeIds(nodeResults, structuralPredecessorIds)
                    : nodeResults;
                for (const result of sourceResults) {
                    wrappedNode[result.node_id] = buildNodeOutputView(result.output_data);
                }
            } else {
                const nodeEntries = snapshot.node || {};
                for (const [entryId, output] of Object.entries(nodeEntries)) {
                    if (nodeId && !structuralPredecessorIdSet.has(String(entryId))) {
                        continue;
                    }
                    wrappedNode[entryId] = buildNodeOutputView(output);
                }
            }

            let json = snapshot.json || {};
            if (nodeId && Array.isArray(nodeResults) && nodeResults.length) {
                const latestParentResult = getLatestNodeResultForNodeIds(nodeResults, structuralParentIds);
                if (latestParentResult && latestParentResult.output_data !== undefined) {
                    json = latestParentResult.output_data;
                }
            } else if (nodeId && structuralParentIds.length) {
                const snapshotNodes = snapshot.node || {};
                for (let index = structuralParentIds.length - 1; index >= 0; index--) {
                    const parentId = structuralParentIds[index];
                    if (Object.prototype.hasOwnProperty.call(snapshotNodes, parentId)) {
                        json = snapshotNodes[parentId];
                        break;
                    }
                }
            }

            return {
                _vars: snapshot.vars || {},
                _node: wrappedNode,
                _json: json,
                _loop: null,
                _input: buildInputContext(json),
                _execution: snapshot.execution || null,
                _workflow: snapshot.workflow || null,
                _now: snapshot.now || null,
                _today: snapshot.today || null,
            };
        };
    }

    // ========================================
    // CAPABILITY FLAGS
    // ========================================

    /**
     * Check if editing is enabled
     * Used in templates and event handlers
     */
    get canEdit() {
        return this.isEditorMode && !this.isReadonly;
    }

    /**
     * Check if editor is currently readonly (runtime reactive)
     */
    get isReadonly() {
        if (this.isEditorMode) {
            return !!this.editorUiState.readonly;
        }
        return !!this.state.readonly;
    }

    /**
     * Check if we're in editor mode (using service state)
     */
    get isEditorMode() {
        return this._mode === 'editor';
    }

    /**
     * Check if execution features are available.
     */
    get hasExecution() {
        return !!this.executionState;
    }

    /**
     * Unified execution state — from service (editor) or local (widget).
     * Contains both live progress fields (nodeStatuses, executedOrder)
     * and rich final data (nodeResults, contextSnapshot, etc.).
     * @returns {Object|null}
     */
    get executionState() {
        if (this.isEditorMode) {
            return this.editorState.executionProgress;
        }
        return this.state.execution;
    }

    /**
     * Map of nodeId → execution status ('running' | 'success' | 'error').
     * Reads directly from executionProgress.nodeStatuses.
     * @returns {Map<string, string>}
     */
    get nodeExecutionStatusMap() {
        const progress = this.executionState;
        if (!progress || !progress.nodeStatuses) {
            return this._emptyExecutionMap || (this._emptyExecutionMap = new Map());
        }
        const statuses = progress.nodeStatuses;
        const map = new Map();
        for (const nodeId of Object.keys(statuses)) {
            map.set(nodeId, statuses[nodeId]);
        }
        return map;
    }

    /**
     * Set of connectionIds on the execution path.
     * Uses backend-provided socket-level routing data when available.
     * Fallback to node-order heuristic for backward compatibility.
     * @returns {Set<string>}
     */
    get executedConnectionIds() {
        const progress = this.executionState;
        const explicitConnectionIds = progress
            && Array.isArray(progress.executedConnectionIds)
            && progress.executedConnectionIds.length
            ? progress.executedConnectionIds
            : null;

        if (explicitConnectionIds) {
            if (
                this._executedConnectionIdsSource !== explicitConnectionIds
                || this._executedConnectionIdsLength !== explicitConnectionIds.length
            ) {
                this._executedConnectionIdsSource = explicitConnectionIds;
                this._executedConnectionIdsLength = explicitConnectionIds.length;
                this._executedConnectionIdsCache = new Set(explicitConnectionIds);
            }
            return this._executedConnectionIdsCache;
        }

        const executedOrder = progress && Array.isArray(progress.executedOrder) && progress.executedOrder.length >= 2
            ? progress.executedOrder
            : null;

        if (!executedOrder) {
            return this._emptyExecConnSet || (this._emptyExecConnSet = new Set());
        }

        if (
            this._lastExecutedOrder === executedOrder
            && this._lastExecutedOrderLength === executedOrder.length
        ) {
            return this._execConnSet;
        }
        this._lastExecutedOrder = executedOrder;
        this._lastExecutedOrderLength = executedOrder.length;

        const executedSet = new Set(executedOrder);
        const connSet = new Set();
        for (const conn of this.connections) {
            if (!conn || !conn.source || !conn.target) continue;
            if (executedSet.has(conn.source) && executedSet.has(conn.target)) {
                connSet.add(conn.id);
            }
        }
        this._execConnSet = connSet;
        return connSet;
    }

    /**
     * Execution data for NodeConfigPanel.
     * Returns the unified progress or undefined.
     */
    get executionProp() {
        const execution = this.executionState;
        if (!execution || typeof execution !== "object") {
            return undefined;
        }
        return execution;
    }

    /**
     * Update readonly state at runtime
     * @param {boolean} nextReadonly
     */
    setReadonly(nextReadonly) {
        const value = !!nextReadonly;
        if (this.isEditorMode) {
            if (this.editorUiState.readonly === value) return;
        } else if (this.state.readonly === value) {
            return;
        }
        if (value) {
            // Cancel in-flight interactions before flipping readonly flag
            if (this.connectionDrawing && this.connectionDrawing.cancelConnection) {
                this.connectionDrawing.cancelConnection();
            }
            if (this.multiNodeDrag && this.multiNodeDrag.handleMouseUp) {
                this.multiNodeDrag.handleMouseUp({});
            }
            if (this.gestures && this.gestures.handleMouseUp) {
                this.gestures.handleMouseUp({});
            }
        }

        if (this.isEditorMode) {
            this.editor.actions.setReadonly(value);
        } else {
            this.state.readonly = value;
        }
    }

    // ========================================
    // UNIFIED STATE GETTERS
    // ========================================

    /**
     * Get graph state - from service (editor mode) or local state (widget mode)
     */
    get graphState() {
        if (this.isEditorMode) {
            return this.editorState.graph;
        }
        return this.state.graph;
    }

    /**
     * Get UI state - from service (editor mode) or local state (widget mode)
     * Use editorUiState for fail-first access in editor mode
     */
    get uiState() {
        if (this.isEditorMode) {
            return this.editorState.ui;
        }
        return this.state.ui;
    }

    /**
     * Get UI state with fail-first guarantee (editor mode only)
     * Throws if called outside editor mode or if state is missing
     */
    get editorUiState() {
        if (!this.isEditorMode) {
            throw new Error('[EditorCanvas] editorUiState requires editor mode');
        }
        const ui = this.editorState.ui;
        if (!ui) {
            throw new Error('[EditorCanvas] editor.state.ui is undefined');
        }
        return ui;
    }

    // ========================================
    // PROPS GETTERS (t-props pattern)
    // ========================================

    /**
     * Get callback props for ConnectionToolbar
     * @returns {Object} { onInsertNode, onHoverChange }
     */
    get connectionToolbarProps() {
        if (!this._connectionToolbarPropsCache) {
            this._connectionToolbarPropsCache = {
                onInsertNode: this.onConnectionAddNode.bind(this),
                onHoverChange: this.onToolbarHoverChange.bind(this),
            };
        }
        return this._connectionToolbarPropsCache;
    }

    get hoveredConnection() {
        // In editor mode, fail-first; in widget mode, safe default
        if (this.isEditorMode) {
            return this.editorUiState.hoveredConnection;
        }
        return this.state.ui.hoveredConnection;
    }

    /**
     * Active toolbar connection: hover takes priority, then single selected connection.
     * Recomputes screen position from canvas midpoint on every access so that
     * zoom/pan/resize automatically updates the toolbar position.
     */
    get toolbarConnection() {
        const hovered = this.hoveredConnection;
        if (hovered.id) return hovered;

        // Show toolbar for a single selected connection
        const selectedIds = this.selectedConnectionIds;
        if (selectedIds.length !== 1) return { id: null, midpoint: { x: 0, y: 0 }, canvasMidpoint: null };

        const connId = selectedIds[0];
        const conn = this.renderedConnections.find(c => c.id === connId);
        if (!conn) return { id: null, midpoint: { x: 0, y: 0 }, canvasMidpoint: null };

        const midpoint = this.getConnectionMidpoint(conn);
        const screenPos = this.getScreenPosition(midpoint.x, midpoint.y);
        return {
            id: connId,
            midpoint: screenPos,
            canvasMidpoint: midpoint,
        };
    }

    /**
     * Get callback props for NodeMenu
     * @returns {Object} { onNodeSelected, onClose }
     */
    get nodeMenuProps() {
        if (!this._nodeMenuPropsCache) {
            this._nodeMenuPropsCache = {
                onNodeSelected: this.onNodeMenuSelect.bind(this),
                onClose: this.onNodeMenuClose.bind(this),
            };
        }
        return this._nodeMenuPropsCache;
    }

    /**
     * Get all props for WorkflowNode component (t-props pattern)
     * @param {Object} node - Node data object
     * @returns {Object} Complete props for WorkflowNode
     */
    getWorkflowNodeProps(node) {
        const snappedSocket = this.canEdit
            ? this.connectionDrawing.state.snappedSocket
            : null;

        if (!this._nodeActionCallbacksCache) {
            this._nodeActionCallbacksCache = {
                onDragStart: (nodeId, event) => {
                    this.multiNodeDrag.onNodeDragStart({ nodeId, event });
                },
                onExecute: (nodeId) => {
                    this.onNodeOpenConfig(nodeId);
                },
                onSocketMouseDown: (data) => {
                    this.connectionDrawing.onSocketMouseDown(data);
                },
                onSocketMouseUp: (data) => {
                    this.connectionDrawing.onSocketMouseUp(data);
                },
                onSocketQuickAdd: (data) => {
                    this.onSocketQuickAdd(data);
                },
                onDelete: (nodeId) => {
                    this.onNodeDelete(nodeId);
                },
                onToggleDisable: (nodeId) => {
                    this.onNodeToggleDisable(nodeId);
                },
                onOpenConfig: (nodeId) => {
                    this.onNodeOpenConfig(nodeId);
                },
                onNodeDoubleClick: (nodeId) => {
                    this.onNodeDoubleClick(nodeId);
                },
                onExecuteFromNode: (nodeId) => {
                    this.onExecuteFromNode(nodeId);
                },
            };
        }

        const executionMap = this.nodeExecutionStatusMap;
        const props = {
            node,
            zoom: this.viewport.zoom,
            selected: this.selectionSet.has(node.id),
            executionStatus: executionMap.get(node.id) || null,
            snappedSocketKey: snappedSocket && snappedSocket.nodeId === node.id
                ? snappedSocket.socketKey
                : null,
            connectedOutputsSet: this.connectedOutputsSet,
            dimensionConfig: this.dimensions,
            readonly: !this.canEdit,
        };

        // Add callbacks only if editable
        if (this.canEdit) {
            props.onDragStart = this._nodeActionCallbacksCache.onDragStart;
            props.onExecute = this._nodeActionCallbacksCache.onExecute;
            props.onSocketMouseDown = this._nodeActionCallbacksCache.onSocketMouseDown;
            props.onSocketMouseUp = this._nodeActionCallbacksCache.onSocketMouseUp;
            props.onSocketQuickAdd = this._nodeActionCallbacksCache.onSocketQuickAdd;
            props.onDelete = this._nodeActionCallbacksCache.onDelete;
            props.onToggleDisable = this._nodeActionCallbacksCache.onToggleDisable;
            props.onOpenConfig = this._nodeActionCallbacksCache.onOpenConfig;
            props.onNodeDoubleClick = this._nodeActionCallbacksCache.onNodeDoubleClick;
            props.onExecuteFromNode = this._nodeActionCallbacksCache.onExecuteFromNode;
        }

        return props;
    }

    /**
    * Get DimensionConfig instance from the service (editor mode)
    * or a local widget-only cache (viewer mode).
     * @returns {DimensionConfig}
     */
    get dimensions() {
        if (this.isEditorMode) {
            const dimensionsState = this.editorState.dimensions;
            if (!dimensionsState || !dimensionsState.current) {
                throw new Error('[EditorCanvas] editor.state.dimensions.current is undefined');
            }
            return dimensionsState.current;
        }

        const currentConfig = this.props.dimensionConfig || {};
        if (this._dimensionsConfigSource !== currentConfig || !this._dimensionsCache) {
            this._dimensionsConfigSource = currentConfig;
            this._dimensionsCache = new DimensionConfig(currentConfig);
        }
        return this._dimensionsCache;
    }

    /**
     * Get nodes from graph state
     */
    get nodes() {
        const graph = this.graphState;
        return graph.nodes || [];
    }

    /**
     * Get connections from graph state
     */
    get connections() {
        const graph = this.graphState;
        return graph.connections || [];
    }

    /**
     * Get a Set of selected node IDs for efficient lookups
     */
    get selectionSet() {
        const selection = this.uiState.selection;
        const nodeIds = selection.nodeIds || [];
        if (this._selectionSetSource !== nodeIds) {
            this._selectionSetSource = nodeIds;
            this._selectionSetCache = new Set(nodeIds);
        }
        return this._selectionSetCache;
    }

    /**
     * Get selected connection IDs (for template binding)
     */
    get selectedConnectionIds() {
        const selection = this.uiState.selection;
        return selection.connectionIds || [];
    }

    /**
     * Pre-compute set of connected output sockets for O(1) lookup
     * Format: "nodeId:socketKey"
     * Used by WorkflowNode to show/hide quick-add buttons
     */
    get connectedOutputsSet() {
        const connections = this.connections;
        if (this._connectedOutputsSource !== connections) {
            this._connectedOutputsSource = connections;
            const connected = new Set();
            for (const connection of connections) {
                connected.add(`${connection.source}:${connection.sourceHandle}`);
            }
            this._connectedOutputsSetCache = connected;
        }

        return this._connectedOutputsSetCache;
    }

    /**
     * Get workflow data for NodeConfigPanel context aggregation
     */
    get workflowData() {
        return {
            nodes: this.nodes,
            connections: this.connections,
        };
    }

    /**
     * Get NodeMenu state
     * @returns {{ visible: boolean, x: number, y: number, canvasX: number, canvasY: number, variant: string, connectionContext: Object|null }}
     */
    get nodeMenu() {
        return this.uiState.nodeMenu;
    }

    /**
     * Get viewport from viewportHook (provides compatible panX/panY/zoom format)
     * Delegated to useViewport hook
     * @returns {{ zoom: number, panX: number, panY: number }}
     */
    get viewport() {
        return this.viewportHook.getViewport();
    }

    /**
     * Calculate viewport transform style
     * Delegated to useViewport hook
     */
    get viewportTransformStyle() {
        return this.viewportHook.getViewportTransformStyle();
    }

    /**
     * Get style for the parent canvas to sync background pattern with viewport
     * Delegated to useViewport hook
     */
    get canvasBackgroundStyle() {
        return this.viewportHook.getCanvasBackgroundStyle();
    }

    /**
     * Convert screen coordinates to canvas coordinates (accounting for zoom/pan)
     * Delegated to useViewport hook
     * @param {MouseEvent} ev
     * @returns {{ x: number, y: number }}
     */
    getCanvasPosition(ev) {
        return this.viewportHook.getCanvasPosition(ev);
    }

    /**
     * Convert canvas coordinates to screen coordinates (relative to canvas container)
     * Delegated to useViewport hook
     * @param {number} canvasX 
     * @param {number} canvasY 
     * @returns {{ x: number, y: number }}
     */
    getScreenPosition(canvasX, canvasY) {
        return this.viewportHook.getScreenPosition(canvasX, canvasY);
    }

    /**
     * Update visible viewport rectangle (canvas coordinates)
     * Delegated to useViewport hook
     */
    updateViewRect() {
        this.viewportHook.updateViewRect();
    }

    /**
     * Get nodes that are currently visible in the viewport
     * Delegated to connectionCulling hook
     * @returns {Array}
     */
    get visibleNodes() {
        return this.connectionCulling.visibleNodes;
    }

    /**
     * Handle wheel event for zoom
     * Delegated to useViewport hook
     * @param {WheelEvent} ev
     */
    onWheel(ev) {
        this.viewportHook.onWheel(ev);
        // Hide connection toolbar immediately — position would be stale after zoom
        this._dismissConnectionToolbar();
    }

    /**
     * Get zoom percentage for display
     * Delegated to useViewport hook
     */
    get zoomPercentage() {
        return this.viewportHook.getZoomPercentage();
    }

    /**
     * Zoom in by 10% (fixed step)
     * Delegated to useViewport hook
     */
    zoomIn() {
        this.viewportHook.zoomIn();
    }

    /**
     * Zoom out by 10% (fixed step)
     * Delegated to useViewport hook
     */
    zoomOut() {
        this.viewportHook.zoomOut();
    }

    /**
     * Reset zoom to 100% and pan to origin
     * Delegated to useViewport hook
     */
    resetZoom() {
        this.viewportHook.resetZoom();
    }

    /**
     * Fit all nodes into viewport with padding
     * Inspired by n8n/VueFlow fitView implementation
     */
    getFitTopOffsetPx() {
        const rootEl = this.rootRef.el;
        if (!rootEl) {
            return 0;
        }
        const controlsEl = rootEl.querySelector(".workflow-editor-canvas__controls");
        if (!controlsEl) {
            return 0;
        }
        const rootRect = rootEl.getBoundingClientRect();
        const controlsRect = controlsEl.getBoundingClientRect();
        // Leave a small visual gap below controls to avoid overlap.
        return Math.max(0, (controlsRect.bottom - rootRect.top) + 12);
    }

    /**
     * Adaptive rank separation for fit-height layout.
     * Keeps current 1/2-gap behavior on small graphs, and compresses
     * vertical spacing progressively for larger workflows.
     * @returns {number}
     */
    getAdaptiveFitHeightRanksep() {
        const nodeCount = this.nodes.length;
        if (nodeCount <= 6) {
            return 40;
        }
        if (nodeCount <= 12) {
            return 32;
        }
        if (nodeCount <= 20) {
            return 24;
        }
        return 20;
    }

    /**
     * Fit all nodes into viewport with padding
     * Logic extracted to utils/view_utils.js
     * Works in both editor and viewer modes via viewportHook
     */
    fitToView(options = {}) {
        this.closeFitMenu();
        const fitOptions = {
            ...options,
            topOffsetPx: options.topOffsetPx !== undefined
                ? options.topOffsetPx
                : this.getFitTopOffsetPx(),
        };
        this.viewportHook.fitToView(this.nodes, fitOptions);
    }

    get isFitMenuOpen() {
        return !!this.localUi.fitMenuOpen;
    }

    toggleFitMenu(ev) {
        if (ev) {
            ev.preventDefault();
            ev.stopPropagation();
        }
        if (this.isReadonly || this.nodes.length === 0) {
            return;
        }
        this.localUi.fitMenuOpen = !this.localUi.fitMenuOpen;
    }

    closeFitMenu() {
        if (this.localUi.fitMenuOpen) {
            this.localUi.fitMenuOpen = false;
        }
    }

    onFitMenuAction(mode, ev) {
        if (ev) {
            ev.preventDefault();
            ev.stopPropagation();
        }

        if (mode === "full-height") {
            this.fitFullHeight();
            return;
        }
        this.fitFullWidth();
    }

    fitFullWidth() {
        if (!this.canEdit) return;
        this.closeFitMenu();
        this.tidyUp({
            orientation: "horizontal",
            label: "Auto layout (horizontal) + fit full width",
        });
        this.fitToView({ mode: "cover-width" });
    }

    fitFullHeight() {
        if (!this.canEdit) return;
        this.closeFitMenu();
        const adaptiveRanksep = this.getAdaptiveFitHeightRanksep();
        this.tidyUp({
            orientation: "vertical",
            ranksep: adaptiveRanksep,
            label: "Auto layout (vertical) + fit full height",
        });
        this.fitToView({ mode: "cover-height" });
    }

    // =========================================
    // Tidy Up: Auto-Layout
    // =========================================

    /**
     * Auto-arrange nodes using Dagre.js layout algorithm
     * Uses pure util for position calculation, service actions for mutations.
     * Wrapped in batch for single undo/redo step.
     */
    tidyUp(options = {}) {
        if (!this.canEdit) return;
        if (this.nodes.length === 0) return;

        const orientation = options.orientation === "vertical" ? "vertical" : "horizontal";
        const ranksep = typeof options.ranksep === "number" ? options.ranksep : undefined;
        const label = options.label
            || (orientation === "vertical" ? "Tidy up layout (vertical)" : "Tidy up layout");

        // Calculate new positions using pure utility (no side effects)
        const positions = calculateTidyPositions(this.nodes, this.connections, {
            orientation,
            ranksep,
        });

        // Apply positions via service actions (wrapped in batch for single undo)
        this.editor.actions.beginBatch();
        for (const node of this.nodes) {
            const pos = positions[node.id];
            if (pos) {
                this.editor.actions.moveNode(node.id, { x: pos.x, y: pos.y });
            }
        }
        this.editor.actions.endBatch(label);
    }

    /**
     * Get CSS style for selection box (delegates to gestures hook)
     */
    get selectionBoxStyle() {
        return this.gestures.getSelectionBoxStyle();
    }

    /**
     * Clear all node/connection selections
     */
    clearSelection() {
        if (!this.canEdit) return;
        this.editor.actions.select([], []);
    }

    /**
     * Calculate connection path(s) based on positions
     * Unified method used by both renderedConnections and tempConnectionPath
     * @param {{ x: number, y: number }} sourcePos
     * @param {{ x: number, y: number }} targetPos
     * @returns {{ paths: string[], isBackEdge: boolean, isVerticalStack: boolean }}
     */
    getConnectionPath(sourcePos, targetPos) {
        const connectionType = detectConnectionType(sourcePos, targetPos);
        return calculateConnectionPath(sourcePos, targetPos, connectionType);
    }

    /**
     * Calculate socket position based on node position and socket type
     * Uses centralized DimensionConfig for consistency
     * @param {Object} node - Node object with x, y
     * @param {string} socketKey - Socket key (e.g., "response", "data")
     * @param {string} socketType - "input" or "output"
     * @returns {{ x: number, y: number }}
     */
    getSocketPositionForNode(node, socketKey, socketType) {
        return this.dimensions.getSocketPosition(node, socketKey, socketType);
    }

    /**
     * Get connections with calculated paths for SVG rendering
     * Delegated to connectionCulling hook (includes memoization)
     */
    get renderedConnections() {
        return this.connectionCulling.renderedConnections;
    }

    /**
     * Check if currently drawing a connection (for template reactivity)
     */
    get isDrawingConnection() {
        return this.connectionDrawing.state.isConnecting;
    }

    /**
     * Get temp connection path while drawing
     * Returns empty string if not drawing
     * Uses unified getConnectionPath for consistency with renderedConnections
     */
    get tempConnectionPath() {
        const connState = this.connectionDrawing.state;
        if (!connState.isConnecting || !connState.connectionStart || !connState.tempLineEndpoint) {
            return '';
        }

        const { nodeId, socketKey, socketType } = connState.connectionStart;
        const node = this.nodes.find(n => n.id === nodeId);
        if (!node) return '';

        const startPos = this.getSocketPositionForNode(node, socketKey, socketType);

        // Smart snapping: use snapped socket position if available
        const endPos = connState.snappedSocket
            ? { x: connState.snappedSocket.x, y: connState.snappedSocket.y }
            : connState.tempLineEndpoint;

        // Determine source/target based on socket type
        const sourcePos = socketType === 'output' ? startPos : endPos;
        const targetPos = socketType === 'output' ? endPos : startPos;

        const { paths } = this.getConnectionPath(sourcePos, targetPos);
        return paths.join(' ');
    }

    // Connection drawing methods now handled by useConnectionDrawing hook
    // Keeping findNearestSocket for backward compatibility with hook dependency
    // (hook receives getSocketPositionForNode which uses this internally)

    /**
     * Close fit dropdown when clicking outside.
     * @param {MouseEvent} ev
     */
    onDocumentMouseDown(ev) {
        if (!this.isFitMenuOpen) {
            return;
        }
        const target = ev.target;
        if (target && target.closest && target.closest(".fit-view-dropdown")) {
            return;
        }
        this.closeFitMenu();
    }

    /**
     * @param {MouseEvent} ev
     */
    onDocumentMouseMove(ev) {
        if (this.isReadonly) return;
        if (this._mouseMoveFrame) return;

        this._mouseMoveFrame = requestAnimationFrame(() => {
            this._mouseMoveFrame = null;

            // Delegate pan/selection to gestures hook
            if (this.gestures.handleMouseMove(ev)) {
                return;
            }

            // Delegate multi-node drag to hook
            if (this.multiNodeDrag.handleMouseMove(ev)) {
                return;
            }

            // Delegate connection drawing to hook
            this.connectionDrawing.handleMouseMove(ev);
        });
    }

    /**
     * @param {MouseEvent} ev
     */
    onDocumentMouseUp(ev) {
        // Delegate pan/selection end to gestures hook
        if (this.isReadonly) return;
        const gestureType = this.gestures.handleMouseUp(ev);
        if (gestureType) {
            // If selection box just completed, set flag to prevent click from clearing
            if (gestureType === 'selection') {
                this._justCompletedSelection = true;
                if (this._justCompletedSelectionTimeout) {
                    clearTimeout(this._justCompletedSelectionTimeout);
                }
                this._justCompletedSelectionTimeout = setTimeout(() => {
                    this._justCompletedSelection = false;
                    this._justCompletedSelectionTimeout = null;
                }, 0);
            }
            return;
        }

        // Delegate multi-node drag end to hook
        if (this.multiNodeDrag.handleMouseUp(ev)) {
            return;
        }

        // Delegate connection drawing end to hook
        const rootEl = this.rootRef.el;
        const canvasRect = rootEl ? rootEl.getBoundingClientRect() : { left: 0, top: 0 };
        this.connectionDrawing.handleCanvasMouseUp(ev, canvasRect);
    }

    /**
     * Handle drag over for palette drops
     * @param {DragEvent} ev 
     */
    onDragOver(ev) {
        if (this.isReadonly) return;
        if (!this.canEdit) return;
        ev.preventDefault();
        if (ev.dataTransfer) ev.dataTransfer.dropEffect = "copy";
    }

    /**
     * Handle drop from node palette
     * @param {DragEvent} ev 
     */
    onDrop(ev) {
        if (this.isReadonly) return;
        if (!this.canEdit) return;
        ev.preventDefault();
        const dataTransfer = ev.dataTransfer;
        const type = dataTransfer ? dataTransfer.getData("application/x-workflow-node") : "";
        if (!type) return;

        // Use canvas position (accounts for zoom/pan)
        const position = this.getCanvasPosition(ev);
        position.x = Math.round(position.x);
        position.y = Math.round(position.y);
        // Add node via service action
        this.editor.actions.addNode(type, position);
    }

    /**
     * Handle node selection
     * Supports Ctrl+click for multi-select
     * @param {Object} node 
     * @param {MouseEvent} [event] - Mouse event for checking Ctrl key
     */
    onNodeSelect(node, event) {
        if (this.isReadonly) return;
        if (!this.canEdit) return;
        const isCtrlHeld = !!event && (event.ctrlKey || event.metaKey);
        const currentSelection = this.editorUiState.selection.nodeIds || [];

        if (isCtrlHeld) {
            // Ctrl+click: Toggle node in selection
            if (currentSelection.includes(node.id)) {
                this.editor.actions.select(
                    currentSelection.filter(id => id !== node.id)
                );
            } else {
                this.editor.actions.select([...currentSelection, node.id]);
            }
        } else {
            // Normal click: Clear and add single
            this.editor.actions.select([node.id]);
        }

        // Connection selection is cleared by select() action via service
    }

    onNodeOpenConfig(nodeId) {
        if (!this.canEdit && !this.isInExecutionView) return;
        const node = this.nodes.find(n => n.id === nodeId);
        if (!node) return;

        // Open config panel via service
        this.editor.actions.openPanel("config", { nodeId });
    }

    /**
     * Execute the workflow starting only from a specific manual trigger node.
     */
    async onExecuteFromNode(nodeId) {
        if (this.isReadonly) return;
        if (!this.isEditorMode) return;
        await this.editor.executeFromNode(nodeId);
    }

    onNodeExecute(nodeId) {
        if (this.isReadonly) return;
        if (!this.canEdit) return;
        const node = this.nodes.find(n => n.id === nodeId);
        if (!node) return;

        // Open config panel via service
        this.editor.actions.openPanel("config", { nodeId });
    }

    onNodeDelete(nodeId) {
        if (this.isReadonly) return;
        if (!this.canEdit) return;

        // Capture connections before removal for auto-reconnect (A→B, B→C → A→C)
        const incoming = this.connections.filter(c => c.target === nodeId);
        const outgoing = this.connections.filter(c => c.source === nodeId);

        this.editor.actions.removeNode(nodeId);

        // Deselect if it was the only one or among selected
        const current = this.editorUiState.selection.nodeIds;
        if (current.includes(nodeId)) {
            this.editor.actions.select(current.filter(id => id !== nodeId));
        }

        // Auto-reconnect: bridge each incoming→outgoing pair
        for (const inc of incoming) {
            for (const out of outgoing) {
                if (inc.source === out.target) continue; // skip self-loops
                this.editor.actions.addConnection(
                    inc.source, inc.sourceHandle, out.target, out.targetHandle
                );
            }
        }
    }

    /**
     * Handle node disable/enable toggle from toolbar
     * @param {string} nodeId 
     */
    onNodeToggleDisable(nodeId) {
        if (this.isReadonly) return;
        if (!this.canEdit) return;
        // Find node and toggle disabled state
        const node = this.nodes.find(n => n.id === nodeId);
        if (!node) return;

        // Toggle the disabled flag (will be handled by updateNode prop if available)
        // For now, just log - actual implementation depends on parent component
        console.log(`[EditorCanvas] Toggle disable for node: ${nodeId}, was disabled: ${node.disabled}`);

        // This would typically be handled via props.updateNode callback
        // For now, we emit a change via the standard position change mechanism
        // or implement a dedicated onNodeUpdate prop
    }


    /**
     * Deselect when clicking on canvas background
     * @param {MouseEvent} ev 
     */
    onCanvasClick(ev) {
        // Skip if we just finished a selection drag (click fires after mouseup)
        if (this._justCompletedSelection) {
            return;
        }
        // Check if clicking on background (including specific elements that are part of background)
        const target = ev.target;
        const targetClassList = target && target.classList ? target.classList : null;
        if (target === this.rootRef.el || (targetClassList && targetClassList.contains('workflow-editor-canvas__content'))) {
            this.clearSelection();
        }
    }

    /**
     * Handle connection selection
     * @param {string} connId 
     */
    onConnectionSelect(connId) {
        if (this.isReadonly) return;
        if (!this.canEdit) return;
        // Select only this connection (clear node selection)
        this.editor.actions.select([], [connId]);
    }

    /**
     * Check if a connection is part of the execution path
     * @param {string} connId - Connection ID
     * @returns {boolean}
     */
    isConnectionExecuted(connId) {
        return this.executedConnectionIds.has(connId);
    }

    /**
     * Check if node is selected
     * Uses Set for O(1) lookup instead of Array.includes O(n)
     * @param {Object} node 
     * @returns {boolean}
     */
    isNodeSelected(node) {
        return this.selectionSet.has(node.id);
    }

    /**
     * Handle canvas mousedown - start pan or selection (delegates to gestures hook)
     * @param {MouseEvent} ev
     */
    onCanvasMouseDown(ev) {
        // Hide connection toolbar immediately when starting pan/selection
        this._dismissConnectionToolbar();
        this.gestures.onCanvasMouseDown(ev);
    }

    /**
     * Handle right-click on canvas to open NodeMenu
     * Uses service action (source of truth)
     */
    onCanvasContextMenu(ev) {
        if (this.isReadonly) return;
        if (!this.canEdit) return;

        const target = ev.target;
        const rootEl = this.rootRef.el;
        const contentEl = this.contentRef.el;
        const svgEl = rootEl.querySelector('.workflow-connections');
        const isCanvasBackground = target === rootEl || target === contentEl || target === svgEl;
        if (!isCanvasBackground) return;

        ev.preventDefault();
        const rect = rootEl.getBoundingClientRect();
        const canvasPos = this.getCanvasPosition(ev);

        this.editor.actions.openNodeMenu({
            x: ev.clientX - rect.left,
            y: ev.clientY - rect.top,
            canvasX: canvasPos.x,
            canvasY: canvasPos.y,
            variant: 'default',
            connectionContext: null,
        });
    }

    /**
     * Handle NodeMenu selection
     */
    onNodeMenuSelect(nodeType, connectionContext) {
        if (this.isReadonly) return;
        if (!this.canEdit) return;
        let { canvasX, canvasY } = this.nodeMenu;
        const dims = this.dimensions;

        // Final position for node placement
        let position = {
            x: canvasX - dims.nodeWidth / 2,
            y: canvasY
        };

        const context = connectionContext || null;
        if (context && (context.type === 'quickAdd' || context.type === 'dragConnect')) {
            // Quick-add from socket OR drag-connect from canvas:
            // Create node and auto-connect from source socket
            const { sourceNodeId, sourceSocketKey } = context;
            const newNodeId = this.editor.actions.addNode(nodeType, position);

            if (newNodeId) {
                // Use setTimeout to ensure node is in state
                if (this._deferredInsertNodeTimeout) {
                    clearTimeout(this._deferredInsertNodeTimeout);
                }
                this._deferredInsertNodeTimeout = setTimeout(() => {
                    const newNode = this.nodes.find(n => n.id === newNodeId);
                    if (!newNode) return;
                    const newInputs = newNode.inputs || {};
                    const firstInputKey = Object.keys(newInputs)[0];

                    if (firstInputKey) {
                        this.editor.actions.addConnection(
                            sourceNodeId,
                            sourceSocketKey,
                            newNodeId,
                            firstInputKey
                        );
                    }
                    this._deferredInsertNodeTimeout = null;
                }, 0);
            }
        } else if (context && context.connectionId) {
            // Inserting node into existing connection
            this._insertNodeIntoConnection(nodeType, { connectionId: context.connectionId, position });
        } else {
            // Adding new node at position
            this.editor.actions.addNode(nodeType, position);
        }
    }

    /**
     * Close NodeMenu
     * Uses service action (source of truth)
     */
    onNodeMenuClose() {
        if (this.isReadonly) return;
        if (!this.canEdit) return;
        // Cancel any pending connection drawing from drag-connect flow
        this.connectionDrawing.cancelConnection();

        // Close menu via service action
        this.editor.actions.closeNodeMenu();
    }

    /**
     * Handle connection mouseenter - calculates midpoint only on actual event
     * (Performance optimization: avoids calculating midpoint on every render)
     * @param {MouseEvent} ev
     * @param {Object} conn - Connection object from renderedConnections
     */
    handleConnectionEnter(ev, conn) {
        if (this.isReadonly) return;
        if (!this.canEdit) return;
        // Clear any pending leave timeout
        if (this._connectionHoverTimeout) {
            clearTimeout(this._connectionHoverTimeout);
            this._connectionHoverTimeout = null;
        }

        // Mark that we're hovering connection
        this._isHoveringConnection = true;

        // Only update if connection changed (debounce rapid hovers)
        if (this.hoveredConnection.id === conn.id) return;

        const midpoint = this.getConnectionMidpoint(conn);
        const screenPos = this.getScreenPosition(midpoint.x, midpoint.y);

        this.editor.actions.setHoveredConnection({
            id: conn.id,
            midpoint: screenPos,
            canvasMidpoint: midpoint,
        });
    }

    /**
     * Handle connection hover - show toolbar (legacy, kept for compatibility)
     */
    onConnectionMouseEnter(connectionId, midpoint) {
        if (this.isReadonly) return;
        if (!this.canEdit) return;
        this.editor.actions.setHoveredConnection({
            id: connectionId,
            midpoint,
        });
    }

    /**
     * Immediately dismiss connection toolbar (zoom / pan / resize invalidates position)
     */
    _dismissConnectionToolbar() {
        if (this._connectionHoverTimeout) {
            clearTimeout(this._connectionHoverTimeout);
            this._connectionHoverTimeout = null;
        }
        this._isHoveringConnection = false;
        this._isHoveringToolbar = false;
        if (this.editor && this.hoveredConnection.id) {
            this.editor.actions.setHoveredConnection();
        }
    }

    /**
     * Handle connection hover end - schedule potential hide
     * Toolbar persists while user is in hover zone
     */
    onConnectionMouseLeave() {
        if (!this.canEdit) return;

        // Don't hide immediately - user may be moving to toolbar
        // Toolbar will hide when:
        // 1. User hovers a different connection (handleConnectionEnter clears old one)
        // 2. User leaves toolbar (onToolbarHoverChange handles this)
        // 3. User clicks elsewhere on canvas (handled by canvas click)

        // Only set a long timeout as fallback safety net
        if (this._connectionHoverTimeout) {
            clearTimeout(this._connectionHoverTimeout);
        }

        this._connectionHoverTimeout = setTimeout(() => {
            // After 500ms, check if user is still engaged with toolbar
            if (this._isHoveringToolbar) {
                return; // User is on toolbar, don't hide
            }
            // Check if mouse is still reasonably close to canvas
            // If toolbar still exists and user is engaged, don't hide
            if (document.querySelector('.connection-toolbar:hover')) {
                return;
            }
            this.editor.actions.setHoveredConnection();
            this._connectionHoverTimeout = null;
        }, 100);
    }

    /**
     * Handle toolbar hover state
     * Simply prevents hide when hovering, allows hide when leaving
     */
    onToolbarHoverChange(isHovering) {
        if (!this.canEdit) return;
        this._isHoveringToolbar = isHovering;

        if (isHovering) {
            // Cancel any pending hide when entering toolbar
            if (this._connectionHoverTimeout) {
                clearTimeout(this._connectionHoverTimeout);
                this._connectionHoverTimeout = null;
            }
        } else {
            // When leaving toolbar, start hide timeout
            // If user moves to connection, handleConnectionEnter will cancel it
            if (this._connectionHoverTimeout) {
                clearTimeout(this._connectionHoverTimeout);
            }
            this._connectionHoverTimeout = setTimeout(() => {
                if (!this._isHoveringToolbar) {
                    this.editor.actions.setHoveredConnection();
                }
                this._connectionHoverTimeout = null;
            }, 100);
        }
    }

    /**
     * Handle "Add Node" from connection toolbar
     */
    onConnectionAddNode(connectionId, position) {
        if (!this.canEdit) return;
        // position here is the screen-relative midpoint from toolbarConnection
        // We use the stored canvasMidpoint for the actual node placement
        let canvasPos = this.toolbarConnection.canvasMidpoint;
        if (!canvasPos) {
            const rect = this.rootRef.el.getBoundingClientRect();
            canvasPos = this.viewportHook.getCanvasPosition({
                clientX: rect.left + position.x,
                clientY: rect.top + position.y,
            });
        }

        this.editor.actions.openNodeMenu({
            visible: true,
            x: position.x,
            y: position.y,
            canvasX: canvasPos.x,
            canvasY: canvasPos.y,
            variant: 'default',
            connectionContext: { connectionId, position: canvasPos },
        });
    }

    /**
     * Insert a new node into an existing connection
     * 
     * Logic: When inserting C into A→B connection:
     * 1. Create new node C at position
     * 2. Remove old connection A→B
     * 3. Create new connection A→C (source's output → new node's first input)
     * 4. Create new connection C→B (new node's first output → original target's input)
     */
    _insertNodeIntoConnection(nodeType, context) {
        if (!this.canEdit) return;
        const { connectionId, position } = context;
        const conn = this.connections.find(c => c.id === connectionId);
        if (!conn) return;

        // Remember original connection details before removing
        const originalSource = conn.source;
        const originalSourceHandle = conn.sourceHandle;
        const originalTarget = conn.target;
        const originalTargetHandle = conn.targetHandle;

        // 1. Create new node at position
        const newNodeId = this.editor.actions.addNode(nodeType, position);
        if (!newNodeId) return;

        // 2. Remove old connection A→B
        this.editor.actions.removeConnection(connectionId);

        // 3. Use setTimeout to ensure the new node is available in state
        if (this._deferredConnectTimeout) {
            clearTimeout(this._deferredConnectTimeout);
        }
        this._deferredConnectTimeout = setTimeout(() => {
            const newNode = this.nodes.find(n => n.id === newNodeId);
            if (!newNode) return;

            const newNodeInputKey = Object.keys(newNode.inputs || {})[0];
            const newNodeOutputKey = Object.keys(newNode.outputs || {})[0];

            if (!newNodeInputKey) return;

            // 3. Create connection from old source to new node (A→C)
            this.editor.actions.addConnection(
                originalSource,
                originalSourceHandle,
                newNodeId,
                newNodeInputKey
            );

            // 4. Create connection from new node to original target (C→B)
            if (newNodeOutputKey) {
                this.editor.actions.addConnection(
                    newNodeId,
                    newNodeOutputKey,
                    originalTarget,
                    originalTargetHandle
                );
            }
            this._deferredConnectTimeout = null;
        }, 0);
    }

    /**
     * Calculate connection midpoint for toolbar positioning
     */
    getConnectionMidpoint(conn) {
        // For multi-path connections (backedge, vertical stack), the join point
        // is precomputed by getConnectionPath and stored on the conn object.
        if (conn.midpoint) {
            return conn.midpoint;
        }

        // Forward bezier: simple socket average is visually close enough.
        const sourceNode = this.nodes.find(n => n.id === conn.source);
        const targetNode = this.nodes.find(n => n.id === conn.target);
        if (!sourceNode || !targetNode) return { x: 0, y: 0 };

        const sourcePos = this.getSocketPositionForNode(sourceNode, conn.sourceHandle, 'output');
        const targetPos = this.getSocketPositionForNode(targetNode, conn.targetHandle, 'input');

        return {
            x: (sourcePos.x + targetPos.x) / 2,
            y: (sourcePos.y + targetPos.y) / 2,
        };
    }

    /**
     * Remove connection by ID (used by ConnectionToolbar)
     */
    removeConnectionById(connectionId) {
        if (!this.canEdit) return;
        this.editor.actions.removeConnection(connectionId);
        this.editor.actions.setHoveredConnection();
    }

    /**
     * Handle "+ Node" button click from toolbar
     */
    onAddNodeClick(ev) {
        if (!this.canEdit) return;
        const rect = this.rootRef.el.getBoundingClientRect();
        const btnRect = ev.currentTarget.getBoundingClientRect();

        // Position below the button (dropdown style)
        const x = btnRect.left - rect.left;
        const y = btnRect.bottom - rect.top + 8; // 8px gap

        // Center of viewport for the node itself to be dropped
        const canvasPos = this.getCanvasPosition({
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2
        });

        this.editor.actions.openNodeMenu({
            x,
            y,
            canvasX: canvasPos.x,
            canvasY: canvasPos.y,
            variant: 'large',
            connectionContext: null,
        });
    }

    /**
     * Handle quick-add button click on unconnected output sockets
     * Opens NodeMenu and auto-connects new node to clicked socket
     */
    onSocketQuickAdd = ({ nodeId, socketKey, event }) => {
        if (!this.canEdit) return;
        const node = this.nodes.find(n => n.id === nodeId);
        if (!node) return;

        // Get socket position for menu placement
        const socketPos = this.getSocketPositionForNode(node, socketKey, 'output');
        const screenPos = this.getScreenPosition(socketPos.x, socketPos.y);
        const rect = this.rootRef.el.getBoundingClientRect();

        this.editor.actions.openNodeMenu({
            x: screenPos.x + 30,  // Offset from socket
            y: screenPos.y - 100, // Position above socket
            canvasX: socketPos.x + 150,  // Where new node will be placed (right of socket)
            canvasY: socketPos.y - 20,   // Slightly above
            variant: 'default',
            // Context for auto-connection
            connectionContext: {
                type: 'quickAdd',
                sourceNodeId: nodeId,
                sourceSocketKey: socketKey,
            },
        });
    };

    _removeActiveConfigDialog() {
        if (!this._removeConfigPanelDialog) {
            return;
        }
        const removeDialog = this._removeConfigPanelDialog;
        this._removeConfigPanelDialog = null;
        this._configPanelDialogNodeId = null;
        this._isProgrammaticDialogClose = true;
        removeDialog();
        this._isProgrammaticDialogClose = false;
    }

    _syncConfigPanelDialog() {
        if (!this.isEditorMode || !this.dialogService) {
            return;
        }

        const node = this.configPanelNode;
        const shouldOpen = !!(this.isConfigPanelOpen && node);
        if (!shouldOpen) {
            this._removeActiveConfigDialog();
            return;
        }

        if (this._removeConfigPanelDialog && this._configPanelDialogNodeId === node.id) {
            return;
        }

        this._removeActiveConfigDialog();
        this._configPanelDialogNodeId = node.id;
        this._removeConfigPanelDialog = this.dialogService.add(
            ConfigPanelDialog,
            {
                node,
                workflow: this.workflowData,
                actions: this.nodeConfigActions,
                execution: this.executionProp,
                viewMode: this.configPanelViewMode,
                onSave: this.onConfigPanelSave,
            },
            {
                onClose: () => {
                    this._removeConfigPanelDialog = null;
                    this._configPanelDialogNodeId = null;
                    if (!this._isProgrammaticDialogClose && this.uiState.panels.configOpen) {
                        this.editor.actions.closePanel("config");
                    }
                }
            }
        );
    }

    // ============================================
    // CONFIG PANEL HANDLERS
    // ============================================

    /**
     * Handle double-click on node to open config panel (via service action).
     * Also allowed in execution view mode to view I/O data.
     */
    onNodeDoubleClick = (nodeId) => {
        if (!this.canEdit && !this.isInExecutionView) return;
        this.onNodeOpenConfig(nodeId);
    };

    /**
     * Check if config panel is open
     */
    get isConfigPanelOpen() {
        return this.uiState.panels.configOpen || false;
    }

    /**
     * Whether we are currently viewing a past execution run.
     */
    get isInExecutionView() {
        const executionView = this.editorUiState && this.editorUiState.executionView;
        return !!(executionView && executionView.active);
    }

    /**
     * View mode for NodeConfigPanel: 'execution' when viewing a run, 'edit' otherwise.
     */
    get configPanelViewMode() {
        return this.isInExecutionView ? 'execution' : 'edit';
    }

    /**
     * Get the node currently being configured
     */
    get configPanelNode() {
        const nodeId = this.uiState.panels.configNodeId;
        if (!nodeId) return null;
        return this.nodes.find(n => n.id === nodeId) || null;
    }

    /**
     * Close config panel (via service action)
     */
    onConfigPanelClose = () => {
        if (!this.canEdit && !this.isInExecutionView) return;
        this.editor.actions.closePanel("config");
        this._removeActiveConfigDialog();
    };

    /**
     * Save config panel changes
     * If auto_save is enabled, triggers workflow save via bus
     */
    onConfigPanelSave = (values) => {
        if (!this.canEdit) return;
        const nodeId = this.uiState.panels.configNodeId;
        if (!nodeId) return;
        this.onConfigPanelClose();
        // Trigger workflow save if auto_save is enabled
        if (this.editor.getAutoSave()) {
            this.env.bus.trigger("save");
        }
    };

    // ============================================
    // UNDO/REDO
    // ============================================

    /**
     * Check if undo is available
     */
    get canUndo() {
        return this.uiState.history.canUndo || false;
    }

    /**
     * Check if redo is available
     */
    get canRedo() {
        return this.uiState.history.canRedo || false;
    }

    get hasCanvasActions() {
        return this.isEditorMode;
    }

    get isSaving() {
        return this.isEditorMode ? this.editorState.ui.saving : false;
    }

    get isExecuting() {
        return this.isEditorMode ? this.editorState.ui.executing : false;
    }

    get fitMenuItems() {
        return [
            {
                key: "fit-full-width",
                icon: "icon-arrow-left-right",
                label: "Fit Full Width",
                callback: (ev) => this.onFitMenuAction("full-width", ev),
            },
            {
                key: "fit-full-height",
                icon: "icon-arrow-up-down",
                label: "Fit Full Height",
                callback: (ev) => this.onFitMenuAction("full-height", ev),
            },
        ];
    }

    /**
     * Handle undo button click
     */
    onUndo = () => {
        if (!this.canEdit) return;
        this.editor.actions.undo();
    };

    /**
     * Handle redo button click
     */
    onRedo = () => {
        if (!this.canEdit) return;
        this.editor.actions.redo();
    };

    onCopyToEditor = () => {
        if (!this.isEditorMode) return;
        this.editor.copyExecutionToEditor();
    };

    /**
     * Get button definitions for the controls bar
     * Returns array of button config objects with properties:
     * - name: unique identifier
     * - label: display text
     * - icon: lucide font class name (e.g., 'icon-save')
     * - callback: handler function
     * - visible: boolean or getter function
     * - disabled: boolean or getter function
     * - title: tooltip text
     * - classes: CSS classes
     * - divider: insert divider after this button
     */
    getButtons() {
        const buttons = [];

        // Canvas Actions Group (save/run)
        if (this.hasCanvasActions) {
            buttons.push(
                {
                    name: 'save',
                    label: 'Save',
                    icon: 'icon-save',
                    callback: () => this.onSave(),
                    visible: true,
                    disabled: this.isSaving || this.isExecuting || this.isReadonly,
                    classes: 'btn btn-primary btn-sm d-inline-flex align-items-center gap-1',
                },
                {
                    name: 'run',
                    label: 'Run',
                    icon: 'icon-play',
                    callback: () => this.onRun(),
                    visible: true,
                    disabled: this.isExecuting || this.isSaving || this.isReadonly,
                    classes: 'btn btn-success btn-sm d-inline-flex align-items-center gap-1',
                }
            );
            if (this.isInExecutionView) {
                buttons.push({
                    name: 'copy-to-editor',
                    label: 'Copy To Editor',
                    icon: 'icon-copy',
                    callback: () => this.onCopyToEditor(),
                    visible: true,
                    disabled: !this.executionState,
                    classes: 'btn btn-warning btn-sm d-inline-flex align-items-center gap-1',
                });
            }
            buttons.push({ name: 'divider-1', divider: true });
        }

        // Edit Actions Group (undo/redo)
        if (!this.isReadonly) {
            buttons.push(
                {
                    name: 'undo',
                    icon: 'icon-undo-2',
                    callback: () => this.onUndo(),
                    visible: true,
                    disabled: !this.canUndo,
                    title: 'Undo (Ctrl+Z)',
                    classes: 'btn btn-light d-inline-flex',
                },
                {
                    name: 'redo',
                    icon: 'icon-redo-2',
                    callback: () => this.onRedo(),
                    visible: true,
                    disabled: !this.canRedo,
                    title: 'Redo (Ctrl+Y)',
                    classes: 'btn btn-light d-inline-flex',
                }
            );
            buttons.push({ name: 'divider-2', divider: true });

            // Node Management Group
            buttons.push(
                {
                    name: 'tidyup',
                    icon: 'icon-sparkles',
                    callback: () => this.tidyUp(),
                    visible: true,
                    disabled: this.nodes.length === 0,
                    title: 'Tidy Up',
                    classes: 'btn btn-light d-inline-flex',
                },
                {
                    name: 'add-node',
                    icon: 'icon-plus',
                    label: 'Node',
                    callback: (ev) => this.onAddNodeClick(ev),
                    visible: true,
                    disabled: false,
                    title: 'Add Node',
                    classes: 'btn btn-primary btn-sm',
                }
            );
            buttons.push({ name: 'divider-3', divider: true });
        }

        // View Control Group (always available)
        buttons.push(
            {
                name: 'fit-view',
                icon: 'icon-maximize',
                callback: () => this.fitToView(),
                visible: true,
                disabled: this.nodes.length === 0,
                title: 'Fit to View',
                classes: 'btn btn-light d-inline-flex',
                menu: {
                    open: this.isFitMenuOpen,
                    disabled: this.isReadonly || this.nodes.length === 0,
                    toggle: (ev) => this.toggleFitMenu(ev),
                    items: this.fitMenuItems,
                },
            },
            {
                name: 'zoom-out',
                icon: 'icon-minus',
                callback: () => this.zoomOut(),
                visible: true,
                disabled: false,
                title: 'Zoom Out',
                classes: 'btn btn-light d-inline-flex',
            },
            {
                name: 'zoom-in',
                icon: 'icon-plus',
                callback: () => this.zoomIn(),
                visible: true,
                disabled: false,
                title: 'Zoom In',
                classes: 'btn btn-light d-inline-flex',
            },
            {
                name: 'reset-zoom',
                icon: 'icon-refresh-cw',
                callback: () => this.resetZoom(),
                visible: true,
                disabled: false,
                title: 'Reset View',
                classes: 'btn btn-light d-inline-flex',
            }
        );

        return buttons.filter(btn => !btn.divider && btn.visible);
    }

    /**
     * Get button dividers for grouping
     * Returns divider positions based on button list
     */
    getButtonDividers() {
        const allButtons = this.getButtonsWithDividers();
        return allButtons.filter(btn => btn.divider);
    }

    /**
     * Get buttons including dividers
     * Helper for template that needs to render dividers
     */
    getButtonsWithDividers() {
        const buttons = [];

        // Canvas Actions Group (save/run)
        if (this.hasCanvasActions) {
            buttons.push(
                {
                    name: 'save',
                    label: 'Save',
                    icon: 'icon-save',
                    callback: () => this.onSave(),
                    visible: true,
                    disabled: this.isSaving || this.isExecuting || this.isReadonly,
                    classes: 'btn btn-primary btn-sm d-inline-flex align-items-center gap-1',
                },
                {
                    name: 'run',
                    label: 'Run',
                    icon: 'icon-play',
                    callback: () => this.onRun(),
                    visible: true,
                    disabled: this.isExecuting || this.isSaving || this.isReadonly,
                    classes: 'btn btn-success btn-sm d-inline-flex align-items-center gap-1',
                },
                ...(this.isInExecutionView ? [{
                    name: 'copy-to-editor',
                    label: 'Copy To Editor',
                    icon: 'icon-copy',
                    callback: () => this.onCopyToEditor(),
                    visible: true,
                    disabled: !this.executionState,
                    classes: 'btn btn-warning btn-sm d-inline-flex align-items-center gap-1',
                }] : []),
                { name: 'divider-1', divider: true }
            );
        }

        // Edit Actions Group (undo/redo)
        if (!this.isReadonly) {
            buttons.push(
                {
                    name: 'undo',
                    icon: 'icon-undo-2',
                    callback: () => this.onUndo(),
                    visible: true,
                    disabled: !this.canUndo,
                    title: 'Undo (Ctrl+Z)',
                    classes: 'btn btn-light d-inline-flex',
                },
                {
                    name: 'redo',
                    icon: 'icon-redo-2',
                    callback: () => this.onRedo(),
                    visible: true,
                    disabled: !this.canRedo,
                    title: 'Redo (Ctrl+Y)',
                    classes: 'btn btn-light d-inline-flex',
                },
                { name: 'divider-2', divider: true },
                {
                    name: 'tidyup',
                    icon: 'icon-sparkles',
                    callback: () => this.tidyUp(),
                    visible: true,
                    disabled: this.nodes.length === 0,
                    title: 'Tidy Up',
                    classes: 'btn btn-light d-inline-flex',
                },
                {
                    name: 'add-node',
                    icon: 'icon-plus',
                    label: 'Node',
                    callback: (ev) => this.onAddNodeClick(ev),
                    visible: true,
                    disabled: false,
                    title: 'Add Node',
                    classes: 'btn btn-primary btn-sm',
                },
                { name: 'divider-3', divider: true }
            );
        }

        // View Control Group (always available)
        buttons.push(
            {
                name: 'fit-view',
                icon: 'icon-maximize',
                callback: () => this.fitToView(),
                visible: true,
                disabled: this.nodes.length === 0,
                title: 'Fit to View',
                classes: 'btn btn-light d-inline-flex',
                menu: {
                    open: this.isFitMenuOpen,
                    disabled: this.isReadonly || this.nodes.length === 0,
                    toggle: (ev) => this.toggleFitMenu(ev),
                    items: this.fitMenuItems,
                },
            },
            {
                name: 'zoom-out',
                icon: 'icon-minus',
                callback: () => this.zoomOut(),
                visible: true,
                disabled: false,
                title: 'Zoom Out',
                classes: 'btn btn-light d-inline-flex',
            },
            {
                name: 'zoom-in',
                icon: 'icon-plus',
                callback: () => this.zoomIn(),
                visible: true,
                disabled: false,
                title: 'Zoom In',
                classes: 'btn btn-light d-inline-flex',
            },
            {
                name: 'reset-zoom',
                icon: 'icon-refresh-cw',
                callback: () => this.resetZoom(),
                visible: true,
                disabled: false,
                title: 'Reset View',
                classes: 'btn btn-light d-inline-flex',
            }
        );

        return buttons;
    }

}
