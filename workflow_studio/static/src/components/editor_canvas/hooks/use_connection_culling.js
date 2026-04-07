/** @odoo-module **/

import { onWillUnmount } from "@odoo/owl";
import { detectConnectionType } from "../../../core/dimensions";
import { getConnectionPath } from "../utils/connection_path";

/**
 * Hook to manage connection visibility and rendering (Culling)
 *
 * optimizations:
 * 1. Visibility Check: Only render connections connected to visible nodes
 * 2. Memoization: Cache expensive path calculations
 *
 * @param {Object} params
 * @param {Function} params.getNodes - Returns array of nodes
 * @param {Function} params.getConnections - Returns array of connections
 * @param {Function} params.getViewRect - Returns current viewport rect {x, y, w, h}
 * @param {Function} params.getSocketPosition - Function to calculate socket position(node, key, type)
 */
export function useConnectionCulling({ getNodes, getConnections, getViewRect, getSocketPosition }) {
    // Cache only latest geometry per connection (prevents unbounded key growth while dragging)
    // Value: { key: string, value: { paths, isBackEdge, isVerticalStack } }
    const pathCache = new Map();

    // Reused collections to avoid allocations in hot getter path
    const nodeById = new Map();
    const visibleNodeIds = new Set();

    // Performance constants
    const MAX_NODE_WIDTH = 500;
    const MAX_NODE_HEIGHT = 500;

    /**
     * Check if a node is within specific bounds (AABB check)
     * Expects rect with {x, y, width, height} format (from useViewport.viewRect)
     */
    function isNodeVisible(node, rect) {
        if (!rect) return true;
        return (
            node.x < rect.x + rect.width &&
            node.x + MAX_NODE_WIDTH > rect.x &&
            node.y < rect.y + rect.height &&
            node.y + MAX_NODE_HEIGHT > rect.y
        );
    }

    /**
     * Calculate or retrieve memoized connection path
     */
    function getRenderedPath(conn, sourceNode, targetNode) {
        const sourcePos = getSocketPosition(sourceNode, conn.sourceHandle, 'output');
        const targetPos = getSocketPosition(targetNode, conn.targetHandle, 'input');

        const key = `${conn.id}:${sourcePos.x},${sourcePos.y}:${targetPos.x},${targetPos.y}`;

        const cached = pathCache.get(conn.id);
        if (cached && cached.key === key) {
            return cached.value;
        }

        const connectionType = detectConnectionType(sourcePos, targetPos);
        const result = getConnectionPath(sourcePos, targetPos, connectionType);

        pathCache.set(conn.id, { key, value: result });
        return result;
    }

    onWillUnmount(() => {
        pathCache.clear();
        nodeById.clear();
        visibleNodeIds.clear();
    });

    return {
        /**
         * Computed property to get connections that should be rendered
         * Returns array of connection objects augmented with path data
         */
        get renderedConnections() {
            const rect = getViewRect();
            const nodes = getNodes();
            const connections = getConnections();

            nodeById.clear();
            for (const node of nodes) {
                nodeById.set(node.id, node);
            }

            // 1. Identify visible nodes
            visibleNodeIds.clear();
            for (const node of nodes) {
                if (isNodeVisible(node, rect)) {
                    visibleNodeIds.add(node.id);
                }
            }

            // 2. Filter and map connections
            const rendered = [];

            for (const conn of connections) {
                // Visibility check: Render if Source OR Target is visible
                // This covers connections entering/leaving the viewport
                if (!visibleNodeIds.has(conn.source) && !visibleNodeIds.has(conn.target)) {
                    continue;
                }

                const sourceNode = nodeById.get(conn.source);
                const targetNode = nodeById.get(conn.target);

                if (!sourceNode || !targetNode) {
                    continue; // Skip invalid connections
                }

                // Calculate details
                const pathDetails = getRenderedPath(conn, sourceNode, targetNode);

                rendered.push({
                    ...conn,
                    ...pathDetails
                });
            }

            return rendered;
        },

        /**
         * Get visible nodes (exposed if needed by consumer)
         */
        get visibleNodes() {
            const rect = getViewRect();
            return getNodes().filter(n => isNodeVisible(n, rect));
        }
    };
}
