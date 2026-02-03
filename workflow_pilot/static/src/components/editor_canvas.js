/** @odoo-module **/

import { Component, useRef, useState, useExternalListener, reactive, onMounted, onWillUnmount, useEnv } from "@odoo/owl";
import { WorkflowNode } from "./workflow_node";
import { NodeMenu } from "./node_menu";
import { ConnectionToolbar } from "./connection_toolbar";
import { NodeConfigPanel } from "./node_config_panel";
import { DimensionConfig, CONNECTION, detectConnectionType } from "../core/dimensions";
import {
    getBezierPath,
    getBackEdgePath,
    getVerticalStackPath,
    getConnectionPath as calculateConnectionPath
} from "./editor_canvas/utils/connection_path";
import { calculateFitView } from "./editor_canvas/utils/view_utils";
import { calculateTidyPositions } from "./editor_canvas/utils/layout";
import { useCanvasGestures, useConnectionDrawing, useMultiNodeDrag, useKeyboardShortcuts, useConnectionCulling, useClipboard, useViewport } from "./editor_canvas/hooks";
import { LucideIcon } from "./common/lucide_icon";

/**
 * EditorCanvas Component
 * 
 * Main canvas for the workflow editor. Manages node positions, selection,
 * and drag-drop from palette.
 * Reads graph state from workflowEditor service via env.
 */
export class EditorCanvas extends Component {
    static template = "workflow_pilot.editor_canvas";
    static components = { WorkflowNode, NodeMenu, ConnectionToolbar, NodeConfigPanel, LucideIcon };

    static props = {
        // Dimension configuration for node sizing
        dimensionConfig: { type: Object, optional: true },
    };

    setup() {
        this.rootRef = useRef("root");
        this.svgRef = useRef("svgConnections");
        this.contentRef = useRef("content");
        this.env = useEnv();
        this.editor = this.env.workflowEditor;
        // Bind component to service state reactivity
        this.editorState = useState(this.editor.state);

        function normalizeItems(value) {
            if (Array.isArray(value)) {
                return value;
            }
            if (value === null || value === undefined) {
                return [];
            }
            return [value];
        }

        function buildNodeOutputView(output) {
            const jsonValue = output;
            const itemsValue = normalizeItems(jsonValue);
            const itemValue = itemsValue.length ? itemsValue[0] : jsonValue;
            return {
                json: jsonValue,
                item: itemValue,
                items: itemsValue,
            };
        }

        const emptyExpressionContext = () => ({
            _vars: {},
            _node: {},
            _json: {},
            _loop: null,
            _input: { item: null, json: null, items: [] },
            _execution: null,
            _workflow: null,
            _now: null,
            _today: null,
        });

        this.nodeConfigActions = {
            getControls: (nodeId) => this.editor.getNodeControls(nodeId),
            getNodeMeta: (nodeId) => this.editor.getNodeMeta(nodeId),
            setNodeMeta: (nodeId, meta) => this.editor.setNodeMeta(nodeId, meta),
            getExpressionContext: () => {
                const snapshot = this.editorState.execution?.contextSnapshot || null;
                if (!snapshot) {
                    return emptyExpressionContext();
                }
                const json = snapshot.json || {};
                const wrappedNode = {};
                const nodeEntries = snapshot.node || {};
                for (const [nodeId, output] of Object.entries(nodeEntries)) {
                    wrappedNode[nodeId] = buildNodeOutputView(output);
                }
                const inputItems = normalizeItems(json);
                return {
                    _vars: snapshot.vars || {},
                    _node: wrappedNode,
                    _json: json,
                    _loop: null,
                    _input: { item: inputItems[0] || json, json, items: inputItems },
                    _execution: snapshot.execution || null,
                    _workflow: snapshot.workflow || null,
                    _now: snapshot.now || null,
                    _today: snapshot.today || null,
                };
            },
            buildContextForNode: () => ({
                _node: {},
                _json: {},
                _input: { item: null, json: null },
                _execution: null,
                _workflow: null,
            }),
            executeUntilNode: (nodeId, inputData = {}, configOverrides = null) =>
                this.editor.actions.executeUntilNode(nodeId, inputData, configOverrides),
            setNodeConfig: (nodeId, values) => this.editor.setNodeConfig(nodeId, values),
        };

        this.state = useState({
            // Connection drawing state managed by useConnectionDrawing hook
            // Dimension configuration (reactive for runtime updates)
            dimensionConfig: this.props.dimensionConfig || {},
            // NodeMenu state - now in workflowEditor.state.ui.nodeMenu
            // Viewport tracking for culling - now handled by useViewport
            // Config panel state - now read from service via getter isConfigPanelOpen
        });

        // Initialize Viewport Hook (zoom, pan, coordinate conversion) - MUST be first
        this.viewportHook = useViewport({
            editor: this.editor,
            rootRef: this.rootRef,
            getDimensions: () => this.dimensions,
        });

        // Initialize Canvas Gestures Hook (pan/selection box)
        this.gestures = useCanvasGestures({
            editor: this.editor,
            rootRef: this.rootRef,
            getViewport: () => this.viewportHook.getViewport(),
            getCanvasPosition: (ev) => this.viewportHook.getCanvasPosition(ev),
            onViewRectUpdate: () => this.viewportHook.updateViewRect(),
            getDimensions: () => this.dimensions,
        });

        // Initialize Connection Drawing Hook
        this.connectionDrawing = useConnectionDrawing({
            editor: this.editor,
            getCanvasPosition: (ev) => this.viewportHook.getCanvasPosition(ev),
            getSocketPositionForNode: (node, key, type) => this.getSocketPositionForNode(node, key, type),
            getNodes: () => this.nodes,
            openNodeMenu: (config) => { this.editor.actions.openNodeMenu(config); },
        });

        // Initialize Multi-Node Drag Hook
        this.multiNodeDrag = useMultiNodeDrag({
            editor: this.editor,
            getNodes: () => this.nodes,
            getZoom: () => this.viewportHook.getViewport().zoom,
        });

        // Initialize Keyboard Shortcuts Hook (Delete, Arrows, Undo/Redo, Select All)
        // Copy/Paste remains managed locally until useClipboard is implemented
        useKeyboardShortcuts({
            editor: this.editor,
            getNodes: () => this.nodes,
        });

        // Initialize Connection Culling Hook (Visibility + Memoization)
        this.connectionCulling = useConnectionCulling({
            getNodes: () => this.nodes,
            getConnections: () => this.connections,
            getViewRect: () => this.viewportHook.viewRect,
            getSocketPosition: (node, key, type) => this.getSocketPositionForNode(node, key, type),
        });

        // Initialize Clipboard Hook (Copy/Paste)
        useClipboard({
            editor: this.editor,
            getNodes: () => this.nodes,
            getConnections: () => this.connections,
            getSelection: () => this.editorState.ui.selection,
        });

        // Resize observer to update viewport on window resize
        this._resizeObserver = new ResizeObserver(() => this.viewportHook.updateViewRect());
        onMounted(() => {
            if (this.rootRef.el) {
                this._resizeObserver.observe(this.rootRef.el);
                // viewRect is already initialized in useViewport onMounted
            }
        });
        onWillUnmount(() => {
            this._resizeObserver.disconnect();
        });

        // Global mouse listeners
        useExternalListener(document, "mousemove", this.onDocumentMouseMove.bind(this));
        useExternalListener(document, "mouseup", this.onDocumentMouseUp.bind(this));

        // Note: Parent->child callbacks are now passed directly via props/t-props:
        // - ConnectionToolbar: onInsertNode, onHoverChange
        // - NodeMenu: onNodeSelected, onClose
        // - WorkflowNode: nodeActions (onDragStart, onExecute, onSocket*)

        this.isDebug = typeof odoo !== "undefined" && odoo.debug;
        window.canvas = this.isDebug ? this : null;
    }

    // ========================================
    // PROPS GETTERS (t-props pattern)
    // ========================================

    /**
     * Get callback props for ConnectionToolbar
     * @returns {Object} { onInsertNode, onHoverChange }
     */
    get connectionToolbarProps() {
        return {
            onInsertNode: (connectionId, position) => {
                this.onConnectionAddNode(connectionId, position);
            },
            onHoverChange: (isHovering) => {
                this.onToolbarHoverChange(isHovering);
            },
        };
    }

    get hoveredConnection() {
        return this.editorState.ui.hoveredConnection;
    }

    /**
     * Get callback props for NodeMenu
     * @returns {Object} { onNodeSelected, onClose }
     */
    get nodeMenuProps() {
        return {
            onNodeSelected: (nodeType, connectionContext) => {
                this.onNodeMenuSelect(nodeType, connectionContext);
            },
            onClose: () => {
                this.onNodeMenuClose();
            },
        };
    }

    /**
     * Get all props for WorkflowNode component (t-props pattern)
     * @param {Object} node - Node data object
     * @returns {Object} Complete props for WorkflowNode
     */
    getWorkflowNodeProps(node) {
        const snappedSocket = this.connectionDrawing.state.snappedSocket;
        return {
            node,
            zoom: this.viewport.zoom,
            selected: this.selectionSet.has(node.id),
            snappedSocketKey: snappedSocket && snappedSocket.nodeId === node.id
                ? snappedSocket.socketKey
                : null,
            connectedOutputsSet: this.connectedOutputsSet,
            dimensionConfig: this.dimensions,
            // Callbacks
            onDragStart: (nodeId, event) => {
                this.multiNodeDrag.onNodeDragStart({ nodeId, event });
            },
            onExecute: async (nodeId) => {
                this.editor.actions.openPanel("config", { nodeId });
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
        };
    }

    /**
     * Get DimensionConfig instance (reactive - recalculates when state.dimensionConfig changes)
     * @returns {DimensionConfig}
     */
    get dimensions() {
        return new DimensionConfig(this.state.dimensionConfig);
    }

    /**
     * Update dimension configuration at runtime
     * @param {Object} newConfig - Partial config to merge
     */
    updateDimensionConfig(newConfig) {
        this.state.dimensionConfig = { ...this.state.dimensionConfig, ...newConfig };
    }

    /**
     * Get nodes from editor service state
     */
    get nodes() {
        return this.editorState.graph.nodes || [];
    }

    /**
     * Get connections from editor service state
     */
    get connections() {
        return this.editorState.graph.connections || [];
    }

    /**
     * Get a Set of selected node IDs for efficient lookups
     */
    get selectionSet() {
        return new Set(this.editorState.ui.selection.nodeIds || []);
    }

    /**
     * Get selected connection IDs from service state (for template binding)
     */
    get selectedConnectionIds() {
        return this.editorState.ui.selection.connectionIds || [];
    }

    /**
     * Pre-compute set of connected output sockets for O(1) lookup
     * Format: "nodeId:socketKey"
     * Used by WorkflowNode to show/hide quick-add buttons
     */
    get connectedOutputsSet() {
        const set = new Set();
        for (const c of this.connections) {
            set.add(`${c.source}:${c.sourceHandle}`);
        }
        return set;
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

    get executionState() {
        return this.editorState.execution || undefined;
    }

    /**
     * Get NodeMenu state from service (source of truth)
     * @returns {{ visible: boolean, x: number, y: number, canvasX: number, canvasY: number, variant: string, connectionContext: Object|null }}
     */
    get nodeMenu() {
        return this.editorState.ui.nodeMenu;
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
    /**
     * Fit all nodes into viewport with padding
     * Logic extracted to utils/view_utils.js
     */
    fitToView() {
        const nodes = this.nodes;
        if (!nodes || nodes.length === 0) return;

        const canvasEl = this.rootRef.el;
        if (!canvasEl) return;

        const rect = canvasEl.getBoundingClientRect();
        const viewState = calculateFitView(nodes, this.dimensions, rect);

        if (viewState) {
            this.editor.actions.setViewport({
                pan: { x: viewState.panX, y: viewState.panY },
                zoom: viewState.zoom,
            });
            this.updateViewRect();
        }
    }

    // =========================================
    // Tidy Up: Auto-Layout
    // =========================================

    /**
     * Auto-arrange nodes using Dagre.js layout algorithm
     * Uses pure util for position calculation, service actions for mutations.
     * Wrapped in batch for single undo/redo step.
     */
    tidyUp() {
        if (this.nodes.length === 0) return;

        // Calculate new positions using pure utility (no side effects)
        const positions = calculateTidyPositions(this.nodes, this.connections);

        // Apply positions via service actions (wrapped in batch for single undo)
        this.editor.actions.beginBatch();
        for (const node of this.nodes) {
            const pos = positions[node.id];
            if (pos) {
                this.editor.actions.moveNode(node.id, { x: pos.x, y: pos.y });
            }
        }
        this.editor.actions.endBatch("Tidy up layout");
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
     * @param {MouseEvent} ev
     */
    onDocumentMouseMove(ev) {
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
        const gestureType = this.gestures.handleMouseUp(ev);
        if (gestureType) {
            // If selection box just completed, set flag to prevent click from clearing
            if (gestureType === 'selection') {
                this._justCompletedSelection = true;
                setTimeout(() => { this._justCompletedSelection = false; }, 0);
            }
            return;
        }

        // Delegate multi-node drag end to hook
        if (this.multiNodeDrag.handleMouseUp(ev)) {
            return;
        }

        // Delegate connection drawing end to hook
        const canvasRect = this.rootRef.el?.getBoundingClientRect() || { left: 0, top: 0 };
        this.connectionDrawing.handleCanvasMouseUp(ev, canvasRect);
    }

    /**
     * Handle drag over for palette drops
     * @param {DragEvent} ev 
     */
    onDragOver(ev) {
        ev.preventDefault();
        if (ev.dataTransfer) ev.dataTransfer.dropEffect = "copy";
    }

    /**
     * Handle drop from node palette
     * @param {DragEvent} ev 
     */
    onDrop(ev) {
        ev.preventDefault();
        const type = ev.dataTransfer?.getData("application/x-workflow-node");
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
        const isCtrlHeld = event?.ctrlKey || event?.metaKey;
        const currentSelection = this.editor.state.ui.selection.nodeIds || [];

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

    onNodeExecute(nodeId) {
        const node = this.nodes.find(n => n.id === nodeId);
        if (!node) return;

        // Open config panel via service
        this.editor.actions.openPanel("config", { nodeId });
    }

    onNodeDelete(nodeId) {
        this.editor.actions.removeNode(nodeId);
        // Deselect if it was the only one or among selected
        const current = this.editor.state.ui.selection.nodeIds;
        if (current.includes(nodeId)) {
            this.editor.actions.select(current.filter(id => id !== nodeId));
        }
    }

    /**
     * Handle node disable/enable toggle from toolbar
     * @param {string} nodeId 
     */
    onNodeToggleDisable(nodeId) {
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
        if (ev.target === this.rootRef.el || ev.target.classList?.contains('workflow-editor-canvas__content')) {
            this.clearSelection();
        }
    }

    /**
     * Handle connection selection
     * @param {string} connId 
     */
    onConnectionSelect(connId) {
        // Select only this connection (clear node selection)
        this.editor.actions.select([], [connId]);
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
        this.gestures.onCanvasMouseDown(ev);
    }

    /**
     * Handle right-click on canvas to open NodeMenu
     * Uses service action (source of truth)
     */
    onCanvasContextMenu(ev) {
        ev.preventDefault();
        const rect = this.rootRef.el.getBoundingClientRect();
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
        let { canvasX, canvasY } = this.nodeMenu;
        const dims = this.dimensions;

        // Final position for node placement
        let position = {
            x: canvasX - dims.nodeWidth / 2,
            y: canvasY
        };

        if (connectionContext?.type === 'quickAdd' || connectionContext?.type === 'dragConnect') {
            // Quick-add from socket OR drag-connect from canvas:
            // Create node and auto-connect from source socket
            const { sourceNodeId, sourceSocketKey } = connectionContext;
            const newNodeId = this.editor.actions.addNode(nodeType, position);

            if (newNodeId) {
                // Use setTimeout to ensure node is in state
                setTimeout(() => {
                    const newNode = this.nodes.find(n => n.id === newNodeId);
                    const firstInputKey = Object.keys(newNode?.inputs || {})[0];

                    if (firstInputKey) {
                        this.editor.actions.addConnection(
                            sourceNodeId,
                            sourceSocketKey,
                            newNodeId,
                            firstInputKey
                        );
                    }
                }, 0);
            }
        } else if (connectionContext?.connectionId) {
            // Inserting node into existing connection
            this._insertNodeIntoConnection(nodeType, { connectionId: connectionContext.connectionId, position });
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
        // Clear any pending leave timeout
        if (this._connectionHoverTimeout) {
            clearTimeout(this._connectionHoverTimeout);
            this._connectionHoverTimeout = null;
        }

        // Only update if connection changed (debounce rapid hovers)
        if (this.editorState.ui.hoveredConnection.id === conn.id) return;

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
        this.editor.actions.setHoveredConnection({
            id: connectionId,
            midpoint,
        });
    }

    /**
     * Handle connection hover end - hide toolbar
     */
    onConnectionMouseLeave() {
        // Small delay to allow clicking on toolbar
        this._connectionHoverTimeout = setTimeout(() => {
            if (!this._isHoveringToolbar) {
                this.editor.actions.setHoveredConnection();
            }
        }, 100);
    }

    /**
     * Handle toolbar hover state
     */
    onToolbarHoverChange(isHovering) {
        this._isHoveringToolbar = isHovering;
        if (!isHovering) {
            this.editor.actions.setHoveredConnection();
        }
    }

    /**
     * Handle "Add Node" from connection toolbar
     */
    onConnectionAddNode(connectionId, position) {
        // position here is the screen-relative midpoint from state.ui.hoveredConnection.midpoint
        // We use the stored canvasMidpoint for the actual node placement
        let canvasPos = this.editorState.ui.hoveredConnection.canvasMidpoint;
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
        setTimeout(() => {
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
        }, 0);
    }

    /**
     * Calculate connection midpoint for toolbar positioning
     */
    getConnectionMidpoint(conn) {
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
        this.editor.actions.removeConnection(connectionId);
        this.editor.actions.setHoveredConnection();
    }

    /**
     * Handle "+ Node" button click from toolbar
     */
    onAddNodeClick(ev) {
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

    // ============================================
    // CONFIG PANEL HANDLERS
    // ============================================

    /**
     * Handle double-click on node to open config panel (via service action)
     */
    onNodeDoubleClick = (nodeId) => {
        this.editor.actions.openPanel("config", { nodeId });
    };

    /**
     * Check if config panel is open (reads from service state)
     */
    get isConfigPanelOpen() {
        return this.editorState.ui.panels.configOpen;
    }

    /**
     * Get the node currently being configured (from service state)
     */
    get configPanelNode() {
        const nodeId = this.editorState.ui.panels.configNodeId;
        if (!nodeId) return null;
        return this.nodes.find(n => n.id === nodeId) || null;
    }

    /**
     * Close config panel (via service action)
     */
    onConfigPanelClose = () => {
        this.editor.actions.closePanel("config");
    };

    /**
     * Save config panel changes
     */
    onConfigPanelSave = (values) => {
        const nodeId = this.editorState.ui.panels.configNodeId;
        if (!nodeId) return;
        this.onConfigPanelClose();
    };

    // ============================================
    // UNDO/REDO
    // ============================================

    /**
     * Check if undo is available (reads from service state)
     */
    get canUndo() {
        return this.editorState.ui.history.canUndo;
    }

    /**
     * Check if redo is available (reads from service state)
     */
    get canRedo() {
        return this.editorState.ui.history.canRedo;
    }

    /**
     * Handle undo button click
     */
    onUndo = () => {
        this.editor.actions.undo();
    };

    /**
     * Handle redo button click
     */
    onRedo = () => {
        this.editor.actions.redo();
    };
}
