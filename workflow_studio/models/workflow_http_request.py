"""Workflow connector request bridge model."""

import hashlib
import json
import logging

from odoo import _, api, fields, models
from odoo.exceptions import ValidationError

_logger = logging.getLogger(__name__)


class WorkflowHttpRequest(models.Model):
    """Backend bridge for connector_request workflow nodes.

    The graph node config in the snapshot is the source of truth for
    execution.  This record augments it with:
    - workspace / connector / endpoint / auth profile binding
    - backend_config_json: additive admin-side overrides
    - health/status observability fields
    - config_hash for change detection
    """

    _name = "workflow.http.request"
    _description = "Workflow Connector HTTP Request"
    _order = "workflow_id, node_id"

    # === Graph binding ===
    workflow_id = fields.Many2one(
        "ir.workflow",
        string="Workflow",
        required=True,
        ondelete="cascade",
        index=True,
    )
    node_id = fields.Char(
        string="Graph Node ID",
        required=True,
        index=True,
        help="node_id inside the workflow snapshot (matches workflow.node.node_id).",
    )

    company_id = fields.Many2one(
        related="workflow_id.company_id",
        store=True,
        string="Company",
        index=True,
    )
    workspace_id = fields.Many2one(
        related="workflow_id.workspace_id",
        store=True,
        string="Workspace",
        index=True,
        readonly=True,
    )

    connector_id = fields.Many2one(
        "workflow.connector",
        string="Connector",
        ondelete="set null",
        index=True,
        help="Connector binding used by this managed request node.",
    )
    endpoint_id = fields.Many2one(
        "workflow.endpoint",
        string="Endpoint Preset",
        ondelete="set null",
        domain="['|', ('connector_id', '=', False), ('connector_id', '=', connector_id)]",
        help="Endpoint preset to use as base config for this node.",
    )
    auth_profile_id = fields.Many2one(
        "workflow.auth.profile",
        string="Auth Profile",
        ondelete="set null",
        domain="['|', ('connector_id', '=', False), ('connector_id', '=', connector_id)]",
        help="Auth profile override. Falls back to the connector default if blank.",
    )
    operation_code = fields.Char(
        string="Operation Code",
        index=True,
        help="Stable logical action key (e.g. 'create_order'). "
        "Used for provider-specific dispatching.",
    )

    # === Toggle ===
    active = fields.Boolean(
        string="Active",
        default=True,
        help="Disable to skip connector behaviour without removing the record.",
    )

    # === Change detection ===
    config_hash = fields.Char(
        string="Config Hash",
        help="MD5 hash of snapshot node config for change detection.",
        readonly=True,
    )

    # === Cached config (read-only snapshots) ===
    snapshot_config_json = fields.Text(
        string="Snapshot Config (cached)",
        readonly=True,
        help="Cached view of the node config from the last sync. "
        "Source of truth remains the workflow snapshot.",
    )
    backend_config_json = fields.Text(
        string="Backend Config Override",
        help="JSON object with admin-managed additive overrides applied at runtime. "
        "Must not duplicate or silently replace snapshot fields.",
    )

    # === UI preview ===
    resolved_url_preview = fields.Char(
        string="Resolved URL (preview)",
        compute="_compute_resolved_url_preview",
        help="Current resolved URL preview for admin inspection. Not used at runtime.",
    )

    # === Observability ===
    last_status_code = fields.Integer(
        string="Last HTTP Status",
        readonly=True,
    )
    last_duration_ms = fields.Integer(
        string="Last Duration (ms)",
        readonly=True,
    )
    last_error = fields.Text(
        string="Last Error",
        readonly=True,
    )
    last_run_at = fields.Datetime(
        string="Last Run At",
        readonly=True,
    )

    _sql_constraints = [
        (
            "bridge_workflow_node_uniq",
            "UNIQUE(workflow_id, node_id)",
            "A connector bridge already exists for this node in this workflow.",
        ),
    ]

    @api.depends("connector_id.base_url", "endpoint_id.path", "endpoint_id.connector_id")
    def _compute_resolved_url_preview(self):
        for rec in self:
            rec.resolved_url_preview = rec.get_effective_endpoint_url()

    def init(self):
        """Migrate legacy workspace_id bindings into connector_id when upgrading."""

        cr = self.env.cr
        cr.execute(
            """
            SELECT 1
            FROM information_schema.columns
            WHERE table_name = 'workflow_http_request'
              AND column_name = 'workspace_id'
            """
        )
        if not cr.fetchone():
            return
        cr.execute(
            """
            UPDATE workflow_http_request request
               SET connector_id = request.workspace_id
             WHERE request.connector_id IS NULL
               AND request.workspace_id IS NOT NULL
               AND EXISTS (
                   SELECT 1
                   FROM workflow_connector connector
                   WHERE connector.id = request.workspace_id
               )
            """
        )

    @api.constrains("backend_config_json")
    def _check_backend_config_json(self):
        for rec in self:
            if rec.backend_config_json:
                try:
                    json.loads(rec.backend_config_json)
                except (ValueError, TypeError):
                    raise ValidationError(
                        _("Backend Config Override must be valid JSON.")
                    )

    @api.constrains("connector_id", "endpoint_id", "auth_profile_id")
    def _check_connector_alignment(self):
        for rec in self:
            if (
                rec.endpoint_id
                and rec.endpoint_id.connector_id
                and rec.endpoint_id.connector_id != rec.connector_id
            ):
                raise ValidationError(
                    _(
                        "Endpoint preset must belong to the selected connector or be global."
                    )
                )
            if (
                rec.auth_profile_id
                and rec.auth_profile_id.connector_id
                and rec.auth_profile_id.connector_id != rec.connector_id
            ):
                raise ValidationError(
                    _(
                        "Auth profile must belong to the selected connector or be global."
                    )
                )

    # === Helpers ===
    def get_backend_config(self):
        """Parse backend_config_json or return empty dict."""
        self.ensure_one()
        if not self.backend_config_json:
            return {}
        try:
            return json.loads(self.backend_config_json)
        except (ValueError, TypeError):
            return {}

    def get_effective_auth_profile(self):
        """Return auth_profile_id or fall back to the connector default."""

        self.ensure_one()
        return self.auth_profile_id or (
            self.connector_id.default_auth_profile_id if self.connector_id else False
        )

    def get_effective_endpoint_url(self):
        """Compute effective URL: endpoint.get_effective_url or snapshot url."""
        self.ensure_one()
        if self.endpoint_id:
            return self.endpoint_id.get_effective_url(self.connector_id)
        return ""

    def update_from_snapshot_config(self, node_config):
        """Sync hash and cached snapshot view from node_config dict."""
        self.ensure_one()
        raw = json.dumps(node_config, sort_keys=True, ensure_ascii=False)
        new_hash = hashlib.md5(raw.encode()).hexdigest()  # noqa: S324
        vals = {
            "config_hash": new_hash,
            "snapshot_config_json": raw,
        }
        self.write(vals)

    def record_execution(self, status_code, duration_ms, error=None):
        """Update observability fields after a connector node executes."""
        self.ensure_one()
        self.write(
            {
                "last_status_code": status_code or 0,
                "last_duration_ms": duration_ms or 0,
                "last_error": error or False,
                "last_run_at": fields.Datetime.now(),
            }
        )

    def get_panel_state(self):
        """Serialize bridge state for the editor panel."""
        self.ensure_one()
        endpoint = self.endpoint_id
        workspace = self.workflow_id.workspace_id
        connector = self.connector_id
        auth_profile = self.get_effective_auth_profile()

        return {
            "bridge_id": self.id,
            "node_id": self.node_id,
            "active": bool(self.active),
            "workspace": {
                "id": workspace.id,
                "name": workspace.name,
                "code": workspace.code,
            }
            if workspace
            else False,
            "connector": {
                "id": connector.id,
                "name": connector.name,
                "code": connector.code,
                "provider_key": connector.provider_key,
                "connector_type": connector.connector_type,
                "environment": connector.environment,
                "base_url": connector.base_url or "",
            }
            if connector
            else False,
            "endpoint": {
                "id": endpoint.id,
                "name": endpoint.name,
                "code": endpoint.code,
                "category": endpoint.category,
                "method": endpoint.method,
                "path": endpoint.path or "",
                "effective_url": self.get_effective_endpoint_url(),
                "requires_auth": endpoint.requires_auth,
                "timeout_seconds": endpoint.timeout_seconds,
            }
            if endpoint
            else False,
            "auth_profile": {
                "id": auth_profile.id,
                "name": auth_profile.name,
                "auth_type": auth_profile.auth_type,
            }
            if auth_profile
            else False,
            "operation_code": self.operation_code or False,
            "last_status_code": self.last_status_code or False,
            "last_duration_ms": self.last_duration_ms or False,
            "last_error": self.last_error or False,
            "last_run_at": self.last_run_at.isoformat()
            if self.last_run_at
            else False,
        }

    def name_get(self):
        result = []
        for rec in self:
            connector_prefix = f"[{rec.connector_id.code}] " if rec.connector_id else ""
            label = f"{connector_prefix}{rec.workflow_id.name} / {rec.node_id}"
            result.append((rec.id, label))
        return result
