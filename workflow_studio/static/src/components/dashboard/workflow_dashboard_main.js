/** @odoo-module **/

import { loadBundle } from "@web/core/assets";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { Component, onWillStart, useState } from "@odoo/owl";
import { DashboardBlock } from "./base/dashboard_block";
import { DashboardNotebook } from "./base/dashboard_notebook";
import { WorkflowDashboardSummary } from "./workflow_dashboard_summary";
import { WorkflowDashboardStats } from "./workflow_dashboard_stats";
import { WorkflowList } from "./base/workflow_list";

/**
 * WorkflowDashboardComponent — workflow-specific dashboard shell.
 *
 * Wraps DashboardNotebook (base shell) and composes existing sub-components
 * within DashboardBlock shells. This is the "implementation" layer;
 * DashboardNotebook/DashboardBlock are reusable base shells.
 */
export class WorkflowDashboardMain extends Component {
    static template = "workflow_studio.WorkflowDashboardMain";
    static components = {
        DashboardBlock,
        DashboardNotebook,
        WorkflowDashboardSummary,
        WorkflowDashboardStats,
        WorkflowList,
    };
    static props = { action: { type: Object, optional: true }, "*": true };

    setup() {
        this.orm = useService("orm");
        this.actionService = useService("action");
        this.state = useState({ loading: true });

        onWillStart(async () => {
            await loadBundle("web.chartjs_lib");
            this.dashboardData = await this.orm.call('ir.workflow', 'retrieve_dashboard', []);
            this.state.loading = false;
        });
    }

    /** Navigation actions for the hero tag-row */
    get navActions() {
        return [
            { label: "Workflows", xmlId: "workflow_studio.action_ir_workflow" },
            { label: "Execution Logs", xmlId: "workflow_studio.action_workflow_run" },
            { label: "Node Types", xmlId: "workflow_studio.action_workflow_type" },
            { label: "System Logs", xmlId: "workflow_studio.action_ir_workflow_logging" },
        ];
    }

    /** Toggle options for the execution runs chart (7d/14d/30d) */
    get runChartToggleOptions() {
        return [
            { key: "7d", label: "7d" },
            { key: "14d", label: "14d" },
            { key: "30d", label: "30d" },
        ];
    }

    onNavigate(actionXmlId, context) {
        this.actionService.doAction(actionXmlId || "workflow_studio.action_ir_workflow", {
            additionalContext: context || {},
        });
    }
}

registry.category("actions").add("workflow_studio.dashboard", WorkflowDashboardMain);
