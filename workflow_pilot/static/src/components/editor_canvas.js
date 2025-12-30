/** @odoo-module **/

import { Component, useRef, useState, useExternalListener, reactive, onMounted } from "@odoo/owl";
import { WorkflowNode } from "./workflow_node";
import { NodeMenu } from "./node_menu";
import { ConnectionToolbar } from "./connection_toolbar";
import { NodeConfigPanel } from "./node_config_panel";
import { WorkflowGraph } from "../utils/graph_utils";
import { DimensionConfig, CONNECTION } from "../core/dimensions";

/**
 * EditorCanvas Component
 * 
 * Main canvas for the workflow editor. Manages node positions, selection,
 * and drag-drop from palette.
 * 
 * Uses props.nodes directly (controlled component pattern).
 */
export class EditorCanvas extends Component {
    static template = "workflow_pilot.editor_canvas";
    static components = { WorkflowNode, NodeMenu, ConnectionToolbar, NodeConfigPanel };

    static props = {
        nodes: { type: Array, optional: true },
        connections: { type: Array, optional: true },
        onDropNode: { type: Function, optional: true },
        onSelectNode: { type: Function },
        onNodePositionChange: { type: Function },
        onConnectionCreate: { type: Function },
        removeNode: { type: Function },
        removeConnection: { type: Function },
        onPasteNode: { type: Function },
        undo: { type: Function, optional: true },
        redo: { type: Function, optional: true },
        onBeginBatch: { type: Function, optional: true },
        onEndBatch: { type: Function, optional: true },
        onNodeExecute: { type: Function, optional: true },  // Callback when node is executed
        // Dimension configuration for node sizing
        dimensionConfig: { type: Object, optional: true },
    };

    setup() {
        this.rootRef = useRef("root");
        this.svgRef = useRef("svgConnections");
        this.contentRef = useRef("content");

        this.state = useState({
            isConnecting: false,
            connectionStart: null,
            tempLineEndpoint: null,
            snappedSocket: null,  // { nodeId, socketKey, x, y } - for smart snapping
            viewport: {
                zoom: 1,
                panX: 0,
                panY: 0,
            },
            isSelecting: false,
            selectionBox: null,
            // Nodes selection is managed by this.selection (Reactive Set)
            // selectedNodeIds removed in favor of Set
            selectedConnectionIds: [],
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
            // Config panel state
            configPanel: {
                visible: false,
                nodeId: null,
            },
        });

        // Resize observer to update viewport on window resize
        this._resizeObserver = new ResizeObserver(() => this.updateViewRect());
        onMounted(() => {
            if (this.rootRef.el) {
                this._resizeObserver.observe(this.rootRef.el);
                this.updateViewRect();
            }
        });

        // Pan/drag tracking (non-reactive)
        this._panStart = null;
        this._panInitial = null;

        // Performance: Reactive Set for node selection
        // Automatically handles reactivity for has/add/delete
        this.selection = reactive(new Set());

        // Global mouse listeners
        useExternalListener(document, "mousemove", this.onDocumentMouseMove.bind(this));
        useExternalListener(document, "mouseup", this.onDocumentMouseUp.bind(this));
        useExternalListener(document, "keydown", this.onKeyDown.bind(this));

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
     * Get nodes from props
     */
    get nodes() {
        return this.props.nodes || [];
    }

    /**
     * Get connections from props
     */
    get connections() {
        return this.props.connections || [];
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
     * Calculate viewport transform style
     * ESSENTIAL for pan/zoom - this is not an animation, it's the viewport positioning
     */
    get viewportTransformStyle() {
        const { panX, panY, zoom } = this.state.viewport;
        return `transform: translate(${panX}px, ${panY}px) scale(${zoom}); transform-origin: 0 0;`;
    }

    /**
     * Get style for the parent canvas to sync background pattern with viewport
     * This ensures the grid stays visible and correctly sized when zooming/panning
     */
    get canvasBackgroundStyle() {
        const { panX, panY, zoom } = this.state.viewport;
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
        const { zoom, panX, panY } = this.state.viewport;
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
        const { zoom, panX, panY } = this.state.viewport;
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
        const { zoom, panX, panY } = this.state.viewport;

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
            const delta = ev.deltaY > 0 ? 0.9 : 1.1;
            const newZoom = Math.min(Math.max(this.state.viewport.zoom * delta, 0.25), 2);

            // Zoom towards cursor position
            const rect = this.rootRef.el.getBoundingClientRect();
            const mouseX = ev.clientX - rect.left;
            const mouseY = ev.clientY - rect.top;

            // Adjust pan to zoom towards cursor
            const factor = newZoom / this.state.viewport.zoom;
            this.state.viewport.panX = mouseX - (mouseX - this.state.viewport.panX) * factor;
            this.state.viewport.panY = mouseY - (mouseY - this.state.viewport.panY) * factor;
            this.state.viewport.zoom = newZoom;

            this.updateViewRect();
        });
    }

    /**
     * Get zoom percentage for display
     */
    get zoomPercentage() {
        return Math.round(this.state.viewport.zoom * 100);
    }

    /**
     * Zoom in by 10%
     */
    zoomIn() {
        const newZoom = Math.min(this.state.viewport.zoom * 1.1, 2);
        this.state.viewport.zoom = newZoom;
    }

    /**
     * Zoom out by 10%
     */
    zoomOut() {
        const newZoom = Math.max(this.state.viewport.zoom * 0.9, 0.25);
        this.state.viewport.zoom = newZoom;
    }

    /**
     * Reset zoom to 100% and pan to origin
     */
    resetZoom() {
        this.state.viewport.zoom = 1;
        this.state.viewport.panX = 0;
        this.state.viewport.panY = 0;
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

        this.state.viewport = { zoom, panX, panY };
    }

    // =========================================
    // Tidy Up: Auto-Layout
    // =========================================

    /**
     * Auto-arrange nodes using Dagre.js layout algorithm
     * Supports cyclic graphs (loop nodes) via back-edge detection
     * Uses n8n-style subgraph splitting for disconnected components
     */
    tidyUp() {
        if (this.nodes.length === 0) return;

        // Create graph from current nodes and connections
        const graph = WorkflowGraph.fromNodes(this.nodes, this.connections);

        // Run Dagre layout with subgraph splitting (n8n-style)
        // Handles cycles automatically, splits disconnected components
        const positions = graph.layoutWithSplitting();

        // Apply new positions to nodes and notify parent of each change
        // This ensures Core layer (WorkflowEditor) is synced
        for (const node of this.nodes) {
            const pos = positions[node.id];
            if (pos) {
                // Update local UI state
                node.x = pos.x;
                node.y = pos.y;

                // Sync with Core layer
                this.props.onNodePositionChange({
                    nodeId: node.id,
                    x: pos.x,
                    y: pos.y,
                });
            }
        }
    }

    /**
     * Get CSS style for selection box
     */
    get selectionBoxStyle() {
        const box = this.state.selectionBox;
        if (!box) return '';

        const x = Math.min(box.startX, box.endX);
        const y = Math.min(box.startY, box.endY);
        const w = Math.abs(box.endX - box.startX);
        const h = Math.abs(box.endY - box.startY);

        return `left:${x}px; top:${y}px; width:${w}px; height:${h}px;`;
    }

    /**
     * Complete selection - find nodes within selection box
     */
    completeSelection() {
        const box = this.state.selectionBox;
        if (!box) return;

        const minX = Math.min(box.startX, box.endX);
        const maxX = Math.max(box.startX, box.endX);
        const minY = Math.min(box.startY, box.endY);
        const maxY = Math.max(box.startY, box.endY);

        const NODE_WIDTH = 180;
        const NODE_HEIGHT = 80;

        const selected = this.nodes.filter(node => {
            const nodeRight = node.x + NODE_WIDTH;
            const nodeBottom = node.y + NODE_HEIGHT;
            return node.x < maxX && nodeRight > minX &&
                node.y < maxY && nodeBottom > minY;
        });

        // Clear and add to reactive Set
        this.selection.clear();
        selected.forEach(n => this.selection.add(n.id));

        // Flag to prevent onCanvasClick from clearing selection
        // (click event fires after mouseup)
        this._justCompletedSelection = true;
        setTimeout(() => { this._justCompletedSelection = false; }, 0);
    }

    /**
     * Clear all node/connection selections
     */
    clearSelection() {
        this.selection.clear();
        this.state.selectedConnectionIds = [];
    }

    /**
     * Calculate cubic bezier path between two points
     * Handles back-edges (source right of target) by routing around bottom
     * @param {number} sourceX 
     * @param {number} sourceY 
     * @param {number} targetX 
     * @param {number} targetY 
     * @returns {string} SVG path d attribute
     */
    getBezierPath(sourceX, sourceY, targetX, targetY) {
        const HANDLE_SIZE = 20;
        const isBackEdge = sourceX - HANDLE_SIZE > targetX;

        if (isBackEdge) {
            return this.getBackEdgePath(sourceX, sourceY, targetX, targetY);
        }

        // Normal forward bezier curve
        const dx = Math.abs(targetX - sourceX);
        const controlOffset = Math.max(dx * 0.5, 50);
        return `M ${sourceX} ${sourceY} C ${sourceX + controlOffset} ${sourceY}, ${targetX - controlOffset} ${targetY}, ${targetX} ${targetY}`;
    }

    /**
     * Calculate path for back-edges (connections going right-to-left)
     * Routes around the bottom of both nodes to avoid overlapping
     * Uses rounded corners at all 4 corners (like a rounded rectangle)
     * @param {number} sourceX 
     * @param {number} sourceY 
     * @param {number} targetX 
     * @param {number} targetY 
     * @returns {string} SVG path d attribute
     */
    getBackEdgePath(sourceX, sourceY, targetX, targetY) {
        const EDGE_PADDING_BOTTOM = 80;   // How far below to route
        const CORNER_RADIUS = 20;         // Radius for rounded corners

        // Calculate key positions
        const rightX = sourceX + CORNER_RADIUS;  // Right side vertical line
        const leftX = targetX - CORNER_RADIUS;   // Left side vertical line
        const bottomY = Math.max(sourceY, targetY) + EDGE_PADDING_BOTTOM;

        // Build path with 4 rounded corners (like rounded rectangle)
        // Path: source → right → corner1 → down → corner2 → left → corner3 → up → corner4 → target
        return `M ${sourceX} ${sourceY}
                L ${rightX} ${sourceY}
                Q ${rightX + CORNER_RADIUS} ${sourceY}, ${rightX + CORNER_RADIUS} ${sourceY + CORNER_RADIUS}
                L ${rightX + CORNER_RADIUS} ${bottomY - CORNER_RADIUS}
                Q ${rightX + CORNER_RADIUS} ${bottomY}, ${rightX} ${bottomY}
                L ${leftX} ${bottomY}
                Q ${leftX - CORNER_RADIUS} ${bottomY}, ${leftX - CORNER_RADIUS} ${bottomY - CORNER_RADIUS}
                L ${leftX - CORNER_RADIUS} ${targetY + CORNER_RADIUS}
                Q ${leftX - CORNER_RADIUS} ${targetY}, ${leftX} ${targetY}
                L ${targetX} ${targetY}`;
    }

    /**
     * Calculate paths for vertically stacked nodes (S-curve bracket routing)
     * Creates two bracket segments: "_]" and "[_" that form an S-shape
     * @param {number} sourceX 
     * @param {number} sourceY 
     * @param {number} targetX 
     * @param {number} targetY 
     * @returns {{ path1: string, path2: string }}
     */
    getVerticalStackPath(sourceX, sourceY, targetX, targetY) {
        const CORNER_RADIUS = 16;
        const EDGE_OFFSET_X = 60;  // Horizontal extension beyond nodes

        // Midpoint (junction between two segments)
        const midX = (sourceX + targetX) / 2;
        const midY = (sourceY + targetY) / 2;

        // Segment 1: Source → right → down → midpoint ("_]" shape)
        const rightX = Math.max(sourceX, targetX) + EDGE_OFFSET_X;
        const path1 = `M ${sourceX} ${sourceY}
            L ${rightX - CORNER_RADIUS} ${sourceY}
            Q ${rightX} ${sourceY}, ${rightX} ${sourceY + CORNER_RADIUS}
            L ${rightX} ${midY - CORNER_RADIUS}
            Q ${rightX} ${midY}, ${rightX - CORNER_RADIUS} ${midY}
            L ${midX} ${midY}`;

        // Segment 2: Midpoint → left → down → target ("[_" shape)
        const leftX = Math.min(sourceX, targetX) - EDGE_OFFSET_X;
        const path2 = `M ${midX} ${midY}
            L ${leftX + CORNER_RADIUS} ${midY}
            Q ${leftX} ${midY}, ${leftX} ${midY + CORNER_RADIUS}
            L ${leftX} ${targetY - CORNER_RADIUS}
            Q ${leftX} ${targetY}, ${leftX + CORNER_RADIUS} ${targetY}
            L ${targetX} ${targetY}`;

        return { path1, path2 };
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
        // Use connection constants from dimensions module
        const EDGE_DETECTION = CONNECTION;

        return this.visibleConnections.map(conn => {
            const sourceNode = this.nodes.find(n => n.id === conn.source);
            const targetNode = this.nodes.find(n => n.id === conn.target);

            if (!sourceNode || !targetNode) {
                return { ...conn, paths: [''], isBackEdge: false, isVerticalStack: false };
            }

            const sourcePos = this.getSocketPositionForNode(
                sourceNode, conn.sourceHandle, 'output'
            );
            const targetPos = this.getSocketPositionForNode(
                targetNode, conn.targetHandle, 'input'
            );

            // Calculate deltas
            const deltaX = sourcePos.x - targetPos.x;
            const deltaY = targetPos.y - sourcePos.y;

            // Detect vertical stack using ratio-based approach
            // S-curve ONLY when: 
            // 1. Target is to the LEFT of source (backward connection)
            // 2. Target is significantly below source
            const isVerticalStack =
                deltaY > EDGE_DETECTION.MIN_DELTA_Y &&
                deltaX > 0;

            // Detect back-edge (source right of target) - excludes vertical stack
            const isBackEdge =
                sourcePos.x > targetPos.x &&
                !isVerticalStack;

            // Use S-curve bracket routing for vertically stacked nodes
            if (isVerticalStack) {
                const { path1, path2 } = this.getVerticalStackPath(
                    sourcePos.x, sourcePos.y, targetPos.x, targetPos.y
                );
                return {
                    ...conn,
                    paths: [path1, path2],
                    isBackEdge: false,
                    isVerticalStack: true
                };
            }

            // Normal or back-edge single path
            const path = this.getBezierPath(
                sourcePos.x, sourcePos.y,
                targetPos.x, targetPos.y
            );

            return { ...conn, paths: [path], isBackEdge, isVerticalStack: false };
        });
    }

    // =========================================
    // Phase 4: Interactive Connection Drawing
    // =========================================

    /**
     * Get temp connection path while drawing
     * Returns empty string if not drawing
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

        // If starting from output, draw normal direction
        // If starting from input, reverse the curve
        if (socketType === 'output') {
            return this.getBezierPath(startPos.x, startPos.y, endPos.x, endPos.y);
        } else {
            return this.getBezierPath(endPos.x, endPos.y, startPos.x, startPos.y);
        }
    }

    /**
     * Task 4.2: Handle socket mousedown - start drawing connection
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

            // Phase 5: Panning
            if (this.state.isPanning && this._panStart) {
                this.state.viewport.panX = this._panInitial.x + (ev.clientX - this._panStart.x);
                this.state.viewport.panY = this._panInitial.y + (ev.clientY - this._panStart.y);
                this.updateViewRect();
                return;
            }

            // Phase 6: Selection box
            if (this.state.isSelecting && this.state.selectionBox) {
                const pos = this.getCanvasPosition(ev);
                this.state.selectionBox.endX = pos.x;
                this.state.selectionBox.endY = pos.y;
                return;
            }

            // Phase 4: Connection drawing
            if (!this.state.isConnecting) return;

            const pos = this.getCanvasPosition(ev);
            this.state.tempLineEndpoint = pos;

            // Smart snapping: find nearest socket
            const sourceNodeId = this.state.connectionStart?.nodeId;
            this.state.snappedSocket = this.findNearestSocket(pos.x, pos.y, sourceNodeId);
        });
    }

    /**
     * Task 4.5: Cancel connection if mouse released outside socket
     * @param {MouseEvent} ev
     */
    onDocumentMouseUp(ev) {
        // Phase 5: End panning
        if (this.state.isPanning) {
            this.state.isPanning = false;
            this._panStart = null;
            this._panInitial = null;
            return;
        }

        // Phase 6: End selection
        if (this.state.isSelecting) {
            this.completeSelection();
            this.state.isSelecting = false;
            this.state.selectionBox = null;
            return;
        }

        // Phase 4: Connection drawing
        if (!this.state.isConnecting) return;

        // Smart snapping: if snapped to a socket, create connection
        if (this.state.snappedSocket) {
            const start = this.state.connectionStart;
            if (start && start.socketType === 'output') {
                this.props.onConnectionCreate({
                    source: start.nodeId,
                    sourceHandle: start.socketKey,
                    target: this.state.snappedSocket.nodeId,
                    targetHandle: this.state.snappedSocket.socketKey,
                });
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

        this.cancelConnection();
    }

    /**
     * Task 4.4: Handle socket mouseup - complete connection
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
            this.props.onConnectionCreate({
                source: start.nodeId,
                sourceHandle: start.socketKey,
                target: nodeId,
                targetHandle: socketKey,
            });
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

        this.props.onDropNode({ type, position });
    }

    /**
     * Handle node position change during drag
     * Task 3.6: Connections auto-update via OWL reactivity
     * @param {{ nodeId: string, x: number, y: number }} param
     */
    onNodeMove({ nodeId, x, y }) {
        // Find node in props and update directly (reactive) for immediate local feedback
        const node = this.nodes.find(n => n.id === nodeId);
        if (node) {
            node.x = x;
            node.y = y;

            // Throttle propagation to parent/core to 60fps (16ms)
            // This prevents flooding the undo stack and core logic during rapid drags
            if (this._throttleMove) return;
            this._throttleMove = setTimeout(() => {
                this.props.onNodePositionChange({ nodeId, x, y });
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

        if (isCtrlHeld) {
            // Ctrl+click: Toggle node in selection
            if (this.selection.has(node.id)) {
                this.selection.delete(node.id);
            } else {
                this.selection.add(node.id);
            }
        } else {
            // Normal click: Clear and add single
            this.selection.clear();
            this.selection.add(node.id);
        }

        this.state.selectedConnectionIds = []; // Clear connection selection

        // Notify parent of the most recently selected node (primary selection)
        // If node was deselected, fallback to arbitrary one or null
        if (this.selection.has(node.id)) {
            this.props.onSelectNode(node);
        } else {
            // Get last item from Set (if any)
            const ids = Array.from(this.selection);
            const lastId = ids.length > 0 ? ids[ids.length - 1] : null;
            const lastNode = lastId ? this.nodes.find(n => n.id === lastId) : null;
            this.props.onSelectNode(lastNode);
        }
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
            this.props.onSelectNode(null);
        }
    }

    /**
     * Handle connection selection
     * @param {string} connId 
     */
    onConnectionSelect(connId) {
        this.state.selectedConnectionIds = [connId];
        this.selection.clear();
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
            if (this.selection.size > 0) {
                // Create copy to iterate safely
                [...this.selection].forEach(id => {
                    this.props.removeNode(id);
                });
                this.selection.clear();
            }

            // Delete connection
            if (this.state.selectedConnectionIds.length > 0) {
                [...this.state.selectedConnectionIds].forEach(id => {
                    this.props.removeConnection(id);
                });
                this.state.selectedConnectionIds = [];
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

            this.selection.forEach(nodeId => {
                const node = this.nodes.find(n => n.id === nodeId);
                if (node) {
                    this.props.onNodePositionChange?.({
                        nodeId,
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
            console.log('[EditorCanvas] Ctrl+Z detected');
            ev.preventDefault();
            if (ev.shiftKey) {
                console.log('[EditorCanvas] Redo (Shift+Ctrl+Z)');
                this.props.redo();
            } else {
                console.log('[EditorCanvas] Undo');
                this.props.undo();
            }
            return;
        }

        if (ctrl && ev.key.toLowerCase() === 'y') {
            console.log('[EditorCanvas] Ctrl+Y detected');
            ev.preventDefault();
            this.props.redo();
            return;
        }
    }

    // =========================================
    // Copy/Paste Implementation
    // =========================================

    /**
     * Copy selected nodes to system clipboard
     * Phase 3: Uses adapterService to get config (no _node access)
     */
    async copySelectedNodes() {
        // Prioritize multiple selection list
        if (this.selection.size === 0) return;

        const nodesToCopy = this.nodes.filter(n => this.selection.has(n.id));
        const connectionsToCopy = this.connections.filter(
            c => this.selection.has(c.source) && this.selection.has(c.target)
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

    /**
     * Paste nodes from system clipboard
     */
    async pasteNodes() {
        console.log('[EditorCanvas] pasteNodes start');
        try {
            const text = await navigator.clipboard.readText();
            const data = JSON.parse(text);

            if (!data.nodes || !Array.isArray(data.nodes)) {
                console.warn('[EditorCanvas] Invalid clipboard data');
                return;
            }

            // Start history batch
            this.props.onBeginBatch('Paste nodes');

            const PASTE_OFFSET_X = 50;
            const PASTE_OFFSET_Y = 50;
            const idMap = {};

            // Create new nodes with offset
            data.nodes.forEach(nodeData => {
                // Use props callback to create node (handled by dev_demo_app)
                const newId = this.props.onPasteNode({
                    type: nodeData.type,
                    position: {
                        x: (nodeData.x || 0) + PASTE_OFFSET_X,
                        y: (nodeData.y || 0) + PASTE_OFFSET_Y,
                    },
                    config: nodeData.config,
                });
                if (newId) {
                    idMap[nodeData.id] = newId;
                }
            });

            // Recreate connections between pasted nodes
            (data.connections || []).forEach(conn => {
                if (idMap[conn.source] && idMap[conn.target]) {
                    this.props.onConnectionCreate({
                        source: idMap[conn.source],
                        sourceHandle: conn.sourceHandle,
                        target: idMap[conn.target],
                        targetHandle: conn.targetHandle,
                    });
                }
            });

            // End history batch
            this.props.onEndBatch('Paste nodes');

            console.log(`[EditorCanvas] Pasted ${data.nodes.length} nodes`);
        } catch (e) {
            this.props.onEndBatch(); // Clean up on error
            console.warn('[EditorCanvas] Failed to paste from clipboard:', e);
        }
    }


    /**
     * Check if node is selected
     * Uses Set for O(1) lookup instead of Array.includes O(n)
     * @param {Object} node 
     * @returns {boolean}
     */
    isNodeSelected(node) {
        return this.selection.has(node.id);
    }

    /**
     * Handle canvas mousedown - start pan or selection
     * @param {MouseEvent} ev
     */
    onCanvasMouseDown(ev) {
        // Ignore clicks inside UI overlays (NodeMenu, Toolbar, etc.)
        if (ev.target.closest('.node-menu') || ev.target.closest('.connection-toolbar') || ev.target.closest('.workflow-editor-canvas__controls')) {
            return;
        }

        // Middle mouse = pan
        if (ev.button === 1) {
            ev.preventDefault();
            this.state.isPanning = true;
            this._panStart = { x: ev.clientX, y: ev.clientY };
            this._panInitial = {
                x: this.state.viewport.panX,
                y: this.state.viewport.panY
            };
            return;
        }

        // Left click on empty canvas = start selection
        // Check if clicking on canvas background, not on a node
        const isCanvasBackground =
            ev.target === this.rootRef.el ||
            ev.target === this.contentRef.el ||
            ev.target.classList?.contains('workflow-editor-canvas__content') ||
            ev.target.classList?.contains('workflow-connections') ||
            ev.target.classList?.contains('workflow-editor-canvas');

        const isOnNode = ev.target.closest?.('.workflow-node');

        if (ev.button === 0 && isCanvasBackground && !isOnNode) {
            const pos = this.getCanvasPosition(ev);
            this.state.isSelecting = true;
            this.state.selectionBox = {
                startX: pos.x,
                startY: pos.y,
                endX: pos.x,
                endY: pos.y,
            };
            // Clear previous selection
            this.clearSelection();
        }
    }

    // =========================================
    // Phase 4: NodeMenu & ConnectionToolbar
    // =========================================

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

        if (connectionContext?.type === 'quickAdd') {
            // Quick-add from socket: create node and auto-connect
            const { sourceNodeId, sourceSocketKey } = connectionContext;
            const newNodeId = this.props.onDropNode({ type: nodeType, position });

            if (newNodeId) {
                // Use setTimeout to ensure node is in state
                setTimeout(() => {
                    const newNode = this.nodes.find(n => n.id === newNodeId);
                    const firstInputKey = Object.keys(newNode?.inputs || {})[0];

                    if (firstInputKey) {
                        this.props.onConnectionCreate({
                            source: sourceNodeId,
                            sourceHandle: sourceSocketKey,
                            target: newNodeId,
                            targetHandle: firstInputKey,
                        });
                    }
                }, 0);
            }
        } else if (connectionContext?.connectionId) {
            // Inserting node into existing connection
            this._insertNodeIntoConnection(nodeType, { connectionId: connectionContext.connectionId, position });
        } else {
            // Adding new node at position
            this.props.onDropNode({ type: nodeType, position });
        }
    }

    /**
     * Close NodeMenu
     */
    onNodeMenuClose() {
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
        const newNodeId = this.props.onDropNode({ type: nodeType, position });
        if (!newNodeId) return;

        // 2. Remove old connection A→B
        this.props.removeConnection(connectionId);

        // 3. Use setTimeout to ensure the new node is available in state
        // This handles the async nature of reactive state updates
        setTimeout(() => {
            const newNode = this.nodes.find(n => n.id === newNodeId);
            if (!newNode) {
                console.warn('[EditorCanvas] New node not found after insert:', newNodeId);
                return;
            }

            // Get first input socket of new node (for incoming connection)
            const newNodeInputKey = Object.keys(newNode.inputs || {})[0];
            // Get first output socket of new node (for outgoing connection)
            const newNodeOutputKey = Object.keys(newNode.outputs || {})[0];

            if (!newNodeInputKey) {
                console.warn('[EditorCanvas] New node has no input sockets');
                return;
            }

            // 3. Create connection from old source to new node (A→C)
            this.props.onConnectionCreate({
                source: originalSource,
                sourceHandle: originalSourceHandle,
                target: newNodeId,
                targetHandle: newNodeInputKey,
            });

            // 4. Create connection from new node to original target (C→B)
            if (newNodeOutputKey) {
                this.props.onConnectionCreate({
                    source: newNodeId,
                    sourceHandle: newNodeOutputKey,
                    target: originalTarget,
                    targetHandle: originalTargetHandle,
                });
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
        this.props.removeConnection(connectionId);
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
     * Handle double-click on node to open config panel
     */
    onNodeDoubleClick = (nodeId) => {
        this.state.configPanel = {
            visible: true,
            nodeId: nodeId,
            node: this.nodes.find(n => n.id === nodeId),
        };
    };

    /**
     * Get the node currently being configured
     */
    get configPanelNode() {
        if (!this.state.configPanel.nodeId) return null;
        return this.nodes.find(n => n.id === this.state.configPanel.nodeId) || null;
    }

    /**
     * Close config panel
     */
    onConfigPanelClose = () => {
        this.state.configPanel = {
            visible: false,
            nodeId: null,
        };
    };

    /**
     * Save config panel changes
     *
     * Phase 3: Config is saved via adapterService
     * No direct _node access needed
     */
    onConfigPanelSave = (values) => {
        const nodeId = this.state.configPanel.nodeId;
        if (!nodeId) return;

        // adapterService handles config persistence to Core layer
        // NodeConfigPanel already syncs config when saving
        console.log('[EditorCanvas] Config panel saved for node:', nodeId);

        this.onConfigPanelClose();
    };

    /**
     * Handle node execution callback
     * Passes to parent for variable inspector refresh
     */
    onConfigPanelExecute = (nodeId, result) => {
        console.log('[EditorCanvas] Node executed:', nodeId);
        this.props.onNodeExecute?.(nodeId, result);
    };
}


