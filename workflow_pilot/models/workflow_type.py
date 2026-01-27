# -*- coding: utf-8 -*-

from odoo import api, fields, models, _
from odoo.exceptions import ValidationError


class WorkflowType(models.Model):
    """Node type definitions for workflow builder.
    
    Defines available node types that can be used in workflows.
    Built-in types are loaded via XML data (noupdate=1).
    
    Categories:
        - flow: Control flow nodes (if, loop, noop)
        - integration: External service nodes (http)
        - transform: Data transformation nodes (code, set_data, mapping, validation)
        - data: Variable/data nodes (variable)
        - trigger: Trigger nodes (manual_trigger, webhook) - Phase 4
    """
    _name = 'workflow.type'
    _description = 'Workflow Node Type'
    _order = 'category, sequence, name'

    name = fields.Char(
        string='Name',
        required=True,
        translate=True,
        help='Display name of the node type'
    )
    node_type = fields.Char(
        string='Type Key',
        required=True,
        index=True,
        help='Technical identifier matching frontend registry (e.g., http, if, loop)'
    )
    category = fields.Selection(
        selection=[
            ('trigger', 'Trigger'),
            ('flow', 'Flow Control'),
            ('integration', 'Integration'),
            ('transform', 'Transform'),
            ('data', 'Data'),
        ],
        string='Category',
        required=True,
        default='transform',
        help='Category for grouping in node palette'
    )
    description = fields.Text(
        string='Description',
        translate=True,
        help='Description shown in node palette'
    )
    icon = fields.Char(
        string='Icon',
        help='Icon class or name (e.g., fa-globe, split)'
    )
    sequence = fields.Integer(
        string='Sequence',
        default=10,
        help='Order within category'
    )
    active = fields.Boolean(
        string='Active',
        default=True,
        help='Inactive types are hidden from node palette'
    )
    config_schema = fields.Json(
        string='Configuration Schema',
        default=lambda self: {},
        help='JSON Schema for node configuration validation'
    )
    input_schema = fields.Json(
        string='Input Schema',
        default=lambda self: {},
        help='Expected input data schema'
    )
    output_schema = fields.Json(
        string='Output Schema',
        default=lambda self: {},
        help='Expected output data schema'
    )
    color = fields.Char(
        string='Color',
        help='Hex color for node display (e.g., #3498db)'
    )

    _sql_constraints = [
        ('node_type_uniq', 'UNIQUE(node_type)', 
         'Node type key must be unique!'),
    ]

    @api.constrains('node_type')
    def _check_node_type_format(self):
        """Ensure node_type follows snake_case convention."""
        import re
        pattern = re.compile(r'^[a-z][a-z0-9_]*$')
        for record in self:
            if not pattern.match(record.node_type):
                raise ValidationError(_(
                    "Node type key '%(key)s' must be lowercase snake_case "
                    "(start with letter, only letters/numbers/underscores)",
                    key=record.node_type
                ))

    def name_get(self):
        """Display name with category."""
        result = []
        for record in self:
            name = f"[{record.category}] {record.name}"
            result.append((record.id, name))
        return result

    @api.model
    def get_available_types(self):
        """Return all active node types for frontend.
        
        Called via RPC to populate node palette.
        Returns list of dicts with type definitions.
        """
        types = self.search([('active', '=', True)])
        return [{
            'id': t.id,
            'node_type': t.node_type,
            'name': t.name,
            'category': t.category,
            'description': t.description or '',
            'icon': t.icon or '',
            'color': t.color or '',
            'config_schema': t.config_schema or {},
            'input_schema': t.input_schema or {},
            'output_schema': t.output_schema or {},
        } for t in types]
