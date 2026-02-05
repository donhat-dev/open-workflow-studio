# -*- coding: utf-8 -*-

"""
Workflow Field History Mixin

Provides version history for workflow snapshots using full snapshots stored
as compressed, deduplicated blobs (ir.workflow.snapshot.blob).
"""

import copy

from odoo import api, fields, models
from odoo.exceptions import UserError

from .workflow_diff_utils import generate_workflow_comparison, compute_snapshot_hash


class WorkflowFieldHistory(models.AbstractModel):
    _name = "workflow.field.history.mixin"
    _description = "Workflow Field History (Snapshot Blob)"
    _workflow_field_history_size_limit = 50

    workflow_field_history = fields.Json(
        string="Workflow History Data",
        prefetch=False,
        copy=False,
        help="Stores revision history referencing snapshot blobs"
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

    def _get_snapshot_blob_model(self):
        return self.env["ir.workflow.snapshot.blob"]

    def _ensure_snapshot_history(self, field_name):
        history = dict(self.workflow_field_history or {})
        revisions = history.get(field_name, [])
        if revisions and any(not rev.get('snapshot_ref') for rev in revisions):
            self.sudo().workflow_field_history_migrate_to_snapshots(field_name)
            history = dict(self.workflow_field_history or {})
        return history

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
                            'snapshot_ref': rev.get('snapshot_ref'),
                        }
                        metadata[field_name].append(meta)
            rec.workflow_field_history_metadata = metadata

    def _create_snapshot_revision(self, history, field_name, snapshot, note=None, is_milestone=False,
                                  revision_id=None, create_date=None, create_uid=None, create_user_name=None):
        revisions = history.get(field_name) or []
        snapshot_hash = compute_snapshot_hash(snapshot)
        note_value = note or self._context.get('_history_note', 'Auto-save')

        if revisions and revisions[0].get('hash') == snapshot_hash:
            if is_milestone:
                revisions[0]['is_milestone'] = True
                revisions[0]['note'] = note_value
                history[field_name] = self._prune_revisions(revisions)
                return revisions[0].get('revision_id')
            return None

        blob_model = self._get_snapshot_blob_model()
        _blob, blob_hash = blob_model.get_or_create_from_snapshot(snapshot)

        next_revision_id = revision_id
        if not next_revision_id:
            next_revision_id = (revisions[0]['revision_id'] + 1) if revisions else 1

        revisions.insert(0, {
            'revision_id': next_revision_id,
            'type': 'snapshot',
            'snapshot_ref': blob_hash,
            'hash': snapshot_hash,
            'create_date': create_date or self.env.cr.now().isoformat(),
            'create_uid': create_uid or self.env.uid,
            'create_user_name': create_user_name or self.env.user.name,
            'note': note_value,
            'is_milestone': bool(is_milestone),
        })

        history[field_name] = self._prune_revisions(revisions)
        return next_revision_id

    def write(self, vals):
        """Override write to capture version history.

        When a versioned field is modified:
        1. Perform the write
        2. Store full snapshot as compressed blob
        3. FIFO prune to size limit
        """
        versioned_fields = self._get_versioned_fields()
        vals_contain_versioned = set(vals).intersection(versioned_fields)

        result = super().write(vals)

        if not vals_contain_versioned:
            return result

        history = dict(self.workflow_field_history or {})
        new_revisions = False

        for field in versioned_fields:
            if field not in vals:
                continue

            new_content = self[field] or {}
            created_revision_id = self._create_snapshot_revision(history, field, new_content)
            if created_revision_id:
                new_revisions = True

        if new_revisions:
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
        """Get content at specific revision.

        Args:
            field_name: Name of the versioned field
            revision_id: Target revision ID

        Returns:
            Snapshot dict, or None if not found
        """
        self.ensure_one()

        history = self._ensure_snapshot_history(field_name)
        revisions = history.get(field_name, [])

        target_rev = next(
            (r for r in revisions if r['revision_id'] == revision_id),
            None
        )

        if not target_rev:
            return None

        snapshot_ref = target_rev.get('snapshot_ref')
        if not snapshot_ref:
            return None

        snapshot = self._get_snapshot_blob_model().get_snapshot(snapshot_ref)
        return dict(snapshot) if snapshot else None

    def workflow_field_history_get_comparison(self, field_name, revision_id):
        """Generate comparison between current and revision.
        
        Args:
            field_name: Name of the versioned field
            revision_id: Target revision ID to compare against
            
        Returns:
            Comparison dict with nodes/connections/metadata diffs and HTML
        """
        self.ensure_one()

        self._ensure_snapshot_history(field_name)

        current = self[field_name] or {}
        restored = self.workflow_field_history_get_content_at_revision(
            field_name, revision_id
        )

        if restored is None:
            return None

        return generate_workflow_comparison(current, restored)

    def workflow_field_history_mark_milestone(self, field_name, revision_id, name=None):
        """Mark a revision as milestone.

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
        })

        return True

    def workflow_field_history_create_milestone(self, field_name, name=None):
        """Create a milestone from current state.

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
        note = name or f'Milestone v{revision_id}'

        created_revision_id = self._create_snapshot_revision(
            history,
            field_name,
            current,
            note=note,
            is_milestone=True,
            revision_id=revision_id,
        )

        if created_revision_id:
            super().write({'workflow_field_history': history})

        return created_revision_id or revision_id

    def workflow_field_history_migrate_to_snapshots(self, field_name='draft_snapshot'):
        """One-time migration from legacy patch history to snapshot blobs.

        This method rewrites existing history entries to use snapshot_ref.
        It expects legacy entries to be ordered by revision_id desc.

        Returns:
            Number of migrated revisions
        """
        self.ensure_one()

        history = dict(self.workflow_field_history or {})
        revisions = history.get(field_name, [])
        if not revisions:
            return 0

        if all(rev.get('snapshot_ref') for rev in revisions):
            return 0

        snapshot = copy.deepcopy(self[field_name] or {})
        migrated = []
        blob_model = self._get_snapshot_blob_model()

        ordered_revisions = sorted(
            revisions,
            key=lambda r: r.get('revision_id') or 0,
            reverse=True,
        )

        for rev in ordered_revisions:
            snapshot_ref = rev.get('snapshot_ref')
            if snapshot_ref:
                restored = blob_model.get_snapshot(snapshot_ref)
                if restored is not None:
                    snapshot = copy.deepcopy(restored)
                migrated.append({
                    'revision_id': rev.get('revision_id'),
                    'type': 'snapshot',
                    'snapshot_ref': snapshot_ref,
                    'hash': rev.get('hash') or compute_snapshot_hash(snapshot),
                    'create_date': rev.get('create_date'),
                    'create_uid': rev.get('create_uid'),
                    'create_user_name': rev.get('create_user_name'),
                    'note': rev.get('note'),
                    'is_milestone': rev.get('is_milestone', False),
                })
                continue

            if rev.get('type') == 'snapshot' and rev.get('snapshot') is not None:
                snapshot = copy.deepcopy(rev.get('snapshot') or {})
            elif rev.get('type') == 'patch' and rev.get('patch'):
                patch = rev.get('patch') or {}
                if isinstance(patch, dict):
                    for key, old_val in patch.items():
                        snapshot[key] = old_val
            elif rev.get('snapshot') is not None:
                snapshot = copy.deepcopy(rev.get('snapshot') or {})
            elif rev.get('patch'):
                patch = rev.get('patch') or {}
                if isinstance(patch, dict):
                    for key, old_val in patch.items():
                        snapshot[key] = old_val

            _blob, blob_hash = blob_model.get_or_create_from_snapshot(snapshot)
            migrated.append({
                'revision_id': rev.get('revision_id'),
                'type': 'snapshot',
                'snapshot_ref': blob_hash,
                'hash': compute_snapshot_hash(snapshot),
                'create_date': rev.get('create_date'),
                'create_uid': rev.get('create_uid'),
                'create_user_name': rev.get('create_user_name'),
                'note': rev.get('note'),
                'is_milestone': rev.get('is_milestone', False),
            })

        history[field_name] = migrated
        self.write({'workflow_field_history': history})
        return len(migrated)

    def copy_data(self, default=None):
        """Clear history on copy."""
        data = super().copy_data(default)
        for record_data in data:
            record_data['workflow_field_history'] = None
        return data
