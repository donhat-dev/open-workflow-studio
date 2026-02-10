/** @odoo-module **/

/**
 * Registries Index
 * 
 * Re-exports all workflow registries for convenient importing.
 * 
 * @odoo-dependency - All registries depend on Odoo registry
 */

export {
    nodeTypeRegistry,
    nodeCategoryRegistry
} from "./node_type_registry";

export {
    workflowLibRegistry
} from "./lib_registry";
