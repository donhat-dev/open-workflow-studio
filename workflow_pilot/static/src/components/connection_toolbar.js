/** @odoo-module **/
import { Component, xml } from "@odoo/owl";

/**
 * ConnectionToolbar Component
 * 
 * A floating toolbar that appears on connection hover.
 * Provides quick actions: Add node (insert into connection) and Delete connection.
 * Scales with zoom to maintain visual proportion with the canvas.
 */
export class ConnectionToolbar extends Component {
    static template = xml`
        <div class="connection-toolbar" 
             t-att-style="toolbarStyle"
             t-on-mouseenter="onMouseEnter"
             t-on-mouseleave="onMouseLeave"
             t-on-wheel.stop="">
            <!-- Add Node Button -->
            <button class="connection-toolbar__btn connection-toolbar__btn--add" 
                    t-on-click.stop="onAddClick"
                    title="Add node">
                +
            </button>
            <!-- Delete Connection Button -->
            <button class="connection-toolbar__btn connection-toolbar__btn--delete" 
                    t-on-click.stop="onDeleteClick"
                    title="Delete connection">
                ×
            </button>
        </div>
    `;

    static props = {
        position: { type: Object },      // { x, y } - midpoint in canvas coordinates
        connectionId: { type: String },
        zoom: { type: Number, optional: true },  // Current zoom level for scaling
        onAddNode: { type: Function },   // (connectionId, position) => void
        onDelete: { type: Function },    // (connectionId) => void
        onHoverChange: { type: Function, optional: true }, // (isHovering) => void
    };

    /**
     * Toolbar positioning style with zoom-based scaling
     */
    get toolbarStyle() {
        const { x, y } = this.props.position || { x: 0, y: 0 };
        const zoom = this.props.zoom || 1;

        // Scale toolbar with zoom for visual consistency
        // translate(-50%, -50%) is already in CSS, we add scale here
        return `left: ${x}px; top: ${y}px; transform: translate(-50%, -50%) scale(${zoom});`;
    }

    /**
     * Handle Add button click - opens NodeMenu at this position
     */
    onAddClick() {
        this.props.onAddNode(this.props.connectionId, this.props.position);
    }

    /**
     * Handle Delete button click - removes the connection
     */
    onDeleteClick() {
        this.props.onDelete(this.props.connectionId);
    }

    /**
     * Keep toolbar visible while hovering over it
     */
    onMouseEnter() {
        this.props.onHoverChange?.(true);
    }

    onMouseLeave() {
        this.props.onHoverChange?.(false);
    }
}
