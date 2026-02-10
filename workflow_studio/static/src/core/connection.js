/** @odoo-module **/

/**
 * @core - Pure JavaScript class, no Odoo dependencies.
 *         Can be used outside Odoo environment.
 */

/**
 * Connection - Represents a link between two nodes
 * 
 * Connections are directional: source (output) -> target (input)
 * Each connection references node IDs and socket keys.
 */
export class Connection {
    /**
     * @param {string} sourceId - Source node ID
     * @param {string} sourceHandle - Output socket key on source
     * @param {string} targetId - Target node ID
     * @param {string} targetHandle - Input socket key on target
     */
    constructor(sourceId, sourceHandle, targetId, targetHandle) {
        // Generate deterministic ID from endpoints
        this.id = Connection.generateId(sourceId, sourceHandle, targetId, targetHandle);
        this.source = sourceId;
        this.sourceHandle = sourceHandle;
        this.target = targetId;
        this.targetHandle = targetHandle;

        // Metadata
        this.meta = {
            label: '',      // Optional connection label
            animated: false, // Visual animation
        };
    }

    /**
     * Generate unique connection ID from endpoints
     */
    static generateId(sourceId, sourceHandle, targetId, targetHandle) {
        return `${sourceId}:${sourceHandle}→${targetId}:${targetHandle}`;
    }

    /**
     * Check if this connection involves a specific node
     */
    involvesNode(nodeId) {
        return this.source === nodeId || this.target === nodeId;
    }

    /**
     * Serialize to JSON
     */
    toJSON() {
        return {
            id: this.id,
            source: this.source,
            sourceHandle: this.sourceHandle,
            target: this.target,
            targetHandle: this.targetHandle,
            meta: { ...this.meta },
        };
    }

    /**
     * Create connection from JSON data
     */
    static fromJSON(data) {
        const conn = new Connection(
            data.source,
            data.sourceHandle,
            data.target,
            data.targetHandle
        );
        if (data.id) conn.id = data.id;
        if (data.meta) conn.meta = { ...conn.meta, ...data.meta };
        return conn;
    }
}
