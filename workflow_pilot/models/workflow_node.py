# -*- coding: utf-8 -*-

from odoo import api, fields, models, _
from odoo.exceptions import ValidationError


class WorkflowNode(models.Model):
    """Node instances within a workflow.
    
    These records serve as a cache of snapshot data for UI queries.
    The source of truth is workflow.draft_snapshot.
    
    Purpose:
        - Enable relational queries (e.g., "find all HTTP nodes")
        - Support validation before snapshot save
        - Provide indexed access by node_id
    """
    _name = 'workflow.node'
    _description = 'Workflow Node'
    _order = 'sequence, id'
    _rec_name = 'label'

    # === Identity ===
    node_id = fields.Char(
        string='Node ID',
        required=True,
        index=True,
        help='Frontend-generated unique ID (e.g., n_1, n_abc123)'
    )
    label = fields.Char(
        string='Label',
        required=True,
        help='Display label for the node'
    )

    # === Relationships ===
    workflow_id = fields.Many2one(
        'workflow',
        string='Workflow',
        required=True,
        ondelete='cascade',
        index=True,
        help='Parent workflow'
    )
    company_id = fields.Many2one(
        related='workflow_id.company_id',
        string='Company',
        store=True,
        index=True,
        help='Company (inherited from workflow)'
    )

    # === Type Reference ===
    node_type = fields.Char(
        string='Node Type',
        required=True,
        index=True,
        help='Type key matching workflow.type.node_type'
    )
    type_id = fields.Many2one(
        'workflow.type',
        string='Type Definition',
        compute='_compute_type_id',
        store=True,
        help='Reference to workflow.type record'
    )

    # === Position ===
    position_x = fields.Float(
        string='Position X',
        required=True,
        default=0.0,
        help='X coordinate on canvas'
    )
    position_y = fields.Float(
        string='Position Y',
        required=True,
        default=0.0,
        help='Y coordinate on canvas'
    )

    # === Configuration ===
    config = fields.Json(
        string='Configuration',
        default=lambda self: {},
        help='Node-specific configuration (controls values)'
    )

    # === Ordering ===
    sequence = fields.Integer(
        string='Sequence',
        default=10,
        help='Order for display/processing'
    )

    # === Connections (computed) ===
    incoming_connection_ids = fields.One2many(
        'workflow.connection',
        'target_node_id',
        string='Incoming Connections',
        help='Connections where this node is target'
    )
    outgoing_connection_ids = fields.One2many(
        'workflow.connection',
        'source_node_id',
        string='Outgoing Connections',
        help='Connections where this node is source'
    )

    _sql_constraints = [
        ('node_id_workflow_uniq', 'UNIQUE(node_id, workflow_id)',
         'Node ID must be unique within a workflow!'),
    ]

    # === Computed Fields ===
    @api.depends('node_type')
    def _compute_type_id(self):
        """Link to workflow.type by node_type key."""
        WorkflowType = self.env['workflow.type']
        for record in self:
            if record.node_type:
                type_rec = WorkflowType.search([
                    ('node_type', '=', record.node_type)
                ], limit=1)
                record.type_id = type_rec.id if type_rec else False
            else:
                record.type_id = False

    # === Constraints ===
    @api.constrains('position_x', 'position_y')
    def _check_position(self):
        """Ensure position is set (not null)."""
        for record in self:
            if record.position_x is None or record.position_y is None:
                raise ValidationError(_(
                    "Node '%(label)s' must have valid position coordinates.",
                    label=record.label
                ))

    @api.constrains('node_id')
    def _check_node_id_format(self):
        """Validate node_id format."""
        import re
        # Allow common patterns: n_1, n_abc123, node_xyz, etc.
        pattern = re.compile(r'^[a-zA-Z][a-zA-Z0-9_-]*$')
        for record in self:
            if not pattern.match(record.node_id):
                raise ValidationError(_(
                    "Node ID '%(node_id)s' is invalid. Must start with letter, "
                    "contain only letters, numbers, underscores, or hyphens.",
                    node_id=record.node_id
                ))

    # === Display ===
    def name_get(self):
        """Display as 'Label [type]'."""
        result = []
        for record in self:
            name = f"{record.label} [{record.node_type}]"
            result.append((record.id, name))
        return result

    # === Helpers ===
    def get_config_value(self, key, default=None):
        """Get a configuration value safely."""
        self.ensure_one()
        config = self.config or {}
        return config.get(key, default)
