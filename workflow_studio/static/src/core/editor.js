/** @odoo-module **/

/**
 * @core - Pure JavaScript class, no Odoo dependencies.
 *         Can be used outside Odoo environment.
 */

import { BaseNode } from './node';
import { Connection } from './connection';

/**
 * WorkflowEditor - Central state manager for workflow graph
 *
 * Manages nodes and connections, handles validation,
 * and provides serialization/deserialization.
 */
export class WorkflowEditor {
    constructor(options = {}) {
        // Node storage: Map<nodeId, BaseNode>
        this.nodes = new Map();

        // Connection storage
        this.connections = [];

        // Node registry for deserialization
        this.nodeRegistry = options.nodeRegistry || {};

        // ID generation
        this._idCounter = 0;

        // Event callbacks (n8n-style)
        this._callbacks = {
            onNodeAdd: [],
            onNodeRemove: [],
            onNodeMove: [],
            onConnectionAdd: [],
            onConnectionRemove: [],
            onChange: [],
        };
    }

    // ============================================
    // EVENT SYSTEM
    // ============================================

    /**
     * Subscribe to editor events
     * @param {string} event - Event name
     * @param {Function} callback - Handler function
     */
    on(event, callback) {
        if (this._callbacks[event]) {
            this._callbacks[event].push(callback);
        }
        return () => this.off(event, callback);  // Return unsubscribe function
    }

    off(event, callback) {
        if (this._callbacks[event]) {
            this._callbacks[event] = this._callbacks[event].filter(cb => cb !== callback);
        }
    }

    _emit(event, data) {
        if (this._callbacks[event]) {
            this._callbacks[event].forEach(cb => cb(data));
        }
        // Always emit onChange for any modification
        if (event !== 'onChange') {
            this._callbacks.onChange.forEach(cb => cb({ event, data }));
        }
    }

    // ============================================
    // NODE MANAGEMENT
    // ============================================

    /**
     * Add a node to the editor
     * @param {Function|BaseNode} nodeOrClass - Node class or instance
     * @param {Object} position - Canvas position { x, y }
     * @returns {BaseNode}
     */
    addNode(nodeOrClass, position = { x: 100, y: 100 }) {
        let node;

        if (nodeOrClass instanceof BaseNode) {
            node = nodeOrClass;
        } else {
            node = new nodeOrClass();
        }

        // Assign ID if not set
        if (!node.id) {
            node.id = this._generateId();
        }

        node.position = { ...position };
        this.nodes.set(node.id, node);

        this._emit('onNodeAdd', node);
        return node;
    }

    /**
     * Remove a node and its connections
     * @param {string} nodeId
     */
    removeNode(nodeId) {
        const node = this.nodes.get(nodeId);
        if (!node) return false;

        // Remove all connections involving this node
        const removedConnections = this.connections.filter(c => c.involvesNode(nodeId));
        this.connections = this.connections.filter(c => !c.involvesNode(nodeId));

        removedConnections.forEach(c => {
            this._emit('onConnectionRemove', c);
        });

        this.nodes.delete(nodeId);
        this._emit('onNodeRemove', node);
        return true;
    }

    /**
     * Update node position
     */
    updateNodePosition(nodeId, position) {
        const node = this.nodes.get(nodeId);
        if (!node) return false;

        node.position = { ...position };
        this._emit('onNodeMove', { node, position });
        return true;
    }

    /**
     * Get node meta (UI/runtime metadata)
     * @param {string} nodeId
     * @returns {Object}
     */
    getNodeMeta(nodeId) {
        const node = this.nodes.get(nodeId);
        return node?.meta || {};
    }

    /**
     * Update node meta (shallow merge + special handling for meta.ui)
     * @param {string} nodeId
     * @param {Object} metaPatch
     * @returns {boolean}
     */
    setNodeMeta(nodeId, metaPatch = {}) {
        const node = this.nodes.get(nodeId);
        if (!node) return false;

        const prev = node.meta || {};
        const patchUi = metaPatch.ui || null;

        let nextUi = prev.ui;
        if (patchUi) {
            const prevUi = prev.ui || {};
            nextUi = { ...prevUi, ...patchUi };

            if (patchUi.controlModes) {
                nextUi.controlModes = {
                    ...(prevUi.controlModes || {}),
                    ...patchUi.controlModes,
                };
            }
            if (patchUi.pairModes) {
                nextUi.pairModes = {
                    ...(prevUi.pairModes || {}),
                    ...patchUi.pairModes,
                };
            }
        }

        node.meta = {
            ...prev,
            ...metaPatch,
            ...(patchUi ? { ui: nextUi } : {}),
        };

        // Notify listeners that state changed
        this._emit('onChange', { event: 'meta', data: { nodeId, meta: node.meta } });
        return true;
    }

    /**
     * Update a node's display label (user-visible title).
     * @param {string} nodeId
     * @param {string} label
     * @returns {boolean}
     */
    setNodeLabel(nodeId, label) {
        const node = this.nodes.get(nodeId);
        if (!node) return false;
        node.label = label;
        this._emit('onChange', { event: 'label', data: { nodeId, label } });
        return true;
    }

    /**
     * Get node by ID
     */
    getNode(nodeId) {
        return this.nodes.get(nodeId);
    }

    /**
     * Get all nodes as array
     */
    getNodes() {
        return Array.from(this.nodes.values());
    }

    // ============================================
    // CONNECTION MANAGEMENT
    // ============================================

    /**
     * Add a connection between nodes
     * @returns {Connection|null} - Created connection or null if invalid
     */
    addConnection(sourceId, sourceHandle, targetId, targetHandle) {
        // Validation
        const source = this.nodes.get(sourceId);
        const target = this.nodes.get(targetId);

        if (!source || !target) {
            console.warn('[Editor] Invalid node IDs for connection');
            return null;
        }

        // Check sockets exist
        const outSocket = source.outputs[sourceHandle]?.socket;
        const inSocket = target.inputs[targetHandle]?.socket;

        if (!outSocket || !inSocket) {
            console.warn('[Editor] Invalid socket keys');
            return null;
        }

        // Socket compatibility check
        if (!outSocket.isCompatible(inSocket)) {
            console.warn(`[Editor] Incompatible sockets: ${outSocket.name} -> ${inSocket.name}`);
            return null;
        }

        // Check for duplicate
        const existingId = Connection.generateId(sourceId, sourceHandle, targetId, targetHandle);
        if (this.connections.some(c => c.id === existingId)) {
            console.warn('[Editor] Connection already exists');
            return null;
        }

        // Check for self-connection
        if (sourceId === targetId) {
            console.warn('[Editor] Cannot connect node to itself');
            return null;
        }

        // Create connection
        const connection = new Connection(sourceId, sourceHandle, targetId, targetHandle);
        this.connections.push(connection);

        this._emit('onConnectionAdd', connection);
        return connection;
    }

    /**
     * Remove a connection by ID
     */
    removeConnection(connectionId) {
        const index = this.connections.findIndex(c => c.id === connectionId);
        if (index === -1) return false;

        const removed = this.connections.splice(index, 1)[0];
        this._emit('onConnectionRemove', removed);
        return true;
    }

    /**
     * Get connections for a specific node
     */
    getNodeConnections(nodeId) {
        return this.connections.filter(c => c.involvesNode(nodeId));
    }

    /**
     * Get all connections
     */
    getConnections() {
        return [...this.connections];
    }

    // ============================================
    // SERIALIZATION
    // ============================================

    /**
     * Export workflow to JSON (for Python backend)
     */
    toJSON() {
        return {
            version: '1.0',
            nodes: this.getNodes().map(n => n.toJSON()),
            connections: this.connections.map(c => c.toJSON()),
        };
    }

    /**
     * Import workflow from JSON
     */
    fromJSON(data) {
        // Clear existing
        this.clear();

        // Restore ID counter from node IDs
        let maxId = 0;

        // Restore nodes
        (data.nodes || []).forEach(nodeData => {
            const node = BaseNode.fromJSON(nodeData, this.nodeRegistry);
            this.nodes.set(node.id, node);

            // Track max ID
            const idNum = parseInt(node.id.replace(/\D/g, ''), 10);
            if (!isNaN(idNum) && idNum > maxId) {
                maxId = idNum;
            }
        });

        this._idCounter = maxId;

        // Restore connections
        (data.connections || []).forEach(connData => {
            const conn = Connection.fromJSON(connData);
            this.connections.push(conn);
        });

        this._emit('onChange', { event: 'load' });
    }

    /**
     * Clear all nodes and connections
     */
    clear() {
        this.nodes.clear();
        this.connections = [];
        this._idCounter = 0;
        this._emit('onChange', { event: 'clear' });
    }

    // ============================================
    // UTILITIES
    // ============================================

    _generateId() {
        return `n_${++this._idCounter}`;
    }

    /**
     * Register node types for deserialization
     */
    registerNodes(nodes) {
        nodes.forEach(NodeClass => {
            this.nodeRegistry[NodeClass.nodeType] = NodeClass;
        });
    }
}
