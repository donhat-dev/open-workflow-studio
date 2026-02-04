/** @odoo-module **/

/**
 * WorkflowHistoryDialog Component
 * 
 * Displays version history for workflows with:
 * - Left: revision list (date + author + milestone badge)
 * - Right: Notebook tabs (Content preview / Comparison diff)
 * - Actions: Restore, Mark as Milestone
 * 
 * Inspired by Odoo's HistoryDialog from html_editor module.
 */

import { Component, useState, onWillStart } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";
import { Dialog } from "@web/core/dialog/dialog";
import { Notebook } from "@web/core/notebook/notebook";
import { formatDateTime } from "@web/core/l10n/dates";
import { _t } from "@web/core/l10n/translation";
import { ConfirmationDialog } from "@web/core/confirmation_dialog/confirmation_dialog";
import { memoize } from "@web/core/utils/functions";

export class WorkflowHistoryDialog extends Component {
    static template = "workflow_pilot.WorkflowHistoryDialog";
    static components = { Dialog, Notebook };
    static props = {
        workflowId: { type: Number },
        fieldName: { type: String, optional: true },
        close: { type: Function },
    };

    setup() {
        this.rpc = useService("rpc");
        this.dialog = useService("dialog");
        this.notification = useService("notification");
        this.ui = useService("ui");

        this.state = useState({
            revisions: [],
            selectedRevisionId: null,
            loading: true,
            contentLoading: false,
            activeTab: "comparison",
            content: null,
            comparison: null,
        });

        this.fieldName = this.props.fieldName || "draft_snapshot";

        // Memoize RPC calls
        this.getRevisionContent = memoize((revisionId) => this._fetchContent(revisionId));
        this.getRevisionComparison = memoize((revisionId) => this._fetchComparison(revisionId));

        onWillStart(async () => {
            await this.loadRevisions();
        });
    }

    async loadRevisions() {
        this.state.loading = true;
        try {
            const revisions = await this.rpc("/web/dataset/call_kw", {
                model: "ir.workflow",
                method: "get_version_history",
                args: [[this.props.workflowId], this.fieldName],
                kwargs: {},
            });
            this.state.revisions = revisions || [];
            
            // Auto-select first revision
            if (this.state.revisions.length > 0) {
                await this.selectRevision(this.state.revisions[0].revision_id);
            }
        } catch (error) {
            this.notification.add(_t("Failed to load version history"), { type: "danger" });
            console.error("Failed to load version history:", error);
        } finally {
            this.state.loading = false;
        }
    }

    async selectRevision(revisionId) {
        if (this.state.selectedRevisionId === revisionId) {
            return;
        }
        
        this.state.selectedRevisionId = revisionId;
        this.state.contentLoading = true;
        this.ui.block();

        try {
            const [content, comparison] = await Promise.all([
                this.getRevisionContent(revisionId),
                this.getRevisionComparison(revisionId),
            ]);
            
            this.state.content = content;
            this.state.comparison = comparison;
        } catch (error) {
            this.notification.add(_t("Failed to load revision"), { type: "danger" });
            console.error("Failed to load revision:", error);
        } finally {
            this.state.contentLoading = false;
            this.ui.unblock();
        }
    }

    async _fetchContent(revisionId) {
        return await this.rpc("/web/dataset/call_kw", {
            model: "ir.workflow",
            method: "get_version_content",
            args: [[this.props.workflowId], revisionId, this.fieldName],
            kwargs: {},
        });
    }

    async _fetchComparison(revisionId) {
        return await this.rpc("/web/dataset/call_kw", {
            model: "ir.workflow",
            method: "get_version_comparison",
            args: [[this.props.workflowId], revisionId, this.fieldName],
            kwargs: {},
        });
    }

    formatDate(isoString) {
        if (!isoString) {
            return "";
        }
        try {
            const date = luxon.DateTime.fromISO(isoString);
            return formatDateTime(date, { format: "short" });
        } catch {
            return isoString;
        }
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
        if (!this.state.comparison) {
            return "";
        }
        return this.state.comparison.html || "";
    }

    get comparisonSummary() {
        if (!this.state.comparison || !this.state.comparison.summary) {
            return null;
        }
        return this.state.comparison.summary;
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
            body: _t("Restore workflow to version %s? This will create a new revision with the restored content.", revision.revision_id),
            confirmLabel: _t("Restore"),
            cancelLabel: _t("Cancel"),
            confirm: async () => {
                this.ui.block();
                try {
                    await this.rpc("/web/dataset/call_kw", {
                        model: "ir.workflow",
                        method: "restore_version",
                        args: [[this.props.workflowId], revision.revision_id, this.fieldName],
                        kwargs: {},
                    });
                    this.notification.add(_t("Version restored successfully"), { type: "success" });
                    this.props.close();
                    // Trigger page reload to refresh editor
                    window.location.reload();
                } catch (error) {
                    this.notification.add(_t("Failed to restore version"), { type: "danger" });
                    console.error("Failed to restore version:", error);
                } finally {
                    this.ui.unblock();
                }
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

        this.ui.block();
        try {
            await this.rpc("/web/dataset/call_kw", {
                model: "ir.workflow",
                method: "mark_milestone",
                args: [[this.props.workflowId], revision.revision_id, name, this.fieldName],
                kwargs: {},
            });
            this.notification.add(_t("Marked as milestone"), { type: "success" });
            
            // Refresh revisions
            await this.loadRevisions();
        } catch (error) {
            this.notification.add(_t("Failed to mark milestone"), { type: "danger" });
            console.error("Failed to mark milestone:", error);
        } finally {
            this.ui.unblock();
        }
    }

    get notebookPages() {
        return [
            {
                id: "comparison",
                title: _t("Comparison"),
                isActive: this.state.activeTab === "comparison",
            },
            {
                id: "content",
                title: _t("Content"),
                isActive: this.state.activeTab === "content",
            },
        ];
    }

    onTabChange(tabId) {
        this.state.activeTab = tabId;
    }
}
