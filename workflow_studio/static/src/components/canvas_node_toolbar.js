/** @odoo-module **/

import { Component } from "@odoo/owl";

/**
 * CanvasNodeToolbar - Floating toolbar above workflow nodes
 * 
 * Shows on hover with actions: Execute, Disable/Enable, Delete, Menu
 * Inspired by n8n's CanvasNodeToolbar pattern.
 */
export class CanvasNodeToolbar extends Component {
    static template = "workflow_studio.canvas_node_toolbar";

    static props = {
        nodeId: String,
        isDisabled: { type: Boolean, optional: true },
        isPinned: { type: Boolean, optional: true },
        isExecuting: { type: Boolean, optional: true },
        onExecute: { type: Function, optional: true },
        onDelete: { type: Function, optional: true },
        onToggleDisable: { type: Function, optional: true },
        onTogglePin: { type: Function, optional: true },
        onOpenConfig: { type: Function, optional: true },
        onOpenMenu: { type: Function, optional: true },
    };

    /**
     * Execute button click
     */
    onExecuteClick(ev) {
        ev.stopPropagation();
        const onExecute = this.props.onExecute;
        if (!onExecute) {
            throw new Error("[CanvasNodeToolbar] Missing onExecute prop");
        }
        onExecute(this.props.nodeId);
    }

    /**
     * Delete button click
     */
    onDeleteClick(ev) {
        ev.stopPropagation();
        const onDelete = this.props.onDelete;
        if (!onDelete) {
            throw new Error("[CanvasNodeToolbar] Missing onDelete prop");
        }
        onDelete(this.props.nodeId);
    }

    /**
     * Toggle disable/enable
     */
    onToggleClick(ev) {
        ev.stopPropagation();
        const onToggleDisable = this.props.onToggleDisable;
        if (!onToggleDisable) {
            throw new Error("[CanvasNodeToolbar] Missing onToggleDisable prop");
        }
        onToggleDisable(this.props.nodeId);
    }

    /**
     * Toggle pin/unpin
     */
    onTogglePinClick(ev) {
        ev.stopPropagation();
        const onTogglePin = this.props.onTogglePin;
        if (!onTogglePin) {
            throw new Error("[CanvasNodeToolbar] Missing onTogglePin prop");
        }
        onTogglePin(this.props.nodeId);
    }

    /**
     * Open config panel
     */
    onConfigClick(ev) {
        ev.stopPropagation();
        const onOpenConfig = this.props.onOpenConfig;
        if (!onOpenConfig) {
            throw new Error("[CanvasNodeToolbar] Missing onOpenConfig prop");
        }
        onOpenConfig(this.props.nodeId);
    }

    /**
     * Open context menu
     */
    onMenuClick(ev) {
        ev.stopPropagation();
        const onOpenMenu = this.props.onOpenMenu;
        if (!onOpenMenu) {
            throw new Error("[CanvasNodeToolbar] Missing onOpenMenu prop");
        }
        onOpenMenu(this.props.nodeId, ev);
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

    /**
     * Get pin button title
     */
    get pinTitle() {
        return this.props.isPinned ? "Unpin output data" : "Pin output data";
    }

    /**
     * Get pin button icon
     */
    get pinIcon() {
        return "fa-thumb-tack";
    }
}
