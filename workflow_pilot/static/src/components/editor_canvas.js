/** @odoo-module **/

import { Component, useRef, useState, useExternalListener, reactive, onMounted, useEnv } from "@odoo/owl";
import { WorkflowNode } from "./workflow_node";
import { NodeMenu } from "./node_menu";
import { ConnectionToolbar } from "./connection_toolbar";
import { NodeConfigPanel } from "./node_config_panel";
import { WorkflowGraph } from "../utils/graph_utils";
import { DimensionConfig, CONNECTION, detectConnectionType } from "../core/dimensions";
import {
    getBezierPath,
    getBackEdgePath,
    getVerticalStackPath,
    getConnectionPath as calculateConnectionPath
} from "./editor_canvas/utils/connection_path";
import { useCanvasGestures } from "./editor_canvas/hooks";
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

        this.state = useState({
            // Transient connection drawing state
            isConnecting: false,
            connectionStart: null,
            tempLineEndpoint: null,
            snappedSocket: null,  // { nodeId, socketKey, x, y } - for smart snapping
            // Dimension configuration (reactive for runtime updates)
            dimensionConfig: this.props.dimensionConfig || {},
            nodeMenu: {
                visible: false,
                x: 0,
                y: 0,
                canvasX: 0,
                canvasY: 0,
                variant: 'default', // 'default' or 'large'
                connectionContext: null,  // { connectionId, position } for inserting node
            },
            // Hovered connection for toolbar
            hoveredConnection: {
                id: null,
                midpoint: { x: 0, y: 0 },
            },
            // Viewport tracking for culling
            viewRect: { x: 0, y: 0, w: 0, h: 0 },
            // Config panel state - now read from service via getter isConfigPanelOpen
        });

        // Initialize Canvas Gestures Hook (pan/selection box)
        this.gestures = useCanvasGestures({
            editor: this.editor,
            rootRef: this.rootRef,
            getViewport: () => this.viewport,
            getCanvasPosition: (ev) => this.getCanvasPosition(ev),
            onViewRectUpdate: () => this.updateViewRect(),
        });

        // Resize observer to update viewport on window resize
        this._resizeObserver = new ResizeObserver(() => this.updateViewRect());
        onMounted(() => {
            if (this.rootRef.el) {
                this._resizeObserver.observe(this.rootRef.el);
                this.updateViewRect();
            }
        });

        // Global mouse listeners
        useExternalListener(document, "mousemove", this.onDocumentMouseMove.bind(this));
        useExternalListener(document, "mouseup", this.onDocumentMouseUp.bind(this));
        useExternalListener(document, "keydown", this.onKeyDown.bind(this));

        // Bus listener: ConnectionToolbar "Add Node" button
        this.editor.bus.addEventListener("CONNECTION:INSERT_NODE", (ev) => {
            const { connectionId, position } = ev.detail;
            this.onConnectionAddNode(connectionId, position);
        });

        this.editor.bus.addEventListener("NODE:EXECUTE", async (ev) => {
            const { nodeId } = ev.detail;
            // Execute up to this node via workflowRun service
            const runService = this.env.services.workflowRun;
            const adapter = this.env.services.workflowAdapter;

            if (!runService || !adapter) {
                console.error('[EditorCanvas] Missing workflowRun or workflowAdapter service');
                return;
            }

            const workflow = {
                nodes: adapter.state.nodes,
                connections: adapter.state.connections,
            };

            console.log(`[EditorCanvas] Executing until node: ${nodeId}`);
            await runService.runUntilNode(workflow, nodeId);
        });
        this.editor.bus.addEventListener("SOCKET:MOUSE_DOWN", (ev) => {
            this.onSocketMouseDown(ev.detail);
        });
        this.editor.bus.addEventListener("SOCKET:MOUSE_UP", (ev) => {
            this.onSocketMouseUp(ev.detail);
        });
        this.editor.bus.addEventListener("SOCKET:QUICK_ADD", (ev) => {
            this.onSocketQuickAdd(ev.detail);
        });
        // Menu node selection spawning
        this.editor.bus.addEventListener("MENU:NODE_SELECTED", (ev) => {
            this.onNodeMenuSelect(ev.detail.nodeType, ev.detail.connectionContext);
        });

        window.canvas = this;
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

    /**
     * Get viewport from service state (provides compatible panX/panY/zoom format)
     * Uses editorState (wrapped in useState) for OWL reactivity
     * @returns {{ zoom: number, panX: number, panY: number }}
     */
    get viewport() {
        const { pan, zoom } = this.editorState.ui.viewport;
        return {
            zoom,
            panX: pan.x,
            panY: pan.y,
        };
    }

    /**
     * Calculate viewport transform style
     * ESSENTIAL for pan/zoom - this is not an animation, it's the viewport positioning
     */
    get viewportTransformStyle() {
        const { panX, panY, zoom } = this.viewport;
        return `transform: translate(${panX}px, ${panY}px) scale(${zoom}); transform-origin: 0 0;`;
    }

    /**
     * Get style for the parent canvas to sync background pattern with viewport
     * This ensures the grid stays visible and correctly sized when zooming/panning
     */
    get canvasBackgroundStyle() {
        const { panX, panY, zoom } = this.viewport;

        const size = 20 * zoom;
        // Background position should stay in sync with panning
        return `background-size: ${size}px ${size}px; background-position: ${panX}px ${panY}px;`;
    }

    /**
     * Convert screen coordinates to canvas coordinates (accounting for zoom/pan)
     * @param {MouseEvent} ev
     * @returns {{ x: number, y: number }}
     */
    getCanvasPosition(ev) {
        const rect = this.rootRef.el.getBoundingClientRect();
        const { zoom, panX, panY } = this.viewport;
        return {
            x: (ev.clientX - rect.left - panX) / zoom,
            y: (ev.clientY - rect.top - panY) / zoom
        };
    }

    /**
     * Convert canvas coordinates to screen coordinates (relative to canvas container)
     * Useful for positioning fixed-size overlays
     * @param {number} canvasX 
     * @param {number} canvasY 
     * @returns {{ x: number, y: number }}
     */
    getScreenPosition(canvasX, canvasY) {
        const { zoom, panX, panY } = this.viewport;
        return {
            x: canvasX * zoom + panX,
            y: canvasY * zoom + panY
        };
    }

    /**
     * Update visible viewport rectangle (canvas coordinates)
     * Called on pan, zoom, and resize
     */
    updateViewRect() {
        if (!this.rootRef.el) return;
        const rect = this.rootRef.el.getBoundingClientRect();
        const { zoom, panX, panY } = this.viewport;

        // Add 300px buffer for smooth scrolling/panning
        const BUFFER = 300;

        // Calculate visible area in canvas space
        this.state.viewRect = {
            x: -panX / zoom - BUFFER,
            y: -panY / zoom - BUFFER,
            w: rect.width / zoom + (BUFFER * 2),
            h: rect.height / zoom + (BUFFER * 2),
        };
    }

    /**
     * Get nodes that are currently visible in the viewport
     * @returns {Array}
     */
    get visibleNodes() {
        const { x, y, w, h } = this.state.viewRect;
        // Conservative node size estimate for intersection check
        const MAX_NODE_WIDTH = 500;
        const MAX_NODE_HEIGHT = 500;

        return this.nodes.filter(node => {
            // Simple AABB intersection test
            return (
                node.x < x + w &&
                node.x + MAX_NODE_WIDTH > x &&
                node.y < y + h &&
                node.y + MAX_NODE_HEIGHT > y
            );
        });
    }

    /**
     * Get connections associated with visible nodes
     * @returns {Array}
     */
    get visibleConnections() {
        // Only render connection if source OR target is visible
        const visibleNodeIds = new Set(this.visibleNodes.map(n => n.id));
        return this.connections.filter(c =>
            visibleNodeIds.has(c.source) || visibleNodeIds.has(c.target)
        );
    }

    /**
     * Handle wheel event for zoom
     * @param {WheelEvent} ev
     */
    onWheel(ev) {
        // If mouse is over NodeMenu or other fixed overlays, allow normal scrolling and skip zoom
        if (ev.target.closest('.node-menu') || ev.target.closest('.connection-toolbar')) {
            return;
        }

        ev.preventDefault();

        if (this._scrollFrame) return;

        this._scrollFrame = requestAnimationFrame(() => {
            this._scrollFrame = null;
            const { zoom, panX, panY } = this.viewport;
            const delta = ev.deltaY > 0 ? 0.9 : 1.1;
            const newZoom = Math.min(Math.max(zoom * delta, 0.25), 2);

            // Zoom towards cursor position
            const rect = this.rootRef.el.getBoundingClientRect();
            const mouseX = ev.clientX - rect.left;
            const mouseY = ev.clientY - rect.top;

            // Adjust pan to zoom towards cursor
            const factor = newZoom / zoom;
            const newPanX = mouseX - (mouseX - panX) * factor;
            const newPanY = mouseY - (mouseY - panY) * factor;

            // Update via service action
            this.editor.actions.setViewport({
                pan: { x: newPanX, y: newPanY },
                zoom: newZoom,
            });

            this.updateViewRect();
        });
    }

    /**
     * Get zoom percentage for display
     */
    get zoomPercentage() {
        return Math.round(this.viewport.zoom * 100);
    }

    /**
     * Zoom in by 10% (fixed step)
     */
    zoomIn() {
        const currentZoom = this.viewport.zoom;
        // Round to nearest 0.1 to avoid floating point drift
        const newZoom = Math.min(Math.round((currentZoom + 0.1) * 10) / 10, 2);
        this.editor.actions.zoomTo(newZoom);
    }

    /**
     * Zoom out by 10% (fixed step)
     */
    zoomOut() {
        const currentZoom = this.viewport.zoom;
        // Round to nearest 0.1 to avoid floating point drift  
        const newZoom = Math.max(Math.round((currentZoom - 0.1) * 10) / 10, 0.25);
        this.editor.actions.zoomTo(newZoom);
    }

    /**
     * Reset zoom to 100% and pan to origin
     */
    resetZoom() {
        this.editor.actions.resetViewport();
    }

    /**
     * Fit all nodes into viewport with padding
     * Inspired by n8n/VueFlow fitView implementation
     */
    fitToView() {
        const nodes = this.nodes;
        if (!nodes || nodes.length === 0) return;

        // Calculate bounding box
        const NODE_WIDTH = 200;
        const NODE_HEIGHT = 100;
        const PADDING = 50;

        const xs = nodes.map(n => n.x || 0);
        const ys = nodes.map(n => n.y || 0);

        const bounds = {
            minX: Math.min(...xs),
            maxX: Math.max(...xs) + NODE_WIDTH,
            minY: Math.min(...ys),
            maxY: Math.max(...ys) + NODE_HEIGHT,
        };

        const contentWidth = bounds.maxX - bounds.minX + PADDING * 2;
        const contentHeight = bounds.maxY - bounds.minY + PADDING * 2;

        // Get canvas dimensions
        const canvasEl = this.rootRef.el;
        if (!canvasEl) return;
        const rect = canvasEl.getBoundingClientRect();

        // Calculate zoom to fit (max 1 = don't zoom in beyond 100%)
        const zoom = Math.min(
            rect.width / contentWidth,
            rect.height / contentHeight,
            1
        );

        // Calculate pan to center content
        const panX = -bounds.minX + PADDING + (rect.width / zoom - contentWidth) / 2;
        const panY = -bounds.minY + PADDING + (rect.height / zoom - contentHeight) / 2;

        // Update via service action
        this.editor.actions.setViewport({
            pan: { x: panX, y: panY },
            zoom,
        });
    }

    // =========================================
    // Tidy Up: Auto-Layout
    // =========================================

    /**
     * Auto-arrange nodes using Dagre.js layout algorithm
     */
    tidyUp() {
        if (this.nodes.length === 0) return;
        // Create graph from current nodes and connections
        const graph = WorkflowGraph.fromNodes(this.nodes, this.connections);
        const positions = graph.layoutWithSplitting();
        for (const node of this.nodes) {
            const pos = positions[node.id];
            if (pos) {
                // Update local UI state
                node.x = pos.x;
                node.y = pos.y;

                // Sync with Core layer via service action
                this.editor.actions.moveNode(node.id, { x: pos.x, y: pos.y });
            }
        }
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
     * This getter is called on every render, so paths update when nodes move
     * Returns paths as an array to support multi-segment routing
     */
    get renderedConnections() {
        return this.visibleConnections.map(conn => {
            const sourceNode = this.nodes.find(n => n.id === conn.source);
            const targetNode = this.nodes.find(n => n.id === conn.target);

            if (!sourceNode || !targetNode) {
                return { ...conn, paths: [''], isBackEdge: false, isVerticalStack: false };
            }

            const sourcePos = this.getSocketPositionForNode(sourceNode, conn.sourceHandle, 'output');
            const targetPos = this.getSocketPositionForNode(targetNode, conn.targetHandle, 'input');

            const result = this.getConnectionPath(sourcePos, targetPos);
            return { ...conn, ...result };
        });
    }
    /**
     * Get temp connection path while drawing
     * Returns empty string if not drawing
     * Uses unified getConnectionPath for consistency with renderedConnections
     */
    get tempConnectionPath() {
        if (!this.state.isConnecting || !this.state.connectionStart || !this.state.tempLineEndpoint) {
            return '';
        }

        const { nodeId, socketKey, socketType } = this.state.connectionStart;
        const node = this.nodes.find(n => n.id === nodeId);
        if (!node) return '';

        const startPos = this.getSocketPositionForNode(node, socketKey, socketType);

        // Smart snapping: use snapped socket position if available
        const endPos = this.state.snappedSocket
            ? { x: this.state.snappedSocket.x, y: this.state.snappedSocket.y }
            : this.state.tempLineEndpoint;

        // Determine source/target based on socket type
        const sourcePos = socketType === 'output' ? startPos : endPos;
        const targetPos = socketType === 'output' ? endPos : startPos;

        const { paths } = this.getConnectionPath(sourcePos, targetPos);
        return paths.join(' ');
    }

    /**
     * @param {{ nodeId: string, socketKey: string, socketType: string, event: MouseEvent }} data
     */
    onSocketMouseDown = (data) => {
        const { nodeId, socketKey, socketType, event } = data;

        // Only start connection from output sockets
        if (socketType !== 'output') return;

        event.stopPropagation();
        event.preventDefault();

        // Use canvas coordinates (accounts for zoom/pan)
        const canvasPos = this.getCanvasPosition(event);

        this.state.isConnecting = true;
        this.state.connectionStart = { nodeId, socketKey, socketType };
        this.state.tempLineEndpoint = canvasPos;
    };

    /**
     * Find nearest compatible input socket within snap radius
     * @param {number} x - Canvas X coordinate
     * @param {number} y - Canvas Y coordinate
     * @param {string} sourceNodeId - Node ID to exclude (can't connect to self)
     * @returns {{ nodeId: string, socketKey: string, x: number, y: number } | null}
     */
    findNearestSocket(x, y, sourceNodeId) {
        const SNAP_RADIUS = 50;
        let closest = null;
        let minDist = Infinity;

        // Iterate backwards to prioritize top-most nodes (rendered later = on top)
        for (let i = this.nodes.length - 1; i >= 0; i--) {
            const node = this.nodes[i];
            if (node.id === sourceNodeId) continue; // Skip source node

            // Check each input socket
            for (const [key, _] of Object.entries(node.inputs || {})) {
                const pos = this.getSocketPositionForNode(node, key, 'input');
                const dist = Math.hypot(x - pos.x, y - pos.y);

                if (dist < SNAP_RADIUS && dist < minDist) {
                    minDist = dist;
                    closest = { nodeId: node.id, socketKey: key, x: pos.x, y: pos.y };
                }
            }
        }
        return closest;
    }

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

            // Connection drawing
            if (!this.state.isConnecting) return;

            const pos = this.getCanvasPosition(ev);
            this.state.tempLineEndpoint = pos;

            // Smart snapping: find nearest socket
            const sourceNodeId = this.state.connectionStart?.nodeId;
            this.state.snappedSocket = this.findNearestSocket(pos.x, pos.y, sourceNodeId);
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

        if (!this.state.isConnecting) return;

        // Smart snapping: if snapped to a socket, create connection
        if (this.state.snappedSocket) {
            const start = this.state.connectionStart;
            if (start && start.socketType === 'output') {
                this.editor.actions.addConnection(
                    start.nodeId,
                    start.socketKey,
                    this.state.snappedSocket.nodeId,
                    this.state.snappedSocket.socketKey
                );
            }
            this.cancelConnection();
            return;
        }

        // Check if released on an input socket directly
        const target = ev.target;
        const isSocket = target.classList?.contains('workflow-node__socket-point');
        const socketType = target.dataset?.socketType;

        if (isSocket && socketType === 'input') {
            return; // Will be handled by onSocketMouseUp
        }

        // FEATURE: Spawn NodeMenu when dropping connection on empty canvas
        // Only for output socket drags (input sockets don't create connections)
        const start = this.state.connectionStart;
        if (start && start.socketType === 'output') {
            const canvasPos = this.getCanvasPosition(ev);
            const canvasRect = this.rootRef.el?.getBoundingClientRect() || { left: 0, top: 0 };

            // Screen position relative to canvas container
            const screenX = ev.clientX - canvasRect.left;
            const screenY = ev.clientY - canvasRect.top;

            this.state.nodeMenu = {
                visible: true,
                x: screenX,
                y: screenY,
                canvasX: canvasPos.x,
                canvasY: canvasPos.y,
                variant: 'default',
                connectionContext: {
                    type: 'dragConnect',
                    sourceNodeId: start.nodeId,
                    sourceSocketKey: start.socketKey,
                },
            };

            // Clear connection drawing state but keep context in nodeMenu
            this.state.isConnecting = false;
            this.state.tempLineEndpoint = null;
            this.state.snappedSocket = null;
            // Note: connectionStart cleared when menu closes
            return;
        }

        this.cancelConnection();
    }

    /**
     * @param {{ nodeId: string, socketKey: string, socketType: string, event: MouseEvent }} data
     */
    onSocketMouseUp = (data) => {
        if (!this.state.isConnecting) return;

        const { nodeId, socketKey, socketType } = data;
        const start = this.state.connectionStart;

        // Validate: must be output -> input, different nodes
        if (!start) {
            this.cancelConnection();
            return;
        }

        // Output to input only
        if (start.socketType === 'output' && socketType === 'input' && start.nodeId !== nodeId) {
            // Create connection
            this.editor.actions.addConnection(
                start.nodeId,
                start.socketKey,
                nodeId,
                socketKey
            );
        }

        this.cancelConnection();
    };

    /**
     * Cancel ongoing connection drawing
     */
    cancelConnection() {
        this.state.isConnecting = false;
        this.state.connectionStart = null;
        this.state.tempLineEndpoint = null;
        this.state.snappedSocket = null;
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
     * Handle node position change during drag
     * @param {{ nodeId: string, x: number, y: number }} param
     */
    onNodeMove({ nodeId, x, y }) {
        // Find node in props and update directly (reactive) for immediate local feedback
        const node = this.nodes.find(n => n.id === nodeId);
        if (node) {
            node.x = x;
            node.y = y;

            // Throttle propagation to 60fps (16ms) to prevent flooding undo stack
            if (this._throttleMove) return;
            this._throttleMove = setTimeout(() => {
                this.editor.actions.moveNode(nodeId, { x, y });
                this._throttleMove = null;
            }, 16);
        }
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
            this.editor.actions.select([]);
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
     * Handle keydown events (Delete/Backspace, Arrow keys, Ctrl+C/V)
     * @param {KeyboardEvent} ev 
     */
    onKeyDown(ev) {
        console.log(`[EditorCanvas] Handling key: ${ev.key}, ctrl: ${ev.ctrlKey || ev.metaKey}`);
        // Skip if in input field
        if (ev.target.tagName === 'INPUT' || ev.target.tagName === 'TEXTAREA' || ev.target.isContentEditable) {
            return;
        }

        const ctrl = ev.ctrlKey || ev.metaKey;

        // =========================================
        // Delete nodes/connections
        // =========================================
        if (ev.key === 'Delete' || ev.key === 'Backspace') {
            // Delete nodes (All selected)
            const selectedNodeIds = this.editor.state.ui.selection.nodeIds;
            if (selectedNodeIds.length > 0) {
                [...selectedNodeIds].forEach(id => {
                    this.editor.actions.removeNode(id);
                });
                this.editor.actions.select([]);
            }

            // Delete connection
            const selectedConnIds = this.editorState.ui.selection.connectionIds || [];
            if (selectedConnIds.length > 0) {
                [...selectedConnIds].forEach(id => {
                    this.editor.actions.removeConnection(id);
                });
                this.editor.actions.select([], []);
            }
            return;
        }

        // =========================================
        // Keyboard Navigation (Arrow keys)
        // =========================================
        const MOVE_STEP = ev.shiftKey ? 50 : 20;  // Shift = larger step
        const arrowMoves = {
            'ArrowUp': { x: 0, y: -MOVE_STEP },
            'ArrowDown': { x: 0, y: MOVE_STEP },
            'ArrowLeft': { x: -MOVE_STEP, y: 0 },
            'ArrowRight': { x: MOVE_STEP, y: 0 },
        };

        if (arrowMoves[ev.key]) {
            ev.preventDefault();
            const { x: dx, y: dy } = arrowMoves[ev.key];

            // Move selected node(s)

            const selectedNodeIds = this.editor.state.ui.selection.nodeIds;
            selectedNodeIds.forEach(nodeId => {
                const node = this.nodes.find(n => n.id === nodeId);
                if (node) {
                    this.editor.actions.moveNode(nodeId, {
                        x: (node.x || 0) + dx,
                        y: (node.y || 0) + dy,
                    });
                }
            });
            return;
        }

        // =========================================
        // Copy/Paste (Ctrl+C, Ctrl+V)
        // =========================================
        if (ctrl && ev.key.toLowerCase() === 'c') {
            ev.preventDefault();
            this.copySelectedNodes();
            return;
        }

        if (ctrl && ev.key.toLowerCase() === 'v') {
            ev.preventDefault();
            this.pasteNodes();
            return;
        }

        // =========================================
        // Undo/Redo (Ctrl+Z, Ctrl+Y / Ctrl+Shift+Z)
        // =========================================
        if (ctrl && ev.key.toLowerCase() === 'z') {
            ev.preventDefault();
            if (ev.shiftKey) {
                this.editor.actions.redo();
            } else {
                this.editor.actions.undo();
            }
            return;
        }

        if (ctrl && ev.key.toLowerCase() === 'y') {
            ev.preventDefault();
            this.editor.actions.redo();
            return;
        }
    }

    // =========================================
    // Copy/Paste Implementation
    // =========================================

    /**
     * Copy selected nodes to system clipboard
     */
    async copySelectedNodes() {
        // Prioritize multiple selection list
        const selectedNodeIds = this.editor.state.ui.selection.nodeIds;
        if (selectedNodeIds.length === 0) return;

        const nodesToCopy = this.nodes.filter(n => selectedNodeIds.includes(n.id));
        const connectionsToCopy = this.connections.filter(
            c => selectedNodeIds.includes(c.source) && selectedNodeIds.includes(c.target)
        );

        // Use adapterService to get config for each node
        const adapterService = this.env.services.workflowAdapter;

        const data = {
            nodes: nodesToCopy.map(n => ({
                id: n.id,  // Include for connection mapping
                type: n.type,
                x: n.x,
                y: n.y,
                title: n.title,
                // Get config via adapter service (no _node access)
                config: adapterService?.getNodeConfig(n.id) || {},
            })),
            connections: connectionsToCopy,
        };

        try {
            await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
            console.log(`Copied ${data.nodes.length} nodes to clipboard`);
        } catch (e) {
            console.error('Failed to copy to clipboard:', e);
        }
    }

    async pasteNodes() {
        try {
            const text = await navigator.clipboard.readText();
            const data = JSON.parse(text);

            if (!data.nodes || !Array.isArray(data.nodes)) {
                return;
            }

            // Start history batch via service
            this.editor.actions.beginBatch();

            const PASTE_OFFSET_X = 50;
            const PASTE_OFFSET_Y = 50;
            const idMap = {};
            const adapterService = this.env.services.workflowAdapter;

            // Create new nodes with offset
            data.nodes.forEach(nodeData => {
                const position = {
                    x: (nodeData.x || 0) + PASTE_OFFSET_X,
                    y: (nodeData.y || 0) + PASTE_OFFSET_Y,
                };
                const newId = this.editor.actions.addNode(nodeData.type, position);
                if (newId) {
                    idMap[nodeData.id] = newId;
                    // Apply config if available
                    if (nodeData.config && adapterService) {
                        adapterService.setNodeConfig(newId, nodeData.config);
                    }
                }
            });

            // Recreate connections between pasted nodes
            (data.connections || []).forEach(conn => {
                if (idMap[conn.source] && idMap[conn.target]) {
                    this.editor.actions.addConnection(
                        idMap[conn.source],
                        conn.sourceHandle,
                        idMap[conn.target],
                        conn.targetHandle
                    );
                }
            });

            // End history batch
            this.editor.actions.endBatch('Paste nodes');
        } catch (e) {
            this.editor.actions.endBatch();
            console.warn('[EditorCanvas] Failed to paste:', e);
        }
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
     */
    onCanvasContextMenu(ev) {
        ev.preventDefault();
        const rect = this.rootRef.el.getBoundingClientRect();
        const canvasPos = this.getCanvasPosition(ev);

        this.state.nodeMenu = {
            visible: true,
            x: ev.clientX - rect.left,
            y: ev.clientY - rect.top,
            canvasX: canvasPos.x,
            canvasY: canvasPos.y,
            variant: 'default',
            connectionContext: null,
        };
    }

    /**
     * Handle NodeMenu selection
     */
    onNodeMenuSelect(nodeType, connectionContext) {
        let { canvasX, canvasY } = this.state.nodeMenu;
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
     */
    onNodeMenuClose() {
        // Clear any pending connection state from drag-connect flow
        this.state.connectionStart = null;

        this.state.nodeMenu = {
            visible: false,
            x: 0,
            y: 0,
            canvasX: 0,
            canvasY: 0,
            variant: 'default',
            connectionContext: null,
        };
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
        if (this.state.hoveredConnection.id === conn.id) return;

        const midpoint = this.getConnectionMidpoint(conn);
        const screenPos = this.getScreenPosition(midpoint.x, midpoint.y);

        this.state.hoveredConnection = {
            id: conn.id,
            midpoint: screenPos,      // Screen coords for fixed toolbar placement
            canvasMidpoint: midpoint, // Original coords for node placement
        };
    }

    /**
     * Handle connection hover - show toolbar (legacy, kept for compatibility)
     */
    onConnectionMouseEnter(connectionId, midpoint) {
        this.state.hoveredConnection = {
            id: connectionId,
            midpoint,
        };
    }

    /**
     * Handle connection hover end - hide toolbar
     */
    onConnectionMouseLeave() {
        // Small delay to allow clicking on toolbar
        this._connectionHoverTimeout = setTimeout(() => {
            if (!this._isHoveringToolbar) {
                this.state.hoveredConnection = {
                    id: null,
                    midpoint: { x: 0, y: 0 },
                };
            }
        }, 100);
    }

    /**
     * Handle toolbar hover state
     */
    onToolbarHoverChange(isHovering) {
        this._isHoveringToolbar = isHovering;
        if (!isHovering) {
            this.state.hoveredConnection = {
                id: null,
                midpoint: { x: 0, y: 0 },
            };
        }
    }

    /**
     * Handle "Add Node" from connection toolbar
     */
    onConnectionAddNode(connectionId, position) {
        // position here is the screen-relative midpoint from state.hoveredConnection.midpoint
        // We use the stored canvasMidpoint for the actual node placement
        const canvasPos = this.state.hoveredConnection.canvasMidpoint;

        this.state.nodeMenu = {
            visible: true,
            x: position.x,
            y: position.y,
            canvasX: canvasPos.x,
            canvasY: canvasPos.y,
            variant: 'default',
            connectionContext: { connectionId, position: canvasPos },
        };
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
        this.state.hoveredConnection = {
            id: null,
            midpoint: { x: 0, y: 0 },
        };
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

        this.state.nodeMenu = {
            visible: true,
            x,
            y,
            canvasX: canvasPos.x,
            canvasY: canvasPos.y,
            variant: 'large',
            connectionContext: null,
        };
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

        this.state.nodeMenu = {
            visible: true,
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
        };
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
}