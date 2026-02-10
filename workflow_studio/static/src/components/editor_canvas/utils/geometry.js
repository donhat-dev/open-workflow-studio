/** @odoo-module **/

/**
 * Geometry Utilities
 * 
 * Pure functions for geometric calculations.
 * No OWL dependencies - framework agnostic.
 */

/**
 * Check if a point is inside a rectangle
 * @param {{ x: number, y: number }} point
 * @param {{ x: number, y: number, width: number, height: number }} rect
 * @returns {boolean}
 */
export function pointInRect(point, rect) {
    return (
        point.x >= rect.x &&
        point.x <= rect.x + rect.width &&
        point.y >= rect.y &&
        point.y <= rect.y + rect.height
    );
}

/**
 * Check if two rectangles intersect
 * @param {{ x: number, y: number, width: number, height: number }} rect1
 * @param {{ x: number, y: number, width: number, height: number }} rect2
 * @returns {boolean}
 */
export function rectsIntersect(rect1, rect2) {
    return !(
        rect1.x + rect1.width < rect2.x ||
        rect2.x + rect2.width < rect1.x ||
        rect1.y + rect1.height < rect2.y ||
        rect2.y + rect2.height < rect1.y
    );
}

/**
 * Snap a value to a grid
 * @param {number} value
 * @param {number} gridSize
 * @returns {number}
 */
export function snapToGrid(value, gridSize) {
    return Math.round(value / gridSize) * gridSize;
}

/**
 * Snap a position {x, y} to grid
 * @param {{ x: number, y: number }} position
 * @param {number} gridSize
 * @returns {{ x: number, y: number }}
 */
export function snapPositionToGrid(position, gridSize) {
    return {
        x: snapToGrid(position.x, gridSize),
        y: snapToGrid(position.y, gridSize),
    };
}

/**
 * Calculate distance between two points
 * @param {{ x: number, y: number }} p1
 * @param {{ x: number, y: number }} p2
 * @returns {number}
 */
export function distance(p1, p2) {
    return Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
}

/**
 * Clamp a value between min and max
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

/**
 * Convert screen coordinates to canvas coordinates (accounting for zoom/pan)
 * @param {MouseEvent} ev - Mouse event
 * @param {HTMLElement} containerEl - Canvas container element
 * @param {{ panX: number, panY: number, zoom: number }} viewport
 * @returns {{ x: number, y: number }}
 */
export function screenToCanvas(ev, containerEl, viewport) {
    const rect = containerEl.getBoundingClientRect();
    return {
        x: (ev.clientX - rect.left - viewport.panX) / viewport.zoom,
        y: (ev.clientY - rect.top - viewport.panY) / viewport.zoom,
    };
}

/**
 * Convert canvas coordinates to screen coordinates
 * @param {number} canvasX
 * @param {number} canvasY
 * @param {{ panX: number, panY: number, zoom: number }} viewport
 * @returns {{ x: number, y: number }}
 */
export function canvasToScreen(canvasX, canvasY, viewport) {
    return {
        x: canvasX * viewport.zoom + viewport.panX,
        y: canvasY * viewport.zoom + viewport.panY,
    };
}

/**
 * Get normalized selection box from two corner points
 * (handles dragging in any direction)
 * @param {{ x: number, y: number }} startPoint
 * @param {{ x: number, y: number }} endPoint
 * @returns {{ x: number, y: number, width: number, height: number }}
 */
export function getSelectionBox(startPoint, endPoint) {
    return {
        x: Math.min(startPoint.x, endPoint.x),
        y: Math.min(startPoint.y, endPoint.y),
        width: Math.abs(endPoint.x - startPoint.x),
        height: Math.abs(endPoint.y - startPoint.y),
    };
}
