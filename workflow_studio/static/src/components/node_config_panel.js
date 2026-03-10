/** @odoo-module **/

import { Component, useState, useRef, onMounted, onWillUpdateProps } from "@odoo/owl";
import { ControlRenderer } from "./control_renderer";
import { JsonTreeNode } from "./data_panel/JsonTreeNode";
import { useOdooModels } from "@workflow_studio/utils/use_odoo_models";
import { hasExpressions } from "@workflow_studio/utils/expression_utils";

function inferControlMode(control, value) {
    if (control && control.type === "text" && typeof value === "string" && hasExpressions(value)) {
        return "expression";
    }
    return "fixed";
}

/**
 * NodeConfigPanel Component
 *
 * Provides a configuration interface for a selected workflow node.
 * Uses adapterService for configuration operations and 
 * runService for node/workflow execution.
 */
export class NodeConfigPanel extends Component {
    static template = "workflow_studio.node_config_panel";
    static components = { ControlRenderer, JsonTreeNode };

    static props = {
        node: { type: Object },  // Required: node data object (plain, no _node)
        workflow: { type: Object, optional: true },  // { nodes: [], connections: [] }
        actions: { type: Object },
        onClose: { type: Function },
        onSave: { type: Function },
        onExecute: { type: Function, optional: true },  // Callback after node execution
        execution: { type: Object, optional: true },
        viewMode: { type: String, optional: true },  // 'edit' (default) or 'execution'
    };

    static INPUT_TREE_EXPAND_DEPTH = 1;
    static OUTPUT_TREE_EXPAND_DEPTH = 1;
    static CONTEXT_TREE_EXPAND_DEPTH = 1;
    static TREE_AUTO_COLLAPSE_CHILD_THRESHOLD = 40;

    setup() {
        this.actions = this.props.actions;
        if (!this.actions) {
            throw new Error("[NodeConfigPanel] Missing actions prop");
        }

        // Kick off background fetch of Odoo model list for model_select controls.
        // getOdooModels() returns cached list immediately (fallback during fetch).
        this._odooModels = useOdooModels();

        this.state = useState({
            activeTab: 'parameters',  // 'parameters' | 'output'
            controlValues: {},  // Local copy of control values
            controls: [],  // Control metadata from adapter
            // Expression UI modes (persisted in node.meta.ui)
            controlModes: {},  // { [controlKey]: 'fixed' | 'expression' }
            pairModes: {},  // { [controlKey]: { [pairId]: { key, value } } }
            // Collapsed ancestor sections
            collapsedSections: {},  // { nodeId: true/false }
            // Panel resize state
            isExpanded: false,  // Full width mode
            customWidth: null,  // Custom width from drag (in pixels)
            isResizing: false,  // Currently dragging to resize
            // Lazy-loaded record ref details cache.
            // Key format: `${model}:${id}`
            recordRefCache: {},
        });

        this.panelRef = useRef("panel");
        this._saveDebounceTimer = null;

        // Initialize control values from adapter
        onMounted(() => {
            this.initControlValues();
        });

        onWillUpdateProps((nextProps) => {
            if (nextProps.node.id !== this.props.node.id) {
                this.state.activeTab = "parameters";
                this.state.controlValues = {};
                this.state.controls = [];
                this.state.controlModes = {};
                this.state.pairModes = {};
                this.state.recordRefCache = {};
                this.initControlValues(nextProps.node);
            }
        });
    }

    onRecordRefCachePatch = (patch) => {
        if (!patch || typeof patch !== 'object') {
            return;
        }
        this.state.recordRefCache = {
            ...(this.state.recordRefCache || {}),
            ...patch,
        };
    };

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
            const inferredMode = inferControlMode(control, values[control.key]);
            if (!nextControlModes[control.key] || inferredMode === "expression") {
                nextControlModes[control.key] = inferredMode;
            }
            if (control.type === 'keyvalue') {
                const pairs = Array.isArray(values[control.key]) ? values[control.key] : [];
                const map = { ...(nextPairModes[control.key] || {}) };
                for (const p of pairs) {
                    const id = p?.id;
                    if (id === undefined || id === null) continue;
                    
                    const existing = map[id];
                    if (!existing) {
                        map[id] = { key: 'fixed', value: 'fixed' };
                    } else if (typeof existing === 'string') {
                        // Legacy normalization: assume existing was value-only, key was always fixed
                        map[id] = { key: 'fixed', value: existing };
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
     * Get controls for rendering.
     * Returns control metadata objects (not Control instances).
     * Post-processes model_select controls to inject live model suggestions.
     */
    getControls() {
        const raw = this.state.controls || [];
        return raw.map((ctrl) => {
            if (ctrl.type === "model_select") {
                return { ...ctrl, suggestions: this._getModelSuggestions() };
            }
            return ctrl;
        });
    }

    /**
     * Build model suggestions array from the background-fetched Odoo model list.
     * Returns immediately (no await) using cached/fallback data.
     * @private
     */
    _getModelSuggestions() {
        const models = this._odooModels.getOdooModels();
        return models.map((m) => ({
            value: m.model,
            label: m.model,
            description: m.description,
        }));
    }

    /**
     * Group controls by section, filtering by visibleWhen conditions
     */
    get groupedControls() {
        const controls = this.getControls();
        const groups = {};

        for (const control of controls) {
            // Check visibleWhen conditions
            if (control.visibleWhen && !this._evalVisibleWhen(control.visibleWhen)) {
                continue;
            }
            const section = control.section || 'general';
            if (!groups[section]) {
                groups[section] = {
                    name: this.formatSectionName(section),
                    key: section,
                    icon: this._getSectionIcon(section),
                    controls: [],
                };
            }
            groups[section].controls.push(control);
        }

        return Object.values(groups);
    }

    /**
     * Evaluate visibleWhen conditions against current control values.
     * Format: { "controlKey": ["value1", "value2"] } — control must match one of the values.
     * @private
     */
    _evalVisibleWhen(conditions) {
        const values = this.state.controlValues;
        for (const [key, allowed] of Object.entries(conditions)) {
            const currentVal = values[key];
            if (Array.isArray(allowed)) {
                if (!allowed.includes(currentVal)) return false;
            } else if (typeof allowed === 'string') {
                if (currentVal !== allowed) return false;
            }
        }
        return true;
    }

    /**
     * Get Font Awesome icon class for a section.
     * @private
     */
    _getSectionIcon(section) {
        const icons = {
            general: 'fa-cube',
            request: 'fa-globe',
            authentication: 'fa-lock',
            body: 'fa-file-text-o',
            headers: 'fa-list-ul',
            settings: 'fa-cog',
        };
        return icons[section] || 'fa-cube';
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

    get isExecutionView() {
        return this.props.viewMode === 'execution';
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
        for (let i = execution.nodeResults.length - 1; i >= 0; i--) {
            const result = execution.nodeResults[i];
            if (result && result.node_id === this.props.node.id) {
                return result;
            }
        }
        return null;
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

            const unique = this._getLastExecutionByNode(predecessorResults);
            if (unique.length === 0) return null;

            return unique.map((result, index) => ({
                nodeId: String(result.node_id),
                rowKey: String(result.node_id),
                data: {
                    json: result.output_data,
                    title: result.title || result.node_label || result.node_type || result.node_id,
                },
                isInputNode: index === unique.length - 1,
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

    get inputTreeExpandDepth() {
        return NodeConfigPanel.INPUT_TREE_EXPAND_DEPTH;
    }

    get outputTreeExpandDepth() {
        return NodeConfigPanel.OUTPUT_TREE_EXPAND_DEPTH;
    }

    get contextTreeExpandDepth() {
        return NodeConfigPanel.CONTEXT_TREE_EXPAND_DEPTH;
    }

    get treeAutoCollapseChildrenThreshold() {
        return NodeConfigPanel.TREE_AUTO_COLLAPSE_CHILD_THRESHOLD;
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

        // Build reverse adjacency map from current connections (no cache — avoids
        // stale data when connections change or across different workflows).
        const reverseAdj = {};
        for (const conn of workflow.connections) {
            const { source, target } = conn;
            if (!source || !target) continue;
            if (!reverseAdj[target]) reverseAdj[target] = [];
            reverseAdj[target].push(source);
        }

        // BFS backwards from currentNodeId to collect all predecessors.
        const predecessors = new Set();
        const visited = new Set();
        const queue = [currentNodeId];
        while (queue.length > 0) {
            const current = queue.shift();
            for (const parent of (reverseAdj[current] || [])) {
                if (visited.has(parent)) continue;
                visited.add(parent);
                predecessors.add(parent);
                queue.push(parent);
            }
        }

        return nodeResults.filter(r => predecessors.has(r.node_id));
    }

    /**
     * Keep only the latest execution result for each node.
     * Preserves insertion order by last occurrence (important for loop nodes).
     * @param {Array} nodeResults
     * @returns {Array}
     * @private
     */
    _getLastExecutionByNode(nodeResults) {
        if (!Array.isArray(nodeResults) || nodeResults.length === 0) {
            return [];
        }

        const uniqueByNode = new Map();
        for (const result of nodeResults) {
            if (!result || result.node_id === undefined || result.node_id === null) {
                continue;
            }
            const nodeId = String(result.node_id);
            if (uniqueByNode.has(nodeId)) {
                uniqueByNode.delete(nodeId);
            }
            uniqueByNode.set(nodeId, result);
        }
        return Array.from(uniqueByNode.values());
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

    get outputItemCount() {
        const result = this.executionDisplayResult;
        if (!result || result.error) return null;
        const output = result.output;
        if (Array.isArray(output)) return output.length;
        if (output && typeof output === 'object') return Object.keys(output).length;
        return null;
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

        function buildInputContext(value) {
            const itemsValue = normalizeItems(value);
            const inputContext = {
                item: itemsValue.length ? itemsValue[0] : value,
                json: value,
                items: itemsValue,
            };
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                return {
                    ...value,
                    ...inputContext,
                };
            }
            return inputContext;
        }

        const base = this.actions.getExpressionContext() || {
            _vars: {},
            _node: {},
            _json: {},
            _loop: null,
            _input: buildInputContext(null),
            _execution: null,
            _workflow: null,
            _now: null,
            _today: null,
        };

        const workflow = this._getWorkflowFromContext();
        if (!workflow) {
            const json = this.inputData || {};
            return {
                _vars: base._vars || {},
                _loop: base._loop || null,
                _node: base._node || {},
                _json: json,
                _input: buildInputContext(json),
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

        return {
            _vars: base._vars || {},
            _loop: base._loop || null,
            // Prefer workflow-scoped node outputs for this node (ancestors)
            _node: wfContext._node || base._node || {},
            _json: json,
            _input: buildInputContext(json),
            _execution: base._execution || null,
            _workflow: base._workflow || null,
            _now: base._now || null,
            _today: base._today || null,
        };
    }

    getControlMode(controlKey) {
        const control = (this.state.controls || []).find((item) => item.key === controlKey);
        const value = this.state.controlValues ? this.state.controlValues[controlKey] : undefined;
        return this.state.controlModes[controlKey] || inferControlMode(control, value);
    }

    getPairModes(controlKey) {
        return this.state.pairModes[controlKey] || {};
    }

    onControlModeChange = (controlKey, mode) => {
        this.state.controlModes = {
            ...(this.state.controlModes || {}),
            [controlKey]: mode,
        };
        this._persistUiModes();
    };

    onPairModeChange = (controlKey, pairId, cell, mode) => {
        const current = this.state.pairModes || {};
        const map = { ...(current[controlKey] || {}) };
        const pairMode = typeof map[pairId] === 'object' ? map[pairId] : { key: 'fixed', value: 'fixed' };
        
        map[pairId] = {
            ...pairMode,
            [cell]: mode,
        };
        
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
        const ids = new Set(safePairs.map((p) => p && p.id).filter((id) => id !== undefined && id !== null));

        let changed = false;
        for (const id of ids) {
            if (!next[id]) {
                next[id] = { key: 'fixed', value: 'fixed' };
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

        if (this._saveDebounceTimer) {
            clearTimeout(this._saveDebounceTimer);
            this._saveDebounceTimer = null;
        }
        this._syncToAdapter();

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

        const control = this.state.controls.find(c => c.key === controlKey);
        if (control) {
            control.value = value;
            if (control.type === 'keyvalue') {
                this._reconcilePairModes(controlKey, value);
            }
        }

        this._debouncedLocalSave();
    };

    _debouncedLocalSave() {
        if (this._saveDebounceTimer) {
            clearTimeout(this._saveDebounceTimer);
        }
        this._saveDebounceTimer = setTimeout(() => {
            this._syncToAdapter();
            this._saveDebounceTimer = null;
        }, 300);
    }

    _syncToAdapter() {
        const nodeId = this.props.node.id;
        if (!this.actions.setNodeConfig) {
            throw new Error("[NodeConfigPanel] Missing actions.setNodeConfig");
        }
        this.actions.setNodeConfig(nodeId, this.state.controlValues);
    }

    onTabClick(tabName) {
        this.state.activeTab = tabName;
    }

    toggleAncestorSection(nodeId) {
        this.state.collapsedSections[nodeId] = !this.state.collapsedSections[nodeId];
    }

    isSectionCollapsed(nodeId) {
        return !!this.state.collapsedSections[nodeId];
    }

    onSave() {
        if (this._saveDebounceTimer) {
            clearTimeout(this._saveDebounceTimer);
            this._saveDebounceTimer = null;
        }
        this._syncToAdapter();
        this.props.onSave(this.state.controlValues);
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
