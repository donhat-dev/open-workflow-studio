/** @odoo-module **/

import { useState, useRef, onMounted } from "@odoo/owl";
import { screenToCanvas, canvasToScreen, clamp } from "../utils/geometry";
import { calculateFitView } from "../utils/view_utils";

/**
 * useViewport Hook
 * 
 * Manages viewport state (zoom, pan) and provides viewport-related methods.
 * Supports both editor mode (via service) and viewer mode (via local state).
 * 
 * @param {{
 *   editor?: Object,              // Editor service (optional for viewer mode)
 *   rootRef: { el: HTMLElement },
 *   getDimensions: () => DimensionConfig,
 *   readonly?: boolean,           // Viewer mode flag
 *   initialViewport?: { pan: { x: number, y: number }, zoom: number }, // Initial state for viewer
 * }} params
 * @returns {Object} Viewport state and methods
 */
export function useViewport({ editor, rootRef, getDimensions, readonly = false, initialViewport }) {
    // RAF frame for throttling wheel zoom
    let scrollFrame = null;

    // Local viewport state for viewer mode
    const localViewport = useState({
        pan: initialViewport?.pan || { x: 0, y: 0 },
        zoom: initialViewport?.zoom || 1,
    });

    // View rect tracking
    const viewRect = useState({
        x: 0,
        y: 0,
        width: 0,
        height: 0,
    });

    /**
     * Get reactive viewport - from editor service or local state
     */
    function getViewport() {
        if (editor) {
            const { pan, zoom } = editor.state.ui.viewport;
            return { zoom, panX: pan.x, panY: pan.y };
        }
        return {
            zoom: localViewport.zoom,
            panX: localViewport.pan.x,
            panY: localViewport.pan.y,
        };
    }

    /**
     * Set viewport - to editor service or local state
     */
    function setViewport(viewportUpdate) {
        if (editor) {
            editor.actions.setViewport(viewportUpdate);
        } else {
            if (viewportUpdate.pan) {
                localViewport.pan = { ...localViewport.pan, ...viewportUpdate.pan };
            }
            if (viewportUpdate.zoom !== undefined) {
                localViewport.zoom = viewportUpdate.zoom;
            }
        }
    }

    /**
     * Calculate viewport transform style for CSS
     * Includes transform-origin for proper scaling
     */
    function getViewportTransformStyle() {
        const viewport = getViewport();
        return `transform: translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom}); transform-origin: 0 0;`;
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
     * Includes 300px buffer for smooth scrolling/panning
     */
    function updateViewRect() {
        if (!rootRef.el) return;

        const viewport = getViewport();
        const rect = rootRef.el.getBoundingClientRect();

        // Add 300px buffer for smooth scrolling/panning
        const BUFFER = 300;

        // Convert screen rect to canvas coordinates with buffer
        Object.assign(viewRect, {
            x: -viewport.panX / viewport.zoom - BUFFER,
            y: -viewport.panY / viewport.zoom - BUFFER,
            width: rect.width / viewport.zoom + (BUFFER * 2),
            height: rect.height / viewport.zoom + (BUFFER * 2),
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

            setViewport({
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
        if (editor) {
            editor.actions.zoomTo(newZoom);
        } else {
            setViewport({ zoom: newZoom });
        }
        updateViewRect();
    }

    /**
     * Zoom out by 10%
     */
    function zoomOut() {
        const currentZoom = getViewport().zoom;
        const newZoom = Math.max(Math.round((currentZoom - 0.1) * 10) / 10, 0.25);
        if (editor) {
            editor.actions.zoomTo(newZoom);
        } else {
            setViewport({ zoom: newZoom });
        }
        updateViewRect();
    }

    /**
     * Reset zoom to 100% and pan to origin
     */
    function resetZoom() {
        if (editor) {
            editor.actions.resetViewport();
        } else {
            setViewport({ pan: { x: 0, y: 0 }, zoom: 1 });
        }
        updateViewRect();
    }

    /**
     * Fit all nodes into viewport
     * @param {Array} nodes - Array of node objects with x, y
     */
    function fitToView(nodes) {
        if (!nodes || nodes.length === 0) return;
        if (!rootRef.el) return;

        const dims = getDimensions ? getDimensions() : null;
        if (!dims) return;

        const rect = rootRef.el.getBoundingClientRect();
        const viewState = calculateFitView(nodes, dims, rect);

        if (!viewState) return;

        setViewport({
            pan: { x: viewState.panX, y: viewState.panY },
            zoom: viewState.zoom,
        });

        updateViewRect();
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
