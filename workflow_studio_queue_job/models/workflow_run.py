# -*- coding: utf-8 -*-

from odoo import api, fields, models, _
from odoo.exceptions import UserError


class WorkflowRunQueueJob(models.Model):
    _inherit = 'workflow.run'

    queue_job_id = fields.Many2one(
        'queue.job',
        string='Queue Job',
        readonly=True,
        copy=False,
        index=True,
        ondelete='set null',
    )
    queue_job_uuid = fields.Char(
        string='Queue Job UUID',
        readonly=True,
        copy=False,
        index=True,
    )
    queue_job_state = fields.Selection(
        related='queue_job_id.state',
        string='Queue Job State',
        readonly=True,
        store=True,
    )
    queue_can_cancel = fields.Boolean(
        string='Can Cancel Queue Job',
        compute='_compute_queue_can_cancel',
    )

    @api.depends('queue_job_id', 'queue_job_state')
    def _compute_queue_can_cancel(self):
        cancellable_states = {'pending', 'enqueued', 'wait_dependencies'}
        for run in self:
            run.queue_can_cancel = bool(
                run.queue_job_id and run.queue_job_state in cancellable_states
            )

    def _sync_queue_job_link(self):
        missing_links = self.filtered(lambda run: run.queue_job_uuid and not run.queue_job_id)
        if not missing_links:
            return True

        queue_job_model = self.env['queue.job'].sudo()
        for run in missing_links:
            queue_job = queue_job_model.search([('uuid', '=', run.queue_job_uuid)], limit=1)
            if queue_job:
                run.sudo().write({'queue_job_id': queue_job.id})
        return True

    def _queue_job_description(self):
        self.ensure_one()
        mode_label = dict(self._fields['execution_mode'].selection).get(
            self.execution_mode,
            self.execution_mode or _('Queued'),
        )
        return _(
            "%(workflow)s - %(mode)s run %(run)s",
            workflow=self.workflow_id.name,
            mode=mode_label,
            run=self.name,
        )

    def _job_store_values_for__queue_job_execute(self, job):
        self.ensure_one()
        return {
            'workflow_run_id': self.id,
        }

    def _queue_job_execute(self):
        self.ensure_one()
        run = self.sudo()
        if run.status == 'cancelled':
            return False

        run._sync_queue_job_link()
        workflow = run.workflow_id
        if not workflow:
            raise UserError(_("Workflow run '%s' has no workflow.") % run.display_name)

        try:
            return workflow.launch(
                run=run,
                input_data=run.input_data or {},
                execution_mode=run.execution_mode or 'manual',
                start_node_ids=run.start_node_ids or [],
                notify_user=False,
                raise_on_error=True,
                _from_queue=True,
            )
        except Exception:
            if run.status not in ('failed', 'completed', 'cancelled'):
                run.write({
                    'status': 'failed',
                    'completed_at': fields.Datetime.now(),
                    'error_message': _("Queued workflow execution failed before completion."),
                })
            raise

    def _cancel_requested(self, event):
        event = super()._cancel_requested(event)
        run = (event or {}).get('run') or self
        if not run:
            return event

        run = run.sudo()
        run._sync_queue_job_link()
        if not run.queue_can_cancel or not run.queue_job_id:
            return event

        run.queue_job_id.sudo().button_cancelled()
        run.write({
            'status': 'cancelled',
            'completed_at': fields.Datetime.now(),
            'error_message': False,
            'error_node_id': False,
        })
        event['handled'] = True
        event['queue_job_state'] = run.queue_job_id.state
        return event
