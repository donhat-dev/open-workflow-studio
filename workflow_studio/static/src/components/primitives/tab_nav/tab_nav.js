/** @odoo-module **/

import { Component } from "@odoo/owl";

/**
 * TabNav — reusable tab navigation shell.
 *
 * Renders a tab strip from the `tabs` prop and exposes a default slot for
 * tab body content. Which content to show inside the slot is the caller's
 * responsibility (use t-if per tab key).
 *
 * Example:
 *   <TabNav tabs="tabDefs" activeTab="state.activeTab" onTabClick.bind="onTabClick">
 *     <div class="tab-content">
 *       <t t-if="state.activeTab === 'parameters'">…</t>
 *       <t t-if="state.activeTab === 'settings'">…</t>
 *     </div>
 *   </TabNav>
 *
 * Tab descriptor shape: { id: string, label: string, icon?: string }
 * (icon is a Font Awesome icon class suffix, e.g. "fa-cog")
 */
export class TabNav extends Component {
    static template = "workflow_studio.tab_nav";

    static props = {
        /** Tab descriptors: [{ id, label, icon? }] */
        tabs: { type: Array },
        /** ID of the currently visible tab */
        activeTab: { type: String },
        /** Callback invoked with the tab id when the user clicks a tab */
        onTabClick: { type: Function },
        slots: { type: Object, optional: true },
    };
}
