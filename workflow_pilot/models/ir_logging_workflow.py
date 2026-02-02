# -*- coding: utf-8 -*-

from datetime import timedelta
from odoo import api, fields, models


class IrWorkflowLogging(models.Model):
    """Workflow-specific logging with delegation to ir.logging.
    
    Uses _inherits for delegation inheritance:
    - Creates separate ir.workflow.logging table
    - Delegates base logging fields to ir.logging
    - Adds workflow-specific fields
    
    Benefits:
    - Cleaner separation from core ir.logging
    - Workflow logs can be queried independently
    - No pollution of base ir.logging table with workflow fields
    """
    _name = 'ir.workflow.logging'
    _description = 'Workflow Audit Log'
    _inherits = {'ir.logging': 'logging_id'}
    _order = 'create_date desc'

    # === Delegation Link ===
    logging_id = fields.Many2one(
        'ir.logging',
        string='Base Log',
        required=True,
        ondelete='cascade',
        auto_join=True,
        index=True
    )

    # === Workflow Context (Integer for performance) ===
    workflow_run_id = fields.Integer(
        string='Workflow Run ID',
        index=True,
        help='ID of workflow.run record'
    )
    workflow_node_id = fields.Integer(
        string='Workflow Node ID',
        index=True,
        help='ID of workflow.node record'
    )
    workflow_id = fields.Integer(
        string='Workflow ID',
        index=True,
        help='ID of ir.workflow record'
    )

    # === Event Categorization ===
    event_type = fields.Selection([
        ('node_start', 'Node Started'),
        ('node_end', 'Node Ended'),
        ('node_error', 'Node Error'),
        ('model_access', 'Model Accessed'),
        ('secret_access', 'Secret Accessed'),
        ('expression_eval', 'Expression Evaluated'),
        ('output_read', 'Output Read'),
        ('output_unmask', 'Output Unmasked'),
    ], string='Event Type', index=True)

    # === Timing ===
    duration_ms = fields.Integer(string='Duration (ms)')

    # === Masked Message ===
    message_display = fields.Text(
        string='Masked Message',
        help='Masked version of message for non-privileged users'
    )

    # === Model Access Tracking ===
    model_name = fields.Char(string='Model', index=True)
    method_name = fields.Char(string='Method')

    # === Secret Access Tracking ===
    secret_key = fields.Char(string='Secret Key (masked)')

    # === Success/Failure ===
    success = fields.Boolean(string='Success', default=True)

    # === Computed Relations (for UI convenience) ===
    workflow_run = fields.Many2one(
        'workflow.run',
        string='Workflow Run',
        compute='_compute_workflow_run',
        store=False
    )
    workflow_node = fields.Many2one(
        'workflow.node',
        string='Workflow Node',
        compute='_compute_workflow_node',
        store=False
    )

    @api.depends('workflow_run_id')
    def _compute_workflow_run(self):
        for record in self:
            if record.workflow_run_id:
                record.workflow_run = self.env['workflow.run'].browse(record.workflow_run_id)
            else:
                record.workflow_run = False

    @api.depends('workflow_node_id')
    def _compute_workflow_node(self):
        for record in self:
            if record.workflow_node_id:
                record.workflow_node = self.env['workflow.node'].browse(record.workflow_node_id)
            else:
                record.workflow_node = False

    @api.autovacuum
    def _gc_workflow_logs(self):
        """Auto-cleanup workflow logs older than 30 days."""
        limit_date = fields.Datetime.now() - timedelta(days=30)
        self.env.cr.execute("""
            DELETE FROM ir_workflow_logging
            WHERE create_date < %s
        """, (limit_date,))
        return True

    @api.model_create_multi
    def create(self, vals_list):
        """Create workflow log with base ir.logging record."""
        for vals in vals_list:
            # Ensure base logging fields have defaults
            if 'name' not in vals:
                vals['name'] = 'workflow_pilot'
            if 'type' not in vals:
                vals['type'] = 'server'
            if 'dbname' not in vals:
                vals['dbname'] = self.env.cr.dbname
            if 'level' not in vals:
                vals['level'] = 'INFO'
            if 'path' not in vals:
                vals['path'] = ''
            if 'func' not in vals:
                vals['func'] = ''
            if 'line' not in vals:
                vals['line'] = '0'
            if 'message' not in vals:
                vals['message'] = vals.get('message_display', '')
        return super().create(vals_list)
