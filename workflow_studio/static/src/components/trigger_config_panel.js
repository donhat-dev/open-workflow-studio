/** @odoo-module **/

import { Component, onMounted, onWillUnmount, onWillUpdateProps, useState } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";
import { useOdooModels } from "@workflow_studio/utils/use_odoo_models";
import { JsonTreeNode } from "./data_panel/JsonTreeNode";
import { DomainControl } from "./domain_control/domain_control";
import { TabNav } from "./primitives/tab_nav/tab_nav";
import { UrlBox } from "./primitives/url_box/url_box";

const SCHEDULE_INTERVAL_OPTIONS = [
    { value: "minutes", label: "Minutes" },
    { value: "hours", label: "Hours" },
    { value: "days", label: "Days" },
    { value: "weeks", label: "Weeks" },
    { value: "months", label: "Months" },
];

const WEBHOOK_METHOD_OPTIONS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const WEBHOOK_RESPONSE_OPTIONS = [
    { value: "immediate", label: "Immediately" },
    { value: "last_node", label: "When last node finishes" },
];
const RECORD_EVENT_OPTIONS = [
    { value: "on_create_or_write", label: "On save (create or update)" },
    { value: "on_create", label: "On creation" },
    { value: "on_write", label: "On update" },
    { value: "on_unlink", label: "On deletion" },
];

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

export class TriggerConfigPanel extends Component {
    static template = "workflow_studio.trigger_config_panel";
    static components = { DomainControl, JsonTreeNode, TabNav, UrlBox };

    static props = {
        node: { type: Object },
        actions: { type: Object },
        workflow: { type: Object, optional: true },
        execution: { type: Object, optional: true },
        viewMode: { type: String, optional: true },
        onHeaderStateChange: { type: Function, optional: true },
        onClose: { type: Function, optional: true },
        onSave: { type: Function, optional: true },
    };

    setup() {
        this.actions = this.props.actions;
        if (!this.actions) {
            throw new Error("[TriggerConfigPanel] Missing actions prop");
        }

        this.notification = useService("notification");
        this.fieldService = useService("field");
        this.workflowEditor = useService("workflowEditor");
        this._odooModels = useOdooModels();
        this._pollTimer = null;

        this.state = useState({
            loading: true,
            busy: false,
            activeWebhookTab: "production",
            values: this._normalizeConfig(this.props.node),
            panelData: null,
            fieldSuggestions: [],
            errorMessage: "",
            recordRefCache: {},
        });

        this._headerNotifyTimer = null;

        onMounted(async () => {
            await this._bootstrap(this.props.node);
        });

        onWillUpdateProps(async (nextProps) => {
            if (nextProps.node.id !== this.props.node.id) {
                await this._bootstrap(nextProps.node);
            }
        });

        onWillUnmount(() => {
            this._stopPolling();
            clearTimeout(this._headerNotifyTimer);
            this._headerNotifyTimer = null;
        });
    }

    _normalizeConfig(node) {
        const config = node && node.config ? { ...node.config } : {};
        if (node.type === "schedule_trigger") {
            return {
                interval_number: config.interval_number || 1,
                interval_type: config.interval_type || "hours",
            };
        }
        if (node.type === "webhook_trigger") {
            return {
                http_method: config.http_method || "POST",
                response_mode: config.response_mode || "immediate",
            };
        }
        if (node.type === "record_event_trigger") {
            return {
                model_name: config.model_name || "",
                trigger_event: config.trigger_event || "on_create_or_write",
                filter_domain: typeof config.filter_domain === "string" ? config.filter_domain : "[]",
                trigger_fields: normalizeTriggerFields(config.trigger_fields),
            };
        }
        return {};
    }

    async _bootstrap(node) {
        this._stopPolling();
        this.state.loading = true;
        this.state.busy = false;
        this.state.errorMessage = "";
        this.state.activeWebhookTab = "production";
        this.state.values = this._normalizeConfig(node);
        this.state.panelData = null;
        this.state.fieldSuggestions = [];
        this.state.recordRefCache = {};
        this._notifyHeaderState();
        this._syncNodeConfig();
        await this._loadFieldSuggestions(this.state.values.model_name);
        await this._reloadPanelData(node.id);
    }

    async _reloadPanelData(nodeId) {
        try {
            const data = await this.props.actions.getTriggerPanelData(nodeId);
            this.state.panelData = data;
            this.state.errorMessage = "";
            this._syncPolling();
        } catch (error) {
            this.state.errorMessage = error && error.message ? error.message : "Failed to load trigger state.";
            this.state.panelData = null;
            this._stopPolling();
        } finally {
            this.state.loading = false;
            this._notifyHeaderState();
        }
    }

    _notifyHeaderState() {
        if (!this.props.onHeaderStateChange) {
            return;
        }
        // Defer to next tick to avoid mutating parent state during render cycle
        // (direct call would cause OWL infinite re-render cascade).
        clearTimeout(this._headerNotifyTimer);
        this._headerNotifyTimer = setTimeout(() => {
            this._headerNotifyTimer = null;
            if (!this.props.onHeaderStateChange) {
                return;
            }
            this.props.onHeaderStateChange({
                summary: this.headerSummary,
                statusLabel: this.backendState.active ? "Active" : "Inactive",
                statusActive: !!this.backendState.active,
                buttons: this.headerButtons,
            });
        }, 0);
    }

    _syncNodeConfig() {
        this.props.actions.setNodeConfig(this.props.node.id, { ...this.state.values });
    }

    async _loadFieldSuggestions(modelName) {
        const safeModel = typeof modelName === "string" ? modelName.trim() : "";
        if (!safeModel) {
            this.state.fieldSuggestions = [];
            return;
        }
        try {
            const defs = await this.fieldService.loadFields(safeModel);
            this.state.fieldSuggestions = Object.entries(defs)
                .map(([name, definition]) => ({
                    name,
                    label: definition && definition.string ? definition.string : name,
                    type: definition && definition.type ? definition.type : "unknown",
                }))
                .sort((left, right) => left.name.localeCompare(right.name));
        } catch {
            this.state.fieldSuggestions = [];
        }
    }

    _syncPolling() {
        const backend = this.backendState;
        if (this.isWebhookTrigger && backend.webhook_test_active) {
            if (this._pollTimer) {
                return;
            }
            this._pollTimer = setInterval(() => {
                this._reloadPanelData(this.props.node.id);
            }, 2000);
            return;
        }
        this._stopPolling();
    }

    _stopPolling() {
        if (this._pollTimer) {
            clearInterval(this._pollTimer);
            this._pollTimer = null;
        }
    }

    async _saveWorkflowForRuntime() {
        this._syncNodeConfig();
        await this.props.actions.saveWorkflow();
    }

    async _runRuntimeAction(callback) {
        if (this.state.busy || this.isReadonly) {
            return;
        }
        this.state.busy = true;
        this.state.errorMessage = "";
        this._notifyHeaderState();
        try {
            await this._saveWorkflowForRuntime();
            const data = await callback();
            this.state.panelData = data;
            this._syncPolling();
        } catch (error) {
            this.state.errorMessage = error && error.message ? error.message : "Trigger action failed.";
            this.notification.add(this.state.errorMessage, { type: "danger" });
        } finally {
            this.state.busy = false;
            this._notifyHeaderState();
        }
    }

    get backendState() {
        const panelData = this.state.panelData;
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
        const panelData = this.state.panelData;
        if (panelData && Array.isArray(panelData.warnings)) {
            return panelData.warnings;
        }
        return [];
    }

    get isReadonly() {
        return this.props.viewMode === "execution";
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

    get modelSuggestions() {
        return this._odooModels.getOdooModels();
    }

    get scheduleIntervalOptions() {
        return SCHEDULE_INTERVAL_OPTIONS;
    }

    get webhookMethodOptions() {
        return WEBHOOK_METHOD_OPTIONS;
    }

    get webhookResponseOptions() {
        return WEBHOOK_RESPONSE_OPTIONS;
    }

    get recordEventOptions() {
        return RECORD_EVENT_OPTIONS;
    }

    get modelDatalistId() {
        return `wf-trigger-models-${this.props.node.id}`;
    }

    get lastTestTriggerLabel() {
        if (!this.backendState.webhook_last_test_triggered) {
            return "No test payload received yet";
        }
        return formatDateTime(this.backendState.webhook_last_test_triggered);
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

    get headerSummary() {
        const triggerCount = this.backendState.trigger_count || 0;
        const triggerLabel = triggerCount === 1 ? "time" : "times";
        return `Triggered ${triggerCount} ${triggerLabel} • ${this.workflowStatusLabel} • ${this.workflowActivationLabel}`;
    }

    get headerButtons() {
        const buttons = [];
        const isDisabled = this.state.busy || this.state.loading;

        if (this.isManualTrigger && !this.isReadonly) {
            buttons.push({
                id: "execute-trigger",
                label: "Execute trigger",
                icon: "fa-play",
                className: "btn-success",
                disabled: isDisabled,
                onClick: () => this.onExecuteManualTrigger(),
            });
        }

        if (!this.isManualTrigger && !this.isReadonly) {
            buttons.push({
                id: "toggle-activation",
                label: this.backendState.active ? "Deactivate" : "Activate",
                icon: this.backendState.active ? "fa-pause" : "fa-bolt",
                className: "btn-primary",
                disabled: isDisabled,
                onClick: () => this.onToggleActivation(),
            });
        }

        if (this.hasOpenBackendAction && !this.isReadonly) {
            buttons.push({
                id: "open-backend-record",
                label: "Open backend record",
                icon: "fa-external-link",
                className: "btn-outline-secondary",
                disabled: isDisabled,
                onClick: () => this.onOpenBackendRecord(),
            });
        }

        return buttons;
    }

    get showTriggerFields() {
        const eventType = this.state.values.trigger_event;
        return eventType === "on_create_or_write" || eventType === "on_write";
    }

    get hasOpenBackendAction() {
        return this.isScheduleTrigger || this.isRecordEventTrigger || this.isWebhookTrigger;
    }

    onRecordRefCachePatch = (patch) => {
        if (!patch || typeof patch !== "object") {
            return;
        }
        this.state.recordRefCache = {
            ...(this.state.recordRefCache || {}),
            ...patch,
        };
    };

    updateValue(key, value) {
        this.state.values = {
            ...this.state.values,
            [key]: value,
        };
        this._syncNodeConfig();
    }

    onTextInput(key, ev) {
        this.updateValue(key, ev.target.value);
    }

    onIntervalNumberChange(ev) {
        const rawValue = parseInt(ev.target.value, 10);
        const intervalNumber = isNaN(rawValue) ? 1 : Math.max(1, rawValue);
        this.updateValue("interval_number", intervalNumber);
    }

    async onModelNameChange(ev) {
        const modelName = ev.target.value;
        this.updateValue("model_name", modelName);
        this.updateValue("trigger_fields", []);
        await this._loadFieldSuggestions(modelName);
    }

    onToggleTriggerField(fieldName, ev) {
        const selected = new Set(normalizeTriggerFields(this.state.values.trigger_fields));
        if (ev.target.checked) {
            selected.add(fieldName);
        } else {
            selected.delete(fieldName);
        }
        this.updateValue("trigger_fields", Array.from(selected));
    }

    onFilterDomainChange = (domain) => {
        this.updateValue("filter_domain", domain);
    };

    onWebhookTabClick(tabId) {
        this.state.activeWebhookTab = tabId;
    }

    async onToggleActivation() {
        await this._runRuntimeAction(() => {
            if (this.backendState.active) {
                return this.props.actions.deactivateTriggerNode(this.props.node.id);
            }
            return this.props.actions.activateTriggerNode(this.props.node.id);
        });
    }

    async onRotateWebhook() {
        await this._runRuntimeAction(() => this.props.actions.rotateTriggerWebhook(this.props.node.id));
    }

    async onStartWebhookTest() {
        await this._runRuntimeAction(() => this.props.actions.startTriggerWebhookTest(this.props.node.id));
    }

    async onStopWebhookTest() {
        if (this.state.busy || this.isReadonly) {
            return;
        }
        this.state.busy = true;
        this._notifyHeaderState();
        try {
            const data = await this.props.actions.stopTriggerWebhookTest(this.props.node.id);
            this.state.panelData = data;
            this._syncPolling();
        } catch (error) {
            this.state.errorMessage = error && error.message ? error.message : "Failed to stop test listener.";
            this.notification.add(this.state.errorMessage, { type: "danger" });
        } finally {
            this.state.busy = false;
            this._notifyHeaderState();
        }
    }

    async onExecuteManualTrigger() {
        if (this.state.busy || this.isReadonly) {
            return;
        }
        this.state.busy = true;
        this._notifyHeaderState();
        try {
            await this._saveWorkflowForRuntime();
            await this.props.actions.executeFromNode(this.props.node.id, {});
            await this._reloadPanelData(this.props.node.id);
        } catch (error) {
            this.state.errorMessage = error && error.message ? error.message : "Manual trigger execution failed.";
            this.notification.add(this.state.errorMessage, { type: "danger" });
        } finally {
            this.state.busy = false;
            this._notifyHeaderState();
        }
    }

    async onOpenBackendRecord() {
        if (this.isReadonly) {
            return;
        }
        try {
            await this._saveWorkflowForRuntime();
            await this.props.actions.openTriggerNodeRecord(this.props.node.id);
        } catch (error) {
            this.state.errorMessage = error && error.message ? error.message : "Failed to open backend record.";
            this.notification.add(this.state.errorMessage, { type: "danger" });
        }
    }

    copyToClipboard = async (value, label) => {
        if (!value) {
            return;
        }
        await this.workflowEditor.copyText(value, { label });
    };
}
