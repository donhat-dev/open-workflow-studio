/** @odoo-module **/

import { Component } from "@odoo/owl";

/**
 * WorkflowSocket Component
 * 
 * Represents a connection point (handle) on a node.
 * Used for both inputs (left side) and outputs (right side).
 */
export class WorkflowSocket extends Component {
    static template = "workflow_studio.workflow_socket";

    static props = {
        type: { type: String, validate: t => ['input', 'output'].includes(t) },
        name: String,
        label: { type: String, optional: true },
        nodeId: String,
        isConnected: { type: Boolean, optional: true },
        isSnapped: { type: Boolean, optional: true },  // Smart snapping highlight
        readonly: { type: Boolean, optional: true },   // Disable interactions in readonly mode
        // Callbacks for connection interactions
        onMouseDown: { type: Function, optional: true },
        onMouseUp: { type: Function, optional: true },
        onQuickAdd: { type: Function, optional: true },  // Quick-add button callback
    };

    /**
     * Handle mouse down on the socket point (start connection)
     * @param {MouseEvent} ev 
     */
    onPointMouseDown(ev) {
        if (this.props.readonly) return;
        // Only left click starts connection
        if (ev.button !== 0) return;
        const onMouseDown = this.props.onMouseDown;
        if (!onMouseDown) return;
        onMouseDown({
            nodeId: this.props.nodeId,
            socketKey: this.props.name,
            socketType: this.props.type,
            event: ev
        });
    }

    /**
     * Handle mouse up on the socket point (complete connection)
     * @param {MouseEvent} ev 
     */
    onPointMouseUp(ev) {
        if (this.props.readonly) return;
        const onMouseUp = this.props.onMouseUp;
        if (!onMouseUp) return;
        onMouseUp({
            nodeId: this.props.nodeId,
            socketKey: this.props.name,
            socketType: this.props.type,
            event: ev
        });
    }

    /**
     * Handle quick-add button click
     * @param {MouseEvent} ev 
     */
    onQuickAddClick(ev) {
        if (this.props.readonly) return;
        ev.stopPropagation();
        const onQuickAdd = this.props.onQuickAdd;
        if (!onQuickAdd) return;
        onQuickAdd({
            nodeId: this.props.nodeId,
            socketKey: this.props.name,
            event: ev,
        });
    }

    /**
     * Handle mouse down on quick-add button - start connection drag from this socket
     * This allows users to drag from the + button to create connections
     * @param {MouseEvent} ev 
     */
    onQuickAddMouseDown(ev) {
        if (this.props.readonly) return;
        // Only left click starts connection
        if (ev.button !== 0) return;
        const onMouseDown = this.props.onMouseDown;
        if (!onMouseDown) return;

        // Trigger the same flow as socket point mousedown
        onMouseDown({
            nodeId: this.props.nodeId,
            socketKey: this.props.name,
            socketType: this.props.type,
            event: ev
        });
    }
}

