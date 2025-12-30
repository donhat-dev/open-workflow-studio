/** @odoo-module **/

import { Component, useState, useRef, onMounted } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";
import { ControlRenderer } from "./control_renderer";
import { JsonTreeNode } from "./data_panel/JsonTreeNode";

/**
 * NodeConfigPanel Component
 *
 * Phase 3 Architecture:
 * - Uses adapterService for ALL config operations
 * - NO direct _node access
 * - Clean separation between UI and Core layer
 *
 * Data Flow:
 *   UI (controlValues) → adapterService.setNodeConfig() → Core layer
 *   Core layer → adapterService.getNodeConfig() → UI (init)
 */
export class NodeConfigPanel extends Component {
    static template = "workflow_pilot.node_config_panel";
    static components = { ControlRenderer, JsonTreeNode };

    static props = {
        node: { type: Object },  // Required: node data object (plain, no _node)
        workflow: { type: Object, optional: true },  // { nodes: [], connections: [] }
        onClose: { type: Function },
        onSave: { type: Function },
        onExecute: { type: Function, optional: true },  // Callback after node execution
    };

    setup() {
        // Phase 3: Use adapterService for config operations
        this.adapterService = useService("workflowAdapter");
        // Executor service for workflow execution
        this.executorService = useService("workflowExecutor");

        this.state = useState({
            activeTab: 'parameters',  // 'parameters' | 'output'
            isDirty: false,
            controlValues: {},  // Local copy of control values
            controls: [],  // Control metadata from adapter
            // Execution state
            isExecuting: false,
            executionResult: null,  // { output, error, meta }
            // Collapsed ancestor sections
            collapsedSections: {},  // { nodeId: true/false }
        });

        this.panelRef = useRef("panel");

        // Initialize control values from adapter
        onMounted(() => {
            this.initControlValues();
        });
    }

    /**
     * Initialize control values from Core layer via adapterService
     * Phase 3: No _node access, uses adapter.getNodeControls()
     */
    initControlValues() {
        const nodeId = this.props.node.id;

        // Get control metadata from adapter (includes current values)
        const controls = this.adapterService.getNodeControls(nodeId);
        this.state.controls = controls;

        // Extract values for local state
        const values = {};
        for (const control of controls) {
            values[control.key] = control.value;
        }
        this.state.controlValues = values;

        console.log('[NodeConfigPanel] Initialized from adapter:', values);
    }

    /**
     * Get controls for rendering
     * Returns control metadata objects (not Control instances)
     */
    getControls() {
        return this.state.controls || [];
    }

    /**
     * Group controls by section
     */
    get groupedControls() {
        const controls = this.getControls();
        const groups = {};

        for (const control of controls) {
            const section = control.section || 'general';
            if (!groups[section]) {
                groups[section] = {
                    name: this.formatSectionName(section),
                    controls: [],
                };
            }
            groups[section].controls.push(control);
        }

        return Object.values(groups);
    }

    formatSectionName(section) {
        return section.charAt(0).toUpperCase() + section.slice(1);
    }

    get nodeTitle() {
        return this.props.node.title || this.props.node.type || 'Node Configuration';
    }

    get nodeIcon() {
        return this.props.node.icon || 'fa-cube';
    }

    // ============================================
    // EXECUTION
    // ============================================

    get canExecute() {
        // All nodes should be executable via adapter
        return true;
    }

    get executionStatus() {
        if (this.state.isExecuting) return 'running';
        if (!this.state.executionResult) return 'idle';
        if (this.state.executionResult.error) return 'error';
        return 'success';
    }

    get executionStatusLabel() {
        const result = this.state.executionResult;
        if (!result) return '';

        if (result.error) return `Error: ${result.error}`;

        // Try to get HTTP status from output
        const status = result.output?.status;
        if (status) return `${status} ${result.output?.statusText || ''}`;

        return 'Success';
    }

    get executionOutputJson() {
        if (!this.state.executionResult?.output) return '';
        return JSON.stringify(this.state.executionResult.output, null, 2);
    }

    /**
     * Get aggregated context from all ancestor nodes
     * Shows data from all previously executed nodes
     */
    get leftPanelData() {
        const workflow = this._getWorkflowFromContext();
        if (!workflow) return null;

        // Get aggregated context from executor
        const context = this.executorService.buildContextForNode(
            workflow,
            this.props.node.id
        );

        return context.$node;
    }

    /**
     * Get input data for expression preview (immediate previous node)
     */
    get inputData() {
        const workflow = this._getWorkflowFromContext();
        if (!workflow) {
            // Fallback to execution result for single-node preview
            const result = this.state.executionResult;
            if (!result?.output) return null;
            if (result.output.body?.data) return result.output.body.data;
            if (result.output.body) return result.output.body;
            return result.output;
        }

        const context = this.executorService.buildContextForNode(
            workflow,
            this.props.node.id
        );
        return context.$json;
    }

    /**
     * Get workflow context from props
     * @private
     */
    _getWorkflowFromContext() {
        if (this.props.workflow) {
            return this.props.workflow;
        }
        return null;
    }

    /**
     * Execute workflow up to this node
     *
     * Phase 3 Flow:
     * 1. Sync current controlValues to Core via adapterService
     * 2. Execute workflow via executorService
     * 3. Get results
     */
    async onExecute() {
        if (this.state.isExecuting) return;

        const nodeId = this.props.node.id;

        // Phase 3: Sync config to Core layer via adapterService
        this.adapterService.setNodeConfig(nodeId, this.state.controlValues);
        console.log('[NodeConfigPanel] Config synced via adapterService');

        this.state.isExecuting = true;
        this.state.executionResult = null;

        try {
            const workflow = this._getWorkflowFromContext();

            if (workflow) {
                // Use executor service for proper data flow
                await this.executorService.executeUntil(
                    workflow,
                    nodeId,
                    (executedNodeId, result) => {
                        console.log(`[NodeConfigPanel] Node ${executedNodeId} executed:`, result);
                    }
                );

                // Get result from executor service
                const result = this.executorService.getNodeOutput(nodeId);
                this.state.executionResult = result
                    ? { output: result.json, error: result.error, meta: result.meta }
                    : null;
            } else {
                // Fallback to single node execution via adapterService
                const result = await this.adapterService.executeNode(nodeId, {});
                this.state.executionResult = {
                    output: result.json,
                    error: result.error,
                    meta: result.meta,
                };
                
                // Notify parent to refresh variable inspector
                this.props.onExecute?.(nodeId, result);
            }
        } catch (err) {
            console.error('[NodeConfigPanel] Execute error:', err);
            this.state.executionResult = {
                output: null,
                error: err.message,
                meta: { executedAt: new Date().toISOString() },
            };
        } finally {
            this.state.isExecuting = false;
        }
    }

    // ============================================
    // EVENT HANDLERS
    // ============================================

    onControlChange = (controlKey, value) => {
        this.state.controlValues[controlKey] = value;
        this.state.isDirty = true;

        // Also update the control in state.controls for UI sync
        const control = this.state.controls.find(c => c.key === controlKey);
        if (control) {
            control.value = value;
        }
    };

    onTabClick(tabName) {
        this.state.activeTab = tabName;
    }

    toggleAncestorSection(nodeId) {
        this.state.collapsedSections[nodeId] = !this.state.collapsedSections[nodeId];
    }

    isSectionCollapsed(nodeId) {
        return !!this.state.collapsedSections[nodeId];
    }

    /**
     * Save config to Core layer via adapterService
     */
    onSave() {
        const nodeId = this.props.node.id;

        // Phase 3: Save via adapterService (updates Core layer)
        this.adapterService.setNodeConfig(nodeId, this.state.controlValues);
        console.log('[NodeConfigPanel] Config saved via adapterService');

        this.props.onSave(this.state.controlValues);
        this.state.isDirty = false;
    }

    onClose() {
        this.props.onClose();
    }

    onBackdropClick(ev) {
        // Close if clicking backdrop (outside panel)
        if (ev.target === ev.currentTarget) {
            this.onClose();
        }
    }
}
