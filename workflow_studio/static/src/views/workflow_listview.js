/** @odoo-module **/

import { registry } from "@web/core/registry";
import { listView } from "@web/views/list/list_view";
import { ListRenderer } from "@web/views/list/list_renderer";
import { WorkflowDashboard } from "@workflow_studio/views/workflow_dashboard";

export class WorkflowDashboardListRenderer extends ListRenderer {
    static template = "workflow_studio.WorkflowListView";
    static components = Object.assign({}, ListRenderer.components, { WorkflowDashboard });
}

export const WorkflowDashboardListView = {
    ...listView,
    Renderer: WorkflowDashboardListRenderer,
};

registry.category("views").add("workflow_dashboard_list", WorkflowDashboardListView);
