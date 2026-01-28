/** @odoo-module **/
import { Component, useState, onMounted, useSubEnv } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";
import { EditorCanvas } from "../components/editor_canvas";

/**
 * WorkflowEditorApp - Production Odoo client action for workflow editor
 * 
 * Loads workflow from backend via RPC, provides Save button, handles version conflicts.
 * Renders EditorCanvas for graph editing.
 */
export class WorkflowEditorApp extends Component {
    static template = "workflow_pilot.workflow_editor_app";
    static components = { EditorCanvas };
    
    setup() {
        // Services (Fail-First - no optional chaining)
        this.editorService = useService("workflowEditor");
        
        // State
        this.state = useState({
            loading: true,
            saving: false,
            publishing: false,
            error: null,
            showConflictModal: false
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
        
        // Load on mount
        onMounted(async () => {
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
            console.log('Workflow saved successfully');
        } catch (error) {
            // Check if conflict error (message contains "modified by another user")
            if (error.message && error.message.includes('modified by another user')) {
                this.state.showConflictModal = true;
            } else {
                // Other errors - show in error state
                this.state.error = error.message || "Failed to save workflow";
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
            console.log('Workflow published successfully');
        } catch (error) {
            this.state.error = error.message || "Failed to publish workflow";
        } finally {
            this.state.publishing = false;
        }
    }
    
    /**
     * Reload page to get fresh workflow data
     */
    reload() {
        window.location.reload();
    }
    
    /**
     * Close conflict modal (user cancelled reload)
     */
    closeConflictModal() {
        this.state.showConflictModal = false;
    }
}
