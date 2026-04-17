/** @odoo-module **/

import { Component, useState, onMounted, onWillUnmount, onWillUpdateProps } from "@odoo/owl";
import { Dropdown } from "@web/core/dropdown/dropdown";
import { DropdownItem } from "@web/core/dropdown/dropdown_item";
import { useDropdownState } from "@web/core/dropdown/dropdown_hooks";
import { useService } from "@web/core/utils/hooks";
import { ControlRenderer } from "./control_renderer";
import { JsonTreeNode } from "./data_panel/JsonTreeNode";
import { TabNav } from "./primitives/tab_nav/tab_nav";
import { UrlBox } from "./primitives/url_box/url_box";
import { useOdooModels } from "@workflow_studio/utils/use_odoo_models";
import { inferExpressionModeFromValue } from "@workflow_studio/utils/expression_utils";
import {
    getLatestNodeResultsByNodeIds,
    getStructuralPredecessorIds,
} from "@workflow_studio/utils/graph_utils";

function normalizeTriggerFields(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .filter((item) => typeof item === "string" && item.trim())
        .map((item) => item.trim());
}

function formatDateTime(value) {
    if (!value || typeof value !== "string") {
        return "Never";
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return value;
    }

    return parsed.toLocaleString();
}

function inferControlMode(control, value) {
    if (inferExpressionModeFromValue(value)) {
        return "expression";
    }
    return "fixed";
}

function normalizeControlValue(control, value) {
    return value;
}

const TRIGGER_NODE_TYPES = new Set([
    "manual_trigger",
    "schedule_trigger",
    "webhook_trigger",
    "record_event_trigger",
]);

const SCHEDULE_INTERVAL_OPTIONS = ["minutes", "hours", "days", "weeks", "months"];
const WEBHOOK_METHOD_OPTIONS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const WEBHOOK_RESPONSE_OPTIONS = ["immediate", "last_node"];
const RECORD_EVENT_OPTIONS = ["on_create_or_write", "on_create", "on_write", "on_unlink"];

function makeSelectOptions(values) {
    return values.map((value) => ({ value, label: value }));
}

function buildFallbackTriggerControls(node) {
    const config = node && node.config ? node.config : {};
    switch (node.type) {
        case "schedule_trigger":
            return [
                {
                    key: "interval_number",
                    type: "number",
                    label: "Every",
                    value: config.interval_number || 1,
                    min: 1,
                },
                {
                    key: "interval_type",
                    type: "select",
                    label: "Unit",
                    value: config.interval_type || "hours",
                    options: makeSelectOptions(SCHEDULE_INTERVAL_OPTIONS),
                },
            ];
        case "webhook_trigger":
            return [
                {
                    key: "http_method",
                    type: "select",
                    label: "HTTP Method",
                    value: config.http_method || "POST",
                    section: "webhook",
                    options: makeSelectOptions(WEBHOOK_METHOD_OPTIONS),
                },
                {
                    key: "response_mode",
                    type: "select",
                    label: "Response Mode",
                    value: config.response_mode || "immediate",
                    section: "webhook",
                    options: makeSelectOptions(WEBHOOK_RESPONSE_OPTIONS),
                },
            ];
        case "record_event_trigger":
            return [
                {
                    key: "model_name",
                    type: "model_select",
                    label: "Model",
                    value: config.model_name || "",
                    placeholder: "res.partner",
                },
                {
                    key: "trigger_event",
                    type: "select",
                    label: "Trigger Event",
                    value: config.trigger_event || "on_create_or_write",
                    options: makeSelectOptions(RECORD_EVENT_OPTIONS),
                },
                {
                    key: "filter_domain",
                    type: "domain",
                    label: "Filter Domain",
                    value: typeof config.filter_domain === "string" ? config.filter_domain : "[]",
                },
            ];
        default:
            return [];
    }
}

/**
 * NodeConfigPanel Component
 *
 * Provides a configuration interface for a selected workflow node.
 * Uses adapterService for configuration operations and
 * runService for node/workflow execution.
 */
export class NodeConfigPanel extends Component {
    static template = "workflow_studio.ConfigPanel";
    static components = { ControlRenderer, Dropdown, DropdownItem, JsonTreeNode, TabNav, UrlBox };
    static subTemplates = {
        header: "workflow_studio.ConfigPanel.Header",
        input: "workflow_studio.ConfigPanel.Input",
        config: "workflow_studio.ConfigPanel.Config",
        output: "workflow_studio.ConfigPanel.Output",
        genericConfig: "workflow_studio.ConfigPanel.GenericConfig",
        triggerConfig: "workflow_studio.ConfigPanel.TriggerConfig",
        triggerManual: "workflow_studio.ConfigPanel.TriggerConfig.Manual",
        triggerSchedule: "workflow_studio.ConfigPanel.TriggerConfig.Schedule",
        triggerWebhook: "workflow_studio.ConfigPanel.TriggerConfig.Webhook",
        triggerRecordEvent: "workflow_studio.ConfigPanel.TriggerConfig.RecordEvent",
    };

    static props = {
        node: { type: Object },  // Required: node data object (plain, no _node)
        workflow: { type: Object, optional: true },  // { nodes: [], connections: [] }
        actions: { type: Object },
        onClose: { type: Function },
        onSave: { type: Function },
        onExecute: { type: Function, optional: true },  // Callback after node execution
        onNavigateToNode: { type: Function, optional: true },
        execution: { type: Object, optional: true },
        previousNavigation: { type: Object, optional: true },
        nextNavigation: { type: Object, optional: true },
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

        this.notification = useService("notification");
        this.fieldService = useService("field");
        this.workflowEditor = useService("workflowEditor");

        // Kick off background fetch of Odoo model list for model_select controls.
        // getOdooModels() returns cached list immediately (fallback during fetch).
        this._odooModels = useOdooModels();
        this._triggerPollTimer = null;

        this.state = useState({
            activeTab: 'parameters',  // 'parameters' | 'output'
            controlValues: {},  // Local copy of control values
            controls: [],  // Control metadata from adapter
            // Expression UI modes (persisted in node.meta.ui)
            controlModes: {},  // { [controlKey]: 'fixed' | 'expression' }
            pairModes: {},  // { [controlKey]: { [pairId]: { key, value } } }
            // Collapsed ancestor sections
            collapsedSections: {},  // { nodeId: true/false }
            // Lazy-loaded record ref details cache.
            // Key format: `${model}:${id}`
            recordRefCache: {},
            // Version/socket selection for output display
            selectedOutputSocket: null,  // null = first available socket
            selectedExecutionVersion: null,  // null = latest version
            pinBusy: false,
            triggerLoading: false,
            triggerBusy: false,
            activeWebhookTab: "production",
            triggerPanelData: null,
            triggerFieldSuggestions: [],
            triggerErrorMessage: "",
            execution: this.props.execution || null,
            navActiveOptionKeys: {
                previous: null,
                next: null,
            },
            navMenuMetrics: {
                previous: { triggerWidth: 0 },
                next: { triggerWidth: 0 },
            },
        });

        this._saveDebounceTimer = null;
        this.previousNavDropdownState = useDropdownState();
        this.nextNavDropdownState = useDropdownState();
        this._navMenuCloseTimers = {
            previous: null,
            next: null,
        };

        // Initialize control values from adapter
        onMounted(async () => {
            this.initControlValues();
            if (this.isTriggerNode) {
                await this._bootstrapTriggerPanel(this.props.node);
            } else {
                this._resetTriggerState();
            }
        });

        onWillUpdateProps(async (nextProps) => {
            if (nextProps.node.id !== this.props.node.id) {
                this.state.activeTab = "parameters";
                this.state.controlValues = {};
                this.state.controls = [];
                this.state.controlModes = {};
                this.state.pairModes = {};
                this.state.recordRefCache = {};
                this.state.selectedOutputSocket = null;
                this.state.selectedExecutionVersion = null;
                this.state.navActiveOptionKeys.previous = null;
                this.state.navActiveOptionKeys.next = null;
                this.initControlValues(nextProps.node);
                if (TRIGGER_NODE_TYPES.has(nextProps.node.type)) {
                    await this._bootstrapTriggerPanel(nextProps.node);
                } else {
                    this._resetTriggerState();
                }
            }
        });

        onWillUnmount(() => {
            this._stopTriggerPolling();
            this._clearAllNavMenuCloseTimers();
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
        let controls = this.actions.getControls(nodeId);
        if (TRIGGER_NODE_TYPES.has(targetNode.type) && (!Array.isArray(controls) || controls.length === 0)) {
            controls = buildFallbackTriggerControls(targetNode);
        }
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
        if (targetNode.type === "record_event_trigger") {
            values.trigger_fields = normalizeTriggerFields(targetNode.config && targetNode.config.trigger_fields);
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
        const controls = raw.map((ctrl) => {
            if (ctrl.type === "model_select") {
                return { ...ctrl, suggestions: this._getModelSuggestions() };
            }
            return ctrl;
        });

        if (this.isRecordEventTrigger && this.showTriggerFields) {
            controls.push({
                key: "trigger_fields",
                type: "trigger_fields",
                label: "Watch only these updated fields",
                section: "filters",
                suggestions: this.triggerFieldSuggestions,
                value: normalizeTriggerFields(this.state.controlValues.trigger_fields),
            });
        }

        return controls;
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
            trigger: 'fa-bolt',
            webhook: 'fa-link',
            filters: 'fa-filter',
            runtime: 'fa-play-circle',
            request: 'fa-globe',
            authentication: 'fa-lock',
            body: 'fa-file-text-o',
            headers: 'fa-list-ul',
            settings: 'fa-cog',
        };
        return icons[section] || 'fa-cube';
    }

    formatSectionName(section) {
        if (section === "webhook") {
            return "Webhook";
        }
        if (section === "filters") {
            return "Filters";
        }
        if (section === "trigger") {
            return "Trigger";
        }
        return section.charAt(0).toUpperCase() + section.slice(1);
    }

    get nodeTitle() {
        if (this.props.node.type === 'record_operation' && !this.props.node.titleIsCustom) {
            return this._computeRecordOperationAutoTitle() || this.props.node.title || this.props.node.type || 'Node Configuration';
        }
        return this.props.node.title || this.props.node.type || 'Node Configuration';
    }

    get canEditNodeTitle() {
        return !this.isExecutionView;
    }

    /**
     * Value shown in the Settings > Node Name input.
     * For auto-titled nodes shows the computed label; for custom-titled shows the stored title.
     */
    get nodeNameInputValue() {
        return this.nodeTitle || '';
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

    get isTriggerNode() {
        return TRIGGER_NODE_TYPES.has(this.props.node.type);
    }

    get isManualTrigger() {
        return this.props.node.type === "manual_trigger";
    }

    get isScheduleTrigger() {
        return this.props.node.type === "schedule_trigger";
    }

    get isWebhookTrigger() {
        return this.props.node.type === "webhook_trigger";
    }

    get isRecordEventTrigger() {
        return this.props.node.type === "record_event_trigger";
    }

    get triggerPanelData() {
        return this.state.triggerPanelData;
    }

    get backendState() {
        const panelData = this.triggerPanelData;
        if (panelData && panelData.backend) {
            return panelData.backend;
        }
        return {
            active: false,
            workflow_is_published: false,
            workflow_is_activated: false,
            trigger_count: 0,
            webhook_test_active: false,
        };
    }

    get warnings() {
        const panelData = this.triggerPanelData;
        if (panelData && Array.isArray(panelData.warnings)) {
            return panelData.warnings;
        }
        return [];
    }

    get triggerHeaderSummary() {
        if (!this.isTriggerNode) {
            return "";
        }
        const triggerCount = this.backendState.trigger_count || 0;
        const triggerLabel = triggerCount === 1 ? "time" : "times";
        return `Triggered ${triggerCount} ${triggerLabel} • ${this.workflowStatusLabel} • ${this.workflowActivationLabel}`;
    }

    get triggerHeaderStatusLabel() {
        if (!this.isTriggerNode) {
            return "";
        }
        return this.backendState.active ? "Active" : "Inactive";
    }

    get triggerHeaderStatusClass() {
        return this.backendState.active ? "is-active" : "is-inactive";
    }

    get triggerHeaderButtons() {
        if (!this.isTriggerNode) {
            return [];
        }

        const buttons = [];
        const isDisabled = this.state.triggerBusy || this.state.triggerLoading;

        if (this.isManualTrigger && !this.isExecutionView) {
            buttons.push({
                id: "execute-trigger",
                label: "Execute trigger",
                icon: "fa-play",
                className: "btn-success",
                disabled: isDisabled,
                onClick: () => this.onExecuteManualTrigger(),
            });
        }

        if (!this.isManualTrigger && !this.isExecutionView) {
            buttons.push({
                id: "toggle-activation",
                label: this.backendState.active ? "Deactivate" : "Activate",
                icon: this.backendState.active ? "fa-pause" : "fa-bolt",
                className: "btn-primary",
                disabled: isDisabled,
                onClick: () => this.onToggleTriggerActivation(),
            });
        }

        if (this.hasOpenBackendAction && !this.isExecutionView) {
            buttons.push({
                id: "open-backend-record",
                label: "Open backend record",
                icon: "fa-external-link",
                className: "btn-outline-secondary",
                disabled: isDisabled,
                onClick: () => this.onOpenTriggerBackendRecord(),
            });
        }

        return buttons;
    }

    get workflowStatusLabel() {
        return this.backendState.workflow_is_published ? "Published" : "Draft";
    }

    get workflowActivationLabel() {
        return this.backendState.workflow_is_activated ? "Workflow live" : "Workflow paused";
    }

    get webhookUrlTabs() {
        return [
            { id: "production", label: "Production", icon: "fa-link" },
            { id: "test", label: "Test", icon: "fa-flask" },
        ];
    }

    get isProductionWebhookTab() {
        return this.state.activeWebhookTab === "production";
    }

    get isTestWebhookTab() {
        return this.state.activeWebhookTab === "test";
    }

    get hasWebhookTestPayload() {
        const payload = this.backendState.webhook_last_test_payload;
        return payload !== undefined && payload !== null && payload !== false;
    }

    get lastTestTriggerLabel() {
        if (!this.backendState.webhook_last_test_triggered) {
            return "No test payload received yet";
        }
        return formatDateTime(this.backendState.webhook_last_test_triggered);
    }

    get triggerOutputTitle() {
        if (this.isWebhookTrigger) {
            return "Test output";
        }
        if (this.isManualTrigger) {
            return "Run notes";
        }
        return "Runtime status";
    }

    get triggerOutputSubtitle() {
        if (this.isWebhookTrigger) {
            return this.backendState.webhook_test_active
                ? "Waiting for the next test webhook call."
                : "Captured payloads from the temporary test listener appear here.";
        }
        if (this.isManualTrigger) {
            return "Use the manual execute action when you want to kick off the workflow from this node.";
        }
        return "Linked backend records and recent runtime activity stay visible here.";
    }

    get showTriggerFields() {
        const eventType = this.state.controlValues.trigger_event;
        return eventType === "on_create_or_write" || eventType === "on_write";
    }

    get hasOpenBackendAction() {
        return this.isScheduleTrigger || this.isRecordEventTrigger || this.isWebhookTrigger;
    }

    get triggerGroupedControls() {
        if (!this.isTriggerNode) {
            return [];
        }
        return this.groupedControls;
    }

    get triggerFieldSuggestions() {
        return this.state.triggerFieldSuggestions || [];
    }

    get previousNavigation() {
        return this.props.previousNavigation || {
            heading: "Previous",
            hasMultiple: false,
            hasOptions: false,
            primary: null,
            options: [],
            summaryTitle: "No previous node",
            summaryMeta: "This node has no incoming connections",
        };
    }

    get nextNavigation() {
        return this.props.nextNavigation || {
            heading: "Next",
            hasMultiple: false,
            hasOptions: false,
            primary: null,
            options: [],
            summaryTitle: "No next node",
            summaryMeta: "This node has no outgoing connections",
        };
    }

    get showHeaderExecute() {
        return !this.isExecutionView && !this.isTriggerNode;
    }

    get showHeaderRail() {
        return this.showHeaderExecute || !!this.props.onNavigateToNode;
    }

    getNavDropdownState(direction) {
        return direction === "next" ? this.nextNavDropdownState : this.previousNavDropdownState;
    }

    getNavModel(direction) {
        return direction === "next" ? this.nextNavigation : this.previousNavigation;
    }

    getPrimaryNavigationOption(direction) {
        const navigation = this.getNavModel(direction);
        if (navigation.primary) {
            return navigation.primary;
        }
        if (Array.isArray(navigation.options) && navigation.options.length) {
            return navigation.options[0];
        }
        return null;
    }

    getNavMenuStyle(direction) {
        const triggerWidth = this.state.navMenuMetrics[direction]
            ? this.state.navMenuMetrics[direction].triggerWidth || 0
            : 0;
        const minWidth = Math.max(220, triggerWidth);
        return `min-width: ${minWidth}px; max-width: min(340px, calc(100vw - 24px));`;
    }

    getNavItemAttrs(direction, option) {
        return {
            "data-nav-direction": direction,
            "data-nav-key": String(option && option.key ? option.key : ""),
        };
    }

    getNavItemClass(direction, option) {
        const classes = ["ncp-nav-dd-item"];
        if (this.isNavOptionActive(direction, option)) {
            classes.push("is-active");
        }
        return classes.join(" ");
    }

    isNavOptionActive(direction, option) {
        if (!option) {
            return false;
        }
        return this.state.navActiveOptionKeys[direction] === option.key;
    }

    isPrimaryNavOption(direction, option) {
        const primary = this.getPrimaryNavigationOption(direction);
        return !!(primary && option && primary.key === option.key);
    }

    onNavTriggerMouseEnter(direction, ev) {
        const navigation = this.getNavModel(direction);
        if (!navigation.hasMultiple) {
            return;
        }
        this._captureNavTriggerMetrics(direction, ev.currentTarget);
        this._clearNavMenuCloseTimer(direction);
        this._primeNavActiveOption(direction);

        const otherDirection = direction === "next" ? "previous" : "next";
        this._clearNavMenuCloseTimer(otherDirection);
        this.getNavDropdownState(otherDirection).close();
        this.getNavDropdownState(direction).open();
    }

    onNavTriggerMouseLeave(direction) {
        this._scheduleNavMenuClose(direction);
    }

    onNavMenuMouseEnter(direction) {
        this._clearNavMenuCloseTimer(direction);
        this._primeNavActiveOption(direction);
    }

    onNavMenuMouseOver(direction, ev) {
        const item = ev.target instanceof Element
            ? ev.target.closest(".ncp-nav-dd-item[data-nav-key]")
            : null;
        if (!item) {
            return;
        }
        const key = item.dataset.navKey;
        if (!key || this.state.navActiveOptionKeys[direction] === key) {
            return;
        }
        this.state.navActiveOptionKeys[direction] = key;
    }

    onNavMenuMouseLeave(direction) {
        this._scheduleNavMenuClose(direction);
    }

    onNavDropdownOpened(direction) {
        this._primeNavActiveOption(direction);
        this._focusActiveNavItem(direction);
    }

    onPrimaryNavClick(direction, ev) {
        const primary = this.getPrimaryNavigationOption(direction);
        if (!primary) {
            return;
        }
        this._captureNavTriggerMetrics(direction, ev.currentTarget);
        this._primeNavActiveOption(direction);
        this.getNavDropdownState(direction).close();
        this.onNavigateToNode(primary.nodeId);
    }

    onNavOptionSelected(direction, option) {
        if (!option) {
            return;
        }
        this.state.navActiveOptionKeys[direction] = option.key;
        this.onNavigateToNode(option.nodeId);
    }

    _primeNavActiveOption(direction) {
        const primary = this.getPrimaryNavigationOption(direction);
        this.state.navActiveOptionKeys[direction] = primary ? primary.key : null;
    }

    _focusActiveNavItem(direction) {
        window.requestAnimationFrame(() => {
            const activeItem = this._findActiveNavItem(direction) || this._findPrimaryNavItem(direction);
            if (!activeItem) {
                return;
            }
            activeItem.focus();
            activeItem.scrollIntoView({ block: "nearest" });
        });
    }

    _findActiveNavItem(direction) {
        const activeKey = this.state.navActiveOptionKeys[direction];
        if (!activeKey) {
            return null;
        }
        return this._findNavItemByKey(direction, activeKey);
    }

    _findPrimaryNavItem(direction) {
        const primary = this.getPrimaryNavigationOption(direction);
        if (!primary) {
            return null;
        }
        return this._findNavItemByKey(direction, primary.key);
    }

    _findNavItemByKey(direction, key) {
        const items = document.querySelectorAll(`.ncp-nav-popover--${direction} .ncp-nav-dd-item[data-nav-key]`);
        for (const item of items) {
            if (item instanceof HTMLElement && item.dataset.navKey === String(key)) {
                return item;
            }
        }
        return null;
    }

    _captureNavTriggerMetrics(direction, target) {
        if (!(target instanceof HTMLElement)) {
            return;
        }
        const rect = target.getBoundingClientRect();
        this.state.navMenuMetrics[direction] = {
            triggerWidth: Math.ceil(rect.width),
        };
    }

    _scheduleNavMenuClose(direction) {
        this._clearNavMenuCloseTimer(direction);
        this._navMenuCloseTimers[direction] = setTimeout(() => {
            this.getNavDropdownState(direction).close();
        }, 140);
    }

    _clearNavMenuCloseTimer(direction) {
        if (this._navMenuCloseTimers[direction]) {
            clearTimeout(this._navMenuCloseTimers[direction]);
            this._navMenuCloseTimers[direction] = null;
        }
    }

    _clearAllNavMenuCloseTimers() {
        this._clearNavMenuCloseTimer("previous");
        this._clearNavMenuCloseTimer("next");
    }

    // ============================================
    // EXECUTION
    // ============================================

    get canExecute() {
        // All nodes should be executable via adapter
        return true;
    }

    get executionStatus() {
        const execution = this.state.execution;
        if (execution && execution.status === 'failed') return 'error';
        const runResult = this.executionNodeResult;
        if (!runResult) return 'idle';
        if (runResult.error_message) return 'error';
        return 'success';
    }

    get executionStatusLabel() {
        const execution = this.state.execution;
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
        const execution = this.state.execution;
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
                : (socketKey === '_default' ? '' : socketKey);
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
        const execution = this.state.execution;

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

    _resetTriggerState() {
        this._stopTriggerPolling();
        this.state.triggerLoading = false;
        this.state.triggerBusy = false;
        this.state.activeWebhookTab = "production";
        this.state.triggerPanelData = null;
        this.state.triggerFieldSuggestions = [];
        this.state.triggerErrorMessage = "";
    }

    async _bootstrapTriggerPanel(node) {
        this._resetTriggerState();
        this.state.triggerLoading = true;
        this.state.activeWebhookTab = "production";
        this.state.triggerErrorMessage = "";
        await this._loadTriggerFieldSuggestions(this.state.controlValues.model_name);
        await this._reloadTriggerPanelData(node.id);
    }

    async _reloadTriggerPanelData(nodeId) {
        try {
            const data = await this.actions.getTriggerPanelData(nodeId);
            this.state.triggerPanelData = data;
            this.state.triggerErrorMessage = "";
            this._syncTriggerPolling();
        } catch (error) {
            this.state.triggerErrorMessage = error && error.message ? error.message : "Failed to load trigger state.";
            this.state.triggerPanelData = null;
            this._stopTriggerPolling();
        } finally {
            this.state.triggerLoading = false;
        }
    }

    async _loadTriggerFieldSuggestions(modelName) {
        const safeModel = typeof modelName === "string" ? modelName.trim() : "";
        if (!safeModel) {
            this.state.triggerFieldSuggestions = [];
            return;
        }
        try {
            const defs = await this.fieldService.loadFields(safeModel);
            this.state.triggerFieldSuggestions = Object.entries(defs)
                .map(([name, definition]) => ({
                    value: name,
                    name,
                    label: definition && definition.string ? definition.string : name,
                    type: definition && definition.type ? definition.type : "unknown",
                }))
                .sort((left, right) => left.name.localeCompare(right.name));
        } catch {
            this.state.triggerFieldSuggestions = [];
        }
    }

    _syncTriggerPolling() {
        if (this.isWebhookTrigger && this.backendState.webhook_test_active) {
            if (this._triggerPollTimer) {
                return;
            }
            this._triggerPollTimer = setInterval(() => {
                this._reloadTriggerPanelData(this.props.node.id);
            }, 2000);
            return;
        }
        this._stopTriggerPolling();
    }

    _stopTriggerPolling() {
        if (this._triggerPollTimer) {
            clearInterval(this._triggerPollTimer);
            this._triggerPollTimer = null;
        }
    }

    async _saveWorkflowForTriggerRuntime() {
        this._syncToAdapter();
        await this.actions.saveWorkflow();
    }

    async _runTriggerRuntimeAction(callback, fallbackErrorMessage) {
        if (this.state.triggerBusy || this.isExecutionView) {
            return;
        }
        this.state.triggerBusy = true;
        this.state.triggerErrorMessage = "";
        try {
            await this._saveWorkflowForTriggerRuntime();
            const data = await callback();
            this.state.triggerPanelData = data;
            this._syncTriggerPolling();
        } catch (error) {
            this.state.triggerErrorMessage = error && error.message ? error.message : fallbackErrorMessage;
            this.notification.add(this.state.triggerErrorMessage, { type: "danger" });
        } finally {
            this.state.triggerBusy = false;
        }
    }

    onWebhookTabClick(tabId) {
        this.state.activeWebhookTab = tabId;
    }

    async onToggleTriggerActivation() {
        await this._runTriggerRuntimeAction(() => {
            if (this.backendState.active) {
                return this.actions.deactivateTriggerNode(this.props.node.id);
            }
            return this.actions.activateTriggerNode(this.props.node.id);
        }, "Trigger action failed.");
    }

    async onRotateTriggerWebhook() {
        await this._runTriggerRuntimeAction(
            () => this.actions.rotateTriggerWebhook(this.props.node.id),
            "Failed to rotate webhook URL."
        );
    }

    async onStartWebhookTest() {
        await this._runTriggerRuntimeAction(
            () => this.actions.startTriggerWebhookTest(this.props.node.id),
            "Failed to start webhook test listener."
        );
    }

    async onStopWebhookTest() {
        if (this.state.triggerBusy || this.isExecutionView) {
            return;
        }
        this.state.triggerBusy = true;
        try {
            const data = await this.actions.stopTriggerWebhookTest(this.props.node.id);
            this.state.triggerPanelData = data;
            this._syncTriggerPolling();
        } catch (error) {
            this.state.triggerErrorMessage = error && error.message ? error.message : "Failed to stop test listener.";
            this.notification.add(this.state.triggerErrorMessage, { type: "danger" });
        } finally {
            this.state.triggerBusy = false;
        }
    }

    async onExecuteManualTrigger() {
        if (this.state.triggerBusy || this.isExecutionView) {
            return;
        }
        this.state.triggerBusy = true;
        try {
            await this._saveWorkflowForTriggerRuntime();
            await this.actions.executeFromNode(this.props.node.id, {});
            await this._reloadTriggerPanelData(this.props.node.id);
        } catch (error) {
            this.state.triggerErrorMessage = error && error.message ? error.message : "Manual trigger execution failed.";
            this.notification.add(this.state.triggerErrorMessage, { type: "danger" });
        } finally {
            this.state.triggerBusy = false;
        }
    }

    async onOpenTriggerBackendRecord() {
        if (this.isExecutionView) {
            return;
        }
        try {
            await this._saveWorkflowForTriggerRuntime();
            await this.actions.openTriggerNodeRecord(this.props.node.id);
        } catch (error) {
            this.state.triggerErrorMessage = error && error.message ? error.message : "Failed to open backend record.";
            this.notification.add(this.state.triggerErrorMessage, { type: "danger" });
        }
    }

    copyToClipboard = async (value, label) => {
        if (!value) {
            return;
        }
        await this.workflowEditor.copyText(value, { label });
    };

    onNavigateToNode(nodeId) {
        const onNavigateToNode = this.props.onNavigateToNode;
        if (!onNavigateToNode || !nodeId) {
            return;
        }
        this._clearAllNavMenuCloseTimers();
        this.previousNavDropdownState.close();
        this.nextNavDropdownState.close();
        onNavigateToNode(nodeId);
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
        const execution = this.state.execution;
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
        const execution = this.state.execution;
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
        this.state.execution = this.workflowEditor.getExecutionResults();
    }

    // ============================================
    // EVENT HANDLERS
    // ============================================

    onControlChange = async (controlKey, value) => {
        const control = this.state.controls.find(c => c.key === controlKey);
        const previousValue = this.state.controlValues[controlKey];
        const normalizedValue = normalizeControlValue(control, value);
        this.state.controlValues[controlKey] = normalizedValue;

        if (control) {
            control.value = normalizedValue;
            if (control.type === 'keyvalue') {
                this._reconcilePairModes(controlKey, normalizedValue);
            }
        }

        if (this.isRecordEventTrigger && controlKey === "model_name" && normalizedValue !== previousValue) {
            this.state.controlValues.trigger_fields = [];
            await this._loadTriggerFieldSuggestions(normalizedValue);
        }

        if (this.isRecordEventTrigger && controlKey === "trigger_event" && !this.showTriggerFields) {
            this.state.controlValues.trigger_fields = [];
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
}
