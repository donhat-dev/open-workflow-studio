from odoo import _, api, fields, models


class QueueJob(models.Model):
    _inherit = "queue.job"

    workflow_run_id = fields.Many2one(
        "workflow.run",
        string="Workflow Run",
        readonly=True,
        index=True,
        ondelete="set null",
    )

    def _sync_linked_workflow_runs(self):
        for job in self.filtered("workflow_run_id"):
            run = job.workflow_run_id.sudo()
            updates = {}

            if not run.queue_job_id or run.queue_job_id.id != job.id:
                updates["queue_job_id"] = job.id
            if job.uuid and run.queue_job_uuid != job.uuid:
                updates["queue_job_uuid"] = job.uuid

            if job.state == "started" and run.status == "pending":
                updates["status"] = "running"
                if not run.started_at:
                    updates["started_at"] = job.date_started or fields.Datetime.now()
            elif job.state == "cancelled" and run.status not in (
                "completed",
                "failed",
                "cancelled",
            ):
                updates["status"] = "cancelled"
                if not run.completed_at:
                    updates["completed_at"] = (
                        job.date_cancelled or fields.Datetime.now()
                    )
                updates["error_message"] = False
                updates["error_node_id"] = False
            elif job.state == "failed" and run.status == "pending":
                updates["status"] = "failed"
                if not run.completed_at:
                    updates["completed_at"] = fields.Datetime.now()
                updates["error_message"] = (
                    job.exc_message
                    or job.result
                    or _("Queued workflow job failed before execution.")
                )

            if updates:
                run.write(updates)

    @api.model_create_multi
    def create(self, vals_list):
        records = super().create(vals_list)
        records._sync_linked_workflow_runs()
        return records

    def write(self, vals):
        result = super().write(vals)
        if set(vals) & {
            "state",
            "date_started",
            "date_done",
            "date_cancelled",
            "exc_message",
            "result",
        }:
            self._sync_linked_workflow_runs()
        return result
