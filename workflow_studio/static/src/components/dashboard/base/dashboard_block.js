/** @odoo-module **/

import { Component } from "@odoo/owl";

/**
 * DashboardBlock — generic reusable card shell for dashboard panels.
 *
 * Provides:
 *  - card h-100 with flex column layout
 *  - card-header (bg-view, border-0) with optional title + header_actions slot
 *  - card-body (flex-grow-1, min-height-0) with default slot
 *  - optional scrollable body via `scrollable` prop
 *
 * Usage:
 *   <DashboardBlock title="'Recent Errors'" scrollable="true">
 *       <t t-set-slot="header_actions">
 *           <button class="btn btn-sm">Filter</button>
 *       </t>
 *       <!-- body content via default slot -->
 *       <div class="list-group">...</div>
 *   </DashboardBlock>
 */
export class DashboardBlock extends Component {
    static template = "workflow_studio.DashboardBlock";
    static props = {
        title: { type: String, optional: true },
        help: { type: String, optional: true },
        bodyClass: { type: String, optional: true },
        blockClass: { type: String, optional: true },
        scrollable: { type: Boolean, optional: true },
        slots: { type: Object },
    };
    static defaultProps = {
        scrollable: false,
        bodyClass: "",
        blockClass: "",
    };

    get rootClass() {
        const classes = ["card", "h-100", "d-flex", "flex-column"];
        if (this.props.blockClass) {
            classes.push(this.props.blockClass);
        }
        return classes.join(" ");
    }

    get bodyContainerClass() {
        const classes = ["flex-grow-1"];
        if (this.props.scrollable) {
            classes.push("o_wf_scrollable_panel");
        } else {
            classes.push("card-body");
        }
        if (this.props.bodyClass) {
            classes.push(this.props.bodyClass);
        }
        return classes.join(" ");
    }
}
