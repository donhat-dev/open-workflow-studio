# -*- coding: utf-8 -*-

import hashlib
import json

from odoo import api, fields, models, _
from odoo.exceptions import ValidationError, UserError
from odoo.tools import safe_eval


class Workflow(models.Model):
    """Workflow container with dual-snapshot architecture.
    
    Design Principles:
        - draft_snapshot: Updated on every save (working copy)
        - published_snapshot: Updated on publish (production copy)
        - Execution reads from snapshot JSON, not node records
        - Node/Connection records kept for UI queries and validation
        
    Version Control:
        - version increments on each save
        - version_hash computed from draft_snapshot for conflict detection
    """
    _name = 'workflow'
    _description = 'Workflow'
    _inherit = ['mail.thread', 'mail.activity.mixin']
    _order = 'name'

    # === Identity Fields ===
    name = fields.Char(
        string='Name',
        required=True,
        tracking=True,
        help='Workflow display name'
    )
    description = fields.Text(
        string='Description',
        tracking=True,
        help='Purpose and notes about this workflow'
    )
    active = fields.Boolean(
        string='Active',
        default=True,
        tracking=True,
        help='Archived workflows are hidden from lists'
    )

    # === Multi-company ===
    company_id = fields.Many2one(
        'res.company',
        string='Company',
        required=True,
        default=lambda self: self.env.company,
        index=True,
        help='Company that owns this workflow'
    )

    # === Ownership ===
    user_id = fields.Many2one(
        'res.users',
        string='Owner',
        required=True,
        default=lambda self: self.env.user,
        tracking=True,
        help='User who created/owns this workflow'
    )

    # === Snapshot Architecture ===
    draft_snapshot = fields.Json(
        string='Draft Snapshot',
        default=lambda self: {'nodes': {}, 'connections': [], 'metadata': {}},
        help='Working copy updated on every save. Contains full graph state.'
    )
    published_snapshot = fields.Json(
        string='Published Snapshot',
        default=lambda self: {},
        help='Production copy updated on publish. Execution uses this.'
    )
    is_published = fields.Boolean(
        string='Is Published',
        compute='_compute_is_published',
        store=True,
        help='True if workflow has been published at least once'
    )

    # === Version Control ===
    version = fields.Integer(
        string='Version',
        default=1,
        readonly=True,
        help='Increments on each save'
    )
    version_hash = fields.Char(
        string='Version Hash',
        compute='_compute_version_hash',
        store=True,
        help='Hash of draft_snapshot for conflict detection'
    )
    published_version = fields.Integer(
        string='Published Version',
        default=0,
        readonly=True,
        help='Version number when last published'
    )
    published_at = fields.Datetime(
        string='Published At',
        readonly=True,
        help='Timestamp of last publish'
    )

    # === Node Limit ===
    node_count = fields.Integer(
        string='Node Count',
        compute='_compute_node_count',
        store=True,
        help='Number of nodes in draft snapshot'
    )

    # === Relationships ===
    node_ids = fields.One2many(
        'workflow.node',
        'workflow_id',
        string='Nodes',
        help='Node records (cache of snapshot for UI queries)'
    )
    connection_ids = fields.One2many(
        'workflow.connection',
        'workflow_id',
        string='Connections',
        help='Connection records (cache of snapshot for UI queries)'
    )
    run_ids = fields.One2many(
        'workflow.run',
        'workflow_id',
        string='Runs',
        help='Execution history'
    )

    _sql_constraints = [
        ('name_company_uniq', 'UNIQUE(name, company_id)',
         'Workflow name must be unique per company!'),
    ]

    # === Computed Fields ===
    @api.depends('published_snapshot')
    def _compute_is_published(self):
        for record in self:
            record.is_published = bool(record.published_snapshot)

    @api.depends('draft_snapshot')
    def _compute_version_hash(self):
        for record in self:
            if record.draft_snapshot:
                snapshot_str = json.dumps(record.draft_snapshot, sort_keys=True)
                record.version_hash = hashlib.md5(snapshot_str.encode()).hexdigest()[:16]
            else:
                record.version_hash = False

    @api.depends('draft_snapshot')
    def _compute_node_count(self):
        for record in self:
            nodes = record.draft_snapshot.get('nodes', {}) if record.draft_snapshot else {}
            record.node_count = len(nodes)

    # === Constraints ===
    @api.constrains('node_count')
    def _check_node_limit(self):
        """Limit nodes to 200 per workflow (Phase 1)."""
        max_nodes = 200
        for record in self:
            if record.node_count > max_nodes:
                raise ValidationError(_(
                    "Workflow '%(name)s' has %(count)d nodes. "
                    "Maximum allowed is %(max)d.",
                    name=record.name,
                    count=record.node_count,
                    max=max_nodes
                ))

    # === CRUD Overrides ===
    @api.model_create_multi
    def create(self, vals_list):
        """Initialize version and ensure snapshot structure."""
        for vals in vals_list:
            if 'draft_snapshot' not in vals:
                vals['draft_snapshot'] = {'nodes': {}, 'connections': [], 'metadata': {}}
            vals['version'] = 1
        return super().create(vals_list)

    def write(self, vals):
        """Increment version on snapshot changes."""
        if 'draft_snapshot' in vals:
            for record in self:
                vals['version'] = record.version + 1
        return super().write(vals)

    def copy(self, default=None):
        """Copy workflow with reset state."""
        default = dict(default or {})
        default.update({
            'name': _('%s (Copy)', self.name),
            'version': 1,
            'published_snapshot': {},
            'published_version': 0,
            'published_at': False,
        })
        return super().copy(default)

    # === Core Actions ===
    def action_publish(self):
        """Publish current draft snapshot for execution."""
        self.ensure_one()
        if not self.draft_snapshot or not self.draft_snapshot.get('nodes'):
            raise UserError(_("Cannot publish an empty workflow."))
        
        self.write({
            'published_snapshot': self.draft_snapshot.copy(),
            'published_version': self.version,
            'published_at': fields.Datetime.now(),
        })
        return True

    def action_unpublish(self):
        """Remove published snapshot (stop execution)."""
        self.ensure_one()
        self.write({
            'published_snapshot': {},
            'published_version': 0,
            'published_at': False,
        })
        return True

    # === RPC Methods for Frontend ===
    @api.model
    def load_workflow(self, workflow_id):
        """Load workflow for editor.
        
        Args:
            workflow_id: Database ID of workflow
            
        Returns:
            dict with workflow data and snapshot
            
        Raises:
            UserError if workflow not found
        """
        workflow = self.browse(workflow_id)
        if not workflow.exists():
            raise UserError(_("Workflow not found."))
        
        workflow.check_access('read')
        
        return {
            'id': workflow.id,
            'name': workflow.name,
            'description': workflow.description or '',
            'version': workflow.version,
            'version_hash': workflow.version_hash,
            'is_published': workflow.is_published,
            'draft_snapshot': workflow.draft_snapshot or {},
            'published_snapshot': workflow.published_snapshot or {},
            'node_count': workflow.node_count,
        }

    def save_workflow(self, snapshot, expected_hash=None):
        """Save workflow from editor.
        
        Args:
            snapshot: Full graph snapshot from frontend
            expected_hash: Hash client expects (for conflict detection)
            
        Returns:
            dict with new version info
            
        Raises:
            UserError on conflict (hash mismatch)
        """
        self.ensure_one()
        self.check_access('write')
        
        # Conflict detection: raise error if hash mismatch
        if expected_hash and self.version_hash and expected_hash != self.version_hash:
            raise UserError(_("Workflow was modified by another user. Please reload to see changes."))
        
        # Validate snapshot structure
        if not isinstance(snapshot, dict):
            raise UserError(_("Invalid snapshot format."))
        
        # Ensure required keys exist
        if 'nodes' not in snapshot:
            snapshot['nodes'] = {}
        if 'connections' not in snapshot:
            snapshot['connections'] = []
        if 'metadata' not in snapshot:
            snapshot['metadata'] = {}
        
        self.write({'draft_snapshot': snapshot})
        
        return {
            'id': self.id,
            'version': self.version,
            'version_hash': self.version_hash,
            'node_count': self.node_count,
        }
