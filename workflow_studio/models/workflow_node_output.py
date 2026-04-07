from odoo import fields, models


class WorkflowNodeOutput(models.Model):
    """Workflow Node Output with dual storage (raw + masked).

    Stores execution outputs with separate raw (privileged) and
    display (masked) versions for security.
    """

    _name = "workflow.node.output"
    _description = "Workflow Node Output"
    _order = "create_date desc"

    # === Relationships ===
    run_id = fields.Many2one(
        "workflow.run",
        string="Workflow Run",
        required=True,
        ondelete="cascade",
        index=True,
    )
    node_id = fields.Many2one(
        "workflow.node",
        string="Workflow Node",
        required=True,
        ondelete="cascade",
        index=True,
    )

    # === Dual Outputs ===
    output_raw = fields.Text(
        string="Raw Output",
        groups="base.group_system",
        help="Unmasked output (may contain secrets)",
    )
    output_display = fields.Text(
        string="Display Output", help="Masked output for general viewing"
    )

    # === JSON for Programmatic Access ===
    output_json = fields.Text(string="Output JSON")

    # === Company (inherited) ===
    company_id = fields.Many2one(
        related="run_id.company_id", string="Company", store=True, index=True
    )
