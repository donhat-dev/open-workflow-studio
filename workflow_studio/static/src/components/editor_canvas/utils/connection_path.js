/** @odoo-module **/

/**
 * Connection Path Utilities
 * 
 * Pure functions for calculating SVG paths between connection points.
 * No OWL dependencies - framework agnostic.
 */

/**
 * Calculate normal forward bezier curve between two points
 * @param {number} sourceX 
 * @param {number} sourceY 
 * @param {number} targetX 
 * @param {number} targetY 
 * @returns {string} SVG path d attribute
 */
export function getBezierPath(sourceX, sourceY, targetX, targetY) {
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
export function getBackEdgePath(sourceX, sourceY, targetX, targetY) {
    const EDGE_PADDING_BOTTOM = 80;
    const CORNER_RADIUS = 20;

    const rightX = sourceX + CORNER_RADIUS;
    const leftX = targetX - CORNER_RADIUS;
    const bottomY = Math.max(sourceY, targetY) + EDGE_PADDING_BOTTOM;

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
export function getVerticalStackPath(sourceX, sourceY, targetX, targetY) {
    const CORNER_RADIUS = 16;
    const EDGE_OFFSET_X = 60;

    const midX = (sourceX + targetX) / 2;
    const midY = (sourceY + targetY) / 2;

    const rightX = Math.max(sourceX, targetX) + EDGE_OFFSET_X;
    const path1 = `M ${sourceX} ${sourceY}
        L ${rightX - CORNER_RADIUS} ${sourceY}
        Q ${rightX} ${sourceY}, ${rightX} ${sourceY + CORNER_RADIUS}
        L ${rightX} ${midY - CORNER_RADIUS}
        Q ${rightX} ${midY}, ${rightX - CORNER_RADIUS} ${midY}
        L ${midX} ${midY}`;

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
 * Calculate connection path(s) based on source and target positions
 * @param {{ x: number, y: number }} sourcePos
 * @param {{ x: number, y: number }} targetPos
 * @param {{ isVerticalStack: boolean, isBackEdge: boolean }} connectionType
 * @returns {{ paths: string[], isBackEdge: boolean, isVerticalStack: boolean }}
 */
export function getConnectionPath(sourcePos, targetPos, connectionType) {
    const { isVerticalStack, isBackEdge } = connectionType;

    if (isVerticalStack) {
        const { path1, path2 } = getVerticalStackPath(
            sourcePos.x, sourcePos.y, targetPos.x, targetPos.y
        );
        return { paths: [path1, path2], isBackEdge: false, isVerticalStack: true };
    }

    if (isBackEdge) {
        const path = getBackEdgePath(
            sourcePos.x, sourcePos.y, targetPos.x, targetPos.y
        );
        return { paths: [path], isBackEdge: true, isVerticalStack: false };
    }

    const path = getBezierPath(
        sourcePos.x, sourcePos.y, targetPos.x, targetPos.y
    );
    return { paths: [path], isBackEdge: false, isVerticalStack: false };
}

/**
 * Calculate midpoint of a bezier path for toolbar positioning
 * @param {string} pathD - SVG path d attribute
 * @returns {{ x: number, y: number }}
 */
export function getPathMidpoint(pathD) {
    // Create temp SVG to calculate point on path
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathD);
    svg.appendChild(path);
    document.body.appendChild(svg);

    try {
        const length = path.getTotalLength();
        const point = path.getPointAtLength(length / 2);
        return { x: point.x, y: point.y };
    } finally {
        document.body.removeChild(svg);
    }
}
