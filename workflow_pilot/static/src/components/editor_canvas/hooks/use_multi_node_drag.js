/** @odoo-module **/

import { useState } from "@odoo/owl";

/**
 * useMultiNodeDrag Hook
 *
 * Manages dragging of multiple selected nodes.
 * - Listens for NODE:DRAG_START
 * - Moves all selected nodes by the same delta
 * - Handles history batching
 * - Optimized with requestAnimationFrame
 *
 * @param {Object} options
 * @param {Object} options.editor - workflowEditor service instance
 * @param {Function} options.getNodes - () => nodes array
 * @param {Number} options.zoom - current zoom level
 */
export function useMultiNodeDrag(options) {
    const { editor, getNodes, getZoom } = options;

    const state = useState({
        isDragging: false,
    });

    // Non-reactive drag state
    let dragState = {
        startX: 0,
        startY: 0,
        initialPositions: new Map(), // nodeId -> { x, y }
        nodeIds: [],
    };
    let dragFrame = null;

    /**
     * Start drag sequence
     * @param {{ nodeId: string, event: MouseEvent }} data
     */
    function onNodeDragStart(data) {
        const { nodeId, event } = data;

        // Ensure the dragged node is selected (if not already)
        // Note: WorkflowNode handles click-selection logic, but we safeguard here
        const selectedIds = editor.state.ui.selection.nodeIds || [];

        // If keeping existing selection or starting new one, the list of nodes to move
        // is the current selection. If the user drags a non-selected node without Ctrl, 
        // the selection logic in WorkflowNode should have already updated selection.
        let nodesToMove = selectedIds.includes(nodeId) ? selectedIds : [nodeId];

        // Capture initial positions
        const initialPositions = new Map();
        const nodes = getNodes();

        nodesToMove.forEach(id => {
            const node = nodes.find(n => n.id === id);
            if (node) {
                initialPositions.set(id, { x: node.x || 0, y: node.y || 0 });
            }
        });

        dragState = {
            startX: event.clientX,
            startY: event.clientY,
            initialPositions,
            nodeIds: nodesToMove,
        };

        state.isDragging = true;
        editor.actions.beginBatch();
    }

    /**
     * Handle mouse move
     * @param {MouseEvent} ev
     * @returns {boolean} true if handled
     */
    function handleMouseMove(ev) {
        if (!state.isDragging) return false;
        if (dragFrame) return true;

        const { clientX, clientY } = ev;

        dragFrame = requestAnimationFrame(() => {
            dragFrame = null;
            if (!state.isDragging) return;

            const zoom = getZoom ? getZoom() : 1;
            const dx = (clientX - dragState.startX) / zoom;
            const dy = (clientY - dragState.startY) / zoom;

            const GRID_SIZE = 20;

            dragState.nodeIds.forEach(id => {
                const initial = dragState.initialPositions.get(id);
                if (initial) {
                    const targetX = initial.x + dx;
                    const targetY = initial.y + dy;
                    const snappedX = Math.round(targetX / GRID_SIZE) * GRID_SIZE;
                    const snappedY = Math.round(targetY / GRID_SIZE) * GRID_SIZE;

                    editor.actions.moveNode(id, { x: snappedX, y: snappedY });
                }
            });
        });

        return true;
    }

    /**
     * Handle mouse up
     * @returns {boolean} true if handled
     */
    function handleMouseUp(ev) {
        if (!state.isDragging) return false;

        state.isDragging = false;
        if (dragFrame) {
            cancelAnimationFrame(dragFrame);
            dragFrame = null;
        }

        editor.actions.endBatch("Move nodes");
        return true;
    }

    return {
        state,
        onNodeDragStart,
        handleMouseMove,
        handleMouseUp,
    };
}
