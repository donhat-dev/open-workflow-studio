/** @odoo-module **/

import { useState } from "@odoo/owl";

/**
 * useConnectionDrawing Hook
 *
 * Manages connection drawing state and interactions:
 * - Drawing temporary connection lines
 * - Smart socket snapping
 * - Connection creation on socket release
 *
 * @param {Object} options
 * @param {Object} options.editor - workflowEditor service instance
 * @param {Function} options.getCanvasPosition - (event) => { x, y } canvas coords
 * @param {Function} options.getSocketPositionForNode - (node, key, type) => { x, y }
 * @param {Function} options.getNodes - () => nodes array
 * @param {Function} options.openNodeMenu - (config) => void - called when dragging to empty space
 */
export function useConnectionDrawing(options) {
    const { editor, getCanvasPosition, getSocketPositionForNode, getNodes, openNodeMenu } = options;

    const state = useState({
        isConnecting: false,
        connectionStart: null,    // { nodeId, socketKey, socketType }
        tempLineEndpoint: null,   // { x, y } - current cursor position in canvas coords
        snappedSocket: null,      // { nodeId, socketKey, x, y } - nearest valid socket
    });

    const SNAP_RADIUS = 50;

    /**
     * Find nearest compatible input socket within snap radius
     * @param {number} x - Canvas X coordinate
     * @param {number} y - Canvas Y coordinate
     * @param {string} sourceNodeId - Node ID to exclude (can't connect to self)
     * @returns {{ nodeId: string, socketKey: string, x: number, y: number } | null}
     */
    function findNearestSocket(x, y, sourceNodeId) {
        let closest = null;
        let minDist = Infinity;
        const nodes = getNodes();

        // Iterate backwards to prioritize top-most nodes (rendered later = on top)
        for (let i = nodes.length - 1; i >= 0; i--) {
            const node = nodes[i];
            if (node.id === sourceNodeId) continue;

            // Check each input socket
            for (const [key, _] of Object.entries(node.inputs || {})) {
                const pos = getSocketPositionForNode(node, key, 'input');
                const dist = Math.hypot(x - pos.x, y - pos.y);

                if (dist < SNAP_RADIUS && dist < minDist) {
                    minDist = dist;
                    closest = { nodeId: node.id, socketKey: key, x: pos.x, y: pos.y };
                }
            }
        }
        return closest;
    }

    /**
     * Start drawing connection from an output socket
     * @param {{ nodeId: string, socketKey: string, socketType: string, event: MouseEvent }} data
     */
    function onSocketMouseDown(data) {
        const { nodeId, socketKey, socketType, event } = data;

        // Only start connection from output sockets
        if (socketType !== 'output') return;

        event.stopPropagation();
        event.preventDefault();

        const canvasPos = getCanvasPosition(event);

        state.isConnecting = true;
        state.connectionStart = { nodeId, socketKey, socketType };
        state.tempLineEndpoint = canvasPos;
    }

    /**
     * Update connection endpoint during mouse move (called from RAF)
     * @param {MouseEvent} ev
     * @returns {boolean} - true if handled (connection is being drawn)
     */
    function handleMouseMove(ev) {
        if (!state.isConnecting) return false;

        const pos = getCanvasPosition(ev);
        state.tempLineEndpoint = pos;

        // Smart snapping: find nearest socket
        const sourceNodeId = state.connectionStart?.nodeId;
        state.snappedSocket = findNearestSocket(pos.x, pos.y, sourceNodeId);

        return true;
    }

    /**
     * Complete connection on socket release
     * @param {{ nodeId: string, socketKey: string, socketType: string, event: MouseEvent }} data
     */
    function onSocketMouseUp(data) {
        if (!state.isConnecting) return;

        const { nodeId, socketKey, socketType } = data;
        const start = state.connectionStart;

        if (!start) {
            cancelConnection();
            return;
        }

        // Output to input only
        if (start.socketType === 'output' && socketType === 'input' && start.nodeId !== nodeId) {
            editor.actions.addConnection(
                start.nodeId,
                start.socketKey,
                nodeId,
                socketKey
            );
        }

        cancelConnection();
    }

    /**
     * Handle mouse up on canvas (not on socket)
     * @param {MouseEvent} ev
     * @param {Object} canvasRect - { left, top } from canvas element
     * @returns {boolean} - true if handled
     */
    function handleCanvasMouseUp(ev, canvasRect) {
        if (!state.isConnecting) return false;

        // Smart snapping: if snapped to a socket, create connection
        if (state.snappedSocket) {
            const start = state.connectionStart;
            if (start && start.socketType === 'output') {
                editor.actions.addConnection(
                    start.nodeId,
                    start.socketKey,
                    state.snappedSocket.nodeId,
                    state.snappedSocket.socketKey
                );
            }
            cancelConnection();
            return true;
        }

        // Check if released on an input socket directly (let onSocketMouseUp handle it)
        const target = ev.target;
        const isSocket = target.classList?.contains('workflow-node__socket-point');
        const socketType = target.dataset?.socketType;

        if (isSocket && socketType === 'input') {
            return false; // Will be handled by onSocketMouseUp
        }

        // FEATURE: Spawn NodeMenu when dropping connection on empty canvas
        const start = state.connectionStart;
        if (start && start.socketType === 'output') {
            const canvasPos = getCanvasPosition(ev);
            const screenX = ev.clientX - canvasRect.left;
            const screenY = ev.clientY - canvasRect.top;

            openNodeMenu({
                visible: true,
                x: screenX,
                y: screenY,
                canvasX: canvasPos.x,
                canvasY: canvasPos.y,
                variant: 'default',
                connectionContext: {
                    type: 'dragConnect',
                    sourceNodeId: start.nodeId,
                    sourceSocketKey: start.socketKey,
                },
            });

            // Clear connection drawing state but keep context in nodeMenu
            state.isConnecting = false;
            state.tempLineEndpoint = null;
            state.snappedSocket = null;
            return true;
        }

        cancelConnection();
        return true;
    }

    /**
     * Cancel ongoing connection drawing
     */
    function cancelConnection() {
        state.isConnecting = false;
        state.connectionStart = null;
        state.tempLineEndpoint = null;
        state.snappedSocket = null;
    }

    return {
        state,
        onSocketMouseDown,
        onSocketMouseUp,
        handleMouseMove,
        handleCanvasMouseUp,
        cancelConnection,
        findNearestSocket,
    };
}
