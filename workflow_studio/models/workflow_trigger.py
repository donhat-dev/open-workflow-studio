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
    webhook_test_uuid = fields.Char(
        string='Test Webhook UUID',
        index=True,
        copy=False,
        help='Ephemeral UUID used by the editor test webhook listener.',
    )
    webhook_test_active = fields.Boolean(
        string='Listening for Test Event',
        default=False,
        help='Whether the temporary test webhook endpoint is currently armed.',
    )
    webhook_test_url = fields.Char(
        string='Test Webhook URL',
        compute='_compute_webhook_test_url',
        help='Temporary URL used for test webhook calls from the editor.',
    )
    webhook_last_test_payload = fields.Json(
        string='Last Test Payload',
        help='Last payload received on the test webhook endpoint.',
    )
    webhook_last_test_triggered = fields.Datetime(
        string='Last Test Triggered',
        readonly=True,
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
           ('webhook_test_uuid_uniq', 'UNIQUE(webhook_test_uuid)',
            'Test webhook UUID must be unique.'),
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

    @api.depends('webhook_test_uuid')
    def _compute_webhook_test_url(self):
        base_url = self.env['ir.config_parameter'].sudo().get_param('web.base.url', '')
        for rec in self:
            if rec.webhook_test_uuid:
                rec.webhook_test_url = f'{base_url}/workflow_studio/webhook-test/{rec.webhook_test_uuid}'
            else:
                rec.webhook_test_url = False

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
        node_config = self._get_node_config()
        interval_number = node_config.get('interval_number') or 1
        interval_type = node_config.get('interval_type') or 'hours'

        try:
            interval_number = max(1, int(interval_number))
        except (TypeError, ValueError):
            interval_number = 1

        allowed_interval_types = {'minutes', 'hours', 'days', 'weeks', 'months'}
        if interval_type not in allowed_interval_types:
            interval_type = 'hours'

        cron_vals = {
            'name': f'Workflow: {self.workflow_id.name} (trigger {self.node_id})',
            'model_id': self.env['ir.model']._get_id('ir.workflow'),
            'state': 'code',
            'code': (
                f"env['ir.workflow'].browse({self.workflow_id.id})"
                f"._execute_from_trigger('{self.node_id}', 'schedule', {{}})"
            ),
            'active': True,
            'interval_number': interval_number,
            'interval_type': interval_type,
            'user_id': self.workflow_id.run_as_user_id.id or self.env.ref('base.user_root').id,
        }

        if self.cron_id:
            self.cron_id.write(cron_vals)
        else:
            cron = self.env['ir.cron'].sudo().create({
                **cron_vals,
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
        """Webhook route is disabled via ``active``; keep UUID stable for UX."""
        self.ensure_one()
        return True

    def action_rotate_webhook_uuid(self):
        """Rotate the webhook UUID to invalidate the old URL."""
        self.ensure_one()
        self.webhook_uuid = str(uuid.uuid4())
        return True

    def action_start_test_webhook(self):
        """Arm the temporary editor test webhook endpoint."""
        self.ensure_one()
        if not self.webhook_test_uuid:
            self.webhook_test_uuid = str(uuid.uuid4())
        self.webhook_test_active = True
        return True

    def action_stop_test_webhook(self):
        """Disarm the temporary editor test webhook endpoint."""
        self.ensure_one()
        self.webhook_test_active = False
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

        node_config = self._get_node_config()
        model_name = (node_config.get('model_name') or '').strip()
        if not model_name:
            raise UserError(_("Record event trigger requires a target model."))

        model_rec = self.env['ir.model']._get(model_name)
        if not model_rec:
            raise UserError(_(
                "Model '%(model)s' was not found.",
                model=model_name,
            ))

        trigger_event = node_config.get('trigger_event') or 'on_create_or_write'
        allowed_events = {'on_create_or_write', 'on_create', 'on_write', 'on_unlink'}
        if trigger_event not in allowed_events:
            trigger_event = 'on_create_or_write'

        filter_domain = node_config.get('filter_domain') or '[]'
        trigger_field_names = node_config.get('trigger_fields') or []
        if not isinstance(trigger_field_names, list):
            trigger_field_names = []

        trigger_fields = self.env['ir.model.fields']
        if trigger_field_names:
            trigger_fields = self.env['ir.model.fields'].search([
                ('model', '=', model_name),
                ('name', 'in', trigger_field_names),
            ])

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
            'filter_domain': filter_domain,
            'trigger_field_ids': [(6, 0, trigger_fields.ids)],
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

    def record_test_webhook_call(self, payload):
        """Persist the most recent test webhook payload for editor QA."""
        self.ensure_one()
        self.write({
            'webhook_last_test_payload': payload or {},
            'webhook_last_test_triggered': fields.Datetime.now(),
        })

    def get_panel_state(self):
        """Serialize trigger backend/runtime state for the editor panel."""
        self.ensure_one()
        return {
            'trigger_id': self.id,
            'node_id': self.node_id,
            'trigger_type': self.trigger_type,
            'active': bool(self.active),
            'workflow_is_published': bool(self.workflow_id.is_published),
            'workflow_is_activated': bool(self.workflow_id.is_activated),
            'last_triggered': self.last_triggered.isoformat() if self.last_triggered else False,
            'trigger_count': self.trigger_count,
            'cron_id': self.cron_id.id if self.cron_id else False,
            'automation_id': self.automation_id.id if self.automation_id else False,
            'webhook_uuid': self.webhook_uuid or False,
            'webhook_url': self.webhook_url or False,
            'webhook_test_uuid': self.webhook_test_uuid or False,
            'webhook_test_active': bool(self.webhook_test_active),
            'webhook_test_url': self.webhook_test_url or False,
            'webhook_last_test_payload': self.webhook_last_test_payload or False,
            'webhook_last_test_triggered': self.webhook_last_test_triggered.isoformat() if self.webhook_last_test_triggered else False,
            'record_event_supported': 'base.automation' in self.env,
        }

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
