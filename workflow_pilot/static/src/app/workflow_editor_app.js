/** @odoo-module **/
import { Component, useState, onMounted, useSubEnv } from "@odoo/owl";
import { useBus, useService } from "@web/core/utils/hooks";
import { AlertDialog, ConfirmationDialog } from "@web/core/confirmation_dialog/confirmation_dialog";
import { useEditor } from "@workflow_pilot/store/use_editor";
import { EditorCanvas } from "@workflow_pilot/components/editor_canvas";
import { LucideIcon } from "@workflow_pilot/components/common/lucide_icon";
import { View } from "@web/views/view";
import { Chatter } from "@mail/chatter/web_portal/chatter";
import { WorkflowHistoryPanel } from "@workflow_pilot/components/workflow_history_panel/workflow_history_panel";
/**
 * WorkflowEditorApp - Production Odoo client action for workflow editor
 * 
 * Loads workflow from backend via RPC, provides Save button, handles version conflicts.
 * Renders EditorCanvas for graph editing.
 */
export class WorkflowEditorApp extends Component {
    static template = "workflow_pilot.workflow_editor_app";
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
    async execute() {
        this.editorService.actions.setExecuting(true);
        try {
            // Auto-save before execute if enabled
            if (this.editorService.getAutoSave()) {
                await this.editorService.saveWorkflow();
            }
            const result = await this.editorService.executeWorkflow();
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
        this.action.doAction("workflow_pilot.action_ir_workflow");
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
        this.editorService.actions.endHistoryPreview({ restoreOriginal: true });
        this.editorService.actions.closePanel("history");
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

    
}
