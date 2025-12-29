/** @odoo-module **/

import { Component, useRef, useState, useExternalListener, onMounted } from "@odoo/owl";
import { WorkflowSocket } from "./workflow_socket";
import { MotionHelpers } from "../utils/motion_helpers";

/**
 * WorkflowNode Component
 * 
 * Renders a draggable node with header (drag handle) and body.
 * Uses Odoo's useExternalListener pattern for global mouse events.
 */
export class WorkflowNode extends Component {
    static template = "workflow_pilot.workflow_node";

    static components = { WorkflowSocket };
    static props = {
        node: Object,
        zoom: { type: Number, optional: true },
        snappedSocketKey: { type: [String, { value: null }], optional: true },
        connectedOutputsSet: { type: Object, optional: true },  // Set of "nodeId:socketKey" for connected outputs
        dimensionConfig: { type: Object },  // Dimension configuration from EditorCanvas
        onMove: { type: Function },
        onSelect: { type: Function },
        onSocketMouseDown: { type: Function, optional: true },
        onSocketMouseUp: { type: Function, optional: true },
        onSocketQuickAdd: { type: Function, optional: true },  // Quick-add button on unconnected sockets
        onDoubleClick: { type: Function, optional: true },  // Double-click to open config
        selected: { type: Boolean, optional: true },
    };

    setup() {
        this.rootRef = useRef("root");
        this.state = useState({ isDragging: false });

        useExternalListener(document, "mousemove", this.onMouseMove.bind(this));
        useExternalListener(document, "mouseup", this.onMouseUp.bind(this));

        this.dragState = { startX: 0, startY: 0, initialX: 0, initialY: 0 };

        // Motion.dev entrance animation - DISABLED
        // onMounted(() => {
        //     MotionHelpers.animateNodeIn(this.rootRef.el);
        // });
    }

    /**
     * Start drag sequence on header mousedown
     * @param {MouseEvent} ev 
     */
    onHeaderMouseDown(ev) {
        ev.stopPropagation();
        ev.preventDefault();

        this.state.isDragging = true;
        this.dragState = {
            startX: ev.clientX,
            startY: ev.clientY,
            initialX: this.props.node.x || 0,
            initialY: this.props.node.y || 0,
        };

        // Notify parent of selection (pass event for Ctrl+click multi-select)
        this.props.onSelect(this.props.node, ev);
    }

    /**
     * Handle double-click on node to open config panel
     */
    onNodeDoubleClick(ev) {
        ev.stopPropagation();
        if (!this.props.onDoubleClick) return;
        this.props.onDoubleClick(this.props.node.id);
    }

    /**
     * Handle mouse movement during drag
     * Optimized with requestAnimationFrame for smoother performance
     * @param {MouseEvent} ev 
     */
    onMouseMove(ev) {
        if (!this.state.isDragging) return;

        // Throttling with requestAnimationFrame
        if (this._dragFrame) return;

        this._dragFrame = requestAnimationFrame(() => {
            this._dragFrame = null;
            if (!this.state.isDragging) return;

            // Enhancement 1: Account for zoom when calculating delta
            const zoom = this.props.zoom || 1;
            const dx = (ev.clientX - this.dragState.startX) / zoom;
            const dy = (ev.clientY - this.dragState.startY) / zoom;

            // Grid Snapping (n8n-style)
            // Note: No artificial bounds - canvas is infinite, nodes can be anywhere
            const GRID_SIZE = 20;
            const targetX = this.dragState.initialX + dx;
            const targetY = this.dragState.initialY + dy;
            const snappedX = Math.round(targetX / GRID_SIZE) * GRID_SIZE;
            const snappedY = Math.round(targetY / GRID_SIZE) * GRID_SIZE;

            // Notify parent to update node position
            this.props.onMove({
                nodeId: this.props.node.id,
                x: snappedX,
                y: snappedY,
            });
        });
    }

    /**
     * End drag sequence on mouseup
     */
    onMouseUp() {
        if (this.state.isDragging) {
            this.state.isDragging = false;
        }
    }

    /**
     * Get node icon - now from node props (FA class)
     */
    get nodeIcon() {
        // Support both new format (icon property) and legacy (type-based)
        if (this.props.node.icon) {
            return this.props.node.icon;
        }
        // Fallback for legacy format
        const icons = {
            http: "fa-globe",
            validation: "fa-check-circle",
            mapping: "fa-exchange",
            loop: "fa-repeat",
            if: "fa-code-branch",
            code: "fa-code",
            noop: "fa-circle-o",
        };
        return icons[this.props.node.type] || "fa-cube";
    }

    /**
     * Get node CSS class based on type
     */
    get nodeTypeClass() {
        return `workflow-node--${this.props.node.type || "default"}`;
    }

    /**
     * Get socket rows for row-paired layout
     * Pairs inputs and outputs by index so they appear on the same row
     * @returns {Array<{ input: [string, Object] | null, output: [string, Object] | null }>}
     */
    get socketRows() {
        const inputs = Object.entries(this.props.node.inputs || {});
        const outputs = Object.entries(this.props.node.outputs || {});
        const maxLen = Math.max(inputs.length, outputs.length);

        const rows = [];
        for (let i = 0; i < maxLen; i++) {
            rows.push({
                input: inputs[i] || null,
                output: outputs[i] || null,
            });
        }
        return rows;
    }

    /**
     * Check if an output socket is connected
     * Uses O(1) Set lookup from parent
     * @param {string} socketKey 
     * @returns {boolean}
     */
    isOutputConnected(socketKey) {
        const set = this.props.connectedOutputsSet;
        if (!set) return false;
        return set.has(`${this.props.node.id}:${socketKey}`);
    }

    /**
     * Get inline style for node (position + dynamic dimensions)
     * Uses dimensionConfig from props if available
     * @returns {string}
     */
    get nodeStyle() {
        const x = this.props.node.x || 0;
        const y = this.props.node.y || 0;

        // Base style with position
        let styles = `left:${x}px;top:${y}px;`;

        // Add dynamic CSS variables from dimensionConfig
        // props.dimensionConfig is an instance of DimensionConfig (passed from EditorCanvas)
        const props = this.props.dimensionConfig.getCSSProperties();
        for (const [key, value] of Object.entries(props)) {
            styles += `${key}:${value};`;
        }

        return styles;
    }
}
