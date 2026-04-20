"""Workflow auth profile model."""

from odoo import _, api, fields, models
from odoo.exceptions import ValidationError


class WorkflowAuthProfile(models.Model):
    """Auth strategy metadata record.

    Stores *references* to secrets (e.g. the key names passed to
    ``secret.get(key)``), not the secret values themselves.  Runtime
    resolves credentials via the existing SecretBroker.
    """

    _name = "workflow.auth.profile"
    _description = "Workflow Auth Profile"
    _order = "connector_id, name"

    # === Identity ===
    name = fields.Char(string="Name", required=True)

    # === Scope ===
    connector_id = fields.Many2one(
        "workflow.connector",
        string="Connector",
        ondelete="cascade",
        index=True,
        help="Scope this profile to a connector. Leave blank for a global profile.",
    )
    company_id = fields.Many2one(
        related="connector_id.company_id",
        store=True,
        string="Company",
        index=True,
    )

    # === Auth type ===
    auth_type = fields.Selection(
        selection=[
            ("api_key", "API Key"),
            ("bearer", "Bearer Token"),
            ("basic", "Basic Auth"),
            ("oauth2_client_credentials", "OAuth2 Client Credentials"),
            ("oauth2_refresh_token", "OAuth2 Refresh Token"),
            ("hmac", "HMAC Signature"),
            ("jwt_assertion", "JWT Assertion"),
            ("custom", "Custom"),
            ("none", "None"),
        ],
        string="Auth Type",
        default="bearer",
        required=True,
        index=True,
    )

    # === Token acquisition ===
    token_endpoint_id = fields.Many2one(
        "workflow.endpoint",
        string="Token Endpoint",
        ondelete="set null",
        domain="['|', ('connector_id', '=', False), ('connector_id', '=', connector_id)]",
        help="Endpoint used to acquire or refresh tokens.",
    )

    # === Secret references (keys for SecretBroker, NOT the actual values) ===
    secret_refs_json = fields.Text(
        string="Secret References",
        help='JSON map of secret slot → broker key.\n'
             'Example: {"token": "viettelpost_token", "username": "vtp_user"}.\n'
             'Runtime reads: secret.get("viettelpost_token").',
    )

    # === Header / query auth templates ===
    header_template_json = fields.Text(
        string="Header Template",
        help='JSON object of auth-level headers (may use {{secret_key}} placeholders).',
    )
    query_template_json = fields.Text(
        string="Query Param Template",
        help='JSON object of auth-level query params.',
    )

    # === Signature ===
    signature_template = fields.Text(
        string="Signature Recipe",
        help="Provider-specific signature generation recipe (HMAC, JWT, etc.). "
        "Interpreted by the provider plugin.",
    )

    # === OAuth / JWT metadata ===
    scope = fields.Char(string="Scope", help="OAuth scope string.")
    audience = fields.Char(string="Audience", help="OAuth / JWT audience claim.")

    # === Token lifecycle ===
    token_expires_at = fields.Datetime(
        string="Token Expires At",
        readonly=True,
        help="Cached expiry for managed token lifecycle.",
    )
    last_refresh_at = fields.Datetime(
        string="Last Refresh At",
        readonly=True,
        help="Timestamp of last token refresh.",
    )

    active = fields.Boolean(string="Active", default=True)

    def init(self):
        """Migrate legacy workspace_id bindings into connector_id when upgrading."""

        cr = self.env.cr
        cr.execute(
            """
            SELECT 1
            FROM information_schema.columns
            WHERE table_name = 'workflow_auth_profile'
              AND column_name = 'workspace_id'
            """
        )
        if not cr.fetchone():
            return
        cr.execute(
            """
            UPDATE workflow_auth_profile profile
               SET connector_id = profile.workspace_id
             WHERE profile.connector_id IS NULL
               AND profile.workspace_id IS NOT NULL
               AND EXISTS (
                   SELECT 1
                   FROM workflow_connector connector
                   WHERE connector.id = profile.workspace_id
               )
            """
        )

    @api.constrains("secret_refs_json", "header_template_json", "query_template_json")
    def _check_json_fields(self):
        import json

        for rec in self:
            for fname in ("secret_refs_json", "header_template_json", "query_template_json"):
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

    @api.constrains("token_endpoint_id", "connector_id")
    def _check_token_endpoint_connector(self):
        for rec in self:
            if (
                rec.token_endpoint_id
                and rec.token_endpoint_id.connector_id
                and rec.token_endpoint_id.connector_id != rec.connector_id
            ):
                raise ValidationError(
                    _(
                        "Token endpoint must belong to the same connector or be global."
                    )
                )

    def get_secret_refs(self):
        """Parse and return the secret references dict."""
        import json

        if not self.secret_refs_json:
            return {}
        try:
            return json.loads(self.secret_refs_json)
        except (ValueError, TypeError):
            return {}

    def get_header_template(self):
        """Parse and return the header template dict."""
        import json

        if not self.header_template_json:
            return {}
        try:
            return json.loads(self.header_template_json)
        except (ValueError, TypeError):
            return {}

    def get_query_template(self):
        """Parse and return the query param template dict."""
        import json

        if not self.query_template_json:
            return {}
        try:
            return json.loads(self.query_template_json)
        except (ValueError, TypeError):
            return {}

    def build_auth_headers(self, secret_broker):
        """Build auth headers using the SecretBroker for secret resolution.

        Args:
            secret_broker: SecretBroker instance from execution context.

        Returns:
            dict: Headers to merge into the request.
        """
        self.ensure_one()
        if self.auth_type == "none":
            return {}

        secret_refs = self.get_secret_refs()
        resolved_secrets = {}
        for slot, broker_key in secret_refs.items():
            try:
                resolved_secrets[slot] = secret_broker.get(broker_key)
            except Exception:
                resolved_secrets[slot] = ""

        headers = {}

        if self.auth_type == "bearer":
            token = resolved_secrets.get("token", "")
            if token:
                headers["Authorization"] = f"Bearer {token}"

        elif self.auth_type == "basic":
            import base64

            username = resolved_secrets.get("username", "")
            password = resolved_secrets.get("password", "")
            if username:
                credentials = base64.b64encode(
                    f"{username}:{password}".encode()
                ).decode()
                headers["Authorization"] = f"Basic {credentials}"

        elif self.auth_type == "api_key":
            header_tmpl = self.get_header_template()
            for k, v in header_tmpl.items():
                # Resolve {{slot}} placeholders
                for slot, value in resolved_secrets.items():
                    v = v.replace(f"{{{{{slot}}}}}", value)
                headers[k] = v

        elif self.auth_type in ("oauth2_client_credentials", "oauth2_refresh_token"):
            token = resolved_secrets.get("access_token", "")
            if token:
                headers["Authorization"] = f"Bearer {token}"

        else:
            # Fallback: apply header template with resolved placeholders
            header_tmpl = self.get_header_template()
            for k, v in header_tmpl.items():
                for slot, value in resolved_secrets.items():
                    v = v.replace(f"{{{{{slot}}}}}", value)
                headers[k] = v

        return headers

    def build_auth_query_params(self, secret_broker):
        """Build auth query params using the SecretBroker."""
        self.ensure_one()
        if self.auth_type == "none":
            return {}

        secret_refs = self.get_secret_refs()
        resolved_secrets = {}
        for slot, broker_key in secret_refs.items():
            try:
                resolved_secrets[slot] = secret_broker.get(broker_key)
            except Exception:
                resolved_secrets[slot] = ""

        query_tmpl = self.get_query_template()
        result = {}
        for k, v in query_tmpl.items():
            for slot, value in resolved_secrets.items():
                v = str(v).replace(f"{{{{{slot}}}}}", value)
            result[k] = v
        return result

    def name_get(self):
        result = []
        for rec in self:
            prefix = f"[{rec.connector_id.code}] " if rec.connector_id else ""
            auth_label = dict(self._fields["auth_type"].selection).get(
                rec.auth_type, rec.auth_type
            )
            result.append((rec.id, f"{prefix}{rec.name} ({auth_label})"))
        return result
