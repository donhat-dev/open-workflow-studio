/** @odoo-module **/

/**
 * Workflow Studio - Unified Dimension Constants
 *
 * Centralized configuration for all node/component dimensions.
 * These values are used for:
 * - CSS sizing (via custom properties)
 * - Connection path calculations
 * - Socket position calculations
 * - Layout algorithms (Tidy Up, Fit to View)
 */

// =========================================
// Node Width Presets
// =========================================
export const NODE_WIDTH = {
    SMALL: 120,
    NORMAL: 240, // Wider for Odoo Card layout (Icon Left + Content Right)
    LARGE: 360,
};

// =========================================
// Node / Socket Geometry
// =========================================
export const NODE_CHROME_MIN_HEIGHT = 68; // Default outer node height for card chrome
export const NODE_BORDER_WIDTH = 2;       // Matches .workflow-node border thickness

export const SOCKET_PITCH = 24;           // Vertical distance between socket row centers
export const SOCKET_HITBOX_SIZE = 10;     // Invisible layout box used for interaction area
export const SOCKET_MARKER_WIDTH = 5;     // Visible vertical marker width
export const SOCKET_MARKER_HEIGHT = 10;   // Visible vertical marker height
export const SOCKET_CLEARANCE_Y = 10;     // Top/bottom breathing room around socket block
export const SOCKET_MIN_ROWS = 2;         // Keep single-socket nodes visually centered

export const SOCKET_ANCHOR_MODE = {
    BORDER_EDGE: "border-edge",
    MARKER_CENTER: "marker-center",
};

// =========================================
// Connection Path Constants
// =========================================
export const CONNECTION = {
    CORNER_RADIUS: 16,      // Bezier curve corner radius
    EDGE_OFFSET_X: 60,      // Horizontal extension for S-curve routing
    SNAP_DISTANCE: 30,      // Socket snapping threshold
    HANDLE_SIZE: 20,        // Buffer for back-edge detection
    VERTICAL_RATIO: 1.5,    // deltaY/deltaX threshold for S-curve
    MIN_DELTA_Y: 60,        // Minimum Y distance for S-curve
};

// =========================================
// Canvas / Grid Constants
// =========================================
export const GRID_SIZE = 20;           // Snap-to-grid size (also CSS background)
export const PASTE_OFFSET = 50;        // Offset when pasting nodes

// =========================================
// Fit To View Constants
// =========================================
export const FIT_VIEW_PADDING = 50;

/**
 * DimensionConfig Class
 *
 * Holds the current dimension configuration for an editor instance.
 * Can be initialized with custom values or defaults.
 */
export class DimensionConfig {
    constructor(config = {}) {
        // Node dimensions
        this.nodeWidth = config.nodeWidth ?? NODE_WIDTH.NORMAL;
        this.nodeChromeMinHeight = config.nodeChromeMinHeight ?? NODE_CHROME_MIN_HEIGHT;
        this.nodeBorderWidth = config.nodeBorderWidth ?? NODE_BORDER_WIDTH;

        // Socket dimensions
        this.socketPitch = config.socketPitch ?? config.socketSpacing ?? SOCKET_PITCH;
        this.socketHitboxSize = config.socketHitboxSize
            ?? (config.socketRadius !== undefined ? config.socketRadius * 2 : SOCKET_HITBOX_SIZE);
        this.socketMarkerWidth = config.socketMarkerWidth ?? SOCKET_MARKER_WIDTH;
        this.socketMarkerHeight = config.socketMarkerHeight ?? SOCKET_MARKER_HEIGHT;
        this.socketClearanceY = config.socketClearanceY ?? config.nodeBodyPadding ?? SOCKET_CLEARANCE_Y;
        this.socketMinRows = config.socketMinRows ?? SOCKET_MIN_ROWS;
        this.socketAnchorMode = config.socketAnchorMode ?? SOCKET_ANCHOR_MODE.MARKER_CENTER;

        // Grid
        this.gridSize = config.gridSize ?? GRID_SIZE;
    }

    /**
     * @param {Object} node
     * @param {string} socketType
     * @returns {string[]}
     */
    getSocketKeys(node, socketType) {
        const sockets = socketType === "input" ? node.inputs : node.outputs;
        return Object.keys(sockets || {});
    }

    /**
     * @param {Object} node
     * @param {string} socketType
     * @returns {number}
     */
    getSocketCount(node, socketType) {
        return this.getSocketKeys(node, socketType).length;
    }

    /**
     * @param {Object} node
     * @param {string} socketKey
     * @param {string} socketType
     * @returns {number}
     */
    getSocketIndex(node, socketKey, socketType) {
        const socketKeys = this.getSocketKeys(node, socketType);
        const index = socketKeys.indexOf(socketKey);
        return index >= 0 ? index : 0;
    }

    /**
     * Get the paired socket row count used for layout and height calculations.
     * @param {Object} node
     * @returns {number}
     */
    getSocketRowCount(node) {
        const inputCount = Object.keys((node && node.inputs) || {}).length;
        const outputCount = Object.keys((node && node.outputs) || {}).length;
        return Math.max(inputCount, outputCount, 0);
    }

    /**
     * Get the layout row count used to size the node and place sockets.
     * Keep at least 2 rows when sockets exist so a single socket can sit in
     * the vertical middle of the socket grid instead of hugging the top row.
     * @param {Object} node
     * @returns {number}
     */
    getSocketLayoutRowCount(node) {
        const rowCount = this.getSocketRowCount(node);
        if (!rowCount) {
            return 0;
        }
        return Math.max(rowCount, this.socketMinRows);
    }

    /**
     * Get the minimum height needed to host the centered socket block.
     * @param {Object} node
     * @returns {number}
     */
    getSocketDrivenMinHeight(node) {
        const layoutRowCount = this.getSocketLayoutRowCount(node);
        if (!layoutRowCount) {
            return 0;
        }
        return (layoutRowCount * this.socketPitch) + (this.socketClearanceY * 2);
    }

    /**
     * Get the minimum outer node height.
     * @param {Object} node
     * @returns {number}
     */
    getNodeMinHeight(node) {
        return Math.max(this.nodeChromeMinHeight, this.getSocketDrivenMinHeight(node));
    }

    /**
     * Get the X anchor for a socket according to the selected anchor mode.
     * @param {Object} node
     * @param {string} socketType
     * @returns {number}
     */
    getSocketCenterX(node, socketType) {
        const nodeX = (node && node.x) || 0;
        const borderEdgeX = socketType === "input"
            ? nodeX
            : nodeX + this.nodeWidth;

        if (this.socketAnchorMode === SOCKET_ANCHOR_MODE.BORDER_EDGE) {
            return borderEdgeX;
        }

        const markerHalfWidth = this.socketMarkerWidth / 2;
        return socketType === "input"
            ? borderEdgeX - markerHalfWidth
            : borderEdgeX + markerHalfWidth;
    }

    /**
     * Get the Y anchor for a socket using centered row geometry.
     * @param {Object} node
     * @param {string} socketKey
     * @param {string} socketType
     * @returns {number}
     */
    getSocketCenterY(node, socketKey, socketType) {
        const nodeY = (node && node.y) || 0;
        const nodeHeight = this.getNodeMinHeight(node);
        const socketCount = Math.max(this.getSocketCount(node, socketType), 1);
        const rowIndex = this.getSocketIndex(node, socketKey, socketType);
        const centeredIndex = rowIndex - ((socketCount - 1) / 2);

        return nodeY + (nodeHeight / 2) + (centeredIndex * this.socketPitch);
    }

    /**
     * Calculate socket anchor position from geometry only.
     * @param {Object} node - Node object with x, y, inputs, outputs
     * @param {string} socketKey - Socket key name
     * @param {string} socketType - 'input' or 'output'
     * @returns {{ x: number, y: number }}
     */
    getSocketPosition(node, socketKey, socketType) {
        return {
            x: this.getSocketCenterX(node, socketType),
            y: this.getSocketCenterY(node, socketKey, socketType),
        };
    }

    /**
     * Deterministic node height estimate for fitting and hit-testing.
     * @param {Object} node
     * @returns {number}
     */
    estimateNodeHeight(node) {
        return this.getNodeMinHeight(node);
    }

    /**
     * Get CSS custom properties for current config
     * @returns {Object} - CSS custom properties object
     */
    getCSSProperties() {
        return {
            '--node-width': `${this.nodeWidth}px`,
            '--node-border-width': `${this.nodeBorderWidth}px`,
            '--socket-pitch': `${this.socketPitch}px`,
            '--socket-hitbox-size': `${this.socketHitboxSize}px`,
            '--socket-marker-width': `${this.socketMarkerWidth}px`,
            '--socket-marker-height': `${this.socketMarkerHeight}px`,
            '--grid-size': `${this.gridSize}px`,
        };
    }

    /**
     * Build inline node style from node position + current dimension variables.
     * @param {Object} node
     * @returns {string}
     */
    getNodeStyle(node) {
        const x = (node && node.x) || 0;
        const y = (node && node.y) || 0;

        let styles = `left:${x}px;top:${y}px;`;
        const cssProps = this.getCSSProperties();
        for (const [key, value] of Object.entries(cssProps)) {
            styles += `${key}:${value};`;
        }

        styles += `min-height:${this.getNodeMinHeight(node)}px;`;

        return styles;
    }

    /**
     * Get node width class name
     * @returns {string} - CSS class like 'nw-180'
     */
    getNodeWidthClass() {
        return `nw-${this.nodeWidth}`;
    }
}

// Default instance for convenience
export const defaultDimensions = new DimensionConfig();

// =========================================
// Connection Path Helpers
// =========================================

/**
 * Detect connection type based on source/target positions
 * Centralizes the detection logic used by both renderedConnections and tempConnectionPath
 *
 * @param {{ x: number, y: number }} sourcePos - Source socket position
 * @param {{ x: number, y: number }} targetPos - Target socket position
 * @returns {{ isVerticalStack: boolean, isBackEdge: boolean }}
 */
export function detectConnectionType(sourcePos, targetPos) {
    const deltaX = sourcePos.x - targetPos.x;
    const deltaY = targetPos.y - sourcePos.y;

    // S-curve (vertical stack): target LEFT of source AND significantly below
    const isVerticalStack = deltaY > CONNECTION.MIN_DELTA_Y && deltaX > 0;

    // Back-edge: source right of target (with buffer), NOT vertical stack
    const isBackEdge = deltaX > CONNECTION.HANDLE_SIZE && !isVerticalStack;

    return { isVerticalStack, isBackEdge };
}
