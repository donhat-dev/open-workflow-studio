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

/**
 * Calculate viewport transform to fit nodes
 * @param {Array} nodes - Array of nodes
 * @param {Object} dims - Dimension config object
 * @param {Object} canvasRect - Canvas bounding client rect { width, height }
 * @param {number} [padding=50] - Padding around content
 * @returns {{ zoom: number, panX: number, panY: number } | null}
 */
export function calculateFitView(nodes, dims, canvasRect, padding = 50) {
    if (!nodes || nodes.length === 0 || !canvasRect) return null;

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

    const contentWidth = bounds.maxX - bounds.minX + padding * 2;
    const contentHeight = bounds.maxY - bounds.minY + padding * 2;

    // Calculate zoom to fit (max 1 = don't zoom in beyond 100%)
    const zoom = Math.min(
        canvasRect.width / contentWidth,
        canvasRect.height / contentHeight,
        1
    );

    // Calculate pan to center content
    const panX = -bounds.minX + padding + (canvasRect.width / zoom - contentWidth) / 2;
    const panY = -bounds.minY + padding + (canvasRect.height / zoom - contentHeight) / 2;

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
