# -*- coding: utf-8 -*-

from odoo import api, fields, models, _
from odoo.exceptions import UserError

from ..workflow import WorkflowExecutionRegistry


class WorkflowRun(models.Model):
    """Workflow execution record (stub for Phase 1).
    
    This model tracks individual workflow executions.
    Full implementation in Phase 3 (Execution Engine).
    
    Created as stub to:
        - Allow foreign key references from other models
        - Define security rules for future use
        - Establish the schema early for planning
    """
    _name = 'workflow.run'
    _description = 'Workflow Execution Run'
    _order = 'started_at desc'

    # === Identity ===
    name = fields.Char(
        string='Run ID',
        required=True,
        readonly=True,
        default=lambda self: self.env['ir.sequence'].next_by_code('workflow.run') or _('New'),
        help='Unique execution identifier'
    )

    # === Relationships ===
    workflow_id = fields.Many2one(
        'ir.workflow',
        string='Workflow',
        required=True,
        ondelete='restrict',
        index=True,
        help='Executed workflow'
    )
    company_id = fields.Many2one(
        related='workflow_id.company_id',
        string='Company',
        store=True,
        index=True,
        help='Company (inherited from workflow)'
    )

    # === State ===
    status = fields.Selection(
        selection=[
            ('pending', 'Pending'),
            ('running', 'Running'),
            ('completed', 'Completed'),
            ('failed', 'Failed'),
            ('cancelled', 'Cancelled'),
        ],
        string='Status',
        default='pending',
        required=True,
        index=True,
        help='Current execution state'
    )
    execution_mode = fields.Selection(
        selection=[
            ('manual', 'Manual'),
            ('schedule', 'Schedule'),
            ('webhook', 'Webhook'),
            ('record_event', 'Record Event'),
        ],
        string='Execution Mode',
        default='manual',
        index=True,
        help='How this execution was triggered',
    )

    # === Timing ===
    started_at = fields.Datetime(
        string='Started At',
        index=True,
        help='Execution start time'
    )
    completed_at = fields.Datetime(
        string='Completed At',
        help='Execution completion time'
    )
    duration_seconds = fields.Float(
        string='Duration (s)',
        default=0.0,
        digits=(8, 4),
        help='Total execution duration in seconds'
    )

    # === Snapshot Reference ===
    executed_version = fields.Integer(
        string='Executed Version',
        help='Workflow version that was executed'
    )
    executed_snapshot = fields.Json(
        string='Executed Snapshot',
        default=lambda self: {},
        help='Copy of published_snapshot at execution time'
    )
    start_node_ids = fields.Json(
        string='Start Node IDs',
        default=lambda self: [],
        help='Ordered start nodes used to launch this run.',
    )

    # === Input/Output ===
    input_data = fields.Json(
        string='Input Data',
        default=lambda self: {},
        help='Initial data passed to workflow'
    )
    output_data = fields.Json(
        string='Output Data',
        default=lambda self: {},
        help='Final output from workflow execution'
    )
    executed_connections = fields.Json(
        string='Executed Connections',
        default=lambda self: [],
        help='Traversed connections in execution order (source socket -> target socket)'
    )

    # === Error Handling ===
    error_message = fields.Text(
        string='Error Message',
        help='Error message if execution failed'
    )
    error_node_id = fields.Char(
        string='Error Node ID',
        help='Node where error occurred'
    )

    # === Execution Stats ===
    node_count_executed = fields.Integer(
        string='Nodes Executed',
        default=0,
        help='Number of nodes that were executed'
    )
    execution_count = fields.Integer(
        string='Execution Count',
        default=0,
        help='Total node executions (including loops)'
    )

    # === Node Results ===
    node_run_ids = fields.One2many(
        'workflow.run.node',
        'run_id',
        string='Node Results',
        help='Per-node execution results'
    )

    @api.model
    def _prepare_workflow_event_payload(self, event_name, event=None, **extra):
        payload = dict(event or {})
        payload.setdefault('event_name', event_name)
        payload.setdefault('run', self if self else self.env['workflow.run'])
        if self:
            payload.setdefault('workflow', self.workflow_id)
            payload.setdefault('execution_mode', self.execution_mode)
            payload.setdefault('status', self.status)
            payload.setdefault('input_data', self.input_data or {})
        payload.update(extra)
        return payload

    def _emit_workflow_event(self, event_name, event=None, **extra):
        """Dispatch a workflow event — delegates to ir.workflow or registry."""
        self.ensure_one()
        payload = self._prepare_workflow_event_payload(event_name, event=event, **extra)
        if self.workflow_id:
            return self.workflow_id._emit_workflow_event(
                event_name,
                event=payload,
            )
        return WorkflowExecutionRegistry.dispatch(event_name, payload)

    # Cancel hook — overridden by queue module for bidirectional cancel
    def _cancel_requested(self, event):
        return event

    def action_cancel(self):
        for run in self:
            payload = run._prepare_workflow_event_payload('cancel_requested')
            event = run._cancel_requested(payload)
            if event and event.get('handled'):
                continue
            raise UserError(_("Cancellation is not available for this workflow run."))
        return True

    # === Display ===
    def name_get(self):
        """Display as 'Run ID [status]'."""
        result = []
        for record in self:
            status_label = dict(self._fields['status'].selection).get(record.status, record.status)
            name = f"{record.name} [{status_label}]"
            result.append((record.id, name))
        return result


class WorkflowRunNode(models.Model):
    """Per-node execution result (stub for Phase 1).
    
    Tracks the result of executing each node within a run.
    Full implementation in Phase 3 (Execution Engine).
    """
    _name = 'workflow.run.node'
    _description = 'Workflow Run Node Result'
    _order = 'sequence, id'

    # === Relationships ===
    run_id = fields.Many2one(
        'workflow.run',
        string='Run',
        required=True,
        ondelete='cascade',
        index=True,
        help='Parent execution run'
    )
    company_id = fields.Many2one(
        related='run_id.company_id',
        string='Company',
        store=True,
        index=True,
        help='Company (inherited from run)'
    )

    # === Node Reference ===
    node_id = fields.Char(
        string='Node ID',
        required=True,
        index=True,
        help='Node ID from snapshot'
    )
    node_type = fields.Char(
        string='Node Type',
        help='Type of node executed'
    )
    node_label = fields.Char(
        string='Node Label',
        help='Label of node at execution time'
    )

    # === Execution Order ===
    sequence = fields.Integer(
        string='Execution Order',
        default=0,
        help='Order in which node was executed'
    )
    iteration = fields.Integer(
        string='Iteration',
        default=0,
        help='Loop iteration number (0 = first/only run)'
    )

    # === State ===
    status = fields.Selection(
        selection=[
            ('pending', 'Pending'),
            ('running', 'Running'),
            ('completed', 'Completed'),
            ('failed', 'Failed'),
            ('skipped', 'Skipped'),
            ('pinned', 'Pinned'),
        ],
        string='Status',
        default='pending',
        required=True,
        help='Node execution state'
    )

    # === Timing ===
    started_at = fields.Datetime(
        string='Started At',
        help='Node execution start'
    )
    completed_at = fields.Datetime(
        string='Completed At',
        help='Node execution completion'
    )
    duration_ms = fields.Float(
        string='Duration (ms)',
        default=0.0,
        digits=(8, 4),
        help='Node execution time in milliseconds'
    )

    # === Data ===
    input_data = fields.Json(
        string='Input Data',
        default=lambda self: {},
        help='Data received by node'
    )
    output_data = fields.Json(
        string='Output Data',
        default=lambda self: {},
        help='Data produced by node'
    )
    output_socket = fields.Char(
        string='Output Socket',
        help='Which output socket was used'
    )

    # === Error ===
    error_message = fields.Text(
        string='Error Message',
        help='Error if node failed'
    )
