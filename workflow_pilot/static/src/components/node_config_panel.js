/** @odoo-module **/

import { Component, useState, useRef, onMounted, useEnv } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";
import { ControlRenderer } from "./control_renderer";
import { JsonTreeNode } from "./data_panel/JsonTreeNode";

/**
 * NodeConfigPanel Component
 *
 * Provides a configuration interface for a selected workflow node.
 * Uses adapterService for configuration operations and 
 * runService for node/workflow execution.
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
        // Use adapterService for config operations
        this.adapterService = useService("workflowAdapter");
        // Executor service for workflow execution
        this.executorService = useService("workflowExecutor");
        // Run service for orchestrated execution
        this.runService = useService("workflowRun");
        this.editor = this.env.workflowEditor;

        this.state = useState({
            activeTab: 'parameters',  // 'parameters' | 'output'
            isDirty: false,
            controlValues: {},  // Local copy of control values
            controls: [],  // Control metadata from adapter
            // Expression UI modes (persisted in node.meta.ui)
            controlModes: {},  // { [controlKey]: 'fixed' | 'expression' }
            pairModes: {},  // { [controlKey]: { [pairId]: 'fixed' | 'expression' } }
            // Execution snapshot for expression preview
            lastExecutionContext: null, // { $vars, $node, $json, $loop, $input }
            // Execution state
            isExecuting: false,
            executionResult: null,  // { output, error, meta }
            // Collapsed ancestor sections
            collapsedSections: {},  // { nodeId: true/false }
            // Panel resize state
            isExpanded: false,  // Full width mode
            customWidth: null,  // Custom width from drag (in pixels)
            isResizing: false,  // Currently dragging to resize
        });

        this.panelRef = useRef("panel");

        // Initialize control values from adapter
        onMounted(() => {
            this.initControlValues();
        });
    }

    /**
     * Initialize control values from Core layer via adapterService
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

        // Restore UI modes from node meta (persisted)
        const meta = this.adapterService.getNodeMeta(nodeId);
        const ui = meta.ui || {};
        const restoredControlModes = ui.controlModes || {};
        const restoredPairModes = ui.pairModes || {};

        // Ensure every control has a mode (default: fixed)
        const nextControlModes = { ...restoredControlModes };
        const nextPairModes = { ...restoredPairModes };

        for (const control of controls) {
            if (!nextControlModes[control.key]) {
                nextControlModes[control.key] = 'fixed';
            }
            if (control.type === 'keyvalue') {
                const pairs = Array.isArray(values[control.key]) ? values[control.key] : [];
                const map = { ...(nextPairModes[control.key] || {}) };
                for (const p of pairs) {
                    const id = p?.id;
                    if (id === undefined || id === null) continue;
                    if (!map[id]) {
                        map[id] = 'fixed';
                    }
                }
                nextPairModes[control.key] = map;
            }
        }

        this.state.controlModes = nextControlModes;
        this.state.pairModes = nextPairModes;

        // Initialize ancestor section collapse state (first node expanded, others collapsed)
        this._initAncestorCollapseState();
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
     * Returns array with isInputNode marker for expression prefix handling
     */
    get leftPanelData() {
        const workflow = this._getWorkflowFromContext();
        if (!workflow) return null;

        // Get aggregated context from executor
        const context = this.executorService.buildContextForNode(
            workflow,
            this.props.node.id
        );

        const $node = context.$node || {};
        const entries = Object.entries($node);
        if (entries.length === 0) return null;

        // Return array with isInputNode marker (first node = $input)
        return entries.map(([nodeId, data], index) => ({
            nodeId,
            data,
            isInputNode: index === 0,
        }));
    }

    /**
     * Initialize collapse state for ancestor sections
     * First node ($input) expanded, others collapsed
     * @private
     */
    _initAncestorCollapseState() {
        const leftData = this.leftPanelData || [];
        const defaults = { '$vars': true }; // $vars always collapsed
        for (const item of leftData) {
            // First node (isInputNode) expanded, others collapsed
            defaults[item.nodeId] = !item.isInputNode;
        }
        this.state.collapsedSections = { ...defaults, ...this.state.collapsedSections };
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
     * Full expression context for ExpressionInput preview.
     *
     * Goal: allow preview/evaluation of $vars expressions without requiring UI mapping.
     *
     * - $json: immediate previous node output (existing behavior)
     * - $node: ancestor node outputs (for cross-node lookup)
     * - $vars/$loop: from workflowVariable service via adapterService.getExpressionContext()
     */
    get expressionPreviewContext() {
        // Prefer the last execution snapshot for preview (stable, matches executed data flow).
        if (this.state.lastExecutionContext) {
            const snap = this.state.lastExecutionContext;
            const inputJson = snap.$input?.json ?? snap.$input?.item ?? snap.$json ?? {};
            return {
                $vars: snap.$vars || {},
                $loop: snap.$loop || null,
                $node: snap.$node || {},
                // For UX, treat $json as the current input item
                $json: inputJson,
                $input: snap.$input || { item: inputJson, json: inputJson },
            };
        }

        const base = this.adapterService.getExpressionContext() || {
            $vars: {},
            $node: {},
            $json: {},
            $loop: null,
            $input: { item: null, json: null },
        };

        const workflow = this._getWorkflowFromContext();
        if (!workflow) {
            const json = this.inputData || {};
            return {
                $vars: base.$vars || {},
                $loop: base.$loop || null,
                $node: base.$node || {},
                $json: json,
                $input: { item: json, json },
            };
        }

        const wfContext = this.executorService.buildContextForNode(workflow, this.props.node.id);
        const json = wfContext.$json || {};

        return {
            $vars: base.$vars || {},
            $loop: base.$loop || null,
            // Prefer workflow-scoped node outputs for this node (ancestors)
            $node: wfContext.$node || base.$node || {},
            $json: json,
            $input: { item: json, json },
        };
    }

    getControlMode(controlKey) {
        return this.state.controlModes?.[controlKey] || 'fixed';
    }

    getPairModes(controlKey) {
        return this.state.pairModes?.[controlKey] || {};
    }

    onControlModeChange = (controlKey, mode) => {
        this.state.controlModes = {
            ...(this.state.controlModes || {}),
            [controlKey]: mode,
        };
        this._persistUiModes();
    };

    onPairModeChange = (controlKey, pairId, mode) => {
        const current = this.state.pairModes || {};
        const map = { ...(current[controlKey] || {}) };
        map[pairId] = mode;
        this.state.pairModes = { ...current, [controlKey]: map };
        this._persistUiModes();
    };

    _persistUiModes() {
        const nodeId = this.props.node.id;
        this.adapterService.setNodeMeta(nodeId, {
            ui: {
                controlModes: this.state.controlModes || {},
                pairModes: this.state.pairModes || {},
            },
        });
    }

    _reconcilePairModes(controlKey, pairs) {
        const safePairs = Array.isArray(pairs) ? pairs : [];
        const existing = (this.state.pairModes && this.state.pairModes[controlKey]) || {};
        const next = { ...existing };
        const ids = new Set(safePairs.map((p) => p?.id).filter((id) => id !== undefined && id !== null));

        let changed = false;
        for (const id of ids) {
            if (!next[id]) {
                next[id] = 'fixed';
                changed = true;
            }
        }
        for (const key of Object.keys(next)) {
            const asNum = Number(key);
            if (!ids.has(key) && !ids.has(asNum)) {
                delete next[key];
                changed = true;
            }
        }

        if (changed) {
            this.state.pairModes = {
                ...(this.state.pairModes || {}),
                [controlKey]: next,
            };
            this._persistUiModes();
        }
    }

    /**
     * S2.3: Get workflow variables ($vars) for display in left panel
     * This allows users to see and drag $vars expressions
     */
    get workflowVariables() {
        const expressionContext = this.adapterService.getExpressionContext();
        return expressionContext?.$vars || {};
    }

    /**
     * S2.3: Check if there are any workflow variables to display
     */
    get hasWorkflowVariables() {
        const vars = this.workflowVariables;
        return vars && Object.keys(vars).length > 0;
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
     * Phase 3 Flow (Refactored via workflowRunService):
     * 1. runService handles config sync
     * 2. runService calls executorService
     * 3. Results returned to UI
     */
    async onExecute() {
        if (this.runService.isExecuting) return;

        const nodeId = this.props.node.id;
        const workflow = this._getWorkflowFromContext();

        this.state.isExecuting = true;
        this.state.executionResult = null;

        try {
            let result = null;

            if (workflow) {
                // Use runService for proper orchestration
                result = await this.runService.runUntilNode(
                    workflow,
                    nodeId,
                    {
                        syncConfig: true,
                        controlValues: this.state.controlValues,
                        onProgress: (executedNodeId, nodeResult) => {
                            console.log(`[NodeConfigPanel] Node ${executedNodeId} executed`);
                        }
                    }
                );

                this.state.executionResult = result;
                this.state.lastExecutionContext = result?.expressionContext || null;
            } else {
                // Fallback to single node execution
                result = await this.runService.runNode(nodeId, {});
                this.state.executionResult = result;
            }

            // Notify parent to refresh variable inspector
            this.props.onExecute?.(nodeId, result);

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
            if (control.type === 'keyvalue') {
                this._reconcilePairModes(controlKey, value);
            }
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
        this.editor.actions.closePanel("config");
    }

    onBackdropClick(ev) {
        // Close if clicking backdrop (outside panel)
        if (ev.target === ev.currentTarget) {
            this.onClose();
        }
    }

    // ============================================
    // PANEL RESIZE FUNCTIONALITY
    // ============================================

    /**
     * Computed style for panel width
     */
    get panelStyle() {
        if (this.state.isExpanded) {
            return 'width: calc(100vw - 60px);';  // Full width minus small margin
        }
        if (this.state.customWidth) {
            return `width: ${this.state.customWidth}px;`;
        }
        return '';  // Use default CSS (50vw)
    }

    /**
     * Toggle between expanded (full-width) and default mode
     */
    onToggleExpand() {
        this.state.isExpanded = !this.state.isExpanded;
        // Reset custom width when toggling
        if (this.state.isExpanded) {
            this.state.customWidth = null;
        }
    }

    /**
     * Start drag resize
     */
    onResizeStart = (ev) => {
        ev.preventDefault();
        this.state.isResizing = true;
        this.state.isExpanded = false;  // Exit expanded mode when manually resizing

        const startX = ev.clientX;
        const panel = this.panelRef.el;
        const startWidth = panel.offsetWidth;

        const onMouseMove = (moveEv) => {
            // Calculate new width (dragging from left edge)
            const deltaX = startX - moveEv.clientX;
            let newWidth = startWidth + deltaX;

            // Clamp width between min and max
            const minWidth = 500;
            const maxWidth = window.innerWidth - 60;
            newWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));

            this.state.customWidth = newWidth;
        };

        const onMouseUp = () => {
            this.state.isResizing = false;
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        document.body.style.cursor = 'ew-resize';
        document.body.style.userSelect = 'none';
    };
}
