/** @odoo-module **/

import { Component } from "@odoo/owl";

/**
 * DashboardNotebook — generic reusable shell for dashboard client actions.
 *
 * Cloned from hr_payroll's PayrollDashboardComponent shell pattern:
 *   container-fluid h-100 overflow-auto
 *
 * Provides:
 *  - Full-height scrollable container
 *  - Default slot for composing DashboardBlock children
 *  - No grid/layout opinion — layout is caller's concern
 *
 * Usage:
 *   <DashboardNotebook className="'my-custom-class'">
 *       <div class="row g-2">
 *           <DashboardBlock title="'Stats'" .../>
 *       </div>
 *   </DashboardNotebook>
 */
export class DashboardNotebook extends Component {
    static template = "workflow_studio.DashboardNotebook";
    static props = {
        className: { type: String, optional: true },
        slots: { type: Object },
    };
    static defaultProps = {
        className: "",
    };

    get rootClass() {
        const classes = ["o_dashboard_notebook", "container-fluid", "h-100", "overflow-auto", "p-0"];
        if (this.props.className) {
            classes.push(this.props.className);
        }
        return classes.join(" ");
    }
}
