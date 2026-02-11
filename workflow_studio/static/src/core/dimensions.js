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
// Node Height Components
// =========================================
export const NODE_HEADER_HEIGHT = 44;  // Deprecated for positioning, kept for ref
export const NODE_BODY_PADDING = 10;   // Updated for Card layout

// =========================================
// Socket Dimensions
// =========================================
export const SOCKET_RADIUS = 5;        // Socket point radius
export const SOCKET_SPACING = 24;      // Vertical gap between socket rows
export const SOCKET_OFFSET_Y = 12;     // First socket offset from body top

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
        this.nodeWidth = config.nodeWidth || NODE_WIDTH.NORMAL;
        this.nodeHeaderHeight = config.nodeHeaderHeight || NODE_HEADER_HEIGHT;
        this.nodeBodyPadding = config.nodeBodyPadding || NODE_BODY_PADDING;

        // Socket dimensions
        this.socketRadius = config.socketRadius || SOCKET_RADIUS;
        this.socketSpacing = config.socketSpacing || SOCKET_SPACING;
        this.socketOffsetY = config.socketOffsetY || SOCKET_OFFSET_Y;

        // Grid
        this.gridSize = config.gridSize || GRID_SIZE;
    }

    /**
     * Calculate socket position based on node position and socket index
     * @param {Object} node - Node object with x, y, inputs, outputs
     * @param {string} socketKey - Socket key name
     * @param {string} socketType - 'input' or 'output'
     * @returns {{ x: number, y: number }}
     */
    getSocketPosition(node, socketKey, socketType) {
        // Get socket index
        const sockets = socketType === 'input' ? node.inputs : node.outputs;
        const socketKeys = Object.keys(sockets || {});
        const index = socketKeys.indexOf(socketKey);

        // For row-paired layout, we need max of inputs/outputs for row count
        const inputCount = Object.keys(node.inputs || {}).length;
        const outputCount = Object.keys(node.outputs || {}).length;

        // If row-paired, use the same row index for matching input/output
        // This ensures connections align properly
        const rowIndex = index >= 0 ? index : 0;

        // X position: left edge for inputs, right edge for outputs
        const x = socketType === 'input'
            ? node.x + this.socketRadius
            : node.x + this.nodeWidth - this.socketRadius;

        // Y position: body padding + socket offset + row spacing
        // (header height intentionally excluded for socket alignment)
        const y = node.y
            + this.nodeBodyPadding
            + this.socketOffsetY
            + (rowIndex * this.socketSpacing);

        return { x, y };
    }

    /**
     * Get CSS custom properties for current config
     * @returns {Object} - CSS custom properties object
     */
    getCSSProperties() {
        return {
            '--node-width': `${this.nodeWidth}px`,
            '--node-header-height': `${this.nodeHeaderHeight}px`,
            '--node-body-padding': `${this.nodeBodyPadding}px`,
            '--socket-radius': `${this.socketRadius}px`,
            '--socket-spacing': `${this.socketSpacing}px`,
            '--socket-offset-y': `${this.socketOffsetY}px`,
            '--grid-size': `${this.gridSize}px`,
        };
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
