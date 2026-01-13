/** @odoo-module **/

import { Component } from "@odoo/owl";

/**
 * CanvasNodeToolbar - Floating toolbar above workflow nodes
 * 
 * Shows on hover with actions: Execute, Disable/Enable, Delete, Menu
 * Inspired by n8n's CanvasNodeToolbar pattern.
 */
export class CanvasNodeToolbar extends Component {
    static template = "workflow_pilot.canvas_node_toolbar";

    static props = {
        nodeId: String,
        isDisabled: { type: Boolean, optional: true },
        isExecuting: { type: Boolean, optional: true },
        onExecute: { type: Function, optional: true },
        onDelete: { type: Function, optional: true },
        onToggleDisable: { type: Function, optional: true },
        onOpenConfig: { type: Function, optional: true },
        onOpenMenu: { type: Function, optional: true },
    };

    /**
     * Execute button click
     */
    onExecuteClick(ev) {
        ev.stopPropagation();
        this.props.onExecute?.(this.props.nodeId);
    }

    /**
     * Delete button click
     */
    onDeleteClick(ev) {
        ev.stopPropagation();
        this.props.onDelete?.(this.props.nodeId);
    }

    /**
     * Toggle disable/enable
     */
    onToggleClick(ev) {
        ev.stopPropagation();
        this.props.onToggleDisable?.(this.props.nodeId);
    }

    /**
     * Open config panel
     */
    onConfigClick(ev) {
        ev.stopPropagation();
        this.props.onOpenConfig?.(this.props.nodeId);
    }

    /**
     * Open context menu
     */
    onMenuClick(ev) {
        ev.stopPropagation();
        this.props.onOpenMenu?.(this.props.nodeId, ev);
    }

    /**
     * Get disable button title
     */
    get toggleTitle() {
        return this.props.isDisabled ? "Enable node" : "Disable node";
    }

    /**
     * Get disable button icon
     */
    get toggleIcon() {
        return this.props.isDisabled ? "fa-toggle-off" : "fa-toggle-on";
    }
}
