/** @odoo-module **/
import { Component, xml, useEnv, useRef, onMounted } from "@odoo/owl";

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
             t-ref="root"
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
        onInsertNode: { type: Function },   // (connectionId, position) => void
        onHoverChange: { type: Function },  // (isHovering) => void
    };

    setup() {
        this.env = useEnv();
        this.editor = this.env.workflowEditor;
        this.rootRef = useRef("root");

        // On mount, immediately notify parent to prevent premature hide
        // This handles the case where toolbar renders under the mouse
        onMounted(() => {
            // Immediately signal that toolbar is active to prevent timeout from hiding it
            this.props.onHoverChange(true);
        });
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
     * Handle Add button click - opens NodeMenu via callback
     */
    onAddClick() {
        this.props.onInsertNode(this.props.connectionId, this.props.position);
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
        // Clear any pending leave
        if (this._leaveTimeout) {
            clearTimeout(this._leaveTimeout);
            this._leaveTimeout = null;
        }
        this.props.onHoverChange(true);
    }

    onMouseLeave() {
        // Debounce leave to prevent flickering at edges
        if (this._leaveTimeout) {
            clearTimeout(this._leaveTimeout);
        }
        this._leaveTimeout = setTimeout(() => {
            this.props.onHoverChange(false);
            this._leaveTimeout = null;
        }, 100);
    }
}
