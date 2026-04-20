"""Workflow Workspace model.

Workspaces are now the primary organizational boundary for ``ir.workflow``.
Provider-specific integration settings live on ``workflow.connector``.
"""

import re

from odoo import api, fields, models


class WorkflowWorkspace(models.Model):
    """Organizational workspace for grouping workflows."""

    _name = "workflow.workspace"
    _description = "Workflow Workspace"
    _order = "company_id, name"

    # === Identity ===
    name = fields.Char(
        string="Name",
        required=True,
        help="Human-facing workspace name used to organize related workflows.",
    )
    code = fields.Char(
        string="Code",
        index=True,
        copy=False,
        help="Technical workspace slug. Auto-generated from the name when blank.",
    )

    # === Scope ===
    company_id = fields.Many2one(
        "res.company",
        string="Company",
        required=True,
        default=lambda self: self.env.company,
        ondelete="restrict",
        index=True,
    )
    workflow_ids = fields.One2many(
        "ir.workflow",
        "workspace_id",
        string="Workflows",
    )
    workflow_count = fields.Integer(
        compute="_compute_workflow_count",
        string="Workflow Count",
    )
    notes = fields.Text(
        string="Notes",
        help="Internal documentation for this workspace.",
    )
    active = fields.Boolean(string="Active", default=True)

    @api.depends("workflow_ids")
    def _compute_workflow_count(self):
        for rec in self:
            rec.workflow_count = len(rec.workflow_ids)

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if not vals.get("code"):
                vals["code"] = self._generate_code(
                    vals.get("name", ""),
                    vals.get("company_id") or self.env.company.id,
                )
        return super().create(vals_list)

    def _generate_code(self, name, company_id):
        """Slugify *name* and ensure uniqueness within a company."""

        slug_base = (
            re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")
            or "workspace"
        )
        slug = slug_base
        counter = 2
        while self.search(
            [
                ("company_id", "=", company_id),
                ("code", "=", slug),
            ],
            limit=1,
        ):
            slug = f"{slug_base}-{counter}"
            counter += 1
        return slug

    def action_view_workflows(self):
        self.ensure_one()
        action = self.env.ref("workflow_studio.action_ir_workflow").read()[0]
        action["domain"] = [("workspace_id", "=", self.id)]
        action["context"] = {"default_workspace_id": self.id, "active_test": False}
        return action

    def name_get(self):
        result = []
        for rec in self:
            suffix = f" [{rec.code}]" if rec.code else ""
            result.append((rec.id, f"{rec.name}{suffix}"))
        return result
