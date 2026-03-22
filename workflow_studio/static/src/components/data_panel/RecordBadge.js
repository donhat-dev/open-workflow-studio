/** @odoo-module **/

import { Component, useState } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";

/**
 * RecordBadge Component
 *
 * Displays a list of records as pill-shaped badges that match the
 * key-badge style of JsonTreeNode. Supports:
 *  - `data`   {Array}   - list of items to display (each item can be any value;
 *                         pass objects with a `label` key for custom text, or
 *                         any primitive — it will be stringified).
 *  - `max`    {Number}  - max badges shown before collapsing (default: 5).
 *  - `expand` {Boolean} - if true, render all badges immediately (default: false).
 *
 * When data.length > max, a "+N" overflow badge is shown. Clicking it expands
 * the list.  The toggle chevron in `json-tree-node__toggle` collapses it back.
 */
export class RecordBadge extends Component {
    static template = "workflow_studio.record_badge";

    static props = {
        data: { type: Array },
        max: { type: Number, optional: true },
        expand: { type: Boolean, optional: true },
        // Optional label formatter: (item) => String
        getLabel: { type: Function, optional: true },
    };

    static defaultProps = {
        max: 5,
        expand: false,
    };

    setup() {
        this.state = useState({
            expanded: this.props.expand || false,
        });
        this.actionService = useService("action");
    }

    get normalizedMax() {
        const m = this.props.max;
        return typeof m === "number" && m > 0 ? Math.floor(m) : 5;
    }

    get total() {
        return Array.isArray(this.props.data) ? this.props.data.length : 0;
    }

    get isOverflowing() {
        return !this.state.expanded && this.total > this.normalizedMax;
    }

    get visibleItems() {
        const data = this.props.data || [];
        if (this.state.expanded) {
            return data;
        }
        return data.slice(0, this.normalizedMax);
    }

    get remainCount() {
        return this.total - this.normalizedMax;
    }

    getLabel(item) {
        if (this.props.getLabel) {
            return this.props.getLabel(item);
        }
        if (item === null || item === undefined) return "null";
        if (typeof item === "object" && "label" in item) return String(item.label);
        return String(item);
    }

    onExpand(ev) {
        ev.stopPropagation();
        this.state.expanded = true;
    }

    onCollapse(ev) {
        ev.stopPropagation();
        this.state.expanded = false;
    }

    onOpenRecord(ev) {
        ev.stopPropagation();
        // Label stored as data-record-label="model.name,id" on the badge span
        const label = ev.currentTarget.dataset.recordLabel || "";
        const commaIdx = label.lastIndexOf(",");
        if (commaIdx === -1) return;
        const model = label.slice(0, commaIdx);
        const id = parseInt(label.slice(commaIdx + 1), 10);
        if (!model || !id) return;
        this.actionService.doAction({
            type: "ir.actions.act_window",
            res_model: model,
            res_id: id,
            views: [[false, "form"]],
            target: "new",
        });
    }
}
