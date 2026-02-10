/** @odoo-module **/

/**
 * Library Registry
 * 
 * Registry for external libraries used by workflow components.
 * Provides abstraction layer over window globals while maintaining
 * backward compatibility.
 * 
 * @odoo-dependency - Uses Odoo registry
 */

import { registry } from "@web/core/registry";

// Registry for external libraries
// Each entry: { globalName, get: () => instance, description }
export const workflowLibRegistry = registry.category("workflow_libs");

// Register dagre.js for graph layout
// Still binds to window for backward compatibility
workflowLibRegistry.add("dagre", {
    globalName: "dagre",
    description: "Graph layout library for node auto-arrangement",
    get: () => window.dagre,
});

// Register Motion library for animations
workflowLibRegistry.add("motion", {
    globalName: "Motion",
    description: "Animation library for smooth transitions",
    get: () => window.Motion,
});
