/** @odoo-module **/

/**
 * Services Index
 *
 * Re-exports all workflow services for convenient importing.
 *
 * @odoo-dependency - All services depend on Odoo service pattern
 */

export { workflowNodeService } from "./workflow_node_service";
export { workflowLibService } from "./workflow_lib_service";
export { workflowExecutorService } from "./workflow_executor_service";
export { workflowAdapterService } from "./workflow_adapter_service";
export { workflowVariableService } from "./variable_service";
export { workflowEditorService } from "./workflow_editor_service";
