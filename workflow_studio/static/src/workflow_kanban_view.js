/** @odoo-module **/

import { kanbanView } from "@web/views/kanban/kanban_view";
import { KanbanController } from "@web/views/kanban/kanban_controller";
import { registry } from "@web/core/registry";

class WorkflowKanbanController extends KanbanController {
    openRecord(record) {
        this.actionService.doAction("workflow_studio.action_workflow_editor_app", {
            additionalContext: { active_id: record.resId },
        });
    }
}

export const workflowKanbanView = Object.assign({}, kanbanView, {
    Controller: WorkflowKanbanController,
});

registry.category("views").add("workflow_pilot_list_kanban", workflowKanbanView);
