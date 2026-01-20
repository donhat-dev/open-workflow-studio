/** @odoo-module **/

import { useState, useExternalListener } from "@odoo/owl";
import { screenToCanvas, getSelectionBox } from "../utils/geometry";
import { getNodeBounds } from "../utils/view_utils";

/**
 * useCanvasGestures Hook
 * 
 * Manages canvas gestures: panning (middle mouse) and box selection (left click on empty area).
 * Follows pattern: hook returns state + handlers.
 * 
 * @param {{ 
 *   editor: Object, 
 *   rootRef: { el: HTMLElement },
 *   getViewport: () => { panX: number, panY: number, zoom: number },
 *   getCanvasPosition: (ev: MouseEvent) => { x: number, y: number },
 *   onViewRectUpdate: () => void,
 * }} params
 * @returns {Object} Gesture state and handlers
 */
export function useCanvasGestures({
    editor,
    rootRef,
    getViewport,
    getCanvasPosition,
    onViewRectUpdate,
    getDimensions
}) {
    // Gesture state
    const state = useState({
        isPanning: false,
        isSelecting: false,
        selectionBox: null,
    });

    // Non-reactive tracking (no re-render needed)
    let panStart = null;
    let panInitial = null;
    let mouseMoveFrame = null;

    /**
     * Check if event target is UI overlay that should not trigger gestures
     */
    function isOverlay(target) {
        return (
            target.closest('.node-menu') ||
            target.closest('.connection-toolbar') ||
            target.closest('.workflow-editor-canvas__controls')
        );
    }

    /**
     * Check if click is on canvas background (not on nodes or overlays)
     */
    function isCanvasBackground(ev) {
        if (!rootRef.el) return false;
        return (
            ev.target === rootRef.el ||
            ev.target.classList?.contains('workflow-editor-canvas__content') ||
            ev.target.classList?.contains('workflow-connections') ||
            ev.target.classList?.contains('workflow-editor-canvas')
        );
    }

    /**
     * Handle canvas mousedown - start pan or selection
     */
    function onCanvasMouseDown(ev) {
        if (isOverlay(ev.target)) return;

        // Middle mouse = pan
        if (ev.button === 1) {
            ev.preventDefault();
            state.isPanning = true;
            panStart = { x: ev.clientX, y: ev.clientY };
            const viewport = getViewport();
            panInitial = { x: viewport.panX, y: viewport.panY };
            return;
        }

        // Left click on empty canvas = start selection box
        const isOnNode = ev.target.closest?.('.workflow-node');
        if (ev.button === 0 && isCanvasBackground(ev) && !isOnNode) {
            const pos = getCanvasPosition(ev);
            state.isSelecting = true;
            state.selectionBox = {
                startX: pos.x,
                startY: pos.y,
                endX: pos.x,
                endY: pos.y,
            };
            editor.actions.select([]);
        }
    }

    /**
     * Handle document mousemove for pan and selection
     * Returns true if gesture was handled (to skip other handlers)
     */
    function handleMouseMove(ev) {
        // Pan gesture
        if (state.isPanning && panStart && panInitial) {
            const newPanX = panInitial.x + (ev.clientX - panStart.x);
            const newPanY = panInitial.y + (ev.clientY - panStart.y);
            editor.actions.setViewport({ pan: { x: newPanX, y: newPanY } });
            onViewRectUpdate?.();
            return true;
        }

        // Selection box gesture
        if (state.isSelecting && state.selectionBox) {
            const pos = getCanvasPosition(ev);
            state.selectionBox.endX = pos.x;
            state.selectionBox.endY = pos.y;
            return true;
        }

        return false;
    }

    /**
     * Handle document mouseup to end gestures
     * Returns gesture type if ended: 'pan', 'selection', or null
     */
    function handleMouseUp(ev) {
        // End pan
        if (state.isPanning) {
            state.isPanning = false;
            panStart = null;
            panInitial = null;
            return 'pan';
        }

        // End selection box
        if (state.isSelecting) {
            completeSelection();
            state.isSelecting = false;
            state.selectionBox = null;
            return 'selection';
        }

        return null;
    }

    /**
     * Complete selection - find nodes within selection box
     */
    function completeSelection() {
        const box = state.selectionBox;
        if (!box) return;

        const minX = Math.min(box.startX, box.endX);
        const maxX = Math.max(box.startX, box.endX);
        const minY = Math.min(box.startY, box.endY);
        const maxY = Math.max(box.startY, box.endY);

        const dims = getDimensions ? getDimensions() : null;
        if (!dims) return;

        // Get nodes from editor service
        const nodes = editor.state.graph.nodes;
        const selected = nodes.filter((node) => {
            const bounds = getNodeBounds(node, dims);
            const nodeRight = bounds.x + bounds.width;
            const nodeBottom = bounds.y + bounds.height;
            return bounds.x < maxX && nodeRight > minX && bounds.y < maxY && nodeBottom > minY;
        });

        if (selected.length > 0) {
            editor.actions.select(selected.map(n => n.id));
        }
    }

    /**
     * Get CSS style for selection box rendering
     */
    function getSelectionBoxStyle() {
        const box = state.selectionBox;
        if (!box) return '';

        const x = Math.min(box.startX, box.endX);
        const y = Math.min(box.startY, box.endY);
        const w = Math.abs(box.endX - box.startX);
        const h = Math.abs(box.endY - box.startY);

        return `left:${x}px; top:${y}px; width:${w}px; height:${h}px;`;
    }

    return {
        // State
        state,

        // Handlers
        onCanvasMouseDown,
        handleMouseMove,
        handleMouseUp,

        // Getters
        getSelectionBoxStyle,
    };
}
