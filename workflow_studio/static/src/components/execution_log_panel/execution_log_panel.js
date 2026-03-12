/** @odoo-module **/

import { Component, useRef, useState } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";
import { JsonTreeNode } from "@workflow_studio/components/data_panel/JsonTreeNode";
import { CodeEditor } from "@workflow_studio/components/code_editor";
import { SvgTimeline } from "@workflow_studio/components/svg_timeline/svg_timeline";

const DEFAULT_PANEL_HEIGHT = 280;
const MIN_PANEL_HEIGHT = 120;
const MAX_PANEL_HEIGHT_RATIO = 0.7;

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function parseIsoDate(value) {
    if (!value || typeof value !== "string") {
        return null;
    }
    const timestamp = Date.parse(value);
    if (Number.isNaN(timestamp)) {
        return null;
    }
    return timestamp;
}

export class ExecutionLogPanel extends Component {
    static template = "workflow_studio.ExecutionLogPanel";
    static components = { JsonTreeNode, CodeEditor, SvgTimeline };

    setup() {
        this.workflowEditor = useService("workflowEditor");
        this.editorState = useState(this.workflowEditor.state);
        this.panelRef = useRef("panel");
        this.state = useState({
            activeTab: "list",
            listMode: "overview",       // "overview" | "detail"
            detailSelectedKey: null,    // rowKey of step selected in detail pane
            detailShowInput: false,     // independent toggle: show INPUT section
            detailShowOutput: true,     // independent toggle: show OUTPUT section
            customHeight: DEFAULT_PANEL_HEIGHT,
            isResizing: false,
            expandedSteps: {},
        });
    }

    get execution() {
        return this.editorState.executionProgress;
    }

    get panelStyle() {
        const maxHeight = Math.floor(window.innerHeight * MAX_PANEL_HEIGHT_RATIO);
        const height = clamp(this.state.customHeight || DEFAULT_PANEL_HEIGHT, MIN_PANEL_HEIGHT, maxHeight);
        return `height: ${height}px;`;
    }

    get hasExecution() {
        if (!this.execution) {
            return false;
        }
        if (this.executionSteps.length) {
            return true;
        }
        if (this.execution.error || this.execution.errorNodeId) {
            return true;
        }
        if (this.execution.outputData !== undefined && this.execution.outputData !== null) {
            return true;
        }
        if (Array.isArray(this.execution.executedConnections) && this.execution.executedConnections.length) {
            return true;
        }
        return false;
    }

    get isRunningExecution() {
        return !!(this.execution && this.execution.status === "running" && !this.executionSteps.length);
    }

    get executionSteps() {
        const execution = this.execution;
        if (!execution) {
            return [];
        }

        const executionEvents = Array.isArray(execution.executionEvents) ? execution.executionEvents : [];
        if (executionEvents.length) {
            return executionEvents.map((event, index) => this._buildStep(event, index));
        }

        const order = Array.isArray(execution.executedOrder) ? execution.executedOrder : [];
        const results = Array.isArray(execution.nodeResults) ? execution.nodeResults : [];
        const resultsByNodeId = new Map();
        const consumed = new Set();

        for (const result of results) {
            if (!result || !result.node_id) {
                continue;
            }
            resultsByNodeId.set(result.node_id, result);
        }

        const steps = [];
        for (const nodeId of order) {
            if (!nodeId) {
                continue;
            }
            const result = resultsByNodeId.get(nodeId);
            if (result) {
                consumed.add(nodeId);
                steps.push(this._buildStep(result, steps.length));
                continue;
            }
            steps.push(this._buildStep({
                node_id: nodeId,
                node_label: nodeId,
                status: execution.nodeStatuses && execution.nodeStatuses[nodeId] ? execution.nodeStatuses[nodeId] : "running",
                duration_ms: null,
                output_data: null,
                error_message: null,
            }, steps.length));
        }

        for (const result of results) {
            if (!result || !result.node_id || consumed.has(result.node_id)) {
                continue;
            }
            steps.push(this._buildStep(result, steps.length));
        }

        return steps;
    }

    _buildStep(result, index) {
        const eventSequence = typeof result.sequence === "number" ? result.sequence : index;
        const rowKey = result.row_key || `${result.node_id || 'step'}_${eventSequence}`;
        return {
            rowKey,
            index,
            sequence: eventSequence,
            iteration: typeof result.iteration === "number" ? result.iteration : null,
            nodeId: result.node_id,
            label: result.node_label || result.title || result.node_type || result.node_id || `Step ${index + 1}`,
            status: result.error_message ? "error" : (result.status || "completed"),
            durationMs: typeof result.duration_ms === "number" ? result.duration_ms : null,
            startedAt: result.started_at || null,
            completedAt: result.completed_at || null,
            inputData: result.input_data !== undefined ? result.input_data : null,
            outputData: result.output_data,
            errorMessage: result.error_message || null,
            nodeType: result.node_type || null,
            outputSocket: result.output_socket || null,
            meta: result.meta || null,
        };
    }

    get selectedNodeIds() {
        const selection = this.editorState.ui.selection;
        return selection && Array.isArray(selection.nodeIds) ? selection.nodeIds : [];
    }

    isSelectedStep(step) {
        return this.selectedNodeIds.includes(step.nodeId);
    }

    isStepExpanded(stepKey) {
        return !!this.state.expandedSteps[stepKey];
    }

    toggleStep(stepKey) {
        this.state.expandedSteps[stepKey] = !this.state.expandedSteps[stepKey];
    }

    hasStepDetails(step) {
        return step.errorMessage || step.outputData !== undefined;
    }

    onStepClick(step) {
        if (!step || !step.nodeId) {
            return;
        }
        this.workflowEditor.actions.focusNode(step.nodeId);
        this.env.bus.trigger("execution-log:focus-node", { nodeId: step.nodeId });
    }

    closePanel() {
        this.workflowEditor.actions.closePanel("executionLog");
    }

    switchTab(tab) {
        this.state.activeTab = tab;
    }

    switchListMode(mode) {
        this.state.listMode = mode;
        // Auto-select first step when entering detail mode
        if (mode === "detail" && !this.state.detailSelectedKey) {
            const steps = this.executionSteps;
            if (steps.length) {
                this.state.detailSelectedKey = steps[0].rowKey;
            }
        }
    }

    // ── Detail pane ──────────────────────────────────────────────────────────

    get detailSelectedStep() {
        const steps = this.executionSteps;
        if (!steps.length) {
            return null;
        }
        const key = this.state.detailSelectedKey;
        if (!key) {
            return steps[0];
        }
        return steps.find((s) => s.rowKey === key) || steps[0];
    }

    isDetailSelected(step) {
        const selected = this.detailSelectedStep;
        return !!(selected && selected.rowKey === step.rowKey);
    }

    selectDetailStep(step) {
        this.state.detailSelectedKey = step.rowKey;
        if (step.nodeId) {
            this.workflowEditor.actions.focusNode(step.nodeId);
            this.env.bus.trigger("execution-log:focus-node", { nodeId: step.nodeId });
        }
    }

    get areBothSectionsHidden() {
        return !this.state.detailShowInput && !this.state.detailShowOutput;
    }

    getIoGridClass() {
        const both = this.state.detailShowInput && this.state.detailShowOutput;
        return "execution-log-panel__io-grid" + (both ? " is-split" : "");
    }

    hasInputData(step) {
        return step && step.inputData !== null && step.inputData !== undefined;
    }

    hasOutputData(step) {
        return step && step.outputData !== null && step.outputData !== undefined;
    }

    get totalDurationMs() {
        const execution = this.execution;
        if (execution && typeof execution.durationSeconds === "number") {
            return Math.max(1, execution.durationSeconds * 1000);
        }
        let total = 0;
        for (const step of this.executionSteps) {
            total += step.durationMs || 0;
        }
        return Math.max(1, total);
    }

    get failedStepCount() {
        let count = 0;
        for (const step of this.executionSteps) {
            if (step.status === "failed" || step.status === "error" || step.errorMessage) {
                count += 1;
            }
        }
        return count;
    }

    get completedStepCount() {
        return this.executionSteps.length;
    }

    get rawExecutionPayload() {
        const execution = this.execution;
        if (!execution) {
            return {};
        }
        return {
            runId: execution.runId || null,
            status: execution.status || null,
            error: execution.error || null,
            errorNodeId: execution.errorNodeId || null,
            executionCount: execution.executionCount || null,
            durationSeconds: execution.durationSeconds || null,
            nodeCountExecuted: execution.nodeCountExecuted || null,
            inputData: execution.inputData || {},
            outputData: execution.outputData,
            executedOrder: execution.executedOrder || [],
            executedConnectionIds: execution.executedConnectionIds || [],
            executedConnections: execution.executedConnections || [],
            executionEvents: execution.executionEvents || [],
            nodeStatuses: execution.nodeStatuses || {},
            nodeResults: execution.nodeResults || [],
            nodeOutputs: execution.nodeOutputs || null,
            contextSnapshot: execution.contextSnapshot || null,
        };
    }

    get rawExecutionJson() {
        try {
            return JSON.stringify(this.rawExecutionPayload, null, 2);
        } catch (error) {
            return JSON.stringify({ error: error.message || "Unable to serialize execution payload" }, null, 2);
        }
    }

    get rawEditorHeight() {
        const maxHeight = Math.floor(window.innerHeight * MAX_PANEL_HEIGHT_RATIO);
        const panelHeight = clamp(this.state.customHeight || DEFAULT_PANEL_HEIGHT, MIN_PANEL_HEIGHT, maxHeight);
        // toolbar ~36px + border 2px + resize 6px = ~44px chrome
        return Math.max(panelHeight - 44, 80);
    }

    get ganttModel() {
        const steps = this.executionSteps;
        if (!steps.length) {
            return { steps: [], ticks: [], totalDurationMs: 1, hasAbsoluteTiming: false };
        }

        const absoluteSteps = [];
        let minStart = null;
        let maxEnd = null;

        for (const step of steps) {
            const startedAtMs = parseIsoDate(step.startedAt);
            const completedAtMs = parseIsoDate(step.completedAt);
            if (startedAtMs === null || completedAtMs === null) {
                minStart = null;
                maxEnd = null;
                break;
            }
            if (minStart === null || startedAtMs < minStart) {
                minStart = startedAtMs;
            }
            if (maxEnd === null || completedAtMs > maxEnd) {
                maxEnd = completedAtMs;
            }
            absoluteSteps.push({ step, startedAtMs, completedAtMs });
        }

        const normalizedSteps = [];
        let totalDurationMs = this.totalDurationMs;
        let hasAbsoluteTiming = false;

        if (minStart !== null && maxEnd !== null && absoluteSteps.length === steps.length) {
            totalDurationMs = Math.max(totalDurationMs, maxEnd - minStart, 1);
            hasAbsoluteTiming = true;
            for (const entry of absoluteSteps) {
                normalizedSteps.push({
                    ...entry.step,
                    offsetMs: Math.max(0, entry.startedAtMs - minStart),
                    timelineDurationMs: Math.max(entry.step.durationMs || 0, entry.completedAtMs - entry.startedAtMs, 1),
                });
            }
        } else {
            let offsetMs = 0;
            for (const step of steps) {
                const durationMs = Math.max(step.durationMs || 0, 1);
                normalizedSteps.push({
                    ...step,
                    offsetMs,
                    timelineDurationMs: durationMs,
                });
                offsetMs += durationMs;
            }
            totalDurationMs = Math.max(totalDurationMs, offsetMs, 1);
        }

        const ticks = [];
        const tickCount = 5;
        for (let index = 0; index < tickCount; index++) {
            const ratio = tickCount === 1 ? 0 : index / (tickCount - 1);
            const valueMs = totalDurationMs * ratio;
            ticks.push({
                key: `tick_${index}`,
                ratio,
                label: this.formatDuration(valueMs),
            });
        }

        return { steps: normalizedSteps, ticks, totalDurationMs, hasAbsoluteTiming };
    }

    get ganttSteps() {
        return this.ganttModel.steps;
    }

    get ganttTicks() {
        return this.ganttModel.ticks;
    }

    get ganttDurationMs() {
        return this.ganttModel.totalDurationMs;
    }

    /** Props object for the SvgTimeline component in the Gantt tab */
    get svgTimelineProps() {
        const model = this.ganttModel;
        return {
            items: model.steps.map((step) => ({
                id: step.rowKey,
                label: step.label,
                offsetMs: step.offsetMs,
                durationMs: step.timelineDurationMs,
                status: step.errorMessage
                    ? "error"
                    : step.status === "running"
                    ? "running"
                    : "success",
            })),
            totalDurationMs: model.totalDurationMs,
            ticks: model.ticks,
            onItemClick: (itemId) => {
                const step = model.steps.find((s) => s.rowKey === itemId);
                if (step) {
                    this.onStepClick(step);
                }
            },
            selectedIds: this.selectedNodeIds,
            modeLabel: model.hasAbsoluteTiming ? "Absolute timing" : "Sequential",
            rowHeight: 32,
            labelColumnWidth: 200,
        };
    }

    getStepRowClass(step) {
        let className = "execution-log-panel__step";
        if (step.status === "failed" || step.status === "error" || step.errorMessage) {
            className += " is-error";
        } else if (step.status === "running") {
            className += " is-running";
        } else {
            className += " is-success";
        }
        if (this.isSelectedStep(step)) {
            className += " is-selected";
        }
        return className;
    }

    getDetailStepClass(step) {
        let className = "execution-log-panel__detail-step-btn";
        if (step.status === "failed" || step.status === "error" || step.errorMessage) {
            className += " is-error";
        } else if (step.status === "running") {
            className += " is-running";
        }
        if (this.isDetailSelected(step)) {
            className += " is-selected";
        }
        return className;
    }

    getStatusIconClass(step) {
        if (step.status === "failed" || step.status === "error" || step.errorMessage) {
            return "fa fa-times-circle";
        }
        if (step.status === "running") {
            return "fa fa-spinner fa-spin";
        }
        return "fa fa-check-circle";
    }

    formatDuration(durationMs) {
        if (durationMs === null || durationMs === undefined) {
            return "—";
        }
        if (durationMs < 1000) {
            return `${Math.round(durationMs)}ms`;
        }
        const durationSeconds = durationMs / 1000;
        if (durationSeconds < 10) {
            return `${durationSeconds.toFixed(2)}s`;
        }
        return `${durationSeconds.toFixed(1)}s`;
    }

    formatTimestamp(value) {
        if (!value) {
            return "—";
        }
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return "—";
        }
        return date.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            fractionalSecondDigits: 3,
        });
    }

    onResizeStart(ev) {
        ev.preventDefault();
        this.state.isResizing = true;

        const startY = ev.clientY;
        const panel = this.panelRef.el;
        const startHeight = panel ? panel.offsetHeight : (this.state.customHeight || DEFAULT_PANEL_HEIGHT);

        const onMouseMove = (moveEv) => {
            const deltaY = startY - moveEv.clientY;
            const maxHeight = Math.floor(window.innerHeight * MAX_PANEL_HEIGHT_RATIO);
            this.state.customHeight = clamp(startHeight + deltaY, MIN_PANEL_HEIGHT, maxHeight);
        };

        const onMouseUp = () => {
            this.state.isResizing = false;
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
        };

        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "ns-resize";
        document.body.style.userSelect = "none";
    }
}
