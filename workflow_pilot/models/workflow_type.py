# -*- coding: utf-8 -*-

import json
import re

from odoo import api, fields, models, _
from odoo.exceptions import ValidationError
from odoo.tools import ormcache


class WorkflowType(models.Model):
    """Node type definitions for workflow builder.
    
    Defines available node types that can be used in workflows.
    Built-in types are loaded via XML data (noupdate=1).
    
    Categories:
        - flow: Control flow nodes (if, loop, switch, noop)
        - integration: External service nodes (http)
        - transform: Data transformation nodes (code, set_data, validation)
        - data: Variable/data nodes (variable)
        - trigger: Trigger nodes (manual_trigger, webhook)
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

    # === Security ===
    group_id = fields.Many2one(
        'res.groups',
        string='Required Group',
        help='Group required to add/configure this node type'
    )

    _NODE_TYPE_RE = re.compile(r'^[a-z][a-z0-9_]*$')

    _sql_constraints = [
        ('node_type_uniq', 'UNIQUE(node_type)', 
         'Node type key must be unique!'),
    ]

    @api.constrains('node_type')
    def _check_node_type_format(self):
        """Ensure node_type follows snake_case convention."""
        for record in self:
            if not self._NODE_TYPE_RE.match(record.node_type):
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

    # ------------------------------------------------------------------
    # CRUD overrides – invalidate ormcache on changes
    # ------------------------------------------------------------------

    @api.model_create_multi
    def create(self, vals_list):
        self.env.registry.clear_cache()
        return super().create(vals_list)

    def write(self, vals):
        if set(vals) & {'node_type', 'output_schema', 'active'}:
            self.env.registry.clear_cache()
        return super().write(vals)

    def unlink(self):
        self.env.registry.clear_cache()
        return super().unlink()

    # ------------------------------------------------------------------
    # Cached socket mapping (consumed by WorkflowExecutor)
    # ------------------------------------------------------------------

    @api.model
    @ormcache()
    def _get_output_socket_mapping(self):
        """Return {node_type_key: [socket_name, ...]} from output_schema.

        Cached via ormcache; invalidated on create/write/unlink of
        workflow.type records.  The mapping drives output routing in
        WorkflowExecutor._socket_to_index.
        """
        self.flush_model(['node_type', 'output_schema', 'active'])
        self.env.cr.execute(
            "SELECT node_type, output_schema "
            "FROM workflow_type "
            "WHERE active = true AND output_schema IS NOT NULL"
        )
        mapping = {}
        for node_type_key, raw_schema in self.env.cr.fetchall():
            schema = raw_schema
            if isinstance(schema, str):
                try:
                    schema = json.loads(schema)
                except (json.JSONDecodeError, TypeError):
                    continue
            if not isinstance(schema, dict) or not schema:
                continue
            sockets = [str(k) for k in schema if k]
            if sockets:
                mapping[node_type_key] = sockets
        return mapping

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
