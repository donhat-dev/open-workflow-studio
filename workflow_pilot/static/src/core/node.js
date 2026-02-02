/** @odoo-module **/

/**
 * @core - Pure JavaScript class, no Odoo dependencies.
 *         Can be used outside Odoo environment.
 */

import { DataSocket, ErrorSocket, SocketRegistry } from './socket';

/**
 * BaseNode - Abstract base class for all workflow nodes
 * Inspired by Rete.js ClassicPreset.Node and n8n's node structure
 * 
 * Nodes are the building blocks of workflows. Each node type
 * extends BaseNode and defines its inputs, outputs, and controls.
 */
export class BaseNode {
    // Static property - override in subclasses
    static nodeType = 'base';
    static label = 'Base Node';
    static icon = 'fa-cube';
    static category = 'general';

    constructor() {
        this.id = null;  // Assigned by WorkflowEditor
        this.type = this.constructor.nodeType;
        this.label = this.constructor.label;
        this.icon = this.constructor.icon;
        this.category = this.constructor.category;

        // Position on canvas
        this.position = { x: 0, y: 0 };

        // I/O and controls
        this.inputs = {};
        this.outputs = {};
        this.controls = {};

        // Metadata (n8n-style)
        this.meta = {
            disabled: false,
            notes: '',
        };
    }

    // ============================================
    // INPUT/OUTPUT MANAGEMENT
    // ============================================

    /**
     * Add an input socket
     * @param {string} key - Unique key for this input
     * @param {Socket} socket - Socket type
     * @param {string} label - Display label
     * @param {Object} options - Additional options
     */
    addInput(key, socket, label = null, options = {}) {
        this.inputs[key] = {
            key,
            socket,
            label: label || key,
            multiple: options.multiple || false,  // Allow multiple connections
        };
        return this;
    }

    /**
     * Add an output socket
     * @param {string} key - Unique key for this output
     * @param {Socket} socket - Socket type
     * @param {string} label - Display label
     */
    addOutput(key, socket, label = null) {
        this.outputs[key] = {
            key,
            socket,
            label: label || key,
        };
        return this;
    }

    /**
     * Add a control (configuration UI element)
     * @param {string} key - Unique key
     * @param {Control} control - Control instance
     */
    addControl(key, control) {
        this.controls[key] = control;
        return this;
    }

    // ============================================
    // CONFIGURATION ACCESS
    // ============================================

    /**
     * Get all control values as a config object
     * Used for serialization and execution
     */
    getConfig() {
        const config = {};
        Object.entries(this.controls).forEach(([key, control]) => {
            config[key] = control.getValue();
        });
        return config;
    }

    /**
     * Set control values from config object
     */
    setConfig(config) {
        Object.entries(config).forEach(([key, value]) => {
            if (this.controls[key]) {
                this.controls[key].setValue(value);
            }
        });
    }

    // ============================================
    // EXECUTION
    // ============================================

    /**
     * Execute node with input data
     * Frontend execution is disabled; use backend runners
     * @param {Object} inputData - Data from previous node
     * @returns {Promise<{output: Object, error: string|null}>}
     */
    async execute(inputData = {}) {
        throw new Error("[BaseNode] Frontend execution is disabled. Use backend runners.");
    }

    // ============================================
    // SERIALIZATION (n8n compatible format)
    // ============================================

    /**
     * Serialize node to JSON
     * Format designed for Python backend consumption
     */
    toJSON() {
        return {
            id: this.id,
            type: this.type,
            label: this.label,
            position: { ...this.position },
            config: this.getConfig(),
            meta: { ...this.meta },
        };
    }

    /**
     * Create node instance from JSON data
     * @param {Object} data - Serialized node data
     * @param {Object} nodeRegistry - Map of type -> NodeClass
     * @returns {BaseNode}
     */
    static fromJSON(data, nodeRegistry) {
        const NodeClass = nodeRegistry[data.type];
        if (!NodeClass) {
            throw new Error(`Unknown node type: ${data.type}`);
        }

        const node = new NodeClass();
        node.id = data.id;
        node.label = data.label || node.label;
        node.position = data.position || { x: 0, y: 0 };
        node.meta = { ...node.meta, ...(data.meta || {}) };

        // Restore control values
        if (data.config) {
            node.setConfig(data.config);
        }

        return node;
    }

    // ============================================
    // UTILITY METHODS
    // ============================================

    /**
     * Get input socket keys
     */
    getInputKeys() {
        return Object.keys(this.inputs);
    }

    /**
     * Get output socket keys
     */
    getOutputKeys() {
        return Object.keys(this.outputs);
    }

    /**
     * Clone this node (for copy/paste)
     */
    clone() {
        const data = this.toJSON();
        data.id = null;  // Will be reassigned
        return BaseNode.fromJSON(data, { [this.type]: this.constructor });
    }
}

// Export for subclass access
export { DataSocket, ErrorSocket };
