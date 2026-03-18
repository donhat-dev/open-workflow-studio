/** @odoo-module **/

import { Component, useState } from "@odoo/owl";

export class WorkflowDashboardTopWorkflows extends Component {
    static template = "workflow_studio.WorkflowDashboardTopWorkflows";
    static props = { data: Object };

    setup() {
        this.state = useState({ tab: "failing" });
    }

    get failingList() {
        return this.props.data.top_failing || [];
    }

    get slowList() {
        return this.props.data.top_slow || [];
    }

    onTabChange(tab) {
        this.state.tab = tab;
    }
}
