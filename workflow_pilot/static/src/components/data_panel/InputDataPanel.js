/** @odoo-module **/

import { Component, useState } from "@odoo/owl";
import { JsonTreeNode } from "./JsonTreeNode";

/**
 * InputDataPanel Component
 * 
 * Panel displaying output data from previous node.
 * Shows a tree view of JSON data with draggable items.
 */
export class InputDataPanel extends Component {
    static template = "workflow_pilot.input_data_panel";
    static components = { JsonTreeNode };

    static props = {
        data: { type: Object, optional: true },  // Previous node output
        nodeName: { type: String, optional: true },  // Previous node name
        onItemClick: { type: Function, optional: true },
    };

    setup() {
        this.state = useState({
            isCollapsed: false,
        });
    }

    get hasData() {
        return this.props.data && Object.keys(this.props.data).length > 0;
    }

    get nodeDisplayName() {
        return this.props.nodeName || 'Previous Node';
    }

    toggleCollapse() {
        this.state.isCollapsed = !this.state.isCollapsed;
    }

    onNodeClick(path) {
        this.props.onItemClick?.(path);
    }
}
