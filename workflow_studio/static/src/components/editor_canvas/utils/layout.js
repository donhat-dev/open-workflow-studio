/** @odoo-module **/

import { WorkflowGraph } from "../../../utils/graph_utils";

/**
 * Pure utility functions for workflow layout calculations.
 * No side effects, no mutations - just compute and return.
 */

/**
 * Calculate tidy (auto-layout) positions for all nodes using Dagre.js
 * 
 * @param {Array} nodes - Array of node objects with id, x, y
 * @param {Array} connections - Array of connection objects with source, target
 * @returns {Object} Map of nodeId -> { x: number, y: number }
 */
export function calculateTidyPositions(nodes, connections) {
    if (!nodes || nodes.length === 0) {
        return {};
    }

    const graph = WorkflowGraph.fromNodes(nodes, connections);
    return graph.layoutWithSplitting();
}
