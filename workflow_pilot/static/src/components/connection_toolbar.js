/** @odoo-module **/
import { Component, xml, useEnv } from "@odoo/owl";

/**
 * ConnectionToolbar Component
 * 
 * A floating toolbar that appears on connection hover.
 * Provides quick actions: Add node (insert into connection) and Delete connection.
 * Scales with zoom to maintain visual proportion with the canvas.
 * 
 * Uses workflowEditor service for actions (thin UI pattern).
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
        zoom: { type: Number, optional: true },
    };

    setup() {
        this.env = useEnv();
        this.editor = this.env.workflowEditor;
    }

    /**
     * Toolbar positioning style with zoom-based scaling
     */
    get toolbarStyle() {
        const { x, y } = this.props.position || { x: 0, y: 0 };
        const zoom = this.props.zoom || 1;
        return `left: ${x}px; top: ${y}px; transform: translate(-50%, -50%) scale(${zoom});`;
    }

    /**
     * Handle Add button click - opens NodeMenu via service
     */
    onAddClick() {
        // Trigger bus event for EditorCanvas to open NodeMenu with connection context
        this.editor.bus.trigger('CONNECTION:INSERT_NODE', {
            connectionId: this.props.connectionId,
            position: this.props.position,
        });
    }

    /**
     * Handle Delete button click - removes connection via service
     */
    onDeleteClick() {
        this.editor.actions.removeConnection(this.props.connectionId);
    }

    /**
     * Keep toolbar visible while hovering over it
     */
    onMouseEnter() {
        this.editor.bus.trigger("CONNECTION:TOOLBAR_HOVER", {
            connectionId: this.props.connectionId,
            isHovering: true,
        });
    }

    onMouseLeave() {
        this.editor.bus.trigger("CONNECTION:TOOLBAR_HOVER", {
            connectionId: this.props.connectionId,
            isHovering: false,
        });
    }
}
