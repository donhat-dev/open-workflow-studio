/** @odoo-module **/

/**
 * WorkflowHistoryPanel - Version history panel for workflows (docked UI).
 */

import { Component, useState, onMounted, useExternalListener } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";
import { rpc } from "@web/core/network/rpc";
import { formatDateTime } from "@web/core/l10n/dates";
import { _t } from "@web/core/l10n/translation";
import { ConfirmationDialog } from "@web/core/confirmation_dialog/confirmation_dialog";
import { memoize } from "@web/core/utils/functions";
import { user } from "@web/core/user";

const { DateTime } = luxon;
export class WorkflowHistoryPanel extends Component {
    static template = "workflow_studio.WorkflowHistoryPanel";
    static props = {
        workflowId: Number,
        onClose: Function,
        restoreRequested: Function,
        previewRequested: { type: Function, optional: true },
        currentRequested: { type: Function, optional: true },
        executionViewRequested: { type: Function, optional: true },
        exitExecutionView: { type: Function, optional: true },
        historyMetadata: { type: Array, optional: true },
        fieldName: { type: String, optional: true },
    };
    static defaultProps = {
        fieldName: "draft_snapshot",
        historyMetadata: [],
    };

    state = useState({
        revisions: [],
        selectedRevisionId: null,
        loading: false,
        previewing: false,
        followLatest: true,
        // Runs tab state
        activeTab: 'versions',
        runs: [],
        selectedRunId: null,
        loadingRuns: false,
    });

    setup() {
        this.orm = useService("orm");
        this.dialog = useService("dialog");
        this.notification = useService("notification");
        this.ui = useService("ui");

        /** @type {Map<number, Object>} Cache for preloaded run details */
        this._runDetailCache = new Map();

        onMounted(() => this.init());
        useExternalListener(this.env.bus, "refresh", () => this.backgroundRefresh());
    }

    async init() {
        await this.refreshHistory();
    }

    backgroundRefresh() {
        // Softly loads the latest runs in the background.
        if (this.state.loading) return; // Avoid overlapping refreshes
        const self = this;
        if (self.state.activeTab !== 'runs'){
            return self.backgroundRefreshHistory();
        }
        self.orm.call(
            "ir.workflow",
            "get_recent_runs",
            [[self.props.workflowId], 1]
        ).then(
            (runs) => {
                for (const run of runs) {
                    const idx = self.state.runs.findIndex(r => r.id === run.id);
                    if (idx === -1) {
                        self.state.runs.unshift(run);
                    } else {
                        Object.assign(self.state.runs[idx], run);
                    }
                }
            }
        );
    }

    backgroundRefreshHistory() {
        // Softly loads the latest history in the background without replacing the whole list.
        if (this.state.loading) return; // Avoid overlapping refreshes
        this.orm.call(
            "ir.workflow",
            "get_version_history",
            [[this.props.workflowId], this.props.fieldName]
        ).then(
            (raw) => {
                const incoming = this.normalizeRevisionNotes(raw || []);
                for (const rev of incoming) {
                    const idx = this.state.revisions.findIndex(r => r.revision_id === rev.revision_id);
                    if (idx === -1) {
                        this.state.revisions.unshift(rev);
                    } else {
                        Object.assign(this.state.revisions[idx], rev);
                    }
                }
                if (this.state.followLatest) {
                    this.state.selectedRevisionId = this.getLatestRevisionId();
                }
            }
        );
    }

    async refreshHistory() {
        this.state.loading = true;
        try {
            if (this.props.historyMetadata.length > 0) {
                this.state.revisions = this.props.historyMetadata;
            } else {
                this.state.revisions = await this.orm.call(
                    "ir.workflow",
                    "get_version_history",
                    [[this.props.workflowId], this.props.fieldName]
                );
            }
            this.state.revisions = this.normalizeRevisionNotes(this.state.revisions || []);
            if (!this.state.selectedRevisionId || this.state.followLatest) {
                await this.selectCurrentRevision();
            }
        } catch (error) {
            this.notification.add(
                _t("Failed to load version history: %s", error.message),
                { type: "danger" }
            );
        } finally {
            this.state.loading = false;
        }
    }

    async selectRevision(revisionId) {
        if (this.state.selectedRevisionId === revisionId) {
            return;
        }
        if (revisionId === this.getLatestRevisionId()) {
            await this.selectCurrentRevision();
            return;
        }
        try {
            this.state.previewing = true;
            this.ui.block();
            this.state.followLatest = false;
            this.state.selectedRevisionId = revisionId;
            const snapshot = await this.getRevisionContent(revisionId);
            if (this.props.previewRequested) {
                await this.props.previewRequested(revisionId, snapshot);
            }
        } catch (error) {
            this.notification.add(
                _t("Failed to load revision data: %s", error.message),
                { type: "danger" }
            );
        } finally {
            this.ui.unblock();
            this.state.previewing = false;
        }
    }

    async selectCurrentRevision() {
        const latestRevisionId = this.getLatestRevisionId();
        this.state.previewing = false;
        this.state.selectedRevisionId = latestRevisionId;
        this.state.followLatest = true;
        if (this.props.currentRequested) {
            await this.props.currentRequested();
        }
    }

    getRevisionContent = memoize(async function (revisionId) {
        return await this.orm.call(
            "ir.workflow",
            "get_version_content",
            [[this.props.workflowId], revisionId, this.props.fieldName]
        );
    }.bind(this));

    formatDate(isoString) {
        if (!isoString) {
            return "";
        }
        return formatDateTime(
            DateTime.fromISO(isoString, { zone: "utc" }).setZone(user.tz)
        );
    }

    getSelectedRevision() {
        return this.state.revisions.find(
            (r) => r.revision_id === this.state.selectedRevisionId
        );
    }

    get displayRevisions() {
        return this.state.revisions || [];
    }

    get groupedRevisions() {
        const groups = {
            today: { label: _t("Today"), revisions: [] },
            yesterday: { label: _t("Yesterday"), revisions: [] },
            lastWeek: { label: _t("Last Week"), revisions: [] },
            older: { label: _t("Older"), revisions: [] },
        };

        const now = DateTime.now();
        const startOfToday = now.startOf("day");
        const startOfYesterday = startOfToday.minus({ days: 1 });
        const startOfLastWeek = startOfToday.minus({ weeks: 1 });
        const latestRevisionId = this.getLatestRevisionId();

        for (const revision of this.displayRevisions) {
            const date = DateTime.fromISO(revision.create_date, { zone: "utc" }).setZone(user.tz);

            const richRevision = {
                ...revision,
                is_current: revision.revision_id === latestRevisionId,
                readableTime: date.toFormat("HH:mm:ss dd/LL/yyyy"),
                avatarUrl: this.getAvatarUrl(revision.create_uid),
                rawDate: date,
            };

            if (date >= startOfToday) {
                groups.today.revisions.push(richRevision);
            } else if (date >= startOfYesterday) {
                groups.yesterday.revisions.push(richRevision);
            } else if (date >= startOfLastWeek) {
                groups.lastWeek.revisions.push(richRevision);
            } else {
                groups.older.revisions.push(richRevision);
            }
        }

        return Object.values(groups).filter(g => g.revisions.length > 0);
    }

    getAvatarUrl(uid) {
        if (!uid) return "";
        return `/web/image?model=res.users&field=avatar_128&id=${uid}`;
    }

    get isCurrentSelected() {
        return this.state.selectedRevisionId === this.getLatestRevisionId();
    }

    get canRestore() {
        return Boolean(this.state.selectedRevisionId) && !this.state.previewing && !this.isCurrentSelected;
    }

    getLatestRevisionId() {
        const latest = this.state.revisions?.[0];
        return latest ? latest.revision_id : null;
    }

    normalizeRevisionNotes(revisions) {
        return revisions.map((revision) => {
            if (revision.note) {
                return revision;
            }
            return {
                ...revision,
                note: _t("Manual save"),
            };
        });
    }

    onRevisionClick(revisionId) {
        this.selectRevision(revisionId);
    }

    // ================= Runs Tab =================

    switchTab(tab) {
        if (this.state.activeTab === tab) {
            return;
        }
        // Exit any active preview/view when switching tabs
        if (this.state.activeTab === 'versions' && this.state.selectedRevisionId && !this.isCurrentSelected) {
            this.selectCurrentRevision();
        }
        if (this.state.activeTab === 'runs' && this.state.selectedRunId) {
            this.exitRunView();
        }
        this.state.activeTab = tab;
        if (tab === 'runs' && this.state.runs.length === 0) {
            this.loadRuns();
        }
    }

    async loadRuns() {
        this.state.loadingRuns = true;
        try {
            this.state.runs = await this.orm.call(
                "ir.workflow",
                "get_recent_runs",
                [[this.props.workflowId]]
            );
            // Batch preload details for the first 5 runs
            this._preloadRunDetails(this.state.runs.slice(0, 5));
        } catch (error) {
            this.notification.add(
                _t("Failed to load execution runs: %s", error.message),
                { type: "danger" }
            );
        } finally {
            this.state.loadingRuns = false;
        }
    }

    /**
     * Preload run details in parallel (up to N runs).
     * Results are cached in _runDetailCache for instant display on click.
     * @param {Array<{id: number}>} runs
     */
    _preloadRunDetails(runs) {
        if (!runs || !runs.length) return;
        const toFetch = runs.filter(r => !this._runDetailCache.has(r.id));
        if (!toFetch.length) return;

        // Fire-and-forget parallel fetches
        for (const run of toFetch) {
            rpc(`/workflow_studio/run/${run.id}`, {}).then(
                (data) => { this._runDetailCache.set(run.id, data); },
                () => { /* silently skip preload failures */ }
            );
        }
    }

    async selectRun(runId) {
        if (this.state.selectedRunId === runId) {
            return;
        }
        try {
            this.state.loadingRuns = true;
            this.ui.block();
            this.state.selectedRunId = runId;

            // Use cached data if available, otherwise fetch
            let runData = this._runDetailCache.get(runId);
            if (!runData) {
                runData = await rpc(`/workflow_studio/run/${runId}`, {});
                this._runDetailCache.set(runId, runData);
            }

            if (this.props.executionViewRequested) {
                const executionData = {
                    runId: runData.run_id || runData.id,
                    status: runData.status,
                    executionMode: runData.execution_mode || null,
                    executedOrder: runData.executed_order || [],
                    executedConnectionIds: runData.executed_connection_ids || [],
                    executedConnections: runData.executed_connections || [],
                    executionEvents: runData.execution_events || [],
                    nodeResults: runData.node_results || [],
                    contextSnapshot: runData.context_snapshot || null,
                    queueJobState: runData.queue_job_state || null,
                    error: runData.error || null,
                    errorNodeId: runData.error_node_id || null,
                    executionCount: runData.execution_count || null,
                    durationSeconds: runData.duration_seconds || null,
                    nodeCountExecuted: runData.node_count_executed || null,
                    inputData: runData.input_data || {},
                };
                this.props.executionViewRequested(runId, runData.executed_snapshot, executionData);
            }
        } catch (error) {
            this.notification.add(
                _t("Failed to load run details: %s", error.message),
                { type: "danger" }
            );
            this.state.selectedRunId = null;
        } finally {
            this.ui.unblock();
            this.state.loadingRuns = false;
        }
    }

    exitRunView() {
        this.state.selectedRunId = null;
        if (this.props.exitExecutionView) {
            this.props.exitExecutionView();
        }
    }

    getSelectedRun() {
        return this.state.runs.find(r => r.id === this.state.selectedRunId);
    }

    get isRunSelected() {
        return Boolean(this.state.selectedRunId);
    }

    getRunStatusClass(status) {
        const map = {
            completed: 'run-status--success',
            failed: 'run-status--error',
            running: 'run-status--running',
            pending: 'run-status--pending',
            cancelled: 'run-status--cancelled',
        };
        return map[status] || 'run-status--default';
    }

    getRunStatusIcon(status) {
        const map = {
            completed: 'fa fa-check-circle',
            failed: 'fa fa-exclamation-circle',
            running: 'fa fa-spinner fa-spin',
            pending: 'fa fa-clock-o',
            cancelled: 'fa fa-ban',
        };
        return map[status] || 'fa fa-circle-o';
    }

    getRunModeClass(mode) {
        const map = {
            manual: 'run-mode--manual',
            schedule: 'run-mode--schedule',
            webhook: 'run-mode--webhook',
            record_event: 'run-mode--record-event',
        };
        return map[mode] || 'run-mode--default';
    }

    getRunModeLabel(mode) {
        const map = {
            manual: _t('Manual'),
            schedule: _t('Schedule'),
            webhook: _t('Webhook'),
            record_event: _t('Record Event'),
        };
        return map[mode] || _t('Unknown');
    }

    getQueueStateClass(state) {
        const map = {
            wait_dependencies: 'run-queue--waiting',
            pending: 'run-queue--pending',
            enqueued: 'run-queue--enqueued',
            started: 'run-queue--started',
            done: 'run-queue--done',
            cancelled: 'run-queue--cancelled',
            failed: 'run-queue--failed',
        };
        return map[state] || 'run-queue--default';
    }

    getQueueStateLabel(state) {
        const map = {
            wait_dependencies: _t('Waiting'),
            pending: _t('Pending'),
            enqueued: _t('Enqueued'),
            started: _t('Started'),
            done: _t('Done'),
            cancelled: _t('Cancelled'),
            failed: _t('Failed'),
        };
        return map[state] || _t('Queued');
    }

    get canCancelSelectedRun() {
        const selectedRun = this.getSelectedRun();
        return Boolean(selectedRun && selectedRun.queue_can_cancel);
    }

    onCancelRun() {
        const selectedRun = this.getSelectedRun();
        if (!selectedRun || !selectedRun.queue_can_cancel) {
            return;
        }

        this.dialog.add(ConfirmationDialog, {
            title: _t("Cancel queued run"),
            body: _t("Cancel run %s before it starts?", selectedRun.name),
            confirmLabel: _t("Cancel run"),
            confirmClass: "btn-danger",
            confirm: async () => {
                try {
                    this.ui.block();
                    await this.orm.call("workflow.run", "action_cancel", [[selectedRun.id]]);
                    this.notification.add(_t("Queued run cancelled."), { type: "success" });
                    this.exitRunView();
                    await this.loadRuns();
                } catch (error) {
                    this.notification.add(
                        _t("Failed to cancel queued run: %s", error.message),
                        { type: "danger" }
                    );
                } finally {
                    this.ui.unblock();
                }
            },
        });
    }

    formatDuration(seconds) {
        if (seconds === null || seconds === undefined) {
            return '—';
        }
        if (seconds < 1) {
            return `${(seconds * 1000).toFixed(0)}ms`;
        }
        if (seconds < 60) {
            return `${seconds.toFixed(1)}s`;
        }
        const mins = Math.floor(seconds / 60);
        const secs = (seconds % 60).toFixed(0);
        return `${mins}m ${secs}s`;
    }

    async onRestoreClick() {
        if (this.isCurrentSelected) {
            return;
        }
        const revision = this.getSelectedRevision();
        if (!revision) {
            return;
        }

        this.dialog.add(ConfirmationDialog, {
            title: _t("Restore Version"),
            body: _t("Restore to version %s?", revision.revision_id),
            confirmLabel: _t("Restore"),
            confirm: async () => {
                this.ui.block();
                await this.props.restoreRequested(revision.revision_id);
                this.ui.unblock();
            },
        });
    }
}
