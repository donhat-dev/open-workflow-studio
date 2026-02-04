# -*- coding: utf-8 -*-

"""
Workflow Field History Mixin

Provides version history for workflow snapshots using parent-object level patches.
Inspired by Odoo's html.field.history.mixin but adapted for JSON workflow data.

Key differences from html.field.history.mixin:
- Stores patches at parent-object level (nodes, connections, metadata)
- Each patch contains FULL parent objects, not line-level diffs
- Supports milestone versions with full snapshots
- Safe FIFO pruning (no chain dependency)
"""

from odoo import api, fields, models
from odoo.exceptions import UserError

from .workflow_diff_utils import generate_workflow_comparison, compute_snapshot_hash


class WorkflowFieldHistory(models.AbstractModel):
    _name = "workflow.field.history.mixin"
    _description = "Workflow Field History (Parent-Object Patch)"
    _workflow_field_history_size_limit = 50

    workflow_field_history = fields.Json(
        string="Workflow History Data",
        prefetch=False,
        copy=False,
        help="Stores revision history with parent-object patches or full snapshots"
    )

    workflow_field_history_metadata = fields.Json(
        string="Workflow History Metadata",
        compute="_compute_workflow_history_metadata",
        help="Lightweight metadata for UI (excludes patch/snapshot data)"
    )

    @api.model
    def _get_versioned_fields(self):
        """Override to specify versioned fields.
        
        Returns:
            List of field names to track history for
        """
        return []

    @api.model
    def _get_parent_object_keys(self):
        """Keys to track at parent-object level.
        
        Returns:
            List of keys within the snapshot to track separately
        """
        return ['nodes', 'connections', 'metadata']

    @api.depends("workflow_field_history")
    def _compute_workflow_history_metadata(self):
        """Compute lightweight metadata without patch/snapshot data."""
        for rec in self:
            metadata = None
            if rec.workflow_field_history:
                metadata = {}
                for field_name, revisions in rec.workflow_field_history.items():
                    metadata[field_name] = []
                    for rev in revisions:
                        meta = {
                            'revision_id': rev.get('revision_id'),
                            'type': rev.get('type'),
                            'create_date': rev.get('create_date'),
                            'create_uid': rev.get('create_uid'),
                            'create_user_name': rev.get('create_user_name'),
                            'note': rev.get('note'),
                            'is_milestone': rev.get('is_milestone', False),
                            'hash': rev.get('hash'),
                        }
                        metadata[field_name].append(meta)
            rec.workflow_field_history_metadata = metadata

    def write(self, vals):
        """Override write to capture version history.
        
        When a versioned field is modified:
        1. Capture the OLD content before write
        2. Perform the write
        3. Generate parent-object patch (stores OLD values)
        4. FIFO prune to size limit
        """
        versioned_fields = self._get_versioned_fields()
        vals_contain_versioned = set(vals).intersection(versioned_fields)

        old_contents = {}
        if vals_contain_versioned:
            self.ensure_one()
            # Capture current state BEFORE write
            old_contents = {f: self[f] for f in versioned_fields}

        # Perform write
        result = super().write(vals)

        if not vals_contain_versioned:
            return result

        # Generate parent-object patches
        history = dict(self.workflow_field_history or {})
        parent_keys = self._get_parent_object_keys()

        new_revisions = False
        for field in versioned_fields:
            if field not in vals:
                continue

            new_content = self[field] or {}
            old_content = old_contents.get(field) or {}

            # Skip if no change (by hash)
            new_hash = compute_snapshot_hash(new_content)
            old_hash = compute_snapshot_hash(old_content)
            if new_hash == old_hash:
                continue

            if field not in history:
                history[field] = []

            # Build parent-object patch (store OLD values for changed keys)
            patch = {}
            for key in parent_keys:
                old_val = old_content.get(key)
                new_val = new_content.get(key)
                if old_val != new_val:
                    patch[key] = old_val  # Store PREVIOUS value

            if not patch:
                continue

            revision_id = (
                (history[field][0]['revision_id'] + 1)
                if history[field]
                else 1
            )

            history[field].insert(0, {
                'revision_id': revision_id,
                'type': 'patch',
                'patch': patch,
                'snapshot': None,
                'hash': old_hash,  # Hash of the OLD content
                'create_date': self.env.cr.now().isoformat(),
                'create_uid': self.env.uid,
                'create_user_name': self.env.user.name,
                'note': vals.get('_history_note', 'Auto-save'),
                'is_milestone': False,
            })

            # FIFO prune
            history[field] = self._prune_revisions(history[field])
            new_revisions = True

        # Remove internal note key if present
        vals.pop('_history_note', None)

        if new_revisions:
            # Use super().write to avoid recursion
            super().write({'workflow_field_history': history})

        return result

    def _prune_revisions(self, revisions):
        """FIFO prune: keep milestones + newest non-milestones up to limit.
        
        Milestones are never pruned. Non-milestones are pruned oldest-first
        until total count <= limit.
        
        Args:
            revisions: List of revision dicts
            
        Returns:
            Pruned list of revisions
        """
        limit = self._workflow_field_history_size_limit

        milestones = [r for r in revisions if r.get('is_milestone')]
        non_milestones = [r for r in revisions if not r.get('is_milestone')]

        # Keep all milestones + newest non-milestones
        available_slots = max(0, limit - len(milestones))
        keep_non_milestones = non_milestones[:available_slots]

        # Merge and sort by revision_id desc
        result = milestones + keep_non_milestones
        result.sort(key=lambda r: r['revision_id'], reverse=True)
        return result

    def workflow_field_history_get_content_at_revision(self, field_name, revision_id):
        """Reconstruct content at specific revision.
        
        For patch revisions: Apply parent-object patches from current backward.
        For snapshot revisions: Return the stored snapshot directly.
        
        Args:
            field_name: Name of the versioned field
            revision_id: Target revision ID
            
        Returns:
            Reconstructed snapshot dict, or None if not found
        """
        self.ensure_one()

        history = self.workflow_field_history or {}
        revisions = history.get(field_name, [])

        target_rev = next(
            (r for r in revisions if r['revision_id'] == revision_id),
            None
        )

        if not target_rev:
            return None

        # If milestone with snapshot, return directly
        if target_rev.get('type') == 'snapshot' and target_rev.get('snapshot'):
            return dict(target_rev['snapshot'])

        # Apply parent-object patches from current backward to target
        current = self[field_name] or {}
        result = dict(current)

        # Apply patches: each patch contains the OLD values at that revision
        # We apply all patches from newest to target (inclusive)
        for rev in revisions:
            if rev['revision_id'] < revision_id:
                break

            # For snapshot revisions in the chain, use the snapshot
            if rev.get('type') == 'snapshot' and rev.get('snapshot'):
                result = dict(rev['snapshot'])
                if rev['revision_id'] == revision_id:
                    return result
                continue

            # For patch revisions, apply the patch
            if rev.get('type') == 'patch' and rev.get('patch'):
                patch = rev['patch']
                for key, old_val in patch.items():
                    result[key] = old_val

        return result

    def workflow_field_history_get_comparison(self, field_name, revision_id):
        """Generate comparison between current and revision.
        
        Args:
            field_name: Name of the versioned field
            revision_id: Target revision ID to compare against
            
        Returns:
            Comparison dict with nodes/connections/metadata diffs and HTML
        """
        self.ensure_one()

        current = self[field_name] or {}
        restored = self.workflow_field_history_get_content_at_revision(
            field_name, revision_id
        )

        if restored is None:
            return None

        return generate_workflow_comparison(current, restored)

    def workflow_field_history_mark_milestone(self, field_name, revision_id, name=None):
        """Convert a revision to milestone (store full snapshot).
        
        Milestones:
        - Store full snapshot instead of patch
        - Are protected from FIFO pruning
        - Can be named for easy identification
        
        Args:
            field_name: Name of the versioned field
            revision_id: Revision ID to mark as milestone
            name: Optional name for the milestone
            
        Returns:
            True on success
        """
        self.ensure_one()

        history = dict(self.workflow_field_history or {})
        revisions = history.get(field_name, [])

        found = False
        for rev in revisions:
            if rev['revision_id'] == revision_id:
                found = True

                # If not already a snapshot, reconstruct and store
                if rev.get('type') != 'snapshot':
                    snapshot = self.workflow_field_history_get_content_at_revision(
                        field_name, revision_id
                    )
                    rev['type'] = 'snapshot'
                    rev['snapshot'] = snapshot
                    rev['patch'] = None

                rev['is_milestone'] = True
                rev['note'] = name or rev.get('note') or f'Milestone v{revision_id}'
                break

        if not found:
            raise UserError(f"Revision {revision_id} not found")

        self.write({'workflow_field_history': history})
        return True

    def workflow_field_history_unmark_milestone(self, field_name, revision_id):
        """Remove milestone status from a revision.
        
        Note: The snapshot is kept (not converted back to patch).
        The revision may be pruned in future FIFO operations.
        
        Args:
            field_name: Name of the versioned field
            revision_id: Revision ID to unmark
            
        Returns:
            True on success
        """
        self.ensure_one()

        history = dict(self.workflow_field_history or {})
        revisions = history.get(field_name, [])

        for rev in revisions:
            if rev['revision_id'] == revision_id:
                rev['is_milestone'] = False
                break

        self.write({'workflow_field_history': history})
        return True

    def workflow_field_history_restore(self, field_name, revision_id):
        """Restore workflow to specific revision.
        
        This creates a NEW revision in history with the restored content.
        The restore operation is tracked in history.
        
        Args:
            field_name: Name of the versioned field
            revision_id: Revision ID to restore to
            
        Returns:
            True on success
        """
        self.ensure_one()

        restored = self.workflow_field_history_get_content_at_revision(
            field_name, revision_id
        )

        if restored is None:
            raise UserError(f"Revision {revision_id} not found")

        # Write restored content with note
        self.with_context(_history_note=f'Restored from v{revision_id}').write({
            field_name: restored,
            '_history_note': f'Restored from v{revision_id}',
        })

        return True

    def workflow_field_history_create_milestone(self, field_name, name=None):
        """Create a milestone from current state.
        
        This is a convenience method to snapshot the current state
        as a named milestone.
        
        Args:
            field_name: Name of the versioned field
            name: Optional name for the milestone
            
        Returns:
            The new revision_id
        """
        self.ensure_one()

        history = dict(self.workflow_field_history or {})
        if field_name not in history:
            history[field_name] = []

        revisions = history[field_name]
        revision_id = (revisions[0]['revision_id'] + 1) if revisions else 1

        current = self[field_name] or {}

        revisions.insert(0, {
            'revision_id': revision_id,
            'type': 'snapshot',
            'patch': None,
            'snapshot': dict(current),
            'hash': compute_snapshot_hash(current),
            'create_date': self.env.cr.now().isoformat(),
            'create_uid': self.env.uid,
            'create_user_name': self.env.user.name,
            'note': name or f'Milestone v{revision_id}',
            'is_milestone': True,
        })

        # Prune (milestones protected)
        history[field_name] = self._prune_revisions(revisions)

        super().write({'workflow_field_history': history})
        return revision_id

    def copy_data(self, default=None):
        """Clear history on copy."""
        data = super().copy_data(default)
        for record_data in data:
            record_data['workflow_field_history'] = None
        return data
