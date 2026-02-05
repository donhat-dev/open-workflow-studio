/** @odoo-module **/

/**
 * WorkflowHistoryPanel - Version history panel for workflows (docked UI).
 */

import { Component, useState, onMounted, markup } from "@odoo/owl";
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
        activeTab: "comparison",
        content: null,
        comparison: null,
        loading: false,
    });

    setup() {
        this.orm = useService("orm");
        this.dialog = useService("dialog");
        this.notification = useService("notification");
        this.ui = useService("ui");

        onMounted(() => this.init());
    }

    async init() {
        await this.refreshHistory();
        if (this.state.revisions.length > 0) {
            await this.selectRevision(this.state.revisions[0].revision_id);
        }
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
        try {
            this.ui.block();
            this.state.selectedRevisionId = revisionId;
            this.state.content = await this.getRevisionContent(revisionId);
            this.state.comparison = await this.getRevisionComparison(revisionId);
        } catch (error) {
            this.notification.add(
                _t("Failed to load revision data: %s", error.message),
                { type: "danger" }
            );
        } finally {
            this.ui.unblock();
        }
    }

    getRevisionContent = memoize(async function (revisionId) {
        return await this.orm.call(
            "ir.workflow",
            "get_version_content",
            [[this.props.workflowId], revisionId, this.props.fieldName]
        );
    }.bind(this));

    getRevisionComparison = memoize(async function (revisionId) {
        const comparison = await this.orm.call(
            "ir.workflow",
            "get_version_comparison",
            [[this.props.workflowId], revisionId, this.props.fieldName]
        );
        return {
            html: comparison.html ? markup(comparison.html) : "",
            summary: comparison.summary || null,
        };
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

    get contentSummary() {
        const content = this.state.content;
        if (!content) {
            return null;
        }
        return {
            nodeCount: (content.nodes || []).length,
            connectionCount: (content.connections || []).length,
        };
    }

    get comparisonHtml() {
        return this.state.comparison && this.state.comparison.html
            ? this.state.comparison.html
            : "";
    }

    get comparisonSummary() {
        return this.state.comparison ? this.state.comparison.summary : null;
    }

    get content() {
        return JSON.stringify(this.state.content, null, 2);
    }

    onRevisionClick(revisionId) {
        this.selectRevision(revisionId);
    }

    async onRestoreClick() {
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
                await this.props.restoreRequested(revision.revision_id, this.props.onClose);
                this.ui.unblock();
            },
        });
    }

    async onMarkMilestoneClick() {
        const revision = this.getSelectedRevision();
        if (!revision || revision.is_milestone) {
            return;
        }

        const name = prompt(_t("Enter milestone name:"), `Milestone v${revision.revision_id}`);
        if (!name) {
            return;
        }

        this.env.services.ui.block();
        await this.orm.call(
            "ir.workflow",
            "mark_milestone",
            [[this.props.workflowId], revision.revision_id, name, this.props.fieldName]
        );
        this.notification.add(_t("Marked as milestone"), { type: "success" });

        await this.refreshHistory();
        this.env.services.ui.unblock();
    }

    onTabChange(tabId) {
        this.state.activeTab = tabId;
    }
}
