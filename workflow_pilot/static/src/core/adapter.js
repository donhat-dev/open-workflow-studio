/** @odoo-module **/

/**
 * WorkflowAdapter - Bridge between Core WorkflowEditor and OWL UI
 *
 * ARCHITECTURE (Phase 3 - Full Separation):
 * ┌─────────────────────────────────────────────────────────────┐
 * │  UI Layer (OWL Components)                                  │
 * │    - Only sees plain objects (id, type, x, y, inputs, etc.) │
 * │    - NO access to Core layer internals                      │
 * │    - Calls adapter methods for config/execution             │
 * └─────────────────────────┬───────────────────────────────────┘
 *                           │ Adapter Methods
 *                           ▼
 * ┌─────────────────────────────────────────────────────────────┐
 * │  Adapter Layer (This Class)                                 │
 * │    - Translates between UI ↔ Core                           │
 * │    - Exposes clean API: getNodeConfig, setNodeConfig, etc.  │
 * │    - Hides Core implementation details                      │
 * └─────────────────────────┬───────────────────────────────────┘
 *                           │ Internal Access
 *                           ▼
 * ┌─────────────────────────────────────────────────────────────┐
 * │  Core Layer (WorkflowEditor, BaseNode, Controls)            │
 * │    - Pure JS, no Odoo/OWL dependencies                      │
 * │    - Source of truth for node config & execution            │
 * └─────────────────────────────────────────────────────────────┘
 */

import { reactive, markRaw } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { WorkflowEditor } from '../core/editor';

// Odoo registry for node types
const nodeTypeRegistry = registry.category("workflow_node_types");

export class WorkflowAdapter {
    constructor() {
        // Build nodeRegistry from Odoo registry for WorkflowEditor compatibility
        const nodeRegistry = this._buildNodeRegistryFromOdoo();
        this.editor = new WorkflowEditor({ nodeRegistry });

        // Reactive Store Pattern - UI state
        this.state = reactive({
            nodes: [],
            connections: [],
        });

        // Sync editor events to reactive state
        this.editor.on('onChange', () => this._syncState());
    }

    /**
     * Internal sync from Core Editor to Reactive State
     */
    _syncState() {
        this.state.nodes = this.getNodesForUI();
        this.state.connections = this.getConnectionsForUI();
    }

    /**
     * Get nodes for UI layer (plain objects only)
     *
     * IMPORTANT: No _node reference exposed!
     * UI components must use adapter methods for config/execution.
     */
    getNodesForUI() {
        return this.editor.getNodes().map(node => ({
            id: node.id,
            type: node.type,
            title: node.label,
            x: node.position.x,
            y: node.position.y,
            icon: node.icon,
            category: node.category,
            inputs: this._socketsToUI(node.inputs),
            outputs: this._socketsToUI(node.outputs),
            // NO _node reference - clean separation!
        }));
    }

    /**
     * Get connections as plain objects
     */
    getConnectionsForUI() {
        return this.editor.getConnections().map(conn => ({
            id: conn.id,
            source: conn.source,
            sourceHandle: conn.sourceHandle,
            target: conn.target,
            targetHandle: conn.targetHandle,
        }));
    }

    /**
     * Convert socket definitions to UI format
     */
    _socketsToUI(sockets) {
        const result = {};
        Object.entries(sockets).forEach(([key, socket]) => {
            result[key] = { label: socket.label };
        });
        return result;
    }

    // ============================================
    // NODE MANAGEMENT
    // ============================================

    /**
     * Add node by type
     * @returns {string|null} New node ID or null if failed
     */
    addNode(type, position) {
        const NodeClass = this.getNodeClass(type);
        if (!NodeClass) {
            console.warn(`[Adapter] Unknown node type: ${type}`);
            return null;
        }
        const node = this.editor.addNode(NodeClass, position);
        return node?.id || null;
    }

    /**
     * Remove node
     */
    removeNode(nodeId) {
        return this.editor.removeNode(nodeId);
    }

    /**
     * Update node position
     */
    updatePosition(nodeId, position) {
        const result = this.editor.updateNodePosition(nodeId, position);
        // Direct reactive update for smooth dragging (bypasses full refresh)
        const node = this.state.nodes.find(n => n.id === nodeId);
        if (node) {
            node.x = position.x;
            node.y = position.y;
        }
        return result;
    }

    /**
     * Get Core node instance by ID (internal use only)
     * @private
     */
    _getCoreNode(nodeId) {
        return this.editor.getNode(nodeId);
    }

    // ============================================
    // CONFIG MANAGEMENT (Phase 3 API)
    // ============================================

    /**
     * Get node configuration
     * UI calls this instead of accessing _node.getConfig()
     *
     * @param {string} nodeId - Node ID
     * @returns {Object} Config object from Core layer
     */
    getNodeConfig(nodeId) {
        const coreNode = this._getCoreNode(nodeId);
        if (!coreNode) {
            console.warn(`[Adapter] Node not found: ${nodeId}`);
            return {};
        }
        return coreNode.getConfig();
    }

    /**
     * Set node configuration
     * UI calls this instead of accessing _node.setConfig()
     *
     * @param {string} nodeId - Node ID
     * @param {Object} config - Config object to set
     * @returns {boolean} Success
     */
    setNodeConfig(nodeId, config) {
        const coreNode = this._getCoreNode(nodeId);
        if (!coreNode) {
            console.warn(`[Adapter] Node not found: ${nodeId}`);
            return false;
        }
        coreNode.setConfig(config);
        console.log(`[Adapter] Config set for ${nodeId}:`, coreNode.getConfig());
        return true;
    }

    /**
     * Get node controls metadata (for UI rendering)
     * Returns control definitions without exposing Control instances
     *
     * @param {string} nodeId - Node ID
     * @returns {Array<{key, type, label, value, section?, options?, placeholder?, ...}>}
     */
    getNodeControls(nodeId) {
        const coreNode = this._getCoreNode(nodeId);
        if (!coreNode) {
            return [];
        }

        return Object.entries(coreNode.controls).map(([key, control]) => ({
            key,
            type: control.type,
            label: control.label,
            value: control.getValue(),
            section: control.section,  // For grouping in UI
            // Type-specific properties
            placeholder: control.placeholder,
            multiline: control.multiline,
            options: control.options,  // For select
            keyPlaceholder: control.keyPlaceholder,  // For keyvalue
            valuePlaceholder: control.valuePlaceholder,
            min: control.min,
            max: control.max,
            step: control.step,
        }));
    }

    /**
     * Update a single control value
     *
     * @param {string} nodeId - Node ID
     * @param {string} controlKey - Control key
     * @param {*} value - New value
     * @returns {boolean} Success
     */
    setControlValue(nodeId, controlKey, value) {
        const coreNode = this._getCoreNode(nodeId);
        if (!coreNode?.controls[controlKey]) {
            return false;
        }
        coreNode.controls[controlKey].setValue(value);
        return true;
    }

    // ============================================
    // EXECUTION (Phase 3 API)
    // ============================================

    /**
     * Execute a single node with input data and context
     *
     * @param {string} nodeId - Node ID
     * @param {Object} inputData - Input data for execution
     * @param {Object} context - Expression context { $vars, $json, $node, $loop }
     * @returns {Promise<{json: *, error: string|null, meta: Object}>}
     */
    async executeNode(nodeId, inputData = {}, context = null) {
        const coreNode = this._getCoreNode(nodeId);
        if (!coreNode) {
            return {
                json: null,
                error: `Node not found: ${nodeId}`,
                meta: {}
            };
        }

        const startTime = Date.now();
        try {
            // Pass context to node execute for expression resolution
            const output = await coreNode.execute(inputData, context);
            return {
                json: output,
                error: null,
                meta: {
                    duration: Date.now() - startTime,
                    executedAt: new Date().toISOString(),
                }
            };
        } catch (error) {
            return {
                json: null,
                error: error.message || String(error),
                meta: {
                    duration: Date.now() - startTime,
                    executedAt: new Date().toISOString(),
                }
            };
        }
    }

    /**
     * Get node class by type (from Odoo registry)
     *
     * @param {string} type - Node type
     * @returns {Function|null} Node class constructor
     */
    getNodeClass(type) {
        const entry = nodeTypeRegistry.get(type, null);
        if (!entry) return null;
        // Support both: raw Class or definition object { class: NodeClass, ... }
        return entry.class || entry;
    }

    /**
     * Build nodeRegistry object from Odoo registry
     * For WorkflowEditor compatibility (deserialization)
     * @private
     */
    _buildNodeRegistryFromOdoo() {
        const reg = {};
        for (const [key, value] of nodeTypeRegistry.getEntries()) {
            const NodeClass = value.class || value;
            if (typeof NodeClass === 'function') {
                reg[key] = NodeClass;
            }
        }
        return reg;
    }

    // ============================================
    // CONNECTION MANAGEMENT
    // ============================================

    /**
     * Add connection
     */
    addConnection(sourceId, sourceHandle, targetId, targetHandle) {
        return this.editor.addConnection(sourceId, sourceHandle, targetId, targetHandle);
    }

    /**
     * Remove connection
     */
    removeConnection(connectionId) {
        return this.editor.removeConnection(connectionId);
    }

    // ============================================
    // SERIALIZATION
    // ============================================

    /**
     * Clear all
     */
    clear() {
        this.editor.clear();
    }

    /**
     * Export to JSON
     */
    toJSON() {
        return this.editor.toJSON();
    }

    /**
     * Import from JSON
     */
    fromJSON(data) {
        this.editor.fromJSON(data);
    }

    /**
     * Load from legacy format (current localStorage format)
     */
    fromLegacyFormat(data) {
        this.clear();

        // Convert legacy nodes to new format
        (data.nodes || []).forEach(legacyNode => {
            const nodeId = this.addNode(legacyNode.type, {
                x: legacyNode.x,
                y: legacyNode.y,
            });
            if (nodeId) {
                // Override auto-generated ID with legacy ID
                const coreNode = this._getCoreNode(nodeId);
                if (coreNode) {
                    this.editor.nodes.delete(nodeId);
                    coreNode.id = legacyNode.id;
                    this.editor.nodes.set(legacyNode.id, coreNode);
                }
            }
        });

        // Restore connections
        (data.connections || []).forEach(conn => {
            this.editor.addConnection(
                conn.source,
                conn.sourceHandle,
                conn.target,
                conn.targetHandle
            );
        });

        // Update ID counter
        const maxId = Math.max(
            ...Array.from(this.editor.nodes.keys())
                .map(id => parseInt(id.replace(/\D/g, ''), 10) || 0),
            0
        );
        this.editor._idCounter = maxId;
    }
}
