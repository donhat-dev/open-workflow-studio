"""
Workflow Connector Model.

Separates provider/integration configuration from workflow organization.
A connector owns reusable endpoint/auth presets and is the backend binding
anchor for managed connector nodes.
"""

import copy
import json
import re

from odoo import _, api, fields, models


class WorkflowConnector(models.Model):
    """Provider-specific integration boundary."""

    _name = "workflow.connector"
    _description = "Workflow Connector"
    _inherit = ["image.mixin"]
    _order = "company_id, name"

    name = fields.Char(
        string="Name",
        required=True,
        help="Human-facing connector name (for example 'Viettel Post Production').",
    )
    code = fields.Char(
        string="Code",
        index=True,
        copy=False,
        help="Technical connector slug. Generated from the name when left blank.",
    )
    company_id = fields.Many2one(
        "res.company",
        string="Company",
        required=True,
        default=lambda self: self.env.company,
        ondelete="restrict",
        index=True,
    )
    provider_key = fields.Char(
        string="Provider Key",
        index=True,
        help="Stable provider key such as viettelpost, lalamove, or generic_rest.",
    )
    connector_type = fields.Selection(
        selection=[
            ("shipping", "Shipping"),
            ("marketplace", "Marketplace"),
            ("crm", "CRM"),
            ("finance", "Finance"),
            ("generic_rest", "Generic REST"),
            ("custom", "Custom"),
        ],
        string="Connector Type",
        default="generic_rest",
        required=True,
        help="Broad connector family used for grouping and future capability gates.",
    )
    environment = fields.Selection(
        selection=[
            ("sandbox", "Sandbox"),
            ("production", "Production"),
            ("custom", "Custom"),
        ],
        string="Environment",
        default="sandbox",
        required=True,
        index=True,
    )
    base_url = fields.Char(
        string="Base URL",
        help="Default API host used when endpoint presets provide relative paths.",
    )
    default_auth_profile_id = fields.Many2one(
        "workflow.auth.profile",
        string="Default Auth Profile",
        domain="['|', ('connector_id', '=', False), ('connector_id', '=', id)]",
        ondelete="set null",
        help="Fallback auth profile used by managed connector nodes.",
    )
    node_type_tmpl_id = fields.Many2one(
        "workflow.type",
        string="Node Type Template",
        ondelete="set null",
        help="Schema template for endpoint-derived nodes. Defaults to the HTTP node type.",
    )
    endpoint_ids = fields.One2many(
        "workflow.endpoint",
        "connector_id",
        string="Endpoints",
    )
    auth_profile_ids = fields.One2many(
        "workflow.auth.profile",
        "connector_id",
        string="Auth Profiles",
    )
    http_request_ids = fields.One2many(
        "workflow.http.request",
        "connector_id",
        string="Connector Nodes",
    )
    endpoint_count = fields.Integer(
        compute="_compute_counts",
        string="Endpoint Count",
    )
    auth_profile_count = fields.Integer(
        compute="_compute_counts", string="Auth Profile Count"
    )
    workflow_count = fields.Integer(
        compute="_compute_counts",
        string="Workflow Count",
    )
    http_request_count = fields.Integer(
        compute="_compute_counts",
        string="Connector Node Count",
    )
    notes = fields.Text(
        string="Notes",
        help="Internal documentation for this connector binding.",
    )
    active = fields.Boolean(string="Active", default=True)

    _sql_constraints = [
        (
            "connector_code_company_uniq",
            "UNIQUE(company_id, provider_key, code)",
            "A connector with this code already exists for this company and provider.",
        ),
    ]

    @api.depends("endpoint_ids", "auth_profile_ids", "http_request_ids.workflow_id")
    def _compute_counts(self):
        for rec in self:
            workflows = rec.http_request_ids.mapped("workflow_id")
            rec.endpoint_count = len(rec.endpoint_ids)
            rec.auth_profile_count = len(rec.auth_profile_ids)
            rec.workflow_count = len(workflows)
            rec.http_request_count = len(rec.http_request_ids)

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if not vals.get("code"):
                vals["code"] = self._generate_code(
                    vals.get("name", ""),
                    vals.get("company_id") or self.env.company.id,
                    vals.get("provider_key") or "",
                )
        return super().create(vals_list)

    def _generate_code(self, name, company_id, provider_key):
        """Slugify *name* and ensure uniqueness inside a company/provider pair."""

        slug_base = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")
        slug_base = slug_base or "connector"
        slug = slug_base
        counter = 2
        while self.search(
            [
                ("company_id", "=", company_id),
                ("provider_key", "=", provider_key or False),
                ("code", "=", slug),
            ],
            limit=1,
        ):
            slug = f"{slug_base}-{counter}"
            counter += 1
        return slug

    def get_effective_base_url(self):
        """Return the connector base URL without a trailing slash."""

        self.ensure_one()
        return (self.base_url or "").rstrip("/")

    def action_view_endpoints(self):
        self.ensure_one()
        action = self.env.ref("workflow_studio.action_workflow_endpoint").read()[0]
        action["domain"] = [("connector_id", "=", self.id)]
        action["context"] = {"default_connector_id": self.id, "active_test": False}
        return action

    def action_view_auth_profiles(self):
        self.ensure_one()
        action = self.env.ref("workflow_studio.action_workflow_auth_profile").read()[0]
        action["domain"] = [("connector_id", "=", self.id)]
        action["context"] = {"default_connector_id": self.id, "active_test": False}
        return action

    def action_view_workflows(self):
        self.ensure_one()
        workflow_ids = self.http_request_ids.mapped("workflow_id").ids
        action = self.env.ref("workflow_studio.action_ir_workflow").read()[0]
        action["domain"] = [("id", "in", workflow_ids)]
        action["context"] = {"active_test": False}
        return action

    def action_view_http_requests(self):
        self.ensure_one()
        action = self.env.ref("workflow_studio.action_workflow_http_request").read()[0]
        action["domain"] = [("connector_id", "=", self.id)]
        action["context"] = {"default_connector_id": self.id, "active_test": False}
        return action

    def name_get(self):
        result = []
        for rec in self:
            env_label = dict(self._fields["environment"].selection).get(
                rec.environment, rec.environment
            )
            provider = f"{rec.provider_key} • " if rec.provider_key else ""
            result.append((rec.id, f"{provider}{rec.name} [{env_label}]"))
        return result

    # ------------------------------------------------------------------
    # Virtual endpoint node types
    # ------------------------------------------------------------------

    def _get_node_type_template(self):
        """Return the workflow.type record to use as schema template."""
        self.ensure_one()
        if self.node_type_tmpl_id:
            return self.node_type_tmpl_id
        return self.env.ref("workflow_studio.workflow_type_http", raise_if_not_found=False)

    def build_endpoint_node_types(self):
        """Generate virtual node type dicts for each active endpoint.

        Returns a list of dicts compatible with ``workflow.type.get_available_types()``.
        Each endpoint becomes a separate node in the palette, grouped under the
        connector name.
        """
        self.ensure_one()
        template = self._get_node_type_template()
        if not template:
            return []

        def _normalize(raw):
            if isinstance(raw, dict):
                return raw
            if isinstance(raw, str):
                try:
                    return json.loads(raw)
                except (json.JSONDecodeError, TypeError):
                    return {}
            return {}

        base_config = copy.deepcopy(_normalize(template.config_schema))
        input_schema = _normalize(template.input_schema)
        output_schema = _normalize(template.output_schema)

        result = []
        for ep in self.endpoint_ids.filtered("active"):
            config_schema = copy.deepcopy(base_config)

            # --- inject hidden binding fields ---
            config_schema["_runtime_node_type"] = {
                "type": "string",
                "hidden": True,
                "default": "connector_request",
            }
            config_schema["connector_id"] = {
                "type": "number",
                "hidden": True,
                "default": self.id,
            }
            config_schema["endpoint_id"] = {
                "type": "number",
                "hidden": True,
                "default": ep.id,
            }
            if self.default_auth_profile_id:
                config_schema["auth_profile_id"] = {
                    "type": "number",
                    "hidden": True,
                    "default": self.default_auth_profile_id.id,
                }

            # --- pre-fill defaults from endpoint ---
            if "method" in config_schema:
                config_schema["method"]["default"] = ep.method or "GET"
            if "url" in config_schema:
                config_schema["url"]["default"] = ep.get_effective_url(self) or ""
                config_schema["url"]["placeholder"] = ep.get_effective_url(self) or ""

            # headers from template
            headers_data = ep.get_parsed_template("headers_template")
            if headers_data and isinstance(headers_data, dict) and "headers" in config_schema:
                config_schema["headers"]["default"] = [
                    {"key": k, "value": v, "enabled": True}
                    for k, v in headers_data.items()
                ]

            # query params from template
            query_data = ep.get_parsed_template("query_template")
            if query_data and isinstance(query_data, dict) and "query_params" in config_schema:
                config_schema["query_params"]["default"] = [
                    {"key": k, "value": v, "enabled": True}
                    for k, v in query_data.items()
                ]

            # body from template
            body_data = ep.get_parsed_template("body_template")
            if body_data and "body_config" in config_schema:
                config_schema["body_config"]["default"] = {
                    "content_type": "json",
                    "body": json.dumps(body_data, indent=2) if isinstance(body_data, dict) else str(body_data),
                    "form_data": [],
                }

            # timeout
            if ep.timeout_seconds and "timeout" in config_schema:
                config_schema["timeout"]["default"] = ep.timeout_seconds

            # remove auth control (managed by connector auth profile at runtime)
            config_schema.pop("auth", None)

            # --- path parameters from {name} tokens in endpoint path ---
            path_params = ep.extract_path_params()
            if path_params:
                config_schema["path_params"] = {
                    "type": "query_params",
                    "label": "Path Parameters",
                    "section": "request",
                    "default": [
                        {"key": p, "value": "", "enabled": True}
                        for p in path_params
                    ],
                    "locked_keys": path_params,
                }

            node_type_key = f"ep_{self.code}_{ep.code}"
            description = f"{ep.method or 'HTTP'} {ep.path or '/'}"

            connector_icon = (
                f"/web/image/workflow.connector/{self.id}/image_128"
                if self.image_128
                else template.icon or ""
            )

            result.append({
                "id": False,
                "node_type": node_type_key,
                "name": f"{self.name}: {ep.name}",
                "category": self.code,
                "group": self.name,
                "description": description,
                "icon": connector_icon,
                "color": template.color or "",
                "is_custom": False,
                "runtime_backend": "builtin",
                "runtime_node_type": "connector_request",
                "callable_key": "",
                "config_schema": config_schema,
                "input_schema": input_schema,
                "output_schema": output_schema,
            })

        return result
