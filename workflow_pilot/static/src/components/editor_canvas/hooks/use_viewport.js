/** @odoo-module **/

import { useState, useRef, onMounted } from "@odoo/owl";
import { screenToCanvas, canvasToScreen, clamp } from "../utils/geometry";

/**
 * useViewport Hook
 * 
 * Manages viewport state (zoom, pan) and provides viewport-related methods.
 * 
 * @param {{ editor: Object, rootRef: { el: HTMLElement } }} params
 * @returns {Object} Viewport state and methods
 */
export function useViewport({ editor, rootRef }) {
    // RAF frame for throttling wheel zoom
    let scrollFrame = null;

    // View rect tracking
    const viewRect = useState({
        x: 0,
        y: 0,
        width: 0,
        height: 0,
    });

    /**
     * Get reactive viewport from editor service state
     */
    function getViewport() {
        const { pan, zoom } = editor.state.ui.viewport;
        return {
            zoom,
            panX: pan.x,
            panY: pan.y,
        };
    }

    /**
     * Calculate viewport transform style for CSS
     */
    function getViewportTransformStyle() {
        const viewport = getViewport();
        return `transform: translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})`;
    }

    /**
     * Get CSS for canvas background (grid pattern)
     */
    function getCanvasBackgroundStyle() {
        const viewport = getViewport();
        const gridSize = 20 * viewport.zoom;
        return `background-size: ${gridSize}px ${gridSize}px; background-position: ${viewport.panX}px ${viewport.panY}px;`;
    }

    /**
     * Convert screen coordinates to canvas coordinates
     */
    function getCanvasPosition(ev) {
        const viewport = getViewport();
        return screenToCanvas(ev, rootRef.el, viewport);
    }

    /**
     * Convert canvas coordinates to screen coordinates
     */
    function getScreenPosition(canvasX, canvasY) {
        const viewport = getViewport();
        return canvasToScreen(canvasX, canvasY, viewport);
    }

    /**
     * Update visible viewport rectangle (canvas coordinates)
     */
    function updateViewRect() {
        if (!rootRef.el) return;

        const viewport = getViewport();
        const rect = rootRef.el.getBoundingClientRect();

        // Convert screen rect to canvas coordinates
        Object.assign(viewRect, {
            x: -viewport.panX / viewport.zoom,
            y: -viewport.panY / viewport.zoom,
            width: rect.width / viewport.zoom,
            height: rect.height / viewport.zoom,
        });
    }

    /**
     * Handle wheel event for zoom
     */
    function onWheel(ev) {
        // Skip if over overlays
        if (ev.target.closest('.node-menu') || ev.target.closest('.connection-toolbar')) {
            return;
        }

        ev.preventDefault();
        if (scrollFrame) return;

        scrollFrame = requestAnimationFrame(() => {
            scrollFrame = null;
            const viewport = getViewport();
            const delta = ev.deltaY > 0 ? 0.9 : 1.1;
            const newZoom = clamp(viewport.zoom * delta, 0.25, 2);

            // Zoom towards cursor
            const rect = rootRef.el.getBoundingClientRect();
            const mouseX = ev.clientX - rect.left;
            const mouseY = ev.clientY - rect.top;

            const factor = newZoom / viewport.zoom;
            const newPanX = mouseX - (mouseX - viewport.panX) * factor;
            const newPanY = mouseY - (mouseY - viewport.panY) * factor;

            editor.actions.setViewport({
                pan: { x: newPanX, y: newPanY },
                zoom: newZoom,
            });

            updateViewRect();
        });
    }

    /**
     * Get zoom percentage for display
     */
    function getZoomPercentage() {
        return Math.round(getViewport().zoom * 100);
    }

    /**
     * Zoom in by 10%
     */
    function zoomIn() {
        const currentZoom = getViewport().zoom;
        const newZoom = Math.min(Math.round((currentZoom + 0.1) * 10) / 10, 2);
        editor.actions.zoomTo(newZoom);
    }

    /**
     * Zoom out by 10%
     */
    function zoomOut() {
        const currentZoom = getViewport().zoom;
        const newZoom = Math.max(Math.round((currentZoom - 0.1) * 10) / 10, 0.25);
        editor.actions.zoomTo(newZoom);
    }

    /**
     * Reset zoom to 100% and pan to origin
     */
    function resetZoom() {
        editor.actions.resetViewport();
    }

    /**
     * Fit all nodes into viewport
     * @param {Array} nodes - Array of node objects with x, y
     */
    function fitToView(nodes) {
        if (!nodes || nodes.length === 0) return;

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

        if (!rootRef.el) return;
        const rect = rootRef.el.getBoundingClientRect();

        const zoom = Math.min(
            rect.width / contentWidth,
            rect.height / contentHeight,
            1
        );

        const panX = -bounds.minX + PADDING + (rect.width / zoom - contentWidth) / 2;
        const panY = -bounds.minY + PADDING + (rect.height / zoom - contentHeight) / 2;

        editor.actions.setViewport({
            pan: { x: panX, y: panY },
            zoom,
        });
    }

    // Initialize view rect on mount
    onMounted(() => {
        updateViewRect();
    });

    return {
        // State
        viewRect,

        // Getters
        getViewport,
        getViewportTransformStyle,
        getCanvasBackgroundStyle,
        getZoomPercentage,

        // Coordinate conversion
        getCanvasPosition,
        getScreenPosition,
        updateViewRect,

        // Actions
        onWheel,
        zoomIn,
        zoomOut,
        resetZoom,
        fitToView,
    };
}
