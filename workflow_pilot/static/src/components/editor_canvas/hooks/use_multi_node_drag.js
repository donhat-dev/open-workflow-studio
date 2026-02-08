/** @odoo-module **/

import { onWillUnmount, useState } from "@odoo/owl";

/**
 * useMultiNodeDrag Hook
 *
 * Manages dragging of multiple selected nodes.
 * - Listens for NODE:DRAG_START
 * - Moves all selected nodes by the same delta
 * - Commits a single history action on drag end
 * - Optimized with requestAnimationFrame
 *
 * @param {Object} options
 * @param {Object} options.editor - workflowEditor service instance
 * @param {Function} options.getNodes - () => nodes array
 * @param {Function} options.getZoom - () => number
 * @param {Function} options.getViewport - () => { panX: number, panY: number, zoom: number }
 * @param {Function} options.onViewRectUpdate - () => void
 * @param {Object} options.rootRef - owl ref for canvas root
 * @param {Function} [options.getReadonly] - () => boolean - runtime readonly
 */
export function useMultiNodeDrag(options) {
    const { editor, getNodes, getZoom, getViewport, onViewRectUpdate, rootRef, getReadonly } = options;
    function isReadonlyActive() {
        return getReadonly ? !!getReadonly() : false;
    }


    const state = useState({
        isDragging: false,
    });

    // Non-reactive drag state
    let dragState = {
        startX: 0,
        startY: 0,
        initialPositions: new Map(), // nodeId -> { x, y }
        lastPositions: new Map(),    // nodeId -> { x, y }
        nodeIds: [],
    };
    let dragFrame = null;
    let autoScrollFrame = null;
    let lastPointer = null;

    const AUTO_SCROLL_THRESHOLD = 56;
    const AUTO_SCROLL_MAX_SPEED = 18;

    function getViewportState() {
        if (getViewport) {
            return getViewport();
        }
        const viewport = editor.state.ui.viewport;
        return {
            zoom: viewport.zoom,
            panX: viewport.pan.x,
            panY: viewport.pan.y,
        };
    }

    function getRootRect() {
        if (!rootRef || !rootRef.el) {
            return null;
        }
        return rootRef.el.getBoundingClientRect();
    }

    function getAutoScrollDelta(clientX, clientY, rect) {
        const threshold = AUTO_SCROLL_THRESHOLD;
        const maxSpeed = AUTO_SCROLL_MAX_SPEED;
        let dx = 0;
        let dy = 0;

        const leftDist = clientX - rect.left;
        const rightDist = rect.right - clientX;
        const topDist = clientY - rect.top;
        const bottomDist = rect.bottom - clientY;

        function speedFromDistance(distance) {
            const safeDistance = distance < 0 ? 0 : distance;
            if (safeDistance >= threshold) return 0;
            const strength = (threshold - safeDistance) / threshold;
            return strength * maxSpeed;
        }

        if (leftDist < threshold) {
            dx = -speedFromDistance(leftDist);
        } else if (rightDist < threshold) {
            dx = speedFromDistance(rightDist);
        }

        if (topDist < threshold) {
            dy = -speedFromDistance(topDist);
        } else if (bottomDist < threshold) {
            dy = speedFromDistance(bottomDist);
        }

        return { dx, dy };
    }

    function shouldAutoScroll(clientX, clientY) {
        const rect = getRootRect();
        if (!rect) return false;
        const { dx, dy } = getAutoScrollDelta(clientX, clientY, rect);
        return dx !== 0 || dy !== 0;
    }

    function applyDrag(clientX, clientY) {
        const zoom = getZoom ? getZoom() : getViewportState().zoom;
        const dx = (clientX - dragState.startX) / zoom;
        const dy = (clientY - dragState.startY) / zoom;
        const GRID_SIZE = 20;

        const updates = {};

        dragState.nodeIds.forEach((id) => {
            const initial = dragState.initialPositions.get(id);
            if (initial) {
                const targetX = initial.x + dx;
                const targetY = initial.y + dy;
                const snappedX = Math.round(targetX / GRID_SIZE) * GRID_SIZE;
                const snappedY = Math.round(targetY / GRID_SIZE) * GRID_SIZE;

                updates[id] = { x: snappedX, y: snappedY };
                dragState.lastPositions.set(id, { x: snappedX, y: snappedY });
            }
        });

        editor.actions.moveNodesTransient(updates);
    }

    function autoScrollStep() {
        autoScrollFrame = null;
        if (!state.isDragging || !lastPointer) {
            return;
        }
        const rect = getRootRect();
        if (!rect) {
            return;
        }

        const { dx, dy } = getAutoScrollDelta(lastPointer.x, lastPointer.y, rect);
        if (dx === 0 && dy === 0) {
            return;
        }

        const viewport = getViewportState();
        const newPanX = viewport.panX - dx;
        const newPanY = viewport.panY - dy;

        editor.actions.setViewport({
            pan: { x: newPanX, y: newPanY },
        });

        if (onViewRectUpdate) {
            onViewRectUpdate();
        }

        dragState.startX -= dx;
        dragState.startY -= dy;
        applyDrag(lastPointer.x, lastPointer.y);

        autoScrollFrame = requestAnimationFrame(autoScrollStep);
    }

    function startAutoScroll() {
        if (autoScrollFrame) return;
        autoScrollFrame = requestAnimationFrame(autoScrollStep);
    }

    function stopAutoScroll() {
        if (autoScrollFrame) {
            cancelAnimationFrame(autoScrollFrame);
            autoScrollFrame = null;
        }
    }

    /**
     * Start drag sequence
     * @param {{ nodeId: string, event: MouseEvent }} data
     */
    function onNodeDragStart(data) {
        if (isReadonlyActive()) return;
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
            lastPositions: new Map(initialPositions),
            nodeIds: nodesToMove,
        };

        lastPointer = { x: event.clientX, y: event.clientY };

        state.isDragging = true;
    }

    /**
     * Handle mouse move
     * @param {MouseEvent} ev
     * @returns {boolean} true if handled
     */
    function handleMouseMove(ev) {
        if (isReadonlyActive()) return false;
        if (!state.isDragging) return false;

        lastPointer = { x: ev.clientX, y: ev.clientY };
        if (shouldAutoScroll(ev.clientX, ev.clientY)) {
            startAutoScroll();
        } else {
            stopAutoScroll();
        }

        if (dragFrame) return true;

        const { clientX, clientY } = ev;

        dragFrame = requestAnimationFrame(() => {
            dragFrame = null;
            if (!state.isDragging) return;
            applyDrag(clientX, clientY);
        });

        return true;
    }

    /**
     * Handle mouse up
     * @returns {boolean} true if handled
     */
    function handleMouseUp(ev) {
        if (isReadonlyActive()) return false;
        if (!state.isDragging) return false;

        state.isDragging = false;
        stopAutoScroll();
        lastPointer = null;
        if (dragFrame) {
            cancelAnimationFrame(dragFrame);
            dragFrame = null;
        }

        const nodeMoves = [];
        dragState.nodeIds.forEach((id) => {
            const oldPosition = dragState.initialPositions.get(id);
            const newPosition = dragState.lastPositions.get(id) || oldPosition;
            if (!oldPosition || !newPosition) {
                return;
            }
            if (oldPosition.x === newPosition.x && oldPosition.y === newPosition.y) {
                return;
            }
            nodeMoves.push({
                nodeId: id,
                oldPosition,
                newPosition,
            });
        });
        if (nodeMoves.length > 0) {
            editor.actions.recordMoveNodes(nodeMoves);
        }

        dragState.initialPositions.clear();
        dragState.lastPositions.clear();
        dragState.nodeIds = [];

        return true;
    }

    onWillUnmount(() => {
        stopAutoScroll();
        if (dragFrame) {
            cancelAnimationFrame(dragFrame);
            dragFrame = null;
        }
    });

    return {
        state,
        onNodeDragStart,
        handleMouseMove,
        handleMouseUp,
    };
}
