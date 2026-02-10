/** @odoo-module **/

/**
 * Node Type Registry
 * 
 * Central registry for workflow node types and categories.
 * Uses Odoo's registry pattern for extensibility.
 * 
 * @odoo-dependency - Uses Odoo registry
 */

import { registry } from "@web/core/registry";

// Registry for node type definitions
// Each entry: { class, name, icon, category, description, inputs, outputs }
export const nodeTypeRegistry = registry.category("workflow_node_types");

// Registry for node categories
// Each entry: { name, icon, sequence }
export const nodeCategoryRegistry = registry.category("workflow_node_categories");

// Default categories - can be extended by other modules
// Icons use Font Awesome class names (e.g., "fa-bolt")
nodeCategoryRegistry
    .add("trigger", {
        name: "Triggers",
        icon: "fa-bolt",
        description: "Start workflow execution",
    }, { sequence: 10 })
    .add("action", {
        name: "Actions",
        icon: "fa-play-circle",
        description: "Perform operations",
    }, { sequence: 20 })
    .add("flow", {
        name: "Flow Control",
        icon: "fa-code-branch",
        description: "Control workflow logic",
    }, { sequence: 30 })
    .add("data", {
        name: "Data",
        icon: "fa-database",
        description: "Transform and validate data",
    }, { sequence: 40 })
    .add("integration", {
        name: "Integrations",
        icon: "fa-plug",
        description: "Connect to external systems",
    }, { sequence: 50 })
    .add("transform", {
        name: "Transform",
        icon: "fa-exchange",
        description: "Transform and map data",
    }, { sequence: 45 });
