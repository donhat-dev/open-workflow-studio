/** @odoo-module **/

import { registry } from "@web/core/registry";
import { kanbanView } from "@web/views/kanban/kanban_view";
import { KanbanController } from "@web/views/kanban/kanban_controller";
import { KanbanRenderer } from "@web/views/kanban/kanban_renderer";
import { WorkflowDashboard } from "@workflow_studio/views/workflow_dashboard";

/**
 * Custom Kanban controller: opens the workflow editor on record click.
 */
class WorkflowDashboardKanbanController extends KanbanController {
    openRecord(record) {
        this.actionService.doAction("workflow_studio.action_workflow_editor_app", {
            additionalContext: { active_id: record.resId },
        });
    }
}

export class WorkflowDashboardKanbanRenderer extends KanbanRenderer {
    static template = "workflow_studio.WorkflowKanbanView";
    static components = Object.assign({}, KanbanRenderer.components, { WorkflowDashboard });
}

export const WorkflowDashboardKanbanView = {
    ...kanbanView,
    Controller: WorkflowDashboardKanbanController,
    Renderer: WorkflowDashboardKanbanRenderer,
};

registry.category("views").add("workflow_dashboard_kanban", WorkflowDashboardKanbanView);
