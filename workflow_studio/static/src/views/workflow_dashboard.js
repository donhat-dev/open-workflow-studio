/** @odoo-module **/

import { useService } from "@web/core/utils/hooks";
import { Component, onWillStart } from "@odoo/owl";

export class WorkflowDashboard extends Component {
    static template = "workflow_studio.WorkflowDashboard";
    static props = {};

    setup() {
        this.orm = useService("orm");
        this.action = useService("action");

        onWillStart(async () => {
            this.data = await this.orm.call("ir.workflow", "retrieve_list_dashboard", []);
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
