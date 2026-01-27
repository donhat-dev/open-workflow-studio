# -*- coding: utf-8 -*-

from odoo import api, fields, models, _
from odoo.exceptions import ValidationError


class WorkflowConnection(models.Model):
    """Edges between workflow nodes.
    
    These records serve as a cache of snapshot data for UI queries.
    The source of truth is workflow.draft_snapshot.connections.
    
    Notes:
        - Self-loops (source=target) are allowed per user spec
        - Circular references handled by execution limit (Phase 3)
    """
    _name = 'workflow.connection'
    _description = 'Workflow Connection'
    _order = 'id'

    # === Identity ===
    connection_id = fields.Char(
        string='Connection ID',
        index=True,
        help='Frontend-generated unique ID (optional)'
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

    # === Source ===
    source_node_id = fields.Many2one(
        'workflow.node',
        string='Source Node',
        required=True,
        ondelete='cascade',
        index=True,
        domain="[('workflow_id', '=', workflow_id)]",
        help='Node where connection starts'
    )
    source_socket = fields.Char(
        string='Source Socket',
        required=True,
        default='output',
        help='Output socket name on source node'
    )

    # === Target ===
    target_node_id = fields.Many2one(
        'workflow.node',
        string='Target Node',
        required=True,
        ondelete='cascade',
        index=True,
        domain="[('workflow_id', '=', workflow_id)]",
        help='Node where connection ends'
    )
    target_socket = fields.Char(
        string='Target Socket',
        required=True,
        default='input',
        help='Input socket name on target node'
    )

    # === Metadata ===
    metadata = fields.Json(
        string='Metadata',
        default=lambda self: {},
        help='Additional connection data (labels, conditions, etc.)'
    )

    _sql_constraints = [
        # Note: Self-loops allowed, so no source!=target constraint
        ('connection_uniq', 
         'UNIQUE(workflow_id, source_node_id, source_socket, target_node_id, target_socket)',
         'Duplicate connection between same sockets!'),
    ]

    # === Constraints ===
    @api.constrains('source_node_id', 'target_node_id', 'workflow_id')
    def _check_nodes_same_workflow(self):
        """Ensure source and target belong to same workflow."""
        for record in self:
            if record.source_node_id.workflow_id != record.workflow_id:
                raise ValidationError(_(
                    "Source node '%(source)s' does not belong to workflow '%(workflow)s'.",
                    source=record.source_node_id.label,
                    workflow=record.workflow_id.name
                ))
            if record.target_node_id.workflow_id != record.workflow_id:
                raise ValidationError(_(
                    "Target node '%(target)s' does not belong to workflow '%(workflow)s'.",
                    target=record.target_node_id.label,
                    workflow=record.workflow_id.name
                ))

    # === Display ===
    def name_get(self):
        """Display as 'Source.socket -> Target.socket'."""
        result = []
        for record in self:
            name = (
                f"{record.source_node_id.label}.{record.source_socket} -> "
                f"{record.target_node_id.label}.{record.target_socket}"
            )
            result.append((record.id, name))
        return result
