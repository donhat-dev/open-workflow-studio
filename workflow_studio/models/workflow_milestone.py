# -*- coding: utf-8 -*-

"""
Workflow Milestone Model

Lightweight reference model for quick queries on workflow milestones.
The actual snapshot data is stored in workflow_field_history on ir.workflow.
This model provides:
- Quick listing of milestones across workflows
- Search/filter capabilities
- Optional tagging/categorization
"""

from odoo import api, fields, models


class WorkflowMilestone(models.Model):
    _name = 'ir.workflow.milestone'
    _description = 'Workflow Milestone Reference'
    _order = 'create_date desc'

    workflow_id = fields.Many2one(
        'ir.workflow',
        string='Workflow',
        required=True,
        ondelete='cascade',
        index=True
    )
    revision_id = fields.Integer(
        string='Revision ID',
        required=True,
        help='Reference to revision_id in workflow_field_history'
    )
    name = fields.Char(
        string='Name',
        required=True
    )
    description = fields.Text(
        string='Description'
    )
    tag = fields.Selection(
        [
            ('release', 'Release'),
            ('backup', 'Backup'),
            ('checkpoint', 'Checkpoint'),
            ('other', 'Other'),
        ],
        string='Tag',
        default='checkpoint'
    )

    _sql_constraints = [
        (
            'workflow_revision_uniq',
            'UNIQUE(workflow_id, revision_id)',
            'Milestone reference must be unique per workflow revision!'
        ),
    ]

    def action_restore(self):
        """Restore workflow to this milestone's revision."""
        self.ensure_one()
        return self.workflow_id.workflow_field_history_restore(
            'draft_snapshot',
            self.revision_id
        )

    def action_view_comparison(self):
        """Open comparison dialog for this milestone."""
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': f'Compare with {self.name}',
            'res_model': 'ir.workflow',
            'res_id': self.workflow_id.id,
            'view_mode': 'form',
            'target': 'current',
            'context': {
                'compare_revision_id': self.revision_id,
            },
        }
