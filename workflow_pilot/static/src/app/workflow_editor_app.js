/** @odoo-module **/
import { Component, useState, onMounted, useSubEnv } from "@odoo/owl";
import { useBus, useService } from "@web/core/utils/hooks";
import { AlertDialog, ConfirmationDialog } from "@web/core/confirmation_dialog/confirmation_dialog";
import { useEditor } from "@workflow_pilot/store/use_editor";
import { EditorCanvas } from "@workflow_pilot/components/editor_canvas";
import { LucideIcon } from "@workflow_pilot/components/common/lucide_icon";

/**
 * WorkflowEditorApp - Production Odoo client action for workflow editor
 * 
 * Loads workflow from backend via RPC, provides Save button, handles version conflicts.
 * Renders EditorCanvas for graph editing.
 */
export class WorkflowEditorApp extends Component {
    static template = "workflow_pilot.workflow_editor_app";
    static components = { EditorCanvas, LucideIcon };
    
    setup() {
        // Services (Fail-First - no optional chaining)
        this.editorService = useEditor();
        this.notification = useService("notification");
        this.dialog = useService("dialog");
        
        // State
        this.state = useState({
            loading: true,
            saving: false,
            publishing: false,
            executing: false,
            error: null,
        });
        
        // Get workflow_id from props (try context.active_id first, then params)
        const workflowId = this.props.action?.context?.active_id 
                        || this.props.action?.params?.workflow_id;
        
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
            },
        });

        useBus(this.editorService.bus, "save", () => this.save());
        
        // Load on mount
        onMounted(async () => {
            try {
                await this.editorService.loadNodeTypes();
            } catch (error) {
                this.notification.add("Failed to load node types.", { type: "warning" });
            }
            try {
                await this.editorService.loadWorkflow(this.workflowId);
                this.state.loading = false;
            } catch (error) {
                this.state.error = error.message || "Failed to load workflow";
                this.state.loading = false;
            }
        });
    }
    
    /**
     * Save workflow to backend
     * Handles conflict errors by showing modal, other errors by showing error state
     */
    async save() {
        this.state.saving = true;
        try {
            await this.editorService.saveWorkflow();
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
            this.state.saving = false;
        }
    }

    /**
     * Publish current workflow (saves first)
     */
    async publish() {
        this.state.publishing = true;
        try {
            await this.editorService.publishWorkflow();
            this.notification.add("Workflow published.", { type: "success" });
        } catch (error) {
            this.dialog.add(AlertDialog, {
                title: "Publish Failed",
                body: error.message || "Failed to publish workflow",
            });
        } finally {
            this.state.publishing = false;
        }
    }
    
    /**
     * Execute current workflow
     */
    async execute() {
        this.state.executing = true;
        try {
            const result = await this.editorService.executeWorkflow();
            if (result.error){
                return this.notification.add("Execution erorr: " + result.error, {
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
            this.state.executing = false;
        }
    }
    
    /**
     * Reload page to get fresh workflow data
     */
    reload() {
        window.location.reload();
    }
    
}
