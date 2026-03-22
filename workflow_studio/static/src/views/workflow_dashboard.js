/** @odoo-module **/

import { useService } from "@web/core/utils/hooks";
import { Component, onWillStart } from "@odoo/owl";

// TODO Phase 1: replace mock with orm.call('ir.workflow', 'retrieve_list_dashboard')
const MOCK_DASHBOARD_DATA = {
    all_published: 3,
    all_draft: 2,
    all_total: 5,
    my_published: 1,
    my_draft: 1,
    my_total: 2,
    all_runs_today: 42,
    all_failed_today: 5,
    failure_rate_7d: 12,
    all_avg_duration: "3.2s",
};

export class WorkflowDashboard extends Component {
    static template = "workflow_studio.WorkflowDashboard";
    static props = {};

    setup() {
        this.orm = useService("orm");
        this.action = useService("action");

        onWillStart(async () => {
            // TODO Phase 1: this.data = await this.orm.call("ir.workflow", "retrieve_list_dashboard");
            this.data = { ...MOCK_DASHBOARD_DATA };
        });
    }

    /**
     * Clears current search query + toggles the filters
     * found in the `filter_name` attribute of the clicked button.
     */
    setSearchContext(ev) {
        const filterName = ev.currentTarget.getAttribute("filter_name");
        if (!filterName) {
            return;
        }
        const filters = filterName.split(",");
        const searchItems = this.env.searchModel.getSearchItems((item) =>
            filters.includes(item.name)
        );
        this.env.searchModel.query = [];
        for (const item of searchItems) {
            this.env.searchModel.toggleSearchItem(item.id);
        }
    }
}
