/** @odoo-module **/

import { loadBundle } from "@web/core/assets";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { Component, onWillStart, useState } from "@odoo/owl";
import { DashboardBlock } from "./base/dashboard_block";
import { DashboardNotebook } from "./base/dashboard_notebook";
import { WorkflowDashboardSummary } from "./workflow_dashboard_summary";
import { WorkflowDashboardStats } from "./workflow_dashboard_stats";
import { WorkflowDashboardTopWorkflows } from "./workflow_dashboard_top_workflows";
import { WorkflowList } from "./base/workflow_list";

// TODO Phase 1: Replace with orm.call('ir.workflow', 'retrieve_dashboard')
function getMockDashboardData() {
    const today = new Date();

    // Build stacked_bar format for WorkflowDashboardStats: {period: {DatasetName: [{label, value}]}}
    function buildRunData(days) {
        const completed = [];
        const failed = [];
        const cancelled = [];
        for (let i = days - 1; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            const label = d.toLocaleDateString("en", { month: "short", day: "numeric" });
            completed.push({ label, value: Math.floor(Math.random() * 30) + 10 });
            failed.push({ label, value: Math.floor(Math.random() * 8) });
            cancelled.push({ label, value: Math.floor(Math.random() * 3) });
        }
        return { Completed: completed, Failed: failed, Cancelled: cancelled };
    }

    return {
        summary: {
            total_workflows: 12,
            published_workflows: 8,
            draft_workflows: 4,
            running_now: 2,
            my_workflows: 5,
        },
        runs: {
            "7d": buildRunData(7),
            "14d": buildRunData(14),
            "30d": buildRunData(30),
        },
        performance: {
            top_failing: [
                { workflow_name: "Sync Orders", fail_count: 12 },
                { workflow_name: "Stock Update", fail_count: 5 },
                { workflow_name: "Price Sync", fail_count: 3 },
            ],
            top_slow: [
                { workflow_name: "Bulk Import", avg_duration: "45.2s" },
                { workflow_name: "Report Gen", avg_duration: "32.1s" },
                { workflow_name: "Sync Orders", avg_duration: "12.4s" },
            ],
        },
    };
}

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
        WorkflowDashboardTopWorkflows,
        WorkflowList,
    };
    static props = { action: { type: Object, optional: true }, "*": true };

    setup() {
        this.orm = useService("orm");
        this.actionService = useService("action");
        this.state = useState({ loading: true });

        onWillStart(async () => {
            await loadBundle("web.chartjs_lib");
            // TODO Phase 1: this.dashboardData = await this.orm.call('ir.workflow', 'retrieve_dashboard');
            this.dashboardData = getMockDashboardData();
            this.state.loading = false;
        });
    }

    /** Toggle options for the execution runs chart (7d/14d/30d) */
    get runChartToggleOptions() {
        return [
            { key: "7d", label: "7d" },
            { key: "14d", label: "14d" },
            { key: "30d", label: "30d" },
        ];
    }

    /** Bootstrap status colors for stacked bar datasets: Completed / Failed / Cancelled */
    get runChartColors() {
        const style = getComputedStyle(document.documentElement);
        return [
            style.getPropertyValue("--bs-success").trim() || "#198754",
            style.getPropertyValue("--bs-danger").trim() || "#dc3545",
            style.getPropertyValue("--bs-warning").trim() || "#ffc107",
        ];
    }

    onNavigate(actionXmlId, context) {
        this.actionService.doAction(actionXmlId || "workflow_studio.action_ir_workflow", {
            additionalContext: context || {},
        });
    }
}

registry.category("actions").add("workflow_studio.dashboard", WorkflowDashboardMain);
