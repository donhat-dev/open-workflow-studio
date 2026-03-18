# -*- coding: utf-8 -*-

"""
Workflow Trigger Bridge Model

Links a workflow's trigger node (in the graph canvas) to its backend
activation record (ir.cron, base.automation, or webhook route).

Design: Hybrid approach — trigger nodes live in the canvas for UX,
Odoo infrastructure provides reliable activation.
See ADR-008 for rationale.
"""

import logging
import uuid

from odoo import api, fields, models, _
from odoo.exceptions import UserError

_logger = logging.getLogger(__name__)


class WorkflowTrigger(models.Model):
    """Bridge between a graph trigger-node and its backend activation."""

    _name = 'workflow.trigger'
    _description = 'Workflow Trigger'
    _order = 'workflow_id, trigger_type'

    # === Identity ===
    workflow_id = fields.Many2one(
        'ir.workflow',
        string='Workflow',
        required=True,
        ondelete='cascade',
        index=True,
    )
    node_id = fields.Char(
        string='Graph Node ID',
        required=True,
        help='Node ID inside the workflow snapshot',
    )
    trigger_type = fields.Selection(
        selection=[
            ('manual', 'Manual'),
            ('schedule', 'Schedule'),
            ('webhook', 'Webhook'),
            ('record_event', 'Record Event'),
        ],
        string='Trigger Type',
        required=True,
        index=True,
    )
    active = fields.Boolean(
        string='Active',
        default=False,
        help='Whether this trigger is currently armed',
    )

    # === Schedule trigger ===
    cron_id = fields.Many2one(
        'ir.cron',
        string='Cron Job',
        ondelete='set null',
        help='Linked ir.cron record (schedule triggers only)',
    )

    # === Webhook trigger ===
    webhook_uuid = fields.Char(
        string='Webhook UUID',
        index=True,
        copy=False,
        help='UUID path segment for incoming webhook URL',
    )
    webhook_url = fields.Char(
        string='Webhook URL',
        compute='_compute_webhook_url',
        help='Full URL for external systems to call',
    )

    # === Record event trigger ===
    automation_id = fields.Many2one(
        'base.automation',
        string='Automation Rule',
        ondelete='set null',
        help='Linked base.automation record (record_event triggers only)',
    )

    # === Change detection ===
    config_hash = fields.Char(
        string='Config Hash',
        help='Hash of trigger node config for change detection',
    )
    last_triggered = fields.Datetime(
        string='Last Triggered',
        readonly=True,
    )
    trigger_count = fields.Integer(
        string='Trigger Count',
        default=0,
        readonly=True,
    )

    _sql_constraints = [
        ('workflow_node_uniq', 'UNIQUE(workflow_id, node_id)',
         'A trigger already exists for this node in this workflow.'),
        ('webhook_uuid_uniq', 'UNIQUE(webhook_uuid)',
         'Webhook UUID must be unique.'),
    ]

    # === Computed ===
    @api.depends('webhook_uuid')
    def _compute_webhook_url(self):
        base_url = self.env['ir.config_parameter'].sudo().get_param('web.base.url', '')
        for rec in self:
            if rec.webhook_uuid:
                rec.webhook_url = f'{base_url}/workflow_studio/webhook/{rec.webhook_uuid}'
            else:
                rec.webhook_url = False

    # === Actions ===
    def action_activate(self):
        """Activate this trigger — creates/updates the backend record."""
        for trigger in self:
            method = getattr(trigger, f'_activate_{trigger.trigger_type}', None)
            if method:
                method()
            trigger.active = True

    def action_deactivate(self):
        """Deactivate this trigger — pauses/removes the backend record."""
        for trigger in self:
            method = getattr(trigger, f'_deactivate_{trigger.trigger_type}', None)
            if method:
                method()
            trigger.active = False

    # ------------------------------------------------------------------
    # Manual trigger — no activation needed
    # ------------------------------------------------------------------
    def _activate_manual(self):
        pass

    def _deactivate_manual(self):
        pass

    # ------------------------------------------------------------------
    # Schedule trigger — ir.cron with state='code'
    # ------------------------------------------------------------------
    def _activate_schedule(self):
        """Create or re-enable an ir.cron record."""
        self.ensure_one()
        cron_vals = {
            'name': f'Workflow: {self.workflow_id.name} (trigger {self.node_id})',
            'model_id': self.env['ir.model']._get_id('ir.workflow'),
            'state': 'code',
            'code': (
                f"env['ir.workflow'].browse({self.workflow_id.id})"
                f"._execute_from_trigger('{self.node_id}', 'schedule', {{}})"
            ),
            'active': True,
            'user_id': self.workflow_id.run_as_user_id.id or self.env.ref('base.user_root').id,
        }

        if self.cron_id:
            self.cron_id.write(cron_vals)
        else:
            cron = self.env['ir.cron'].sudo().create({
                **cron_vals,
                'interval_number': 1,
                'interval_type': 'hours',
                'active': False,
            })
            self.cron_id = cron
            self.cron_id.write({'active': True})

    def _deactivate_schedule(self):
        """Pause the linked ir.cron."""
        self.ensure_one()
        if self.cron_id:
            self.cron_id.write({'active': False})

    # ------------------------------------------------------------------
    # Webhook trigger — UUID route
    # ------------------------------------------------------------------
    def _activate_webhook(self):
        """Ensure a webhook UUID is assigned."""
        self.ensure_one()
        if not self.webhook_uuid:
            self.webhook_uuid = str(uuid.uuid4())

    def _deactivate_webhook(self):
        """Clear webhook UUID to disable the route."""
        self.ensure_one()
        self.webhook_uuid = False

    def action_rotate_webhook_uuid(self):
        """Rotate the webhook UUID to invalidate the old URL."""
        self.ensure_one()
        self.webhook_uuid = str(uuid.uuid4())
        return True

    # ------------------------------------------------------------------
    # Record event trigger — base.automation (optional dependency)
    # ------------------------------------------------------------------
    def _activate_record_event(self):
        """Create or update a base.automation record.

        Requires ``base_automation`` module to be installed.
        """
        self.ensure_one()
        if 'base.automation' not in self.env:
            raise UserError(_(
                "The 'Automated Actions' module (base_automation) must be "
                "installed to use record-event triggers."
            ))

        model_rec = self.automation_id.model_id if self.automation_id and self.automation_id.model_id else self.env.ref('base.model_res_partner')
        trigger_event = self.automation_id.trigger if self.automation_id and self.automation_id.trigger else 'on_create_or_write'

        # Server action that calls the workflow
        action_vals = {
            'name': f'WF Trigger: {self.workflow_id.name} / {self.node_id}',
            'model_id': model_rec.id,
            'state': 'code',
            'code': (
                f"env['ir.workflow'].browse({self.workflow_id.id})"
                f"._execute_from_trigger('{self.node_id}', 'record_event', {{"
                f"'model': records._name, "
                f"'record_ids': records.ids, "
                f"'event_type': 'record_event'"
                f"}})"
            ),
            'usage': 'base_automation',
        }

        automation_vals = {
            'name': f'WF: {self.workflow_id.name} ({trigger_event})',
            'model_id': model_rec.id,
            'trigger': trigger_event,
            'active': True,
        }

        if self.automation_id:
            # Update existing
            self.automation_id.write(automation_vals)
            if self.automation_id.action_server_ids:
                self.automation_id.action_server_ids[0].write(action_vals)
            else:
                action = self.env['ir.actions.server'].sudo().create(action_vals)
                self.automation_id.write({'action_server_ids': [(4, action.id)]})
        else:
            action = self.env['ir.actions.server'].sudo().create(action_vals)
            automation_vals['action_server_ids'] = [(4, action.id)]
            automation_vals['filter_domain'] = '[]'
            automation_vals['active'] = False
            automation = self.env['base.automation'].sudo().create(automation_vals)
            self.automation_id = automation
            self.automation_id.write({'active': True})

    def _deactivate_record_event(self):
        """Deactivate linked base.automation."""
        self.ensure_one()
        if self.automation_id:
            self.automation_id.write({'active': False})

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    def _get_node_config(self):
        """Read trigger node config from the published snapshot."""
        self.ensure_one()
        snapshot = self.workflow_id.published_snapshot or {}
        for node in snapshot.get('nodes', []):
            if node.get('id') == self.node_id:
                return node.get('config', {})
        return {}

    def _record_triggered(self):
        """Update audit fields after a trigger fires."""
        self.write({
            'last_triggered': fields.Datetime.now(),
            'trigger_count': self.trigger_count + 1,
        })

    def ensure_linked_backend_record(self):
        """Ensure the backend record exists without leaving the trigger active."""
        self.ensure_one()
        was_active = bool(self.active)

        if self.trigger_type == 'schedule' and not self.cron_id:
            self._activate_schedule()
            if not was_active and self.cron_id:
                self.cron_id.write({'active': False})
        elif self.trigger_type == 'record_event' and not self.automation_id:
            self._activate_record_event()
            if not was_active and self.automation_id:
                self.automation_id.write({'active': False})
        elif self.trigger_type == 'webhook' and not self.webhook_uuid:
            self._activate_webhook()

        if not was_active and self.active:
            self.active = False

    @api.ondelete(at_uninstall=False)
    def _cleanup_backend_records(self):
        """Remove linked backend records when trigger is deleted."""
        for trigger in self:
            if trigger.cron_id:
                trigger.cron_id.sudo().unlink()
            if trigger.automation_id:
                trigger.automation_id.sudo().unlink()
