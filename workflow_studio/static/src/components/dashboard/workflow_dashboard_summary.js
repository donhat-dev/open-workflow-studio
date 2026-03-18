/** @odoo-module **/

import { Component } from "@odoo/owl";

export class WorkflowDashboardSummary extends Component {
    static template = "workflow_studio.WorkflowDashboardSummary";
    static props = {
        data: Object,
        onNavigate: { type: Function, optional: true },
    };

    get stats() {
        const d = this.props.data;
        return [
            { label: "Total Workflows", value: d.total_workflows, filter: {} },
            { label: "Published", value: d.published_workflows, filter: { state: "published" } },
            { label: "Draft", value: d.draft_workflows, filter: { state: "draft" } },
            { label: "Running Now", value: d.running_now, filter: {} },
            { label: "My Workflows", value: d.my_workflows, filter: { my: true } },
        ];
    }

    onStatClick(filter) {
        if (this.props.onNavigate) {
            this.props.onNavigate(null, filter);
        }
    }
}
