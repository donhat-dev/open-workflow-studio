# -*- coding: utf-8 -*-

import hashlib
import json
import copy
import logging
from datetime import datetime, timedelta
from .workflow_executor import WorkflowExecutor

from odoo import api, fields, models, _
from odoo.exceptions import ValidationError, UserError
from odoo.tools import safe_eval
from odoo.tools import safe_eval as safe_eval_module
from odoo.tools.safe_eval import wrap_module

_logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Wrapped modules for code-node eval context.
# Raw modules are rejected by safe_eval.check_values; wrap_module exposes
# only the whitelisted attributes.  New functions can be added here or via
# _get_eval_globals() inheritance in downstream modules.
# ---------------------------------------------------------------------------
_workflow_time = wrap_module(
    __import__('time'),
    ['time', 'strptime', 'strftime', 'sleep', 'perf_counter'],
)
_workflow_base64 = wrap_module(
    __import__('base64'),
    ['b64encode', 'b64decode'],
)
_workflow_math = wrap_module(
    __import__('math'),
    [
        'ceil', 'floor', 'trunc', 'log', 'log2', 'log10', 'sqrt',
        'pow', 'exp', 'fabs', 'factorial', 'gcd',
        'pi', 'e', 'inf', 'nan',
        'isnan', 'isinf', 'isfinite',
    ],
)
_workflow_re = wrap_module(
    __import__('re'),
    ['search', 'match', 'fullmatch', 'findall', 'sub', 'split', 'compile', 'escape'],
)


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
        
    Version History:
        - Inherits workflow.field.history.mixin for version tracking
        - Stores full snapshots as compressed, deduplicated blobs
        - Supports milestones (protected from FIFO prune)
        - FIFO pruning to 50 versions (milestones protected)
    """
    _name = 'ir.workflow'
    _description = 'Workflow'
    _inherit = ['mail.thread', 'mail.activity.mixin', 'workflow.field.history.mixin']
    _order = 'name'
    _workflow_field_history_size_limit = 50

    def _get_versioned_fields(self):
        """Track history for draft_snapshot field."""
        return ['draft_snapshot']

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
        help='Archived workflows'
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

    # === Security: Run-as User ===
    run_as_user_id = fields.Many2one(
        'res.users',
        string='Run as User',
        help='User context for workflow execution. Leave empty to use current user.',
    )

    # === Security: Model Access Control ===
    model_allowlist = fields.Text(
        string='Model Allowlist (JSON)',
        help='JSON array of model names allowed. Empty = all allowed (except denylist)'
    )
    model_denylist = fields.Text(
        string='Model Denylist (JSON)',
        default='["ir.%"]',
        help='JSON array of model patterns to block. Supports % wildcard. ir.* always blocked.'
    )
    auto_save = fields.Boolean(
        string='Auto Save',
        default=True,
        help='If true, execute will auto-save before running. Node config save will also trigger workflow save.'
    )
    rollback_on_failure = fields.Boolean(
        string='Rollback on Failure',
        default=False,
        help='When enabled, all database side effects from executed nodes '
             '(ORM operations in Code nodes) are rolled back '
             'if any node fails. Execution logs are preserved for debugging.',
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

    # === Trigger / Activation ===
    is_activated = fields.Boolean(
        string='Activated',
        default=False,
        tracking=True,
        help='Master switch: when True, all configured triggers are armed',
    )
    trigger_ids = fields.One2many(
        'workflow.trigger',
        'workflow_id',
        string='Triggers',
        help='Backend trigger registrations (cron, webhook, automation)',
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

        published_snapshot = copy.deepcopy(self.draft_snapshot)
        metadata = published_snapshot.get('metadata')
        if isinstance(metadata, dict):
            metadata.pop('pin_data', None)
            metadata.pop('pinData', None)

        self.write({
            'published_snapshot': published_snapshot,
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
            'auto_save': workflow.auto_save,
            'rollback_on_failure': workflow.rollback_on_failure,
            'draft_snapshot': workflow.draft_snapshot or {},
            'published_snapshot': workflow.published_snapshot or {},
            'node_count': workflow.node_count,
        }

    def save_workflow(self, snapshot, expected_hash=None):
        """Save workflow from editor (also publishes for execution).
        
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
        
        # Save draft_snapshot (pin_data is preserved for editor use)
        self.write({'draft_snapshot': snapshot})
        
        # Also publish (save to both draft and published)
        if snapshot.get('nodes'):
            published = copy.deepcopy(snapshot)
            # Strip pin data from published snapshot — pinned outputs are
            # development-time fixtures that must never run in production.
            pub_meta = published.get('metadata')
            if isinstance(pub_meta, dict):
                pub_meta.pop('pin_data', None)
                pub_meta.pop('pinData', None)
            self.write({
                'published_snapshot': published,
                'published_version': self.version,
                'published_at': fields.Datetime.now(),
            })
        
        return {
            'id': self.id,
            'version': self.version,
            'version_hash': self.version_hash,
            'node_count': self.node_count,
            'is_published': self.is_published,
        }

    # === Execution Methods ===
    # Node types that are automated triggers (not manually invoked).
    _AUTOMATED_TRIGGER_TYPES = {
        'schedule_trigger', 'webhook_trigger', 'record_event_trigger',
    }

    def _find_manual_start_nodes(self, snapshot):
        """Return node IDs suitable for the Run-button execution.

        Strategy:
        1. Collect all start nodes (no incoming connections).
        2. If any of them are ``manual_trigger``, return only those.
        3. Otherwise exclude automated trigger types (schedule/webhook/
           record_event) so they don't fire from a manual Run.
        4. If nothing remains, fall back to all start nodes (let the
           executor raise a meaningful error if truly empty).
        """
        nodes_by_id = {n['id']: n for n in snapshot.get('nodes', [])}
        targets = {
            c.get('target')
            for c in snapshot.get('connections', [])
            if c.get('target')
        }
        start_ids = [
            nid for nid in nodes_by_id
            if nid not in targets
        ]

        # Prefer manual_trigger nodes
        manual = [
            nid for nid in start_ids
            if nodes_by_id[nid].get('type') == 'manual_trigger'
        ]
        if manual:
            return manual

        # Exclude automated triggers
        non_auto = [
            nid for nid in start_ids
            if nodes_by_id[nid].get('type') not in self._AUTOMATED_TRIGGER_TYPES
        ]
        return non_auto or start_ids

    def execute_workflow(self, input_data=None, notify_user=False):
        """Execute published workflow synchronously.
        
        Creates a workflow.run record and executes all nodes from start
        to completion. Partial results are persisted for debugging.

        When multiple trigger nodes exist, only ``manual_trigger`` nodes
        are used as entry points (automated triggers are skipped).  This
        prevents schedule/webhook/record-event triggers from firing when
        the user clicks the **Run** button.
        
        Args:
            input_data: Initial input data for workflow (optional)
            notify_user: If True, send bus notifications per-node for
                         real-time UI progress (manual runs only)
            
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

        execution_snapshot = copy.deepcopy(self.published_snapshot)
        draft_metadata = (self.draft_snapshot or {}).get('metadata') or {}
        pin_data = draft_metadata.get('pin_data') or draft_metadata.get('pinData')
        if pin_data:
            metadata = execution_snapshot.get('metadata')
            if not isinstance(metadata, dict):
                metadata = {}
            metadata['pin_data'] = copy.deepcopy(pin_data)
            metadata.pop('pinData', None)
            execution_snapshot['metadata'] = metadata

        # Determine which start nodes to push (manual triggers only)
        start_node_ids = self._find_manual_start_nodes(execution_snapshot)
        
        # Create run record with snapshot copy
        run = self.env['workflow.run'].create({
            'workflow_id': self.id,
            'status': 'pending',
            'input_data': input_data or {},
            'executed_version': self.published_version,
            'executed_snapshot': execution_snapshot,
        })
        
        # Execute using WorkflowExecutor
        notify_channel = self.env.user.partner_id if notify_user else None
        executor = WorkflowExecutor(
            self.env, run,
            notify_channel=notify_channel,
            rollback_on_failure=self.rollback_on_failure,
        )
        try:
            output_data = executor.execute(
                input_data,
                start_node_ids=start_node_ids or None,
            )
            last_node_id = executor.executed_order[-1] if executor.executed_order else None
            last_result = executor.node_outputs.get(last_node_id) if last_node_id else None
            context_snapshot = executor._build_context_snapshot(last_node_id, last_result)
            return {
                'run_id': run.id,
                'run_name': run.name,
                'status': run.status,
                'output_data': output_data,
                'context_snapshot': context_snapshot,
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


        executor = WorkflowExecutor(
            self.env, workflow_run=None, snapshot=working_snapshot,
            persist=False, rollback_on_failure=self.rollback_on_failure,
        )
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
            redacted = executor._redact_output(output.get('json'), node_id)
            node_outputs[node_id] = {
                'outputs': executor._mask_sensitive_data(output.get('outputs')),
                'json': redacted['display'],
                'error': output.get('error'),
                'meta': output.get('meta'),
                'title': labels_by_id.get(node_id),
            }

        data = {
            'status': result.get('status', 'completed'),
            'error': result.get('error'),
            'error_node_id': result.get('error_node_id'),
            'target_node_id': result.get('target_node_id'),
            'execution_count': result.get('execution_count'),
            'executed_order': result.get('executed_order') or [],
            'node_outputs': node_outputs,
            'context_snapshot': result.get('context_snapshot'),
        }

        return data

    # === Eval Context (extensible) ===

    @api.model
    def _get_eval_globals(self):
        """Return globals dict for safe_eval in code nodes.

        This is the single source of truth for libraries available to
        user-written code expressions.  Other modules can extend the
        set by inheriting ``ir.workflow`` and calling ``super()``:

            class Workflow(models.Model):
                _inherit = 'ir.workflow'

                @api.model
                def _get_eval_globals(self):
                    ctx = super()._get_eval_globals()
                    ctx['my_lib'] = wrap_module(my_lib, ['fn1', 'fn2'])
                    return ctx

        All values **must** be wrapped via ``wrap_module`` (or be plain
        objects/functions).  Raw ``types.ModuleType`` will be rejected
        by ``safe_eval.check_values``.
        """
        return {
            'datetime': safe_eval_module.datetime,
            'dateutil': safe_eval_module.dateutil,
            'time': _workflow_time,
            'json': safe_eval_module.json,
            'base64': _workflow_base64,
            'math': _workflow_math,
            're': _workflow_re,
        }

    def action_save(self):
        """Explicit save action to trigger version increment."""
        self.ensure_one()
        self.check_access('write')
        # Writing the same draft_snapshot to trigger version increment
        self.write({'draft_snapshot': self.draft_snapshot})
        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': {
                "title": _("Workflow saved"),
                "type": "success",
                "sticky": False,
                "message": _("Workflow '%s' has been saved successfully.") % self.name,
            }
        }

    # === Version History RPC Methods ===
    def get_version_history(self, field_name='draft_snapshot'):
        """Get version history metadata for frontend.
        
        Args:
            field_name: Field to get history for (default: draft_snapshot)
            
        Returns:
            List of revision metadata dicts
        """
        self.ensure_one()
        self.check_access('read')
        
        metadata = self.workflow_field_history_metadata or {}
        return metadata.get(field_name, [])

    def get_version_content(self, revision_id, field_name='draft_snapshot'):
        """Get content at specific revision.
        
        Args:
            revision_id: Target revision ID
            field_name: Field to get content for
            
        Returns:
            Snapshot dict at that revision
        """
        self.ensure_one()
        self.check_access('read')
        
        return self.workflow_field_history_get_content_at_revision(
            field_name, revision_id
        )

    def get_version_comparison(self, revision_id, field_name='draft_snapshot'):
        """Get comparison between current and revision.
        
        Args:
            revision_id: Revision ID to compare against
            field_name: Field to compare
            
        Returns:
            Comparison dict with nodes/connections/metadata diffs
        """
        self.ensure_one()
        self.check_access('read')
        
        return self.workflow_field_history_get_comparison(field_name, revision_id)

    def restore_version(self, revision_id, field_name='draft_snapshot'):
        """Restore workflow to specific revision.
        
        Args:
            revision_id: Revision ID to restore to
            field_name: Field to restore
            
        Returns:
            True on success
        """
        self.ensure_one()
        self.check_access('write')
        
        return self.workflow_field_history_restore(field_name, revision_id)

    def create_milestone(self, name=None, field_name='draft_snapshot'):
        """Create milestone from current state.
        
        Args:
            name: Optional milestone name
            field_name: Field to snapshot
            
        Returns:
            New revision_id
        """
        self.ensure_one()
        self.check_access('write')
        
        revision_id = self.workflow_field_history_create_milestone(field_name, name)
        
        # Create or update reference record
        milestone = self.env['ir.workflow.milestone'].search([
            ('workflow_id', '=', self.id),
            ('revision_id', '=', revision_id),
        ], limit=1)

        if milestone:
            if name:
                milestone.name = name
        else:
            self.env['ir.workflow.milestone'].create({
                'workflow_id': self.id,
                'revision_id': revision_id,
                'name': name or f'Milestone v{revision_id}',
            })
        
        return revision_id

    def get_recent_runs(self, limit=50):
        """Get recent execution runs for this workflow (lightweight metadata).

        Args:
            limit: Maximum number of runs to return (default 50)

        Returns:
            List of dicts with run metadata (no snapshot/node data)
        """
        self.ensure_one()
        self.check_access('read')
        runs = self.env['workflow.run'].search(
            [('workflow_id', '=', self.id)],
            limit=limit,
            order='started_at desc',
        )
        result = []
        for run in runs:
            result.append({
                'id': run.id,
                'name': run.name,
                'status': run.status,
                'started_at': run.started_at.isoformat() if run.started_at else None,
                'completed_at': run.completed_at.isoformat() if run.completed_at else None,
                'duration_seconds': run.duration_seconds,
                'execution_count': run.execution_count,
                'node_count_executed': run.node_count_executed,
                'error_message': run.error_message or None,
            })
        return result

    def mark_milestone(self, revision_id, name=None, field_name='draft_snapshot'):
        """Mark existing revision as milestone.
        
        Args:
            revision_id: Revision ID to mark
            name: Optional milestone name
            field_name: Field the revision belongs to
            
        Returns:
            True on success
        """
        self.ensure_one()
        self.check_access('write')
        
        self.workflow_field_history_mark_milestone(field_name, revision_id, name)
        
        # Create reference record if not exists
        existing = self.env['ir.workflow.milestone'].search([
            ('workflow_id', '=', self.id),
            ('revision_id', '=', revision_id),
        ], limit=1)
        
        if not existing:
            self.env['ir.workflow.milestone'].create({
                'workflow_id': self.id,
                'revision_id': revision_id,
                'name': name or f'Milestone v{revision_id}',
            })
        elif name:
            existing.name = name
        
        return True

    # === Trigger / Activation System (ADR-008) ===

    def action_activate_triggers(self):
        """Activate all configured triggers on published workflows.

        Reads the published_snapshot, finds trigger-category nodes,
        and creates / updates ``workflow.trigger`` records plus their
        backend activation records (ir.cron, base.automation, webhook).
        """
        for wf in self:
            if not wf.is_published or not wf.published_snapshot:
                raise UserError(_(
                    "Workflow '%(name)s' must be published before activation.",
                    name=wf.name,
                ))

            snapshot = wf.published_snapshot
            trigger_nodes = wf._extract_trigger_nodes(snapshot)
            if not trigger_nodes:
                raise UserError(_(
                    "Workflow '%(name)s' has no trigger nodes.",
                    name=wf.name,
                ))

            trigger_model = self.env['workflow.trigger'].with_context(active_test=False)
            existing_triggers = {
                t.node_id: t
                for t in trigger_model.search([('workflow_id', '=', wf.id)])
            }
            seen_node_ids = set()

            for node in trigger_nodes:
                node_id = node['id']
                trigger_type = wf._resolve_trigger_type(node)
                seen_node_ids.add(node_id)

                trigger = existing_triggers.get(node_id)
                if trigger:
                    # Update type if changed
                    if trigger.trigger_type != trigger_type:
                        trigger.action_deactivate()
                        trigger.trigger_type = trigger_type
                    trigger.action_activate()
                else:
                    trigger = self.env['workflow.trigger'].create({
                        'workflow_id': wf.id,
                        'node_id': node_id,
                        'trigger_type': trigger_type,
                    })
                    trigger.action_activate()

            # Deactivate stale triggers (nodes removed from snapshot)
            for node_id, trigger in existing_triggers.items():
                if node_id not in seen_node_ids:
                    trigger.action_deactivate()

            wf.is_activated = True

    def action_deactivate_triggers(self):
        """Deactivate all triggers for these workflows."""
        trigger_model = self.env['workflow.trigger'].with_context(active_test=False)
        for wf in self:
            for trigger in trigger_model.search([('workflow_id', '=', wf.id)]):
                trigger.action_deactivate()
            wf.is_activated = False

    def _execute_from_trigger(self, node_id, trigger_type, trigger_data):
        """Entry point called by ir.cron / base.automation / webhook controller.

        The trigger runner receives ``env.context`` merged with
        ``trigger_data`` as its output for downstream nodes.

        Args:
            node_id: Graph node ID of the trigger that fired
            trigger_type: 'schedule' | 'webhook' | 'record_event'
            trigger_data: Dict with trigger-specific payload
        """
        self.ensure_one()

        if not self.is_published or not self.published_snapshot:
            return

        # Update audit fields on the trigger record
        trigger_rec = self.env['workflow.trigger'].with_context(active_test=False).search([
            ('workflow_id', '=', self.id),
            ('node_id', '=', node_id),
        ], limit=1)
        if trigger_rec:
            trigger_rec._record_triggered()

        # Build input_data: merge env.context + trigger metadata
        input_data = {
            '_trigger': {
                'type': trigger_type,
                'node_id': node_id,
                'context': self._sanitize_context(self.env.context),
                **trigger_data,
            },
        }

        self.execute_from_node(
            start_node_id=node_id,
            input_data=input_data,
            notify_user=False,
        )

    def execute_from_node(self, start_node_id, input_data=None, notify_user=False):
        """Execute published workflow starting from a specific trigger node.

        Unlike ``execute_workflow`` which pushes ALL start nodes, this
        method pushes only ``start_node_id`` onto the stack.  Used by
        the Manual Trigger "execute" button to avoid activating sibling
        trigger nodes.

        Args:
            start_node_id: The single trigger node to start from
            input_data: Optional input data
            notify_user: Whether to send bus notifications

        Returns:
            dict with run_id, status, output_data, etc.
        """
        self.ensure_one()

        if not self.is_published or not self.published_snapshot:
            raise UserError(_("Workflow must be published before execution."))

        snapshot = copy.deepcopy(self.published_snapshot)
        draft_metadata = (self.draft_snapshot or {}).get('metadata') or {}
        pin_data = draft_metadata.get('pin_data') or draft_metadata.get('pinData')
        if pin_data:
            metadata = snapshot.get('metadata')
            if not isinstance(metadata, dict):
                metadata = {}
            metadata['pin_data'] = copy.deepcopy(pin_data)
            metadata.pop('pinData', None)
            snapshot['metadata'] = metadata
        if not snapshot.get('nodes'):
            raise UserError(_("Published workflow has no nodes."))

        # Validate the node exists in snapshot
        node_ids = {n.get('id') for n in snapshot.get('nodes', [])}
        if start_node_id not in node_ids:
            raise UserError(_(
                "Node '%(node_id)s' not found in the published workflow.",
                node_id=start_node_id,
            ))

        run = self.env['workflow.run'].create({
            'workflow_id': self.id,
            'status': 'pending',
            'input_data': input_data or {},
            'execution_mode': 'manual',
            'executed_version': self.published_version,
            'executed_snapshot': snapshot.copy(),
        })

        notify_channel = self.env.user.partner_id if notify_user else None
        executor = WorkflowExecutor(
            self.env, run,
            notify_channel=notify_channel,
            rollback_on_failure=self.rollback_on_failure,
        )
        try:
            output_data = executor.execute(
                input_data=input_data,
                start_node_ids=[start_node_id],
            )
            last_node_id = executor.executed_order[-1] if executor.executed_order else None
            last_result = executor.node_outputs.get(last_node_id) if last_node_id else None
            context_snapshot = executor._build_context_snapshot(last_node_id, last_result)
            return {
                'run_id': run.id,
                'run_name': run.name,
                'status': run.status,
                'output_data': output_data,
                'context_snapshot': context_snapshot,
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

    def get_trigger_node_action(self, node_id):
        """Return an ir.actions dict to open the linked backend record.

        For schedule_trigger → opens the linked ir.cron form.
        For record_event_trigger → opens the linked base.automation form.
        For others → returns False (no linked record).

        Args:
            node_id: Graph node ID of the trigger node

        Returns:
            ir.actions dict or False
        """
        self.ensure_one()

        trigger_model = self.env['workflow.trigger'].with_context(active_test=False)
        trigger = trigger_model.search([
            ('workflow_id', '=', self.id),
            ('node_id', '=', node_id),
        ], limit=1)

        if not trigger:
            # FIXME: find a more efficient way to make sure a trigger record exists
            node = self._get_graph_node(node_id)
            if not node:
                return False
            trigger_vals = {
                'workflow_id': self.id,
                'node_id': node_id,
                'trigger_type': self._resolve_trigger_type(node),
                'active': False,
            }
            try:
                with self.env.cr.savepoint():
                    trigger = trigger_model.create(trigger_vals)
            except Exception:
                trigger = trigger_model.search([
                    ('workflow_id', '=', self.id),
                    ('node_id', '=', node_id),
                ], limit=1)
                if not trigger:
                    raise

        trigger.ensure_linked_backend_record()

        if trigger.trigger_type == 'schedule' and trigger.cron_id:
            return {
                'type': 'ir.actions.act_window',
                'name': _('Scheduled Action'),
                'res_model': 'ir.cron',
                'res_id': trigger.cron_id.id,
                'view_mode': 'form',
                'views': [(False, 'form')],
                'target': 'new',
            }

        if trigger.trigger_type == 'record_event' and trigger.automation_id:
            return {
                'type': 'ir.actions.act_window',
                'name': _('Automated Action'),
                'res_model': 'base.automation',
                'res_id': trigger.automation_id.id,
                'view_mode': 'form',
                'views': [(False, 'form')],
                'target': 'new',
            }

        if trigger.trigger_type == 'webhook':
            view_id = self.env.ref(
                'workflow_studio.view_workflow_trigger_webhook_form',
                raise_if_not_found=False,
            )
            return {
                'type': 'ir.actions.act_window',
                'name': _('Webhook Trigger'),
                'res_model': 'workflow.trigger',
                'res_id': trigger.id,
                'view_mode': 'form',
                'views': [(view_id and view_id.id or False, 'form')],
                'target': 'new',
            }

        return False

    def _ensure_trigger_record(self, node_id):
        """Return the trigger record for a graph trigger node, creating it if needed."""
        self.ensure_one()
        node = self._get_graph_node(node_id)
        if not node:
            raise UserError(_("Trigger node '%s' was not found.") % node_id)

        trigger_model = self.env['workflow.trigger'].with_context(active_test=False)
        trigger = trigger_model.search([
            ('workflow_id', '=', self.id),
            ('node_id', '=', node_id),
        ], limit=1)
        if trigger:
            return trigger

        trigger_vals = {
            'workflow_id': self.id,
            'node_id': node_id,
            'trigger_type': self._resolve_trigger_type(node),
            'active': False,
        }
        try:
            with self.env.cr.savepoint():
                return trigger_model.create(trigger_vals)
        except Exception:
            trigger = trigger_model.search([
                ('workflow_id', '=', self.id),
                ('node_id', '=', node_id),
            ], limit=1)
            if trigger:
                return trigger
            raise

    def get_trigger_panel_data(self, node_id):
        """Return dedicated trigger-panel data for a trigger node."""
        self.ensure_one()
        node = self._get_graph_node(node_id)
        if not node:
            raise UserError(_("Trigger node '%s' was not found.") % node_id)

        trigger = self._ensure_trigger_record(node_id)
        backend_warning = False
        should_ensure_backend = False
        if trigger.trigger_type == 'webhook':
            should_ensure_backend = True
        elif trigger.trigger_type in {'schedule', 'record_event'} and self.is_published:
            should_ensure_backend = True

        if should_ensure_backend:
            try:
                trigger.ensure_linked_backend_record()
            except UserError as err:
                backend_warning = err.args[0] if err.args else str(err)

        config = copy.deepcopy(node.get('config') or {})
        warnings = []
        if trigger.trigger_type == 'record_event' and 'base.automation' not in self.env:
            warnings.append(_("Install the Automated Actions module to activate record-event triggers."))
        if trigger.trigger_type != 'manual' and not self.is_published:
            warnings.append(_("Save the workflow before activating or testing this trigger."))
        if backend_warning:
            warnings.append(backend_warning)

        return {
            'node_id': node_id,
            'node_type': node.get('type'),
            'node_title': node.get('label') or node.get('title') or node.get('type'),
            'config': config,
            'warnings': warnings,
            'backend': trigger.get_panel_state(),
        }

    def activate_trigger_node(self, node_id):
        """Activate a single trigger node from the dedicated editor panel."""
        self.ensure_one()
        if not self.is_published or not self.published_snapshot:
            raise UserError(_("Workflow must be saved before activation."))
        trigger = self._ensure_trigger_record(node_id)
        trigger.action_activate()
        active_count = self.env['workflow.trigger'].with_context(active_test=False).search_count([
            ('workflow_id', '=', self.id),
            ('active', '=', True),
        ])
        self.is_activated = bool(active_count)
        return self.get_trigger_panel_data(node_id)

    def deactivate_trigger_node(self, node_id):
        """Deactivate a single trigger node from the dedicated editor panel."""
        self.ensure_one()
        trigger = self._ensure_trigger_record(node_id)
        trigger.action_deactivate()
        active_count = self.env['workflow.trigger'].with_context(active_test=False).search_count([
            ('workflow_id', '=', self.id),
            ('active', '=', True),
        ])
        self.is_activated = bool(active_count)
        return self.get_trigger_panel_data(node_id)

    def rotate_trigger_webhook(self, node_id):
        """Rotate the production webhook secret for a node and return panel data."""
        self.ensure_one()
        trigger = self._ensure_trigger_record(node_id)
        if trigger.trigger_type != 'webhook':
            raise UserError(_("Only webhook triggers support URL rotation."))
        trigger.action_rotate_webhook_uuid()
        return self.get_trigger_panel_data(node_id)

    def start_trigger_webhook_test(self, node_id):
        """Start listening on the temporary editor test webhook endpoint."""
        self.ensure_one()
        if not self.is_published or not self.published_snapshot:
            raise UserError(_("Workflow must be saved before starting test mode."))
        trigger = self._ensure_trigger_record(node_id)
        if trigger.trigger_type != 'webhook':
            raise UserError(_("Only webhook triggers support test listening."))
        trigger.action_start_test_webhook()
        return self.get_trigger_panel_data(node_id)

    def stop_trigger_webhook_test(self, node_id):
        """Stop listening on the temporary editor test webhook endpoint."""
        self.ensure_one()
        trigger = self._ensure_trigger_record(node_id)
        if trigger.trigger_type != 'webhook':
            raise UserError(_("Only webhook triggers support test listening."))
        trigger.action_stop_test_webhook()
        return self.get_trigger_panel_data(node_id)

    def _get_graph_node(self, node_id):
        """Return a graph node from draft snapshot first, then published snapshot."""
        self.ensure_one()
        for snapshot in (self.draft_snapshot or {}, self.published_snapshot or {}):
            for node in snapshot.get('nodes', []):
                if node.get('id') == node_id:
                    return node
        return None

    def _extract_trigger_nodes(self, snapshot):
        """Return list of trigger-category nodes from a snapshot."""
        nodes = snapshot.get('nodes', [])
        trigger_types = set(
            self.env['workflow.type'].search([
                ('category', '=', 'trigger'),
            ]).mapped('node_type')
        )
        return [n for n in nodes if n.get('type') in trigger_types]

    def _resolve_trigger_type(self, node):
        """Map a node's type key to a workflow.trigger trigger_type value."""
        node_type = node.get('type', '')
        mapping = {
            'manual_trigger': 'manual',
            'schedule_trigger': 'schedule',
            'webhook_trigger': 'webhook',
            'record_event_trigger': 'record_event',
        }
        return mapping.get(node_type, 'manual')

    @staticmethod
    def _sanitize_context(ctx):
        """Strip non-serializable / internal keys from env.context."""
        if not ctx:
            return {}
        safe = {}
        for key, value in ctx.items():
            if key.startswith('_'):
                continue
            try:
                json.dumps(value)
                safe[key] = value
            except (TypeError, ValueError):
                continue
        return safe

    @api.model
    def retrieve_list_dashboard(self):
        """Return summary stats for the workflow list header dashboard widget."""
        uid = self.env.uid
        now = datetime.now()
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        seven_days_ago = now - timedelta(days=7)

        all_workflows = self.search([])
        my_workflows = self.search([('create_uid', '=', uid)])

        all_published = sum(1 for w in all_workflows if w.is_published)
        all_draft = len(all_workflows) - all_published
        my_published = sum(1 for w in my_workflows if w.is_published)
        my_draft = len(my_workflows) - my_published

        Run = self.env['workflow.run']
        all_runs_today = Run.search_count([('started_at', '>=', today_start)])
        all_failed_today = Run.search_count([
            ('started_at', '>=', today_start),
            ('status', '=', 'failed'),
        ])

        runs_7d = Run.search([('started_at', '>=', seven_days_ago)])
        total_7d = len(runs_7d)
        failed_7d = sum(1 for r in runs_7d if r.status == 'failed')
        failure_rate_7d = round(failed_7d / total_7d * 100) if total_7d else 0

        completed_runs = Run.search([
            ('status', '=', 'completed'),
            ('duration_seconds', '>', 0),
        ], limit=100)
        if completed_runs:
            avg_dur = sum(r.duration_seconds for r in completed_runs) / len(completed_runs)
            avg_duration_str = f"{avg_dur / 60:.1f}m" if avg_dur >= 60 else f"{avg_dur:.1f}s"
        else:
            avg_duration_str = "0s"

        return {
            'all_published': all_published,
            'all_draft': all_draft,
            'all_total': all_published + all_draft,
            'my_published': my_published,
            'my_draft': my_draft,
            'my_total': my_published + my_draft,
            'all_runs_today': all_runs_today,
            'all_failed_today': all_failed_today,
            'failure_rate_7d': failure_rate_7d,
            'all_avg_duration': avg_duration_str,
        }

    @api.model
    def retrieve_dashboard(self):
        """Return full stats for the workflow dashboard view."""
        uid = self.env.uid
        now = datetime.now()
        Run = self.env['workflow.run']

        # --- Summary ---
        all_workflows = self.search([])
        my_workflows = self.search([('create_uid', '=', uid)])
        published_count = sum(1 for w in all_workflows if w.is_published)
        draft_count = len(all_workflows) - published_count
        running_now = Run.search_count([('status', '=', 'running')])

        summary = {
            'total_workflows': len(all_workflows),
            'published_workflows': published_count,
            'draft_workflows': draft_count,
            'running_now': running_now,
            'my_workflows': len(my_workflows),
        }

        # --- Runs by day ---
        def _day_label(dt):
            return dt.strftime('%b') + ' ' + str(dt.day)

        def _build_run_data(days):
            cutoff = now - timedelta(days=days)
            runs = Run.search([('started_at', '>=', cutoff)])

            keys = [_day_label(now - timedelta(days=days - 1 - i)) for i in range(days)]
            completed_by_day = {k: 0 for k in keys}
            failed_by_day = {k: 0 for k in keys}
            cancelled_by_day = {k: 0 for k in keys}

            for run in runs:
                if not run.started_at:
                    continue
                lbl = _day_label(run.started_at)
                if run.status == 'completed' and lbl in completed_by_day:
                    completed_by_day[lbl] += 1
                elif run.status == 'failed' and lbl in failed_by_day:
                    failed_by_day[lbl] += 1
                elif run.status == 'cancelled' and lbl in cancelled_by_day:
                    cancelled_by_day[lbl] += 1

            return {
                'Completed': [{'label': k, 'value': completed_by_day[k]} for k in keys],
                'Failed': [{'label': k, 'value': failed_by_day[k]} for k in keys],
                'Cancelled': [{'label': k, 'value': cancelled_by_day[k]} for k in keys],
            }

        runs_data = {
            '7d': _build_run_data(7),
            '14d': _build_run_data(14),
            '30d': _build_run_data(30),
        }

        # --- Performance: top failing ---
        fail_counts = {}
        for run in Run.search([('status', '=', 'failed')]):
            name = run.workflow_id.name or 'Unknown'
            fail_counts[name] = fail_counts.get(name, 0) + 1
        top_failing = sorted(
            [{'workflow_name': k, 'fail_count': v} for k, v in fail_counts.items()],
            key=lambda x: x['fail_count'],
            reverse=True,
        )[:5]

        # --- Performance: top slow ---
        dur_total = {}
        dur_count = {}
        for run in Run.search([('status', '=', 'completed'), ('duration_seconds', '>', 0)], limit=200):
            name = run.workflow_id.name or 'Unknown'
            dur_total[name] = dur_total.get(name, 0.0) + run.duration_seconds
            dur_count[name] = dur_count.get(name, 0) + 1

        slow_list = []
        for name in dur_total:
            avg_s = dur_total[name] / dur_count[name]
            avg_str = f"{avg_s / 60:.1f}m" if avg_s >= 60 else f"{avg_s:.1f}s"
            slow_list.append({'workflow_name': name, 'avg_duration': avg_str, '_sort': avg_s})
        top_slow = sorted(slow_list, key=lambda x: x['_sort'], reverse=True)[:5]
        for item in top_slow:
            del item['_sort']

        return {
            'summary': summary,
            'runs': runs_data,
            'performance': {
                'top_failing': top_failing,
                'top_slow': top_slow,
            },
        }