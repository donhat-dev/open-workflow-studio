# -*- coding: utf-8 -*-

import hashlib
import json
import copy
from .workflow_executor import WorkflowExecutor

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
    _name = 'ir.workflow'
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
        default=lambda self: {'nodes': [], 'connections': [], 'metadata': {}},
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
            nodes = record.draft_snapshot.get('nodes', []) if record.draft_snapshot else []
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
                vals['draft_snapshot'] = {'nodes': [], 'connections': [], 'metadata': {}}
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
        
        # Ensure required keys exist and have correct types
        if 'nodes' not in snapshot or not isinstance(snapshot.get('nodes'), list):
            snapshot['nodes'] = []
        if 'connections' not in snapshot or not isinstance(snapshot.get('connections'), list):
            snapshot['connections'] = []
        if 'metadata' not in snapshot or not isinstance(snapshot.get('metadata'), dict):
            snapshot['metadata'] = {}
        
        self.write({'draft_snapshot': snapshot})
        
        return {
            'id': self.id,
            'version': self.version,
            'version_hash': self.version_hash,
            'node_count': self.node_count,
        }

    # === Execution Methods ===
    def execute_workflow(self, input_data=None):
        """Execute published workflow synchronously.
        
        Creates a workflow.run record and executes all nodes from start
        to completion. Partial results are persisted for debugging.
        
        Args:
            input_data: Initial input data for workflow (optional)
            
        Returns:
            dict with run_id and output_data
            
        Raises:
            UserError if workflow not published or execution fails
        """
        self.ensure_one()
        
        # Validate workflow is published
        if not self.is_published or not self.published_snapshot:
            raise UserError(_("Workflow must be published before execution."))
        
        if not self.published_snapshot.get('nodes'):
            raise UserError(_("Published workflow has no nodes."))
        
        # Create run record with snapshot copy
        run = self.env['workflow.run'].create({
            'workflow_id': self.id,
            'status': 'pending',
            'input_data': input_data or {},
            'executed_version': self.published_version,
            'executed_snapshot': self.published_snapshot.copy(),
        })
        
        # Execute using WorkflowExecutor
        from .workflow_executor import WorkflowExecutor
        
        executor = WorkflowExecutor(self.env, run)
        try:
            output_data = executor.execute(input_data)
            return {
                'run_id': run.id,
                'run_name': run.name,
                'status': run.status,
                'output_data': output_data,
                'node_count_executed': run.node_count_executed,
                'execution_count': run.execution_count,
                'duration_seconds': run.duration_seconds,
            }
        except Exception as e:
            return {
                'run_id': run.id,
                'run_name': run.name,
                'status': 'failed',
                'error': str(e),
                'node_count_executed': run.node_count_executed,
                'execution_count': run.execution_count,
                'duration_seconds': run.duration_seconds,
            }

    def execute_preview(self, target_node_id=None, input_data=None, config_overrides=None, snapshot=None, max_iterations=None):
        """Execute draft workflow until target node is reached (preview mode).

        Args:
            target_node_id: Node ID to stop after execution
            input_data: Initial input data for workflow
            config_overrides: Dict of nodeId -> config overrides
            snapshot: Optional snapshot to execute (defaults to draft_snapshot)
            max_iterations: Optional iteration limit

        Returns:
            dict with node_outputs, executed_order, execution_count, target_node_id
        """
        self.ensure_one()
        self.check_access('read')

        if not target_node_id:
            raise UserError(_("Target node is required for preview execution."))

        base_snapshot = snapshot or self.draft_snapshot or {}
        if not base_snapshot.get('nodes'):
            raise UserError(_("Draft workflow has no nodes."))

        # Deep copy to avoid mutating stored snapshots
        working_snapshot = copy.deepcopy(base_snapshot)
        metadata = working_snapshot.get('metadata') or {}
        metadata['workflow'] = {
            'id': self.id,
            'name': self.name,
            'active': self.active,
        }
        working_snapshot['metadata'] = metadata

        # Apply config overrides
        if config_overrides:
            if not isinstance(config_overrides, dict):
                raise UserError(_("Invalid config overrides format."))
            overrides = config_overrides
            for node in working_snapshot.get('nodes', []):
                node_id = node.get('id')
                if node_id in overrides:
                    existing = node.get('config') or {}
                    override = overrides.get(node_id) or {}
                    if not isinstance(override, dict):
                        raise UserError(_("Invalid config override for node %s") % node_id)
                    node['config'] = {**existing, **override}


        executor = WorkflowExecutor(self.env, workflow_run=None, snapshot=working_snapshot, persist=False)
        result = executor.execute_until(
            target_node_id=target_node_id,
            input_data=input_data or {},
            max_iterations=max_iterations or 1000,
        )

        # Enrich node outputs with labels for UI mapping
        labels_by_id = {}
        for node in working_snapshot.get('nodes', []):
            node_id = node.get('id')
            labels_by_id[node_id] = node.get('label') or node.get('title') or node.get('type') or node_id

        node_outputs = {}
        for node_id, output in (result.get('node_outputs') or {}).items():
            node_outputs[node_id] = {
                'outputs': output.get('outputs'),
                'json': output.get('json'),
                'error': output.get('error'),
                'meta': output.get('meta'),
                'title': labels_by_id.get(node_id),
            }

        return {
            'status': 'completed',
            'target_node_id': result.get('target_node_id'),
            'execution_count': result.get('execution_count'),
            'executed_order': result.get('executed_order') or [],
            'node_outputs': node_outputs,
            'context_snapshot': result.get('context_snapshot'),
        }
