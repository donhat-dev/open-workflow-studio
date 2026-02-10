/** @odoo-module **/

/**
 * WorkflowGraph - Core Graph Utilities using Dagre.js
 * 
 * Provides foundation for graph manipulation and layout in Workflow Pilot.
 * Handles cycle detection for loop nodes.
 * 
 * @core - This is a pure utility class with dependency injection for dagre.
 *         Can work outside Odoo if dagre instance is provided.
 */

export class WorkflowGraph {
    /**
     * @param {Object} dagreInstance - Optional dagre library instance.
     *                                 If not provided, falls back to window.dagre
     *                                 @odoo-dependency - Falls back to window.dagre
     */
    constructor(dagreInstance = null) {
        // @core - Accept injected instance for testability and portability
        // @odoo-dependency - Falls back to window.dagre if not injected
        this.dagre = dagreInstance || window.dagre;

        if (!this.dagre) {
            throw new Error("[WorkflowGraph] Dagre library not loaded. Ensure dagre.js is included in assets.");
        }

        this.graph = new this.dagre.graphlib.Graph();
        this.graph.setDefaultEdgeLabel(() => ({}));
        this.backEdges = [];
    }

    /**
     * Create WorkflowGraph from nodes and connections arrays
     * @param {Array} nodes - Array of node objects with id, x, y
     * @param {Array} connections - Array of {source, target, sourceHandle, targetHandle}
     * @param {Object} dagreInstance - Optional dagre library instance
     * @returns {WorkflowGraph}
     */
    static fromNodes(nodes, connections, dagreInstance = null) {
        const wg = new WorkflowGraph(dagreInstance);

        // Set graph options
        wg.graph.setGraph({
            rankdir: 'LR',      // Left to Right
            nodesep: 120,       // Vertical spacing between nodes (n8n standard)
            ranksep: 160,       // Horizontal spacing between ranks
            edgesep: 120,       // Horizontal spacing between edges
            marginx: 50,
            marginy: 50,
        });

        // Calculate in-degree for each node (for root node detection)
        const inDegree = {};
        for (const node of nodes) {
            inDegree[node.id] = 0;
        }
        for (const conn of connections) {
            inDegree[conn.target] = (inDegree[conn.target] || 0) + 1;
        }

        // Sort nodes following n8n pattern:
        // 1. Root nodes (no incoming edges) first
        // 2. Then by position (Y first, then X) - preserves spawn order
        const sortedNodes = [...nodes].sort((a, b) => {
            // Root nodes first (no incoming edges)
            const aIsRoot = (inDegree[a.id] || 0) === 0;
            const bIsRoot = (inDegree[b.id] || 0) === 0;
            if (aIsRoot && !bIsRoot) return -1;
            if (!aIsRoot && bIsRoot) return 1;

            // Then by position (Y first, then X)
            const yDiff = (a.y || 0) - (b.y || 0);
            return yDiff === 0 ? (a.x || 0) - (b.x || 0) : yDiff;
        });

        // Add nodes in sorted order
        for (const node of sortedNodes) {
            wg.graph.setNode(node.id, {
                width: 180,
                height: 80,
                x: node.x || 0,
                y: node.y || 0,
            });
        }

        // Add edges
        for (const conn of connections) {
            wg.graph.setEdge(conn.source, conn.target);
        }

        return wg;
    }

    /**
     * Detect cycles using DFS and identify back-edges
     * Back-edges are edges that point to an ancestor in the DFS tree
     * @returns {Array} Array of {source, target} back-edge objects
     */
    detectCycles() {
        const backEdges = [];
        const visited = new Set();
        const inStack = new Set();

        const dfs = (nodeId) => {
            visited.add(nodeId);
            inStack.add(nodeId);

            const successors = this.graph.successors(nodeId) || [];
            for (const target of successors) {
                if (inStack.has(target)) {
                    // Back-edge found - target is ancestor of current node
                    backEdges.push({ source: nodeId, target });
                } else if (!visited.has(target)) {
                    dfs(target);
                }
            }

            inStack.delete(nodeId);
        };

        // Start DFS from all root nodes (nodes with no predecessors)
        const allNodes = this.graph.nodes();
        for (const nodeId of allNodes) {
            const predecessors = this.graph.predecessors(nodeId) || [];
            if (predecessors.length === 0 && !visited.has(nodeId)) {
                dfs(nodeId);
            }
        }

        // Also check unvisited nodes (in case of isolated cycles)
        for (const nodeId of allNodes) {
            if (!visited.has(nodeId)) {
                dfs(nodeId);
            }
        }

        this.backEdges = backEdges;
        return backEdges;
    }

    /**
     * Run Dagre layout algorithm
     * Automatically handles cycles by temporarily removing back-edges
     * @param {Object} options - Layout options (rankdir, nodesep, ranksep)
     * @returns {Object} Map of nodeId -> {x, y} positions
     */
    layout(options = {}) {
        // Apply custom options
        const graphConfig = this.graph.graph();
        Object.assign(graphConfig, options);
        this.graph.setGraph(graphConfig);

        // Detect and temporarily remove back-edges to prevent infinite loop
        const backEdges = this.detectCycles();
        for (const edge of backEdges) {
            this.graph.removeEdge(edge.source, edge.target);
        }

        // Run Dagre layout with disableOptimalOrderHeuristic to preserve spawn order
        // (Same as n8n - prevents Dagre from reordering nodes)
        this.dagre.layout(this.graph, { disableOptimalOrderHeuristic: true });

        // Re-add back-edges (for reference, not for layout)
        for (const edge of backEdges) {
            this.graph.setEdge(edge.source, edge.target);
        }

        // Extract positions
        const positions = {};
        for (const nodeId of this.graph.nodes()) {
            const node = this.graph.node(nodeId);
            // Dagre returns center coordinates, convert to top-left
            positions[nodeId] = {
                x: node.x,
                y: node.y,
            };
        }

        return positions;
    }

    /**
     * Get position of a specific node
     * @param {string} nodeId
     * @returns {{x: number, y: number} | null}
     */
    getNodePosition(nodeId) {
        const node = this.graph.node(nodeId);
        if (!node) return null;
        return {
            x: node.x,
            y: node.y,
        };
    }

    /**
     * Get all back-edges (edges that create cycles)
     * Must call detectCycles() first
     * @returns {Array}
     */
    getBackEdges() {
        return this.backEdges;
    }

    /**
     * Check if graph has any cycles
     * @returns {boolean}
     */
    hasCycles() {
        if (this.backEdges.length === 0) {
            this.detectCycles();
        }
        return this.backEdges.length > 0;
    }

    // =========================================
    // Subgraph Splitting (n8n-style)
    // =========================================

    /**
     * Find connected components in the graph
     * Uses Dagre's built-in algorithm
     * @returns {Array<Array<string>>} Array of node ID arrays, one per component
     */
    findComponents() {
        return this.dagre.graphlib.alg.components(this.graph);
    }

    /**
     * Create a subgraph containing only the specified nodes
     * Following n8n's createDagreSubGraph pattern
     * @param {Array<string>} nodeIds - Node IDs to include
     * @returns {dagre.graphlib.Graph}
     */
    createSubgraph(nodeIds) {
        const nodeIdSet = new Set(nodeIds);
        const subgraph = new this.dagre.graphlib.Graph();

        // Copy graph options
        subgraph.setGraph({ ...this.graph.graph() });
        subgraph.setDefaultEdgeLabel(() => ({}));

        // Copy nodes
        for (const nodeId of nodeIds) {
            if (this.graph.hasNode(nodeId)) {
                subgraph.setNode(nodeId, { ...this.graph.node(nodeId) });
            }
        }

        // Copy edges (only internal edges)
        for (const edge of this.graph.edges()) {
            if (nodeIdSet.has(edge.v) && nodeIdSet.has(edge.w)) {
                subgraph.setEdge(edge.v, edge.w, this.graph.edge(edge));
            }
        }

        return subgraph;
    }

    /**
     * Calculate bounding box of a graph after layout
     * @param {dagre.graphlib.Graph} graph
     * @returns {{minX: number, minY: number, maxX: number, maxY: number, width: number, height: number}}
     */
    static getBoundingBox(graph) {
        const nodes = graph.nodes();
        if (nodes.length === 0) {
            return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
        }

        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;

        for (const nodeId of nodes) {
            const node = graph.node(nodeId);
            const halfW = (node.width || 180) / 2;
            const halfH = (node.height || 80) / 2;

            minX = Math.min(minX, node.x - halfW);
            minY = Math.min(minY, node.y - halfH);
            maxX = Math.max(maxX, node.x + halfW);
            maxY = Math.max(maxY, node.y + halfH);
        }

        return {
            minX, minY, maxX, maxY,
            width: maxX - minX,
            height: maxY - minY,
        };
    }

    /**
     * Layout with subgraph splitting (n8n-style)
     * 1. Find connected components
     * 2. Layout each component separately
     * 3. Stack components vertically
     * @param {Object} options - Layout options
     * @returns {Object} Map of nodeId -> {x, y} positions
     */
    layoutWithSplitting(options = {}) {
        const SUBGRAPH_SPACING = 160;  // n8n: GRID_SIZE * 8
        const components = this.findComponents();

        // Single component → normal layout
        if (components.length <= 1) {
            return this.layout(options);
        }

        // Multi-component → layout each separately then stack
        const layoutedComponents = [];

        for (const nodeIds of components) {
            // Create and layout subgraph
            const subgraph = this.createSubgraph(nodeIds);

            // Detect and remove back-edges for this subgraph
            const backEdges = this._detectCyclesInGraph(subgraph);
            for (const edge of backEdges) {
                subgraph.removeEdge(edge.source, edge.target);
            }

            // Run Dagre layout
            this.dagre.layout(subgraph, { disableOptimalOrderHeuristic: true });

            // Re-add back-edges
            for (const edge of backEdges) {
                subgraph.setEdge(edge.source, edge.target);
            }

            layoutedComponents.push({
                nodeIds,
                graph: subgraph,
                bbox: WorkflowGraph.getBoundingBox(subgraph),
            });
        }

        // Sort components by their original top-left position (preserve general order)
        layoutedComponents.sort((a, b) => a.bbox.minY - b.bbox.minY);

        // Stack vertically
        const MARGIN_TOP = 50;
        let currentY = MARGIN_TOP;
        const positions = {};

        for (const comp of layoutedComponents) {
            const offsetY = currentY - comp.bbox.minY + (comp.bbox.height / 2);

            for (const nodeId of comp.nodeIds) {
                const node = comp.graph.node(nodeId);
                positions[nodeId] = {
                    x: node.x,
                    y: node.y + offsetY - comp.bbox.minY,
                };
            }

            currentY += comp.bbox.height + SUBGRAPH_SPACING;
        }

        return positions;
    }

    /**
     * Detect cycles in a specific graph (helper for subgraph processing)
     * @private
     */
    _detectCyclesInGraph(graph) {
        const backEdges = [];
        const visited = new Set();
        const inStack = new Set();

        const dfs = (nodeId) => {
            visited.add(nodeId);
            inStack.add(nodeId);

            const successors = graph.successors(nodeId) || [];
            for (const target of successors) {
                if (inStack.has(target)) {
                    backEdges.push({ source: nodeId, target });
                } else if (!visited.has(target)) {
                    dfs(target);
                }
            }

            inStack.delete(nodeId);
        };

        for (const nodeId of graph.nodes()) {
            if (!visited.has(nodeId)) {
                dfs(nodeId);
            }
        }

        return backEdges;
    }
}
