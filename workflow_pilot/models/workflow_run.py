# -*- coding: utf-8 -*-

from odoo import api, fields, models, _


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
        compute='_compute_duration',
        store=True,
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

    # === Computed Fields ===
    @api.depends('started_at', 'completed_at')
    def _compute_duration(self):
        for record in self:
            if record.started_at and record.completed_at:
                delta = record.completed_at - record.started_at
                record.duration_seconds = delta.total_seconds()
            else:
                record.duration_seconds = 0.0

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
