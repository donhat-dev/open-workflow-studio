/** @odoo-module **/

/**
 * WorkflowHistoryPanel - Version history panel for workflows (docked UI).
 */

import { Component, useState, onMounted, useExternalListener } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";
import { formatDateTime } from "@web/core/l10n/dates";
import { _t } from "@web/core/l10n/translation";
import { ConfirmationDialog } from "@web/core/confirmation_dialog/confirmation_dialog";
import { memoize } from "@web/core/utils/functions";
import { user } from "@web/core/user";

const { DateTime } = luxon;
export class WorkflowHistoryPanel extends Component {
    static template = "workflow_pilot.WorkflowHistoryPanel";
    static props = {
        workflowId: Number,
        onClose: Function,
        restoreRequested: Function,
        previewRequested: { type: Function, optional: true },
        currentRequested: { type: Function, optional: true },
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
    });

    setup() {
        this.orm = useService("orm");
        this.dialog = useService("dialog");
        this.notification = useService("notification");
        this.ui = useService("ui");

        onMounted(() => this.init());
        useExternalListener(this.env.bus, "save", () => this.refreshHistory());
    }

    async init() {
        await this.refreshHistory();
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
