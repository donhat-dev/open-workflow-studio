/** @odoo-module **/
import { Component, useState, onMounted, onWillUnmount, useSubEnv } from "@odoo/owl";
import { useBus, useService } from "@web/core/utils/hooks";
import { AlertDialog, ConfirmationDialog } from "@web/core/confirmation_dialog/confirmation_dialog";
import { useEditor } from "@workflow_studio/store/use_editor";
import { EditorCanvas } from "@workflow_studio/components/editor_canvas";
import { LucideIcon } from "@workflow_studio/components/common/lucide_icon";
import { View } from "@web/views/view";
import { Chatter } from "@mail/chatter/web_portal/chatter";
import { WorkflowHistoryPanel } from "@workflow_studio/components/workflow_history_panel/workflow_history_panel";
/**
 * WorkflowEditorApp - Production Odoo client action for workflow editor
 * 
 * Loads workflow from backend via RPC, provides Save button, handles version conflicts.
 * Renders EditorCanvas for graph editing.
 */
export class WorkflowEditorApp extends Component {
    static template = "workflow_studio.workflow_editor_app";
    static components = { EditorCanvas, LucideIcon, View, Chatter, WorkflowHistoryPanel };
    
    setup() {
        this.editorService = useEditor();
        this.notification = useService("notification");
        this.dialog = useService("dialog");
        this.action = useService("action");
        this.orm = useService("orm");
        
        // State
        this.state = useState({
            loading: true,
            error: null,
            view: "editor",
        });

        this.workflowInfo = useState({
            name: "",
            description: "",
            version: 0,
            is_published: false,
            node_count: 0,
        });
        
        // Get workflow_id from props (try context.active_id first, then params)
        let workflowId = null;
        if (this.props.action && this.props.action.context && this.props.action.context.active_id) {
            workflowId = this.props.action.context.active_id;
        } else if (this.props.action && this.props.action.params && this.props.action.params.workflow_id) {
            workflowId = this.props.action.params.workflow_id;
        }
        
        // Error if no workflow_id
        if (!workflowId) {
            this.state.error = "No workflow ID provided";
            this.state.loading = false;
            return;
        }
        
        // Store for reload
        this.workflowId = workflowId;
        
        // Setup SubEnv for child components
        useSubEnv({
            bus: this.editorService.bus,
            workflowEditor: this.editorService,
            services: {
                workflowEditor: this.editorService,
                ...this.env.services
            },
        });

        useBus(this.editorService.bus, "save", () => this.save());
        useBus(this.editorService.bus, "run", () => this.execute());
        
        onWillUnmount(() => {
            this._uninstallWindowAppFacade();
        });
         
        // Load on mount
        onMounted(async () => {
            try {
                await this.editorService.loadNodeTypes();
            } catch (error) {
                this.notification.add("Failed to load node types.", { type: "warning" });
            }
            try {
                const data = await this.editorService.loadWorkflow(this.workflowId);
                if (data) {
                    this._updateWorkflowInfo(data);
                }
                this._installWindowAppFacade();
                this.state.loading = false;
            } catch (error) {
                this.state.error = error.message || "Failed to load workflow";
                this.state.loading = false;
            }
        });
    }

    get isHistoryOpen() {
        return this.editorService.state.ui.panels.historyOpen;
    }

    get isReadonly() {
        return this.editorService.state.ui.readonly;
    }

    get historyPanelProps() {
        return {
            workflowId: this.workflowId,
            fieldName: "draft_snapshot",
            onClose: () => this.closeHistory(),
            previewRequested: (revisionId, snapshot) =>
                this.previewHistoryRevision(revisionId, snapshot),
            currentRequested: () => this.exitHistoryPreview(),
            restoreRequested: (revisionId) => this.restoreHistoryRevision(revisionId),
            executionViewRequested: (runId, snapshot, data) =>
                this.openExecutionView(runId, snapshot, data),
            exitExecutionView: () => this.exitExecutionView(),
        };
    }

    _updateWorkflowInfo(data) {
        this.workflowInfo.name = data.name || "";
        this.workflowInfo.description = data.description || "";
        this.workflowInfo.version = data.version || 0;
        this.workflowInfo.is_published = Boolean(data.is_published);
        this.workflowInfo.node_count = data.node_count || 0;
    }

    get workflowTitle() {
        return this.workflowInfo.name || "Workflow";
    }

    get resModel(){
        return 'ir.workflow';
    }

    get resId(){
        return this.workflowId;
    }

    get workflowFormViewProps() {
        const context = this.props.action && this.props.action.context ? this.props.action.context : {};
        return {
            resId: this.workflowId,
            resModel: "ir.workflow",
            context: context,
            display: { controlPanel: false },
            mode: "edit",
            type: "form",
            onSave: (record) => this._onFormSaved(record),
            onDiscard: () => this.toggleWorkflowView(),
        };
    }

    toggleWorkflowView() {
        if (this.state.loading || this.state.error) {
            return;
        }
        this.state.view = this.state.view === "editor" ? "form" : "editor";
    }

    async _onFormSaved(record) {
        if (record && record.data && record.data.name) {
            this.workflowInfo.name = record.data.name;
        } else {
            await this._refreshWorkflowName();
        }
        this.toggleWorkflowView();
    }

    async _refreshWorkflowName() {
        if (!this.workflowId) {
            return;
        }
        const result = await this.orm.read("ir.workflow", [this.workflowId], ["name"]);
        if (result && result[0] && result[0].name) {
            this.workflowInfo.name = result[0].name;
        }
    }
    
    /**
     * Save workflow to backend (also publishes)
     * Handles conflict errors by showing modal, other errors by showing error state
     */
    async save() {
        this.editorService.actions.setSaving(true);
        try {
            const result = await this.editorService.saveWorkflow();
            this.workflowInfo.is_published = Boolean(result.is_published);
            this.notification.add("Workflow saved.", { type: "success" });
        } catch (error) {
            // Check if conflict error (message contains "modified by another user")
            if (error.message && error.message.includes('modified by another user')) {
                this.dialog.add(ConfirmationDialog, {
                    title: "Workflow Conflict",
                    body: "Workflow was modified by another user. Reload to see changes.",
                    confirmLabel: "Reload",
                    cancelLabel: "Cancel",
                    confirm: () => this.reload(),
                });
            } else {
                this.dialog.add(AlertDialog, {
                    title: "Save Failed",
                    body: error.message || "Failed to save workflow",
                });
            }
        } finally {
            this.editorService.actions.setSaving(false);
        }
    }
    
    /**
     * Execute current workflow
     * If auto_save is enabled, saves workflow first
     */
    async execute(inputData = {}) {
        this.editorService.actions.setExecuting(true);
        try {
            // Auto-save before execute if enabled
            if (this.editorService.getAutoSave()) {
                await this.editorService.saveWorkflow();
            }
            const result = await this.editorService.executeWorkflow(inputData);
            if (result.error){
                return this.notification.add("Execution error: " + result.error, {
                    type: "danger",
                    sticky: false,
                })
            }
            this.notification.add("Execution started.", {
                type: "success",
                sticky: false,
            });
        } catch (error) {
            this.dialog.add(AlertDialog, {
                title: "Execution Failed",
                body: error.message || "Failed to execute workflow",
            });
        } finally {
            this.editorService.actions.setExecuting(false);
        }
    }
    
    /**
     * Reload page to get fresh workflow data
     */
    reload() {
        return this.editorService.loadWorkflow(this.workflowId);
    }

    exit() {
        if (this.state.view !== "editor") {
            this.toggleWorkflowView();
            return;
        }
        this._exit();
    }

    _exit() {
        this.action.doAction("workflow_studio.action_ir_workflow");
    }

    /**
     * Toggle version history panel
     */
    openHistory() {
        if (this.isHistoryOpen) {
            this.closeHistory();
            return;
        }
        this.editorService.actions.openPanel("history");
    }

    closeHistory() {
        // Exit execution view if active
        if (this.editorService.state.ui.executionView
            && this.editorService.state.ui.executionView.active) {
            this.editorService.actions.endExecutionView();
        }
        this.editorService.actions.endHistoryPreview({ restoreOriginal: true });
        this.editorService.actions.closePanel("history");
    }

    openExecutionView(runId, snapshot, executionData) {
        this.editorService.actions.startExecutionView(runId, snapshot, executionData);
    }

    exitExecutionView() {
        this.editorService.actions.endExecutionView();
    }

    async restoreHistoryRevision(revisionId) {
        this.editorService.actions.endHistoryPreview({ restoreOriginal: false });
        await this.orm.call(
            "ir.workflow",
            "restore_version",
            [[this.workflowId], revisionId, "draft_snapshot"]
        );
        await this.editorService.loadWorkflow(this.workflowId);
        this.notification.add("Version restored.", { type: "success" });
        this.closeHistory();
    }

    async previewHistoryRevision(revisionId, snapshot) {
        this.editorService.actions.startHistoryPreview(revisionId, snapshot);
    }

    exitHistoryPreview() {
        this.editorService.actions.endHistoryPreview({ restoreOriginal: true });
    }

    _getBrowserWindow() {
        if (typeof window === "undefined") {
            return null;
        }
        return window;
    }

    _getWorkflowEditor() {
        return this.editorService;
    }

    _getCanvas() {
        const browserWindow = this._getBrowserWindow();
        if (!browserWindow) {
            return null;
        }
        return browserWindow.canvas || null;
    }

    _requireCanvas() {
        const canvas = this._getCanvas();
        if (!canvas) {
            throw new Error(
                "[window.app] Canvas instance is not available yet. Current canvas helpers depend on `window.canvas`."
            );
        }
        return canvas;
    }

    _requireNode(nodeId) {
        const editor = this._getWorkflowEditor();
        const node = editor.selectors.getNode(nodeId);
        if (!node) {
            throw new Error(`[window.app] Node not found: ${nodeId}`);
        }
        return node;
    }

    _getWorkflowJson() {
        return this._getWorkflowEditor().getAdapter().toJSON();
    }

    _getExecutionResult() {
        return this._getWorkflowEditor().state.executionProgress;
    }

    _getWorkflowInfo() {
        return {
            id: this.workflowId,
            name: this.workflowInfo.name,
            description: this.workflowInfo.description,
            version: this.workflowInfo.version,
            is_published: this.workflowInfo.is_published,
            node_count: this.workflowInfo.node_count,
        };
    }

    _getDefaultNodePosition() {
        const canvas = this._getCanvas();
        if (!canvas || !canvas.rootRef || !canvas.rootRef.el) {
            return { x: 120, y: 120 };
        }

        const rect = canvas.rootRef.el.getBoundingClientRect();
        const center = canvas.getCanvasPosition({
            clientX: rect.left + (rect.width / 2),
            clientY: rect.top + (rect.height / 2),
        });
        const dimensions = canvas.dimensions;
        const nodeWidth = dimensions && typeof dimensions.nodeWidth === "number"
            ? dimensions.nodeWidth
            : 240;

        return {
            x: Math.round(center.x - (nodeWidth / 2)),
            y: Math.round(center.y - 40),
        };
    }

    _normalizeNodePosition(nodeId, positionOrX, y) {
        const node = this._requireNode(nodeId);
        const nextPosition = { x: node.x, y: node.y };

        if (positionOrX && typeof positionOrX === "object") {
            if (typeof positionOrX.x === "number") {
                nextPosition.x = positionOrX.x;
            }
            if (typeof positionOrX.y === "number") {
                nextPosition.y = positionOrX.y;
            }
            return nextPosition;
        }

        if (typeof positionOrX === "number") {
            nextPosition.x = positionOrX;
        }
        if (typeof y === "number") {
            nextPosition.y = y;
        }
        return nextPosition;
    }

    _installWindowAppFacade() {
        const browserWindow = this._getBrowserWindow();
        if (!browserWindow) {
            return;
        }

        this._hadPreviousWindowApp = Object.prototype.hasOwnProperty.call(browserWindow, "app");
        this._previousWindowApp = browserWindow.app;
        this._windowAppFacade = this._buildWindowAppFacade();
        browserWindow.app = this._windowAppFacade;
    }

    _uninstallWindowAppFacade() {
        const browserWindow = this._getBrowserWindow();
        if (!browserWindow) {
            return;
        }

        if (this._hadPreviousWindowApp) {
            browserWindow.app = this._previousWindowApp;
        } else if (browserWindow.app === this._windowAppFacade) {
            delete browserWindow.app;
        }

        this._windowAppFacade = null;
        this._previousWindowApp = undefined;
        this._hadPreviousWindowApp = false;
    }

    _buildWindowAppFacade() {
        const self = this;

        const workflow = {
            get id() {
                return self.workflowId;
            },
            get info() {
                return self._getWorkflowInfo();
            },
            get json() {
                return self._getWorkflowJson();
            },
            get execution() {
                return self._getExecutionResult();
            },
            save() {
                return self.save();
            },
            run(inputData = {}) {
                return self.execute(inputData);
            },
            reload() {
                return self.reload();
            },
            hasUnsavedChanges() {
                return self._getWorkflowEditor().hasUnsavedChanges();
            },
        };

        const canvas = {
            get instance() {
                return self._getCanvas();
            },
            get viewport() {
                return self._requireCanvas().viewport;
            },
            fit(options = {}) {
                return self._requireCanvas().fitToView(options);
            },
            fitWidth() {
                return self._requireCanvas().fitFullWidth();
            },
            fitHeight() {
                return self._requireCanvas().fitFullHeight();
            },
            tidy(options = {}) {
                return self._requireCanvas().tidyUp(options);
            },
            zoomIn() {
                return self._requireCanvas().zoomIn();
            },
            zoomOut() {
                return self._requireCanvas().zoomOut();
            },
            resetZoom() {
                return self._requireCanvas().resetZoom();
            },
            clearSelection() {
                const editor = self._getWorkflowEditor();
                editor.actions.select([], []);
                return editor.state.ui.selection;
            },
        };

        const node = {
            all() {
                return self._getWorkflowEditor().selectors.getNodes();
            },
            get(nodeId) {
                return self._getWorkflowEditor().selectors.getNode(nodeId);
            },
            add(type, position = null) {
                const editor = self._getWorkflowEditor();
                const nextPosition = position || self._getDefaultNodePosition();
                const nodeId = editor.actions.addNode(type, nextPosition);
                if (!nodeId) {
                    return null;
                }
                return editor.selectors.getNode(nodeId);
            },
            move(nodeId, positionOrX, y) {
                const editor = self._getWorkflowEditor();
                const nextPosition = self._normalizeNodePosition(nodeId, positionOrX, y);
                editor.actions.moveNode(nodeId, nextPosition);
                return editor.selectors.getNode(nodeId);
            },
            select(nodeIds) {
                const editor = self._getWorkflowEditor();
                const ids = Array.isArray(nodeIds) ? nodeIds : [nodeIds];
                const cleanIds = ids.filter((id) => Boolean(id));
                editor.actions.select(cleanIds, []);
                return editor.state.ui.selection;
            },
            open(nodeId) {
                const editor = self._getWorkflowEditor();
                self._requireNode(nodeId);
                editor.actions.openPanel("config", { nodeId });
                return editor.selectors.getNode(nodeId);
            },
            remove(nodeId) {
                return self._getWorkflowEditor().actions.removeNode(nodeId);
            },
            setConfig(nodeId, config) {
                const editor = self._getWorkflowEditor();
                self._requireNode(nodeId);
                editor.setNodeConfig(nodeId, config);
                return editor.getNodeConfig(nodeId);
            },
            toggleDisable(nodeId) {
                const editor = self._getWorkflowEditor();
                self._requireNode(nodeId);
                editor.actions.toggleDisable(nodeId);
                return editor.selectors.getNode(nodeId);
            },
        };

        const connection = {
            all() {
                return self._getWorkflowEditor().selectors.getConnections();
            },
            get(connectionId) {
                return self._getWorkflowEditor().selectors.getConnection(connectionId);
            },
            add(sourceOrConfig, sourceHandle, target, targetHandle) {
                const editor = self._getWorkflowEditor();
                const config = sourceOrConfig && typeof sourceOrConfig === "object"
                    ? sourceOrConfig
                    : {
                        source: sourceOrConfig,
                        sourceHandle,
                        target,
                        targetHandle,
                    };
                const connectionId = editor.actions.addConnection(
                    config.source,
                    config.sourceHandle,
                    config.target,
                    config.targetHandle
                );
                if (!connectionId) {
                    return null;
                }
                return editor.selectors.getConnection(connectionId);
            },
            remove(connectionId) {
                return self._getWorkflowEditor().actions.removeConnection(connectionId);
            },
        };

        const editor = {
            get service() {
                return self._getWorkflowEditor();
            },
            get state() {
                return self._getWorkflowEditor().state;
            },
            get actions() {
                return self._getWorkflowEditor().actions;
            },
            get selectors() {
                return self._getWorkflowEditor().selectors;
            },
            get adapter() {
                return self._getWorkflowEditor().getAdapter();
            },
        };

        return {
            get info() {
                return self._getWorkflowInfo();
            },
            get json() {
                return self._getWorkflowJson();
            },
            get execution() {
                return self._getExecutionResult();
            },
            get nodes() {
                return node.all();
            },
            get connections() {
                return connection.all();
            },
            get selection() {
                return self._getWorkflowEditor().state.ui.selection;
            },
            get workflow() {
                return workflow;
            },
            get canvas() {
                return canvas;
            },
            get node() {
                return node;
            },
            get connection() {
                return connection;
            },
            get editor() {
                return editor;
            },
            workflowJson() {
                return self._getWorkflowJson();
            },
            executionResult() {
                return self._getExecutionResult();
            },
            save() {
                return workflow.save();
            },
            run(inputData = {}) {
                return workflow.run(inputData);
            },
            reload() {
                return workflow.reload();
            },
            addNode(type, position = null) {
                return node.add(type, position);
            },
            moveNode(nodeId, positionOrX, y) {
                return node.move(nodeId, positionOrX, y);
            },
            selectNode(nodeId) {
                return node.select(nodeId);
            },
            openNode(nodeId) {
                return node.open(nodeId);
            },
            removeNode(nodeId) {
                return node.remove(nodeId);
            },
            setNodeConfig(nodeId, config) {
                return node.setConfig(nodeId, config);
            },
            connect(sourceOrConfig, sourceHandle, target, targetHandle) {
                return connection.add(sourceOrConfig, sourceHandle, target, targetHandle);
            },
            disconnect(connectionId) {
                return connection.remove(connectionId);
            },
            help() {
                return {
                    root: [
                        "app.json",
                        "app.execution",
                        "app.nodes",
                        "app.connections",
                        "app.selection",
                        "app.save()",
                        "app.run(inputData)",
                        "app.addNode(type, position)",
                        "app.moveNode(nodeId, xOrPosition, y)",
                        "app.selectNode(nodeId)",
                        "app.openNode(nodeId)",
                        "app.setNodeConfig(nodeId, config)",
                        "app.connect({ source, sourceHandle, target, targetHandle })",
                        "app.disconnect(connectionId)",
                    ],
                    namespaces: {
                        workflow: [
                            "id",
                            "info",
                            "json",
                            "execution",
                            "save()",
                            "run(inputData)",
                            "reload()",
                            "hasUnsavedChanges()",
                        ],
                        canvas: [
                            "instance",
                            "viewport",
                            "fit(options)",
                            "fitWidth()",
                            "fitHeight()",
                            "tidy(options)",
                            "zoomIn()",
                            "zoomOut()",
                            "resetZoom()",
                            "clearSelection()",
                        ],
                        node: [
                            "all()",
                            "get(nodeId)",
                            "add(type, position)",
                            "move(nodeId, xOrPosition, y)",
                            "select(nodeIds)",
                            "open(nodeId)",
                            "remove(nodeId)",
                            "setConfig(nodeId, config)",
                            "toggleDisable(nodeId)",
                        ],
                        connection: [
                            "all()",
                            "get(connectionId)",
                            "add(sourceOrConfig, sourceHandle, target, targetHandle)",
                            "remove(connectionId)",
                        ],
                        editor: [
                            "service",
                            "state",
                            "actions",
                            "selectors",
                            "adapter",
                        ],
                    },
                };
            },
        };
    }
}
