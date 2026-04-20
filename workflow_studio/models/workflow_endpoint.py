"""Workflow endpoint preset model."""

import hashlib
import re

from odoo import _, api, fields, models
from odoo.exceptions import ValidationError

_PATH_PARAM_RE = re.compile(r"\{(\w+)\}")
_NON_ALNUM_RE = re.compile(r"[^a-z0-9]+")


def _slug_from_method_path(method, path):
    """Convert method + path into a snake_case code slug.

    Examples::

        GET  /users/{id}/posts  ->  get_users_id_posts
        POST /api/v2/orders     ->  post_api_v2_orders
    """
    raw = f"{method or ''}_{path or ''}".lower()
    # strip braces from {param} → param
    raw = re.sub(r"[{}]", "", raw)
    # replace any run of non-alphanumeric chars with a single underscore
    slug = _NON_ALNUM_RE.sub("_", raw).strip("_")
    return slug or "endpoint"


class WorkflowEndpoint(models.Model):
    """Named API operation preset.

    Presets can be seeded globally via data files, then scoped to a connector
    when provider-specific overrides are needed.
    """

    _name = "workflow.endpoint"
    _description = "Workflow Endpoint Preset"
    _order = "connector_id, category, name"

    # === Identity ===
    name = fields.Char(
        string="Name",
        compute="_compute_name",
        store=True,
        readonly=False,
        help="Auto-computed from method + path. Can be overridden manually.",
    )
    code = fields.Char(
        string="Code",
        compute="_compute_code",
        store=True,
        readonly=False,
        required=True,
        index=True,
        help="Auto-computed slug from method + path. Can be overridden manually.",
    )

    # === Scope ===
    connector_id = fields.Many2one(
        "workflow.connector",
        string="Connector",
        ondelete="cascade",
        index=True,
        help="Scope this preset to a connector. Leave blank for a global preset.",
    )
    company_id = fields.Many2one(
        related="connector_id.company_id",
        store=True,
        string="Company",
        index=True,
    )

    # === Classification ===
    category = fields.Selection(
        selection=[
            ("auth", "Authentication"),
            ("quote", "Quote / Rate"),
            ("create", "Create Order"),
            ("cancel", "Cancel Order"),
            ("status_sync", "Status Sync"),
            ("webhook_register", "Webhook Register"),
            ("webhook_unregister", "Webhook Unregister"),
            ("label", "Label / Print"),
            ("catalog", "Catalog Sync"),
            ("custom", "Custom"),
        ],
        string="Category",
        default="custom",
        required=True,
        index=True,
    )

    # === HTTP definition ===
    method = fields.Selection(
        selection=[
            ("GET", "GET"),
            ("POST", "POST"),
            ("PUT", "PUT"),
            ("PATCH", "PATCH"),
            ("DELETE", "DELETE"),
            ("HEAD", "HEAD"),
            ("OPTIONS", "OPTIONS"),
        ],
        string="Method",
        default="POST",
        required=True,
    )
    path = fields.Char(
        string="Path",
        help="Relative path appended to connector.base_url (e.g. '/api/v2/orders').",
    )
    base_url = fields.Char(
        string="Base URL",
        compute="_compute_base_url",
        store=True,
        help="Base URL inherited from the linked connector.",
    )
    url = fields.Char(
        string="Full URL",
        compute="_compute_url",
        store=True,
        help="Full URL: base_url + path.",
    )

    # === Templates (JSON text) ===
    headers_template = fields.Text(
        string="Headers Template",
        help="JSON object of default headers for this endpoint.",
    )
    query_template = fields.Text(
        string="Query Params Template",
        help="JSON object of default query parameters.",
    )
    body_template = fields.Text(
        string="Body Template",
        help="JSON object skeleton for the request body.",
    )

    # === Auth ===
    requires_auth = fields.Boolean(
        string="Requires Auth",
        default=True,
        help="Whether this endpoint needs an auth profile resolved at runtime.",
    )

    # === Settings ===
    timeout_seconds = fields.Integer(
        string="Timeout (seconds)",
        default=30,
        help="Per-endpoint timeout override. 0 uses the system default.",
    )
    retry_policy_json = fields.Text(
        string="Retry Policy",
        help='JSON: {"max_retries": 3, "backoff_factor": 1.5, "retry_on": [429, 503]}',
    )

    active = fields.Boolean(string="Active", default=True)

    _sql_constraints = [
        (
            "endpoint_code_connector_uniq",
            "UNIQUE(connector_id, code)",
            "An endpoint with this code already exists for this connector.",
        ),
    ]

    @api.depends("method", "path", "connector_id")
    def _compute_code(self):
        """Compute a snake_case code from method + path, deduplicating within the same connector."""
        for rec in self:
            base_slug = _slug_from_method_path(rec.method, rec.path)
            # Check for collision among existing records in the same connector scope
            # (exclude self so an update to method/path doesn't always collide with itself)
            domain = [
                ("connector_id", "=", rec.connector_id.id if rec.connector_id else False),
                ("code", "=", base_slug),
                ("id", "!=", rec.id or 0),
            ]
            if rec.env["workflow.endpoint"].sudo().search_count(domain):
                # Append a short 6-char hex hash for uniqueness
                h = hashlib.sha1(f"{rec.connector_id.id}:{base_slug}".encode()).hexdigest()[:6]
                rec.code = f"{base_slug}_{h}"
            else:
                rec.code = base_slug

    @api.depends("method", "path")
    def _compute_name(self):
        for rec in self:
            if rec.method and rec.path:
                rec.name = f"{rec.method} {rec.path}"
            elif rec.path:
                rec.name = rec.path
            elif not rec.name:
                rec.name = ""

    @api.depends("connector_id", "connector_id.base_url")
    def _compute_base_url(self):
        for rec in self:
            rec.base_url = (rec.connector_id.get_effective_base_url() if rec.connector_id else "")

    @api.depends("base_url", "path")
    def _compute_url(self):
        for rec in self:
            base = (rec.base_url or "").rstrip("/")
            path = (rec.path or "").lstrip("/")
            if base and path:
                rec.url = f"{base}/{path}"
            else:
                rec.url = base or path or ""

    def init(self):
        """Migrate legacy workspace_id bindings into connector_id when upgrading."""

        cr = self.env.cr
        cr.execute(
            """
            SELECT 1
            FROM information_schema.columns
            WHERE table_name = 'workflow_endpoint'
              AND column_name = 'workspace_id'
            """
        )
        if not cr.fetchone():
            return
        cr.execute(
            """
            UPDATE workflow_endpoint endpoint
               SET connector_id = endpoint.workspace_id
             WHERE endpoint.connector_id IS NULL
               AND endpoint.workspace_id IS NOT NULL
               AND EXISTS (
                   SELECT 1
                   FROM workflow_connector connector
                   WHERE connector.id = endpoint.workspace_id
               )
            """
        )

    @api.constrains("headers_template", "query_template", "body_template", "retry_policy_json")
    def _check_json_fields(self):
        import json

        json_fields = {
            "headers_template": self.headers_template,
            "query_template": self.query_template,
            "body_template": self.body_template,
            "retry_policy_json": self.retry_policy_json,
        }
        for rec in self:
            for fname, fval in json_fields.items():
                val = getattr(rec, fname)
                if val:
                    try:
                        json.loads(val)
                    except (ValueError, TypeError):
                        raise ValidationError(
                            _(
                                "Field '%(field)s' must contain valid JSON.",
                                field=fname,
                            )
                        )

    def get_effective_url(self, connector=None):
        """Build the full URL from connector base_url + path."""

        self.ensure_one()
        active_connector = connector or self.connector_id
        base = (
            active_connector.get_effective_base_url() if active_connector else ""
        )
        path = (self.path or "").lstrip("/")
        return f"{base}/{path}" if (base and path) else (base or path or "")

    def extract_path_params(self):
        """Extract ``{name}`` path parameter tokens from ``self.path``.

        Returns a list of parameter name strings in order of appearance,
        e.g. ``["order_id", "item_id"]`` for path ``/orders/{order_id}/items/{item_id}``.
        """
        self.ensure_one()
        return _PATH_PARAM_RE.findall(self.path or "")

    def get_parsed_template(self, field_name):
        """Parse a JSON template field and return a dict/None."""
        import json

        raw = getattr(self, field_name, None)
        if not raw:
            return None
        try:
            return json.loads(raw)
        except (ValueError, TypeError):
            return None

    def name_get(self):
        result = []
        for rec in self:
            prefix = f"[{rec.connector_id.code}] " if rec.connector_id else ""
            result.append((rec.id, f"{prefix}{rec.name}"))
        return result
