/** @odoo-module **/

import { Component, useRef } from "@odoo/owl";
import { WorkflowSocket } from "./workflow_socket";
import { CanvasNodeToolbar } from "./canvas_node_toolbar";
import { useOdooModels } from "@workflow_studio/utils/use_odoo_models";

/**
 * WorkflowNode Component
 * 
 * Renders an individual node on the workflow canvas.
 * Accesses workflowEditor service via env for actions and state.
 */
export class WorkflowNode extends Component {
    static template = "workflow_studio.workflow_node";

    static components = { WorkflowSocket, CanvasNodeToolbar };
    static props = {
        node: Object,
        zoom: { type: Number, optional: true },
        snappedSocketKey: { type: [String, { value: null }], optional: true },
        connectedOutputsSet: { type: Object, optional: true },
        dimensionConfig: { type: Object },
        selected: { type: Boolean, optional: true },
        readonly: { type: Boolean, optional: true },
        executionStatus: { type: [String, { value: null }], optional: true },
        // Parent->child callbacks (flat props, bundled via t-props in parent)
        // Optional in readonly mode
        onDragStart: { type: Function, optional: true },
        onExecute: { type: Function, optional: true },
        onSocketMouseDown: { type: Function, optional: true },
        onSocketMouseUp: { type: Function, optional: true },
        onSocketQuickAdd: { type: Function, optional: true },
        onDelete: { type: Function, optional: true },
        onToggleDisable: { type: Function, optional: true },
        onOpenConfig: { type: Function, optional: true },
        onNodeDoubleClick: { type: Function, optional: true },
        onExecuteFromNode: { type: Function, optional: true },
    };

    setup() {
        this.rootRef = useRef("root");
        this.editor = this.env.workflowEditor || null;
        this._odooModels = useOdooModels();
        this._toolbarPropsCache = null;
        this._toolbarPropsNodeId = null; 
        this._toolbarPropsDisabled = null;

        this._onInputSocketMouseDown = (data) => {
            const onSocketMouseDown = this.props.onSocketMouseDown;
            if (onSocketMouseDown) {
                onSocketMouseDown(data);
            }
        };
        this._onInputSocketMouseUp = (data) => {
            const onSocketMouseUp = this.props.onSocketMouseUp;
            if (onSocketMouseUp) {
                onSocketMouseUp(data);
            }
        };
        this._onOutputSocketMouseDown = (data) => {
            const onSocketMouseDown = this.props.onSocketMouseDown;
            if (onSocketMouseDown) {
                onSocketMouseDown(data);
            }
        };
        this._onOutputSocketMouseUp = (data) => {
            const onSocketMouseUp = this.props.onSocketMouseUp;
            if (onSocketMouseUp) {
                onSocketMouseUp(data);
            }
        };
        this._onOutputSocketQuickAdd = (data) => {
            const onSocketQuickAdd = this.props.onSocketQuickAdd;
            if (onSocketQuickAdd) {
                onSocketQuickAdd(data);
            }
        };

        this._onToolbarExecute = () => this.onExecuteNode();
        this._onToolbarDelete = () => this.onDeleteNode();
        this._onToolbarToggleDisable = () => this.onToggleDisable();
        this._onToolbarOpenConfig = () => {
            const onOpenConfig = this.props.onOpenConfig;
            if (onOpenConfig) {
                onOpenConfig(this.props.node.id);
            }
        };
        this.isDebug = odoo.debug;
    }

    _getRecordOperationModelName() {
        if (!this.editor || !this.editor.getNodeConfig) {
            return "";
        }
        const config = this.editor.getNodeConfig(this.props.node.id) || {};
        const modelName = config.model;
        if (typeof modelName !== "string") {
            return "";
        }
        return modelName.trim();
    }

    _getRecordOperationOperation() {
        if (!this.editor || !this.editor.getNodeConfig) {
            return "";
        }
        const config = this.editor.getNodeConfig(this.props.node.id) || {};
        const operation = config.operation;
        if (typeof operation !== "string") {
            return "";
        }
        return operation.trim().toLowerCase();
    }

    _getRecordOperationOperationLabel(operation) {
        const operationMap = {
            search: "Search",
            create: "Create",
            write: "Update",
            delete: "Delete",
        };
        return operationMap[operation] || "Record Operation";
    }

    _getRecordOperationModelLabel() {
        const modelName = this._getRecordOperationModelName();
        if (!modelName) {
            return "";
        }
        const meta = this._odooModels.getModelMetaByName(modelName);
        if (meta && typeof meta.description === "string" && meta.description.trim()) {
            return meta.description.trim();
        }
        return modelName;
    }

    _getRecordOperationIcon() {
        if (this.props.node.type !== "record_operation") {
            return "";
        }
        const modelName = this._getRecordOperationModelName();
        if (!modelName) {
            return "";
        }
        const meta = this._odooModels.getModelMetaByName(modelName);
        if (meta && typeof meta.iconUrl === "string" && meta.iconUrl) {
            return meta.iconUrl;
        }
        return "";
    }

    /**
     * Check if component is in readonly mode
     */
    get isReadonly() {
        return this.props.readonly || !this.editor;
    }

    /**
     * Start drag sequence on header mousedown
     */
    onHeaderMouseDown(ev) {
        if (this.isReadonly) return;
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
        const onDragStart = this.props.onDragStart;
        if (onDragStart) {
            onDragStart(this.props.node.id, ev);
        }
    }

    /**
     * Handle double-click to open config panel.
     * Only triggers on node zone (header/body), not on toolbar or sockets.
     * Allowed even in readonly mode (execution view) to inspect I/O data.
     */
    onNodeDoubleClick(ev) {
        if (!ev) return;
        const target = ev.target;
        if (target.closest('.canvas-node-toolbar') ||
            target.closest('.workflow-node__socket')) {
            return;
        }

        ev.stopPropagation();
        const onOpenConfig = this.props.onOpenConfig;
        if (onOpenConfig) {
            onOpenConfig(this.props.node.id);
        }
    }

    /**
     * Handle delete from toolbar
     */
    onDeleteNode() {
        if (this.isReadonly) return;
        const onDelete = this.props.onDelete;
        if (onDelete) {
            onDelete(this.props.node.id);
        }
    }

    /**
     * Handle execute from toolbar
     */
    onExecuteNode() {
        if (this.isReadonly) return;
        // Trigger via callback for executor service to handle
        const onExecute = this.props.onExecute;
        if (onExecute) {
            onExecute(this.props.node.id);
        }
    }

    /**
     * Handle toggle disable from toolbar
     */
    onToggleDisable() {
        if (this.isReadonly) return;
        const onToggleDisable = this.props.onToggleDisable;
        if (onToggleDisable) {
            onToggleDisable(this.props.node.id);
        }
    }

    /**
     * Whether this node is a manual trigger (shows execute button).
     */
    get isManualTrigger() {
        return this.props.node.type === 'manual_trigger';
    }

    /**
     * Handle "Execute" button click on manual_trigger node.
     */
    onTriggerExecute(ev) {
        ev.stopPropagation();
        if (this.isReadonly) return;
        const onExecuteFromNode = this.props.onExecuteFromNode;
        if (onExecuteFromNode) {
            onExecuteFromNode(this.props.node.id);
        }
    }

    get nodeIcon() {
        const recordOperationIcon = this._getRecordOperationIcon();
        if (recordOperationIcon) {
            return recordOperationIcon;
        }
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

    get isImageIcon() {
        const icon = this.nodeIcon;
        if (typeof icon !== "string") {
            return false;
        }
        return icon.startsWith("/") || icon.startsWith("http://") || icon.startsWith("https://") || icon.startsWith("data:image/");
    }

    get isFontAwesomeIcon() {
        const icon = this.nodeIcon;
        return typeof icon === "string" && icon.startsWith("fa-");
    }

    get fontAwesomeClass() {
        return `fa ${this.nodeIcon}`;
    }

    get nodeTypeClass() {
        return `workflow-node--${this.props.node.type || "default"}`;
    }

    get displaySubtitle() {
        return this.isDebug ? this.props.node.type : '';
    }

    get displayTitle() {
        if (this.props.node.type !== "record_operation") {
            return this.props.node.title || this.props.node.type;
        }

        const operationLabel = this._getRecordOperationOperationLabel(this._getRecordOperationOperation());
        const modelLabel = this._getRecordOperationModelLabel();

        if (modelLabel) {
            return `${operationLabel} ${modelLabel}`;
        }
        return operationLabel;
    }

    /**
     * CSS class for execution status visualisation (n8n-style).
     * Returns 'execution-success' | 'execution-error' | '' based on last run result.
     */
    get executionClass() {
        const status = this.props.executionStatus;
        if (status === 'running') return 'execution-running';
        if (status === 'success') return 'execution-success';
        if (status === 'error') return 'execution-error';
        return '';
    }

    /**
     * Whether this node has pinned data.
     * @returns {boolean}
     */
    get isPinned() {
        if (!this.editor || !this.editor.actions || !this.editor.actions.isNodePinned) {
            return false;
        }
        return this.editor.actions.isNodePinned(this.props.node.id) || false;
    }

    /**
     * Check if this node is disabled
     * @returns {boolean}
     */
    get isDisabled() {
        if (!this.editor || !this.editor.actions || !this.editor.actions.isNodeDisabled) {
            return false;
        }
        return this.editor.actions.isNodeDisabled(this.props.node.id) || false;
    }

    /**
     * Input socket entries for the left column
     * @returns {Array<[string, Object]>}
     */
    get inputEntries() {
        return Object.entries(this.props.node.inputs || {});
    }

    /**
     * Output socket entries for the right column
     * @returns {Array<[string, Object]>}
     */
    get outputEntries() {
        return Object.entries(this.props.node.outputs || {});
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
        const props = {
            type: "input",
            name: socketKey,
            label: socketDef.label,
            nodeId: this.props.node.id,
            isSnapped: this.props.snappedSocketKey === socketKey,
            readonly: this.isReadonly,
        };
        if (!this.isReadonly) {
            props.onMouseDown = this._onInputSocketMouseDown;
            props.onMouseUp = this._onInputSocketMouseUp;
        }
        return props;
    }

    /**
     * Get props for output socket component
     * @param {[string, Object]} socketEntry - [socketKey, socketDef]
     * @returns {Object} Props object for WorkflowSocket
     */
    getOutputSocketProps(socketEntry) {
        const [socketKey, socketDef] = socketEntry;
        const props = {
            type: "output",
            name: socketKey,
            label: socketDef.label,
            nodeId: this.props.node.id,
            isConnected: this.isOutputConnected(socketKey),
            readonly: this.isReadonly,
        };
        if (!this.isReadonly) {
            props.onMouseDown = this._onOutputSocketMouseDown;
            props.onMouseUp = this._onOutputSocketMouseUp;
            props.onQuickAdd = this._onOutputSocketQuickAdd;
        }
        return props;
    }

    /**
     * Get props for toolbar component
     * @returns {Object} Props object for CanvasNodeToolbar
     */
    get toolbarProps() {
        if (this.isReadonly) return null;
        const nodeId = this.props.node.id;
        const isDisabled = this.props.node.disabled;

        if (!this._toolbarPropsCache || this._toolbarPropsNodeId !== nodeId || this._toolbarPropsDisabled !== isDisabled) {
            this._toolbarPropsNodeId = nodeId;
            this._toolbarPropsDisabled = isDisabled;
            this._toolbarPropsCache = {
                nodeId,
                isDisabled,
                onExecute: this._onToolbarExecute,
                onDelete: this._onToolbarDelete,
                onToggleDisable: this._onToolbarToggleDisable,
                onOpenConfig: this._onToolbarOpenConfig,
            };
        }

        return this._toolbarPropsCache;
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

        // min-height: ensures node extends to cover all socket positions
        const maxSockets = Math.max(this.inputEntries.length, this.outputEntries.length);
        if (maxSockets > 0) {
            const dc = dimensionConfig || {};
            const bodyPad = dc.nodeBodyPadding || 6;
            const sockOffY = dc.socketOffsetY || 10;
            const sockSpacing = dc.socketSpacing || 24;
            const minH = bodyPad + sockOffY + ((maxSockets - 1) * sockSpacing) + sockOffY + bodyPad;
            styles += `min-height:${minH}px;`;
        }

        return styles;
    }
}
