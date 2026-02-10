/** @odoo-module **/

/**
 * @core - Pure JavaScript class, no Odoo dependencies.
 *         Can be used outside Odoo environment.
 */

/**
 * Socket - Defines typed connection points for nodes
 * Inspired by Rete.js ClassicPreset.Socket
 * 
 * Sockets determine which outputs can connect to which inputs
 * based on type compatibility.
 */
export class Socket {
    /**
     * @param {string} name - Socket type name (e.g., 'data', 'error')
     * @param {Object} options
     * @param {string[]} options.compatibleWith - Array of compatible socket names
     */
    constructor(name, options = {}) {
        this.name = name;
        this.compatibleWith = options.compatibleWith || [];
    }

    /**
     * Check if this socket can connect to another socket
     * @param {Socket} other - Target socket to check compatibility
     * @returns {boolean}
     */
    isCompatible(other) {
        if (!other) return false;
        // Same type always compatible
        if (this.name === other.name) return true;
        // Check explicit compatibility list
        return this.compatibleWith.includes(other.name);
    }
}

// ============================================
// PREDEFINED SOCKET TYPES
// ============================================

/**
 * DataSocket - General purpose data flow
 */
export const DataSocket = new Socket('data');

/**
 * ErrorSocket - Error handling path (compatible with data)
 */
export const ErrorSocket = new Socket('error', {
    compatibleWith: ['data']
});

/**
 * TriggerSocket - Execution flow (not data)
 */
export const TriggerSocket = new Socket('trigger');

// Export socket registry for extensibility
export const SocketRegistry = {
    data: DataSocket,
    error: ErrorSocket,
    trigger: TriggerSocket,
};
