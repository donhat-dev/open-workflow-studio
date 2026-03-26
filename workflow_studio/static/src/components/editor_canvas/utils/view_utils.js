/** @odoo-module **/

/**
 * View Utilities
 * 
 * Helper functions for viewport calculations.
 * Pure functions: no framework dependencies.
 */

/**
 * Calculate conservative node height estimate for fitting
 * @param {Object} node - Node data
 * @param {Object} dims - Dimension config object
 * @returns {number} Estimated height
 */
export function estimateNodeHeight(node, dims) {
    if (dims && typeof dims.estimateNodeHeight === "function") {
        return dims.estimateNodeHeight(node);
    }

    const inputCount = Object.keys(node.inputs || {}).length;
    const outputCount = Object.keys(node.outputs || {}).length;
    const rows = Math.max(inputCount, outputCount, 1);

    // Conservative estimate; OK if slightly larger than actual DOM.
    return (
        dims.nodeHeaderHeight +
        (dims.nodeBodyPadding * 2) +
        dims.socketOffsetY +
        (Math.max(0, rows - 1) * dims.socketSpacing) +
        (dims.socketRadius * 2)
    );
}

function getFitZoom(mode, canvasRect, contentWidth, contentHeight, topOffsetPx) {
    const availableHeight = Math.max(canvasRect.height - topOffsetPx, 1);
    const widthZoom = canvasRect.width / contentWidth;
    const heightZoom = availableHeight / contentHeight;

    if (mode === "cover-width") {
        return Math.min(widthZoom, 1);
    }
    if (mode === "cover-height") {
        return Math.min(heightZoom, 1);
    }

    return Math.min(widthZoom, heightZoom, 1);
}

/**
 * Calculate viewport transform to fit nodes
 * @param {Array} nodes - Array of nodes
 * @param {Object} dims - Dimension config object
 * @param {Object} canvasRect - Canvas bounding client rect { width, height }
 * @param {Object} [options] - Fit options
 * @param {number} [options.padding=50] - Padding around content
 * @param {"contain"|"cover-width"|"cover-height"} [options.mode="contain"] - Fit mode
 * @param {number} [options.topOffsetPx=0] - Reserved top area in screen pixels (e.g. toolbar)
 * @returns {{ zoom: number, panX: number, panY: number } | null}
 */
export function calculateFitView(nodes, dims, canvasRect, options = {}) {
    if (!nodes || nodes.length === 0 || !canvasRect) return null;

    const padding = typeof options.padding === "number" ? options.padding : 50;
    const mode = options.mode || "contain";
    const topOffsetPx = Math.max(0, options.topOffsetPx || 0);

    const xs = nodes.map((n) => n.x || 0);
    const ys = nodes.map((n) => n.y || 0);

    // Calculate max X/Y considering node dimensions
    const maxX = nodes.reduce((acc, n) => Math.max(acc, (n.x || 0) + dims.nodeWidth), -Infinity);
    const maxY = nodes.reduce((acc, n) => Math.max(acc, (n.y || 0) + estimateNodeHeight(n, dims)), -Infinity);

    const bounds = {
        minX: Math.min(...xs),
        maxX,
        minY: Math.min(...ys),
        maxY,
    };

    const contentWidth = Math.max(bounds.maxX - bounds.minX + padding * 2, 1);
    const contentHeight = Math.max(bounds.maxY - bounds.minY + padding * 2, 1);

    // Calculate zoom by fit mode (max 1 = don't zoom in beyond 100%)
    const zoom = getFitZoom(mode, canvasRect, contentWidth, contentHeight, topOffsetPx);
    const topOffsetWorld = topOffsetPx / zoom;
    const availableHeightWorld = Math.max((canvasRect.height - topOffsetPx) / zoom, 1);
    const centerYOffset = (availableHeightWorld - contentHeight) / 2;
    const fitTopOffset = mode === "cover-width" ? 0 : centerYOffset;

    const panX = canvasRect.width / 2 - ((bounds.minX + bounds.maxX) / 2) * zoom;
    const panY = -bounds.minY + padding + topOffsetWorld + fitTopOffset;

    return {
        zoom,
        panX,
        panY,
    };
}

/**
 * Get node bounds using DimensionConfig
 * @param {Object} node - Node data
 * @param {Object} dims - Dimension config object
 * @returns {{ x: number, y: number, width: number, height: number }}
 */
export function getNodeBounds(node, dims) {
    const x = node.x || 0;
    const y = node.y || 0;
    return {
        x,
        y,
        width: dims.nodeWidth,
        height: estimateNodeHeight(node, dims),
    };
}
