/** @odoo-module **/

import { Component, useRef, useState, useExternalListener, useEnv } from "@odoo/owl";
import { WorkflowSocket } from "./workflow_socket";
import { CanvasNodeToolbar } from "./canvas_node_toolbar";
import { LucideIcon } from "./common/lucide_icon";

/**
 * WorkflowNode Component
 * 
 * Renders an individual node on the workflow canvas.
 * Accesses workflowEditor service via env for actions and state.
 */
export class WorkflowNode extends Component {
    static template = "workflow_pilot.workflow_node";

    static components = { WorkflowSocket, CanvasNodeToolbar, LucideIcon };
    static props = {
        node: Object,
        zoom: { type: Number, optional: true },
        snappedSocketKey: { type: [String, { value: null }], optional: true },
        connectedOutputsSet: { type: Object, optional: true },
        dimensionConfig: { type: Object },
        selected: { type: Boolean, optional: true },
        // Socket callbacks removed - now use bus events via t-props pattern
    };

    setup() {
        this.rootRef = useRef("root");
        this.state = useState({ isDragging: false });
        this.editor = this.env.workflowEditor;

        useExternalListener(document, "mousemove", this.onMouseMove.bind(this));
        useExternalListener(document, "mouseup", this.onMouseUp.bind(this));

        this.dragState = { startX: 0, startY: 0, initialX: 0, initialY: 0 };
    }

    /**
     * Start drag sequence on header mousedown
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

        // Begin history batch for undo grouping
        this.editor.actions.beginBatch();

        // Select this node (Ctrl for multi-select)
        const currentSelection = this.editor.state.ui.selection.nodeIds || [];
        if (ev.ctrlKey || ev.metaKey) {
            // Toggle selection
            const isSelected = currentSelection.includes(this.props.node.id);
            if (isSelected) {
                this.editor.actions.select(
                    currentSelection.filter(id => id !== this.props.node.id)
                );
            } else {
                this.editor.actions.select([...currentSelection, this.props.node.id]);
            }
        } else {
            // Single select
            this.editor.actions.select([this.props.node.id]);
        }
    }

    /**
     * Handle double-click to open config panel
     * Only triggers on node zone (header/body), not on toolbar or sockets
     */
    onNodeDoubleClick(ev) {
        if (!ev) return;
        const target = ev.target;
        if (target.closest('.canvas-node-toolbar') ||
            target.closest('.workflow-node__socket')) {
            return;
        }

        ev.stopPropagation();
        this.editor.actions.openPanel("config", { nodeId: this.props.node.id });
    }

    /**
     * Handle mouse movement during drag
     */
    onMouseMove(ev) {
        if (!this.state.isDragging) return;
        if (this._dragFrame) return;

        this._dragFrame = requestAnimationFrame(() => {
            this._dragFrame = null;
            if (!this.state.isDragging) return;

            const zoom = this.props.zoom || 1;
            const dx = (ev.clientX - this.dragState.startX) / zoom;
            const dy = (ev.clientY - this.dragState.startY) / zoom;

            const GRID_SIZE = 20;
            const targetX = this.dragState.initialX + dx;
            const targetY = this.dragState.initialY + dy;
            const snappedX = Math.round(targetX / GRID_SIZE) * GRID_SIZE;
            const snappedY = Math.round(targetY / GRID_SIZE) * GRID_SIZE;

            this.editor.actions.moveNode(this.props.node.id, { x: snappedX, y: snappedY });
        });
    }

    /**
     * End drag sequence
     */
    onMouseUp() {
        if (this.state.isDragging) {
            this.state.isDragging = false;
            // Commit history batch
            this.editor.actions.endBatch("Move node");
        }
    }

    /**
     * Handle delete from toolbar
     */
    onDeleteNode() {
        this.editor.actions.removeNode(this.props.node.id);
    }

    /**
     * Handle execute from toolbar
     */
    onExecuteNode() {
        // Trigger via bus for executor service to handle
        this.editor.bus.trigger("NODE:EXECUTE", { nodeId: this.props.node.id });
    }

    /**
     * Handle toggle disable from toolbar
     */
    onToggleDisable() {
        this.editor.bus.trigger("NODE:TOGGLE_DISABLE", { nodeId: this.props.node.id });
    }

    get nodeIcon() {
        if (this.props.node.icon) {
            return this.props.node.icon;
        }
        const icons = {
            http: "fa-globe",
            http_request: "fa-globe",
            validation: "fa-check-circle",
            mapping: "fa-exchange",
            data_mapping: "fa-exchange",
            loop: "fa-repeat",
            if: "fa-code-branch",
            code: "fa-code",
            noop: "fa-circle-o",
            set_variable: "fa-tag",
        };
        return icons[this.props.node.type] || "fa-cube";
    }

    get nodeTypeClass() {
        return `workflow-node--${this.props.node.type || "default"}`;
    }

    /**
     * Check if this node is disabled
     * @returns {boolean}
     */
    get isDisabled() {
        return this.editor.actions.isNodeDisabled(this.props.node.id);
    }

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

    isOutputConnected(socketKey) {
        const set = this.props.connectedOutputsSet;
        if (!set) return false;
        return set.has(`${this.props.node.id}:${socketKey}`);
    }

    /**
     * Get props for input socket component (t-props pattern)
     * @param {[string, Object]} socketEntry - [socketKey, socketDef]
     * @returns {Object} Props object for WorkflowSocket
     */
    getInputSocketProps(socketEntry) {
        const [socketKey, socketDef] = socketEntry;
        return {
            type: "input",
            name: socketKey,
            label: socketDef.label,
            nodeId: this.props.node.id,
            isSnapped: this.props.snappedSocketKey === socketKey,
            onMouseDown: (data) => {
                this.editor.bus.trigger("SOCKET:MOUSE_DOWN", data);
            },
            onMouseUp: (data) => {
                this.editor.bus.trigger("SOCKET:MOUSE_UP", data);
            },
        };
    }

    /**
     * Get props for output socket component
     * @param {[string, Object]} socketEntry - [socketKey, socketDef]
     * @returns {Object} Props object for WorkflowSocket
     */
    getOutputSocketProps(socketEntry) {
        const [socketKey, socketDef] = socketEntry;
        return {
            type: "output",
            name: socketKey,
            label: socketDef.label,
            nodeId: this.props.node.id,
            isConnected: this.isOutputConnected(socketKey),
            onMouseDown: (data) => {
                this.editor.bus.trigger("SOCKET:MOUSE_DOWN", data);
            },
            onMouseUp: (data) => {
                this.editor.bus.trigger("SOCKET:MOUSE_UP", data);
            },
            onQuickAdd: (data) => {
                this.editor?.bus.trigger("SOCKET:QUICK_ADD", data);
            },
        };
    }

    /**
     * Get props for toolbar component
     * @returns {Object} Props object for CanvasNodeToolbar
     */
    get toolbarProps() {
        return {
            nodeId: this.props.node.id,
            isDisabled: this.props.node.disabled,
            onExecute: () => this.onExecuteNode(),
            onDelete: () => this.onDeleteNode(),
            onToggleDisable: () => this.onToggleDisable(),
            onOpenConfig: () => {
                this.editor.actions.openPanel("config", { nodeId: this.props.node.id });
            },
        };
    }

    get nodeStyle() {
        const x = this.props.node.x || 0;
        const y = this.props.node.y || 0;

        let styles = `left:${x}px;top:${y}px;`;

        if (this.props.dimensionConfig?.getCSSProperties) {
            const props = this.props.dimensionConfig.getCSSProperties();
            for (const [key, value] of Object.entries(props)) {
                styles += `${key}:${value};`;
            }
        }

        return styles;
    }
}
