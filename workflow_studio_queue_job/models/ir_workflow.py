# -*- coding: utf-8 -*-

from odoo import models


class WorkflowQueueJob(models.Model):
    _inherit = 'ir.workflow'

    _QUEUE_AUTOMATED_MODES = ('schedule', 'webhook', 'record_event')

    def _should_queue_launch_event(self, event):
        return bool(
            event.get('launch_intent') == 'trigger'
            and event.get('execution_mode') in self._QUEUE_AUTOMATED_MODES
        )

    def _launch_requested(self, event):
        event = super()._launch_requested(event)
        self.ensure_one()
        if event.get('handled') or not self._should_queue_launch_event(event):
            return event

        run = event.get('run')
        run_vals = dict(event.get('run_vals') or {})
        if not run:
            run = self.env['workflow.run'].create(run_vals)
        else:
            pending_updates = {
                key: value
                for key, value in run_vals.items()
                if run._fields.get(key) and run[key] != value
            }
            if pending_updates:
                run.write(pending_updates)

        job = run.with_delay(
            description=run._queue_job_description(),
        )._queue_job_execute()
        job_record = job.db_record()

        link_vals = {
            'queue_job_uuid': job.uuid,
        }
        if job_record:
            link_vals['queue_job_id'] = job_record.id
        run.write(link_vals)
        run.invalidate_recordset(['status', 'execution_count', 'node_count_executed', 'duration_seconds'])

        event['run'] = run
        event['handled'] = True
        event['response'] = self._build_launch_response(
            run,
            {
                'status': run.status,
            },
        )
        return event

    def get_recent_runs(self, limit=50):
        runs = super().get_recent_runs(limit=limit)
        if not runs:
            return runs

        run_map = {
            run.id: run
            for run in self.env['workflow.run'].search([
                ('id', 'in', [item['id'] for item in runs if item.get('id')]),
            ])
        }

        for item in runs:
            run = run_map.get(item.get('id'))
            if not run:
                continue
            item['queue_job_id'] = run.queue_job_id.id if run.queue_job_id else False
            item['queue_job_uuid'] = run.queue_job_uuid or False
            item['queue_job_state'] = run.queue_job_state or False
            item['queue_can_cancel'] = bool(run.queue_can_cancel)
        return runs
