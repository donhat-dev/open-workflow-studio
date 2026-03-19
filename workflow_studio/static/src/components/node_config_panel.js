/** @odoo-module **/

import { Component, useState, useRef, onMounted, onWillUpdateProps } from "@odoo/owl";
import { ControlRenderer } from "./control_renderer";
import { JsonTreeNode } from "./data_panel/JsonTreeNode";
import { TabNav } from "./primitives/tab_nav/tab_nav";
import { useOdooModels } from "@workflow_studio/utils/use_odoo_models";
import { inferExpressionModeFromValue } from "@workflow_studio/utils/expression_utils";
import {
    getLatestNodeResultsByNodeIds,
    getStructuralPredecessorIds,
} from "@workflow_studio/utils/graph_utils";

function inferControlMode(control, value) {
    if (inferExpressionModeFromValue(value)) {
        return "expression";
    }
    return "fixed";
}

function normalizeControlValue(control, value) {
    return value;
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
    static components = { ControlRenderer, JsonTreeNode, TabNav };

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

    static INPUT_TREE_EXPAND_DEPTH = 3;
    static OUTPUT_TREE_EXPAND_DEPTH = 3;
    static CONTEXT_TREE_EXPAND_DEPTH = 3;
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
            // Version/socket selection for output display
            selectedOutputSocket: null,  // null = first available socket
            selectedExecutionVersion: null,  // null = latest version
            pinBusy: false,
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
                this.state.selectedOutputSocket = null;
                this.state.selectedExecutionVersion = null;
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
        let valuesNormalized = false;
        for (const control of controls) {
            const normalizedValue = normalizeControlValue(control, control.value);
            values[control.key] = normalizedValue;
            if (normalizedValue !== control.value) {
                valuesNormalized = true;
            }
            control.value = normalizedValue;
        }
        this.state.controlValues = values;

        if (valuesNormalized && this.actions.setNodeConfig) {
            this.actions.setNodeConfig(nodeId, values);
        }

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
        if (this.props.node.type === 'record_operation' && !this.props.node.titleIsCustom) {
            return this._computeRecordOperationAutoTitle() || this.props.node.title || this.props.node.type || 'Node Configuration';
        }
        return this.props.node.title || this.props.node.type || 'Node Configuration';
    }

    /**
     * Value shown in the Settings > Node Name input.
     * For auto-titled nodes shows the computed label; for custom-titled shows the stored title.
     */
    get nodeNameInputValue() {
        return this.props.node.title || '';
    }

    /**
     * True when this node type supports title auto-derivation from config.
     */
    get isAutoTitleNode() {
        return this.props.node.type === 'record_operation';
    }

    // ============================================
    // RECORD OPERATION AUTO-TITLE HELPERS
    // ============================================

    _computeRecordOperationAutoTitle() {
        if (this.props.node.type !== 'record_operation') return null;
        const values = this.state.controlValues || {};
        const operation = typeof values.operation === 'string' ? values.operation.trim().toLowerCase() : '';
        const operationLabel = this._recordOperationLabel(operation);
        const modelLabel = this._recordOperationModelLabel(values.model);
        return modelLabel ? `${operationLabel} ${modelLabel}` : operationLabel;
    }

    _recordOperationLabel(operation) {
        const operationMap = {
            search: 'Search',
            create: 'Create',
            write: 'Update',
            delete: 'Delete',
        };
        return operationMap[operation] || 'Record Operation';
    }

    _recordOperationModelLabel(modelName) {
        if (typeof modelName !== 'string' || !modelName.trim()) return '';
        const name = modelName.trim();
        const meta = this._odooModels.getModelMetaByName(name);
        if (meta && typeof meta.description === 'string' && meta.description.trim()) {
            return meta.description.trim();
        }
        return name;
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

    /**
     * All execution events for the current node (preserves iterations).
     * Uses executionEvents (non-deduplicated) when available, falls back to nodeResults.
     */
    get nodeExecutionEvents() {
        const execution = this.props.execution;
        if (!execution) return [];
        const nodeId = this.props.node.id;
        const events = Array.isArray(execution.executionEvents) && execution.executionEvents.length
            ? execution.executionEvents
            : execution.nodeResults;
        if (!Array.isArray(events)) return [];
        return events.filter(e => e && e.node_id === nodeId);
    }

    /**
     * Group execution events by output_socket.
     * Returns Map<socketKey, Array<event>>.
     * Events without output_socket are grouped under '_default'.
     */
    get outputSocketGroups() {
        const events = this.nodeExecutionEvents;
        const groups = new Map();
        for (const event of events) {
            const key = event.output_socket || '_default';
            if (!groups.has(key)) {
                groups.set(key, []);
            }
            groups.get(key).push(event);
        }
        return groups;
    }

    /**
     * Tab definitions for output socket selection.
     * Only shown when node has multiple output sockets in execution results.
     */
    get outputSocketTabs() {
        const groups = this.outputSocketGroups;
        if (groups.size <= 1 && groups.has('_default')) return [];
        const nodeOutputs = this.props.node.outputs || {};
        const tabs = [];
        for (const [socketKey, events] of groups) {
            const socketDef = socketKey !== '_default' ? nodeOutputs[socketKey] : null;
            const label = socketDef
                ? (socketDef.label || socketKey)
                : (socketKey === '_default' ? 'Output' : socketKey);
            tabs.push({
                id: socketKey,
                label: `${label} (${events.length})`,
                rawLabel: label,
                count: events.length,
            });
        }
        return tabs;
    }

    /**
     * Currently active output socket key.
     * Defaults to first available socket from execution events.
     */
    get activeOutputSocket() {
        const tabs = this.outputSocketTabs;
        if (!tabs.length) return '_default';
        if (this.state.selectedOutputSocket) {
            const exists = tabs.some(t => t.id === this.state.selectedOutputSocket);
            if (exists) return this.state.selectedOutputSocket;
        }
        return tabs[0].id;
    }

    /**
     * Events filtered by the active output socket.
     */
    get activeSocketEvents() {
        const groups = this.outputSocketGroups;
        const key = this.activeOutputSocket;
        return groups.get(key) || [];
    }

    /**
     * Version dropdown options for the active socket.
     * Each entry: { index, label, event }.
     */
    get versionOptions() {
        const events = this.activeSocketEvents;
        if (events.length <= 1) return [];
        return events.map((event, idx) => ({
            index: idx,
            label: `${idx + 1} of ${events.length}`,
            event,
        }));
    }

    /**
     * Currently selected version index within the active socket.
     * Defaults to last (latest) version.
     */
    get activeVersionIndex() {
        const events = this.activeSocketEvents;
        if (!events.length) return -1;
        const selected = this.state.selectedExecutionVersion;
        if (selected !== null && selected >= 0 && selected < events.length) {
            return selected;
        }
        return events.length - 1;
    }

    /**
     * The selected execution event based on socket + version selection.
     */
    get selectedExecutionEvent() {
        const events = this.activeSocketEvents;
        const idx = this.activeVersionIndex;
        if (idx < 0 || idx >= events.length) return null;
        return events[idx];
    }

    get executionNodeResult() {
        return this.selectedExecutionEvent;
    }

    onOutputSocketClick(socketKey) {
        this.state.selectedOutputSocket = socketKey;
        this.state.selectedExecutionVersion = null;
    }

    onVersionChange(ev) {
        const value = parseInt(ev.target.value, 10);
        this.state.selectedExecutionVersion = isNaN(value) ? null : value;
    }

    /**
     * Get aggregated context from predecessor nodes only.
     * Shows data from nodes that executed BEFORE the current node (not the current node or successors).
     *
     * For the immediate input node: uses the CURRENT node's own input_data from
     * the selected execution event. This ensures loop-cycle children see the
     * data they actually received (e.g., loop-socket batch) instead of the
     * loop node's final done-branch output.
     *
     * Returns array with isInputNode marker for expression prefix handling.
     */
    get leftPanelData() {
        const currentNodeId = this.props.node.id;
        const execution = this.props.execution;
        
        if (execution && Array.isArray(execution.nodeResults) && execution.nodeResults.length) {
            // Filter to show only structural predecessors (ignore loop back-edges).
            const predecessorResults = this._filterPredecessorResults(
                execution.nodeResults,
                currentNodeId
            );

            if (predecessorResults.length === 0) return null;

            // Try to get THIS node's input_data from the selected execution event.
            // This reflects what the node actually received, resolving loop-cycle
            // ambiguity where predecessor's last output_data may be "done" branch
            // data while the child only received "loop" branch data.
            const selectedEvent = this.selectedExecutionEvent;
            const nodeInputData = selectedEvent && selectedEvent.input_data !== undefined
                ? selectedEvent.input_data
                : null;

            return predecessorResults.map((result, index) => {
                const isInput = index === predecessorResults.length - 1;
                return {
                    nodeId: String(result.node_id),
                    rowKey: String(result.node_id),
                    data: {
                        json: isInput && nodeInputData !== null
                            ? nodeInputData
                            : result.output_data,
                        title: result.title || result.node_label || result.node_type || result.node_id,
                    },
                    isInputNode: isInput,
                };
            });

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

        const predecessorIds = getStructuralPredecessorIds(workflow, currentNodeId);
        return getLatestNodeResultsByNodeIds(nodeResults, predecessorIds);
    }
    
    get executionDisplayResult() {
        const runResult = this.executionNodeResult;
        if (runResult) {
            if (runResult.error_message) {
                return {
                    error: runResult.error_message,
                    output: null,
                    source: 'execution',
                };
            }
            const output = runResult.output_data === undefined ? null : runResult.output_data;
            return {
                error: null,
                output,
                source: 'execution',
            };
        }
        return null;
    }

    get canTogglePin() {
        if (this.isNodePinned) {
            return true;
        }
        const event = this.selectedExecutionEvent;
        if (!event || event.error_message) return false;
        // Allow pin when there's either a persisted node_run_id or output data
        return !!(event.node_run_id || event.output_data !== undefined && event.output_data !== null);
    }

    get isPinButtonDisabled() {
        return this.state.pinBusy || !this.canTogglePin;
    }

    /**
     * Whether the current node has pinned data.
     */
    get isNodePinned() {
        if (!this.actions || !this.actions.isNodePinned) return false;
        return this.actions.isNodePinned(this.props.node.id);
    }

    /**
     * Toggle pin state for the current node.
     * If pinned → unpin. If not pinned → pin current execution output.
     */
    async onTogglePin() {
        if (this.state.pinBusy) {
            return;
        }
        const nodeId = this.props.node.id;
        if (!this.actions.saveWorkflow) {
            throw new Error("[NodeConfigPanel] Missing saveWorkflow action");
        }
        this.state.pinBusy = true;
        try {
            if (this.isNodePinned) {
                this.actions.unpinNodeData(nodeId);
                await this.actions.saveWorkflow();
                return;
            }

            const selectedEvent = this.selectedExecutionEvent;
            if (!selectedEvent || selectedEvent.error_message) {
                return;
            }

            if (selectedEvent.node_run_id) {
                // Persisted run: pin by reference
                if (!this.actions.getNodeRunDetails) {
                    throw new Error("[NodeConfigPanel] Missing getNodeRunDetails action");
                }
                const nodeRun = await this.actions.getNodeRunDetails(selectedEvent.node_run_id);
                if (!nodeRun || nodeRun.error) {
                    throw new Error(nodeRun && nodeRun.error ? nodeRun.error : "Node run details not found");
                }
                if (this.actions.replaceExecutionNodeResult) {
                    this.actions.replaceExecutionNodeResult(nodeRun);
                }
                this.actions.pinNodeData(nodeId, nodeRun.node_run_id || selectedEvent.node_run_id);
            } else {
                // Preview execution: pin inline data
                const inlineData = {
                    output_data: selectedEvent.output_data,
                    input_data: selectedEvent.input_data,
                    node_type: selectedEvent.node_type,
                    node_label: selectedEvent.node_label || selectedEvent.title,
                    output_socket: selectedEvent.output_socket,
                };
                this.actions.pinNodeData(nodeId, inlineData);
            }
            await this.actions.saveWorkflow();
        } catch (error) {
            console.error('[NodeConfigPanel] Pin toggle failed:', error);
        } finally {
            this.state.pinBusy = false;
        }
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
     * Get input data for expression preview (immediate previous node).
     * Prefers the selected execution event's input_data for accuracy
     * (resolves loop-cycle "future data" issue).
     */
    get inputData() {
        const selectedEvent = this.selectedExecutionEvent;
        if (selectedEvent && selectedEvent.input_data !== undefined) {
            return selectedEvent.input_data;
        }
        const execution = this.props.execution;
        if (execution && this.actions.getExpressionContext) {
            const context = this.actions.getExpressionContext({
                execution,
                nodeId: this.props.node.id,
                nodeResults: execution.nodeResults || [],
            });
            if (context && context._json !== undefined) {
                return context._json;
            }
        }
        const workflow = this._getWorkflowFromContext();
        if (!workflow) {
            return null;
        }

        if (!this.actions.buildContextForNode) {
            throw new Error("[NodeConfigPanel] Missing actions.buildContextForNode");
        }
        const context = this.actions.buildContextForNode();
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
            const baseCtx = this.actions.getExpressionContext({
                execution,
                nodeId: this.props.node.id,
                nodeResults: execution.nodeResults,
            });
            // Override _json with the selected event's input_data for accuracy
            // (critical for loop-cycle children that should see loop-branch data)
            const selectedEvent = this.selectedExecutionEvent;
            if (selectedEvent && selectedEvent.input_data !== undefined && baseCtx) {
                baseCtx._json = selectedEvent.input_data;
                baseCtx._input = this._buildInputContextFromValue(selectedEvent.input_data);
            }
            return baseCtx;
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
        const inferredMode = inferControlMode(control, value);
        const persistedMode = this.state.controlModes[controlKey];
        const hasValueSignal = typeof value === "string"
            ? value !== ""
            : value !== undefined && value !== null;

        if (hasValueSignal) {
            return inferredMode;
        }

        if (persistedMode === "fixed" || persistedMode === "expression") {
            return persistedMode;
        }

        return inferredMode;
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
     * Build _input context from a value (used for expression preview override).
     * @private
     */
    _buildInputContextFromValue(value) {
        const items = Array.isArray(value) ? value
            : (value === null || value === undefined) ? []
            : [value];
        const inputContext = {
            item: items.length ? items[0] : value,
            json: value,
            items,
        };
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            return { ...value, ...inputContext };
        }
        return inputContext;
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
        const control = this.state.controls.find(c => c.key === controlKey);
        const normalizedValue = normalizeControlValue(control, value);
        this.state.controlValues[controlKey] = normalizedValue;

        if (control) {
            control.value = normalizedValue;
            if (control.type === 'keyvalue') {
                this._reconcilePairModes(controlKey, normalizedValue);
            }
        }

        this._debouncedLocalSave();

        // Auto-update title for nodes that derive their name from config
        if (this.isAutoTitleNode && !this.props.node.titleIsCustom && this.actions.renameNode) {
            const autoTitle = this._computeRecordOperationAutoTitle();
            if (autoTitle) {
                this.actions.renameNode(this.props.node.id, autoTitle);
            }
        }
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

    get tabDefs() {
        return [
            { id: 'parameters', label: 'Parameters', icon: 'fa-sliders' },
            { id: 'settings',   label: 'Settings',   icon: 'fa-cog'     },
        ];
    }

    /**
     * User edits the node name in the Settings tab.
     * Persists the label and marks the title as user-customized so it
     * won't be overridden by auto-title logic.
     */
    onNodeNameChange(ev) {
        if (!this.actions.renameNode || !this.actions.setNodeMeta) return;
        const newLabel = ev.target.value.trim();
        const nodeId = this.props.node.id;
        if (!newLabel) {
            // Clearing the user title → revert to auto-title (remove custom flag)
            this.actions.setNodeMeta(nodeId, { ui: { titleIsCustom: false } });
            if (this.isAutoTitleNode) {
                const autoTitle = this._computeRecordOperationAutoTitle();
                if (autoTitle) {
                    this.actions.renameNode(nodeId, autoTitle);
                }
            }
        } else {
            this.actions.setNodeMeta(nodeId, { ui: { titleIsCustom: true } });
            this.actions.renameNode(nodeId, newLabel);
        }
    }

    /**
     * Reset the node title back to the auto-derived label (removes custom flag).
     */
    onResetNodeName() {
        if (!this.actions.renameNode || !this.actions.setNodeMeta) return;
        const nodeId = this.props.node.id;
        this.actions.setNodeMeta(nodeId, { ui: { titleIsCustom: false } });
        if (this.isAutoTitleNode) {
            const autoTitle = this._computeRecordOperationAutoTitle();
            if (autoTitle) {
                this.actions.renameNode(nodeId, autoTitle);
            }
        }
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
