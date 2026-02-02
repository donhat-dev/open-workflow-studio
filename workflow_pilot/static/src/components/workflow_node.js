/** @odoo-module **/

import { Component, useRef } from "@odoo/owl";
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
        // Parent->child callbacks (flat props, bundled via t-props in parent)
        onDragStart: Function,       // (nodeId, event) => void
        onExecute: Function,         // (nodeId) => void
        onSocketMouseDown: Function, // (data) => void
        onSocketMouseUp: Function,   // (data) => void
        onSocketQuickAdd: Function,  // (data) => void
    };

    setup() {
        this.rootRef = useRef("root");
        this.editor = this.env.workflowEditor;
    }


    /**
     * Start drag sequence on header mousedown
     */
    onHeaderMouseDown(ev) {
        ev.stopPropagation();
        ev.preventDefault();

        // Node Selection Logic
        const currentSelection = this.editor.state.ui.selection.nodeIds || [];
        const isSelected = currentSelection.includes(this.props.node.id);
        const isMultiSelect = ev.ctrlKey || ev.metaKey;

        if (isMultiSelect) {
            // Toggle selection
            if (isSelected) {
                this.editor.actions.select(
                    currentSelection.filter(id => id !== this.props.node.id)
                );
            } else {
                this.editor.actions.select([...currentSelection, this.props.node.id]);
            }
        } else {
            // If not holding Ctrl, and node is NOT selected, select it (and clear others).
            // If it IS selected, keep selection as-is to allow multi-node drag.
            if (!isSelected) {
                this.editor.actions.select([this.props.node.id]);
            }
        }

        // Trigger drag start via callback
        this.props.onDragStart(this.props.node.id, ev);
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
     * Handle delete from toolbar
     */
    onDeleteNode() {
        this.editor.actions.removeNode(this.props.node.id);
    }

    /**
     * Handle execute from toolbar
     */
    onExecuteNode() {
        // Trigger via callback for executor service to handle
        this.props.onExecute(this.props.node.id);
    }

    /**
     * Handle toggle disable from toolbar
     */
    onToggleDisable() {
        this.editor.actions.toggleDisable(this.props.node.id);
    }

    get nodeIcon() {
        if (this.props.node.icon) {
            return this.props.node.icon;
        }
        const icons = {
            http: "fa-globe",
            http_request: "fa-globe",
            validation: "fa-check-circle",
            loop: "fa-repeat",
            if: "fa-code-branch",
            switch: "fa-random",
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
                this.props.onSocketMouseDown(data);
            },
            onMouseUp: (data) => {
                this.props.onSocketMouseUp(data);
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
                this.props.onSocketMouseDown(data);
            },
            onMouseUp: (data) => {
                this.props.onSocketMouseUp(data);
            },
            onQuickAdd: (data) => {
                this.props.onSocketQuickAdd(data);
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

        const dimensionConfig = this.props.dimensionConfig;
        if (dimensionConfig && typeof dimensionConfig.getCSSProperties === "function") {
            const cssProps = dimensionConfig.getCSSProperties();
            for (const [key, value] of Object.entries(cssProps)) {
                styles += `${key}:${value};`;
            }
        }

        return styles;
    }
}
