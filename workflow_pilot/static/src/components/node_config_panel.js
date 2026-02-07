/** @odoo-module **/

import { Component, useState, useRef, onMounted, onWillUpdateProps } from "@odoo/owl";
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
        actions: { type: Object },
        onClose: { type: Function },
        onSave: { type: Function },
        onExecute: { type: Function, optional: true },  // Callback after node execution
        execution: { type: Object, optional: true },
    };

    // Static cache for predecessor computation (cleared on workflow change)
    static _predecessorCache = new Map();  // "workflowId:nodeId" -> Set<predecessorId>
    static _reverseAdjCache = new Map();   // workflowId -> reverseAdj map

    setup() {
        this.actions = this.props.actions;
        if (!this.actions) {
            throw new Error("[NodeConfigPanel] Missing actions prop");
        }

        this.state = useState({
            activeTab: 'parameters',  // 'parameters' | 'output'
            isDirty: false,
            controlValues: {},  // Local copy of control values
            controls: [],  // Control metadata from adapter
            // Expression UI modes (persisted in node.meta.ui)
            controlModes: {},  // { [controlKey]: 'fixed' | 'expression' }
            pairModes: {},  // { [controlKey]: { [pairId]: 'fixed' | 'expression' } }
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

        onWillUpdateProps((nextProps) => {
            if (nextProps.node.id !== this.props.node.id) {
                this.state.activeTab = "parameters";
                this.state.isDirty = false;
                this.state.controlValues = {};
                this.state.controls = [];
                this.state.controlModes = {};
                this.state.pairModes = {};
                this.initControlValues(nextProps.node);
            }
        });
    }

    /**
     * Initialize control values from Core layer via adapterService
     */
    initControlValues(node) {
        const targetNode = node || this.props.node;
        if (!targetNode) {
            throw new Error("[NodeConfigPanel] Missing node for initialization");
        }
        const nodeId = targetNode.id;

        // Get control metadata from adapter (includes current values)
        if (!this.actions.getControls) {
            throw new Error("[NodeConfigPanel] Missing actions.getControls");
        }
        const controls = this.actions.getControls(nodeId);
        this.state.controls = controls;

        // Extract values for local state
        const values = {};
        for (const control of controls) {
            values[control.key] = control.value;
        }
        this.state.controlValues = values;

        // Restore UI modes from node meta (persisted)
        if (!this.actions.getNodeMeta) {
            throw new Error("[NodeConfigPanel] Missing actions.getNodeMeta");
        }
        const meta = this.actions.getNodeMeta(nodeId);
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
        const execution = this.props.execution;
        if (execution && execution.status === 'failed') return 'error';
        const runResult = this.executionNodeResult;
        if (!runResult) return 'idle';
        if (runResult.error_message) return 'error';
        return 'success';
    }

    get executionStatusLabel() {
        const execution = this.props.execution;
        if (execution && execution.status === 'failed') {
            return `Error: ${execution.error || 'Execution failed'}`;
        }
        const runResult = this.executionNodeResult;
        if (runResult && runResult.error_message) {
            return `Error: ${runResult.error_message}`;
        }
        return '';
    }

    get executionOutputJson() {
        const runResult = this.executionNodeResult;
        if (!runResult || runResult.output_data === undefined) return '';
        return JSON.stringify(runResult.output_data, null, 2);
    }

    get executionNodeResult() {
        const execution = this.props.execution;
        if (!execution || !Array.isArray(execution.nodeResults)) {
            return null;
        }
        return execution.nodeResults.find((result) => result.node_id === this.props.node.id) || null;
    }

    /**
     * Get aggregated context from predecessor nodes only.
     * Shows data from nodes that executed BEFORE the current node (not the current node or successors).
     * Matches backend behavior: when opening n_2, show n_1's output; when opening n_1, show n_2's output (not n_3).
     * Returns array with isInputNode marker for expression prefix handling.
     */
    get leftPanelData() {
        const currentNodeId = this.props.node.id;
        const execution = this.props.execution;
        
        if (execution && Array.isArray(execution.nodeResults) && execution.nodeResults.length) {
            // Filter to show only predecessors (nodes executed before current node)
            const predecessorResults = this._filterPredecessorResults(
                execution.nodeResults,
                currentNodeId
            );
            
            if (predecessorResults.length === 0) return null;
            
            return predecessorResults.map((result, index) => ({
                nodeId: result.node_id,
                data: {
                    json: result.output_data,
                    title: result.title || result.node_label || result.node_type || result.node_id,
                },
                isInputNode: index === predecessorResults.length - 1,
            }));
        }

        const workflow = this._getWorkflowFromContext();
        if (!workflow) return null;

        // Get aggregated context from executor
        if (!this.actions.buildContextForNode) {
            throw new Error("[NodeConfigPanel] Missing actions.buildContextForNode");
        }
        const context = this.actions.buildContextForNode();

        const nodeContext = context._node || {};
        const entries = Object.entries(nodeContext);
        if (entries.length === 0) return null;

        // Return array with isInputNode marker (last entry = immediate predecessor)
        return entries.map(([nodeId, data], index) => ({
            nodeId,
            data: {
                json: data,
                title: nodeId,
            },
            isInputNode: index === entries.length - 1,
        }));
    }
    
    /**
     * Filter execution results to show only predecessors of the current node.
     * Uses workflow connections to determine which nodes are predecessors.
     * @private
     */
    _filterPredecessorResults(nodeResults, currentNodeId) {
        const workflow = this.props.workflow;
        if (!workflow || !workflow.connections) {
            // Fallback: show all results except current node
            return nodeResults.filter(r => r.node_id !== currentNodeId);
        }
        
        // Build set of predecessor node IDs (cached BFS backwards from current node)
        const workflowId = workflow.id || 'draft';
        const predecessorIds = this._getPredecessorIds(currentNodeId, workflowId, workflow.connections);
        
        // Filter results to only include predecessors, maintaining execution order
        return nodeResults.filter(r => predecessorIds.has(r.node_id));
    }
    
    /**
     * Get all predecessor node IDs using cached BFS backwards traversal.
     * Uses static cache keyed by workflowId:nodeId for O(1) repeated lookups.
     * @private
     */
    _getPredecessorIds(targetNodeId, workflowId, connections) {
        const cacheKey = `${workflowId}:${targetNodeId}`;
        
        // Check cache first
        if (NodeConfigPanel._predecessorCache.has(cacheKey)) {
            return NodeConfigPanel._predecessorCache.get(cacheKey);
        }
        
        // Get or build reverse adjacency map (cached per workflow)
        let reverseAdj = NodeConfigPanel._reverseAdjCache.get(workflowId);
        if (!reverseAdj) {
            reverseAdj = {};
            for (const conn of connections) {
                const target = conn.target;
                const source = conn.source;
                if (!target || !source) continue;
                if (!reverseAdj[target]) reverseAdj[target] = [];
                reverseAdj[target].push(source);
            }
            NodeConfigPanel._reverseAdjCache.set(workflowId, reverseAdj);
        }
        
        // BFS backwards traversal
        const predecessors = new Set();
        const visited = new Set();
        const queue = [targetNodeId];
        
        while (queue.length > 0) {
            const current = queue.shift();
            const parents = reverseAdj[current] || [];
            for (const parent of parents) {
                if (visited.has(parent)) continue;
                visited.add(parent);
                predecessors.add(parent);
                queue.push(parent);
            }
        }
        
        // Cache result
        NodeConfigPanel._predecessorCache.set(cacheKey, predecessors);
        return predecessors;
    }
    
    /**
     * Clear predecessor cache (call when workflow connections change).
     * @param {string} [workflowId] - Clear specific workflow or all if omitted
     */
    static clearPredecessorCache(workflowId) {
        if (workflowId) {
            // Clear specific workflow entries
            NodeConfigPanel._reverseAdjCache.delete(workflowId);
            for (const key of NodeConfigPanel._predecessorCache.keys()) {
                if (key.startsWith(`${workflowId}:`)) {
                    NodeConfigPanel._predecessorCache.delete(key);
                }
            }
        } else {
            // Clear all
            NodeConfigPanel._predecessorCache.clear();
            NodeConfigPanel._reverseAdjCache.clear();
        }
    }

    get executionDisplayResult() {
        const runResult = this.executionNodeResult;
        if (!runResult) return null;
        if (runResult.error_message) {
            return {
                error: runResult.error_message,
                output: null,
            };
        }
        const output = runResult.output_data === undefined ? null : runResult.output_data;
        return {
            error: null,
            output,
        };
    }

    /**
     * Initialize collapse state for ancestor sections.
     * Immediate input node expanded, others collapsed.
     * Context variables section collapsed by default.
     * @private
     */
    _initAncestorCollapseState() {
        const leftData = this.leftPanelData || [];
        const defaults = { 
            '_context': true,  // Context variables collapsed by default
        };
        for (const item of leftData) {
            // Immediate input node (isInputNode=true) expanded, others collapsed
            defaults[item.nodeId] = !item.isInputNode;
        }
        this.state.collapsedSections = { ...defaults, ...this.state.collapsedSections };
    }

    /**
     * Get input data for expression preview (immediate previous node)
     */
    get inputData() {
        const execution = this.props.execution;
        if (execution) {
            const runResult = this.executionNodeResult;
            if (runResult && runResult.output_data !== undefined) {
                return runResult.output_data;
            }
        }
        const workflow = this._getWorkflowFromContext();
        if (!workflow) {
            return null;
        }

        if (!this.actions.buildContextForNode) {
            throw new Error("[NodeConfigPanel] Missing actions.buildContextForNode");
        }
        const context = this.actions.buildContextForNode(workflow, this.props.node.id);
        return context._json;
    }

    /**
     * Full expression context for ExpressionInput preview.
     *
     * Goal: allow preview/evaluation of _vars expressions without requiring UI mapping.
     *
     * - _json: immediate previous node output (existing behavior)
     * - _node: ancestor node outputs (for cross-node lookup)
     * - _vars/_loop: from workflowVariable service via adapterService.getExpressionContext()
     */
    get expressionPreviewContext() {
        const execution = this.props.execution;
        if (execution && Array.isArray(execution.nodeResults) && execution.nodeResults.length) {
            if (!this.actions.getExpressionContext) {
                throw new Error("[NodeConfigPanel] Missing actions.getExpressionContext");
            }
            return this.actions.getExpressionContext({
                execution,
                nodeId: this.props.node.id,
                nodeResults: execution.nodeResults,
            });
        }

        if (!this.actions.getExpressionContext) {
            throw new Error("[NodeConfigPanel] Missing actions.getExpressionContext");
        }
        function normalizeItems(value) {
            if (Array.isArray(value)) {
                return value;
            }
            if (value === null || value === undefined) {
                return [];
            }
            return [value];
        }
        const base = this.actions.getExpressionContext() || {
            _vars: {},
            _node: {},
            _json: {},
            _loop: null,
            _input: { item: null, json: null, items: [] },
            _execution: null,
            _workflow: null,
            _now: null,
            _today: null,
        };

        const workflow = this._getWorkflowFromContext();
        if (!workflow) {
            const json = this.inputData || {};
            const inputItems = normalizeItems(json);
            return {
                _vars: base._vars || {},
                _loop: base._loop || null,
                _node: base._node || {},
                _json: json,
                _input: { item: inputItems[0] || json, json, items: inputItems },
                _execution: base._execution || null,
                _workflow: base._workflow || null,
                _now: base._now || null,
                _today: base._today || null,
            };
        }

        if (!this.actions.buildContextForNode) {
            throw new Error("[NodeConfigPanel] Missing actions.buildContextForNode");
        }
        const wfContext = this.actions.buildContextForNode();
        const json = wfContext._json || {};
        const inputItems = normalizeItems(json);

        return {
            _vars: base._vars || {},
            _loop: base._loop || null,
            // Prefer workflow-scoped node outputs for this node (ancestors)
            _node: wfContext._node || base._node || {},
            _json: json,
            _input: { item: inputItems[0] || json, json, items: inputItems },
            _execution: base._execution || null,
            _workflow: base._workflow || null,
            _now: base._now || null,
            _today: base._today || null,
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
        if (!this.actions.setNodeMeta) {
            throw new Error("[NodeConfigPanel] Missing actions.setNodeMeta");
        }
        this.actions.setNodeMeta(nodeId, {
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
     * S2.3: Get workflow variables (_vars) for display in left panel
     * This allows users to see and drag _vars expressions
     */
    get workflowVariables() {
        if (!this.actions.getExpressionContext) {
            throw new Error("[NodeConfigPanel] Missing actions.getExpressionContext");
        }
        const expressionContext = this.actions.getExpressionContext();
        if (expressionContext && expressionContext._vars) {
            return expressionContext._vars;
        }
        return {};
    }

    /**
     * S2.3: Check if there are any workflow variables to display
     */
    get hasWorkflowVariables() {
        const vars = this.workflowVariables;
        return vars && Object.keys(vars).length > 0;
    }

    /**
     * Get context variables for display in left panel.
     * Uses underscore-prefixed keys matching backend eval_context:
     * _now, _today, _vars, _execution, _workflow
     * @see workflow_executor.py _get_secure_eval_context
     */
    get contextVariables() {
        if (!this.actions.getExpressionContext) {
            throw new Error("[NodeConfigPanel] Missing actions.getExpressionContext");
        }
        const ctx = this.actions.getExpressionContext() || {};
        
        return {
            _now: ctx._now || new Date().toISOString(),
            _today: ctx._today || new Date().toISOString().split('T')[0],
            _vars: ctx._vars || {},
            _execution: ctx._execution || {
                id: '[filled at execution time]',
                mode: 'test',
            },
            _workflow: ctx._workflow || {
                id: this.props.workflow ? this.props.workflow.id : null,
                name: this.props.workflow ? this.props.workflow.name : 'My workflow',
                active: false,
            },
        };
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
        if (!this.actions.executeUntilNode) {
            throw new Error("[NodeConfigPanel] Missing executeUntilNode action");
        }

        const nodeId = this.props.node.id;
        const configOverrides = this.state.controlValues
            ? { [nodeId]: this.state.controlValues }
            : null;

        try {
            await this.actions.executeUntilNode(nodeId, {}, configOverrides);
            if (this.props.onExecute) {
                this.props.onExecute(nodeId);
            }
        } catch (err) {
            console.error('[NodeConfigPanel] Execute error:', err);
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
        if (!this.actions.setNodeConfig) {
            throw new Error("[NodeConfigPanel] Missing actions.setNodeConfig");
        }
        this.actions.setNodeConfig(nodeId, this.state.controlValues);
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
