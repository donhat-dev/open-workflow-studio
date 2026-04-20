import copy
import json
import logging
import re

from odoo import _, api, fields, models
from odoo.exceptions import ValidationError
from odoo.tools import ormcache

from ..workflow import WorkflowNodeRegistry

_logger = logging.getLogger(__name__)


class WorkflowType(models.Model):
    """Node type definitions for workflow builder.

    Defines available node types that can be used in workflows.
    Built-in types are loaded via XML data (noupdate=1).

    Categories:
        - flow: Control flow nodes (if, loop, switch, noop)
        - integration: External service nodes (http)
        - transform: Data transformation nodes (code, set_data, validation)
        - data: Variable/data nodes (variable)
        - trigger: Trigger nodes (manual_trigger, webhook)
    """

    _name = "workflow.type"
    _description = "Workflow Node Type"
    _order = "category, sequence, name"

    name = fields.Char(
        string="Name",
        required=True,
        translate=True,
        help="Display name of the node type",
    )
    node_type = fields.Char(
        string="Type Key",
        required=True,
        index=True,
        help="Technical identifier matching frontend registry (e.g., http, if, loop)",
    )
    is_custom = fields.Boolean(
        string="Is Custom",
        compute="_compute_is_custom",
        store=True,
        index=True,
        help="True when node_type starts with 'x_'.",
    )
    category = fields.Selection(
        selection=[
            ("trigger", "Trigger"),
            ("flow", "Flow Control"),
            ("integration", "Integration"),
            ("transform", "Transform"),
            ("data", "Data"),
        ],
        string="Category",
        required=True,
        default="transform",
        help="Category for grouping in node palette",
    )
    description = fields.Text(
        string="Description", translate=True, help="Description shown in node palette"
    )
    icon = fields.Char(string="Icon", help="Icon class or name (e.g., fa-globe, split)")
    sequence = fields.Integer(
        string="Sequence", default=10, help="Order within category"
    )
    active = fields.Boolean(
        string="Active",
        default=True,
        help="Inactive types are hidden from node palette",
    )
    config_schema = fields.Json(
        string="Configuration Schema",
        default=lambda self: {},
        help="JSON Schema for node configuration validation",
    )
    input_schema = fields.Json(
        string="Input Schema",
        default=lambda self: {},
        help="Expected input data schema",
    )
    output_schema = fields.Json(
        string="Output Schema",
        default=lambda self: {},
        help="Expected output data schema",
    )
    color = fields.Char(
        string="Color", help="Hex color for node display (e.g., #3498db)"
    )
    code = fields.Text(
        string="Runtime Code",
        help=(
            "Python runtime code for custom node types (node_type starts with 'x_'). "
            "Executed with safe_eval at workflow runtime."
        ),
        default="",
    )
    runtime_backend = fields.Selection(
        selection=[
            ("builtin", "Built-in"),
            ("python_code", "Python Code"),
            ("python_callable", "Python Callable"),
        ],
        string="Runtime Backend",
        default="builtin",
        required=True,
        help="Runtime execution backend used for this node type.",
    )
    callable_key = fields.Char(
        string="Callable Key",
        help="Registry key used to resolve decorated Python workflow nodes.",
    )

    # === Security ===
    group_id = fields.Many2one(
        "res.groups",
        string="Required Group",
        help="Group required to add/configure this node type",
    )

    _NODE_TYPE_RE = re.compile(r"^[a-z][a-z0-9_]*$")

    _HTTP_CONFIG_SUGGESTION_DEFAULTS = {
        "url": {
            "suggestions": [
                "https://api.example.com",
                "https://httpbin.org/anything",
            ],
        },
        "query_params": {
            "suggestionsByKey": {
                "limit": ["10", "20", "50", "100"],
                "offset": ["0", "10", "20"],
                "page": ["1", "2", "3"],
                "sort": ["asc", "desc"],
                "status": ["active", "inactive"],
            },
        },
        "auth": {
            "suggestionsByKey": {
                "header_name": ["Authorization", "X-API-Key"],
                "key_name": ["X-API-Key", "api_key"],
                "scope": ["read", "write", "read write"],
            },
        },
        "body_config": {
            "suggestionsByKey": {
                "form_data_value": ["true", "false", "null"],
            },
        },
        "headers": {
            "suggestionsByKey": {
                "Content-Type": [
                    "application/json",
                    "application/x-www-form-urlencoded",
                    "multipart/form-data",
                ],
                "Accept": ["application/json", "*/*"],
                "Authorization": ["Bearer "],
            },
        },
    }

    _sql_constraints = [
        ("node_type_uniq", "UNIQUE(node_type)", "Node type key must be unique!"),
    ]

    @api.constrains("node_type")
    def _check_node_type_format(self):
        """Ensure node_type follows snake_case convention."""
        for record in self:
            if not self._NODE_TYPE_RE.match(record.node_type):
                raise ValidationError(
                    _(
                        "Node type key '%(key)s' must be lowercase snake_case "
                        "(start with letter, only letters/numbers/underscores)",
                        key=record.node_type,
                    )
                )

    @api.depends("node_type")
    def _compute_is_custom(self):
        for record in self:
            record.is_custom = self._is_custom_node_type(
                (record.node_type or "").strip()
            )

    @staticmethod
    def _is_custom_node_type(node_type):
        return isinstance(node_type, str) and node_type.startswith("x_")

    @staticmethod
    def _infer_runtime_backend(
        node_type, runtime_backend=None, runtime_code=None, callable_key=None
    ):
        runtime_backend = (runtime_backend or "").strip() or None
        runtime_code = (runtime_code or "").strip()
        callable_key = (callable_key or "").strip()
        is_custom = WorkflowType._is_custom_node_type((node_type or "").strip())

        if is_custom and runtime_backend in (None, "builtin"):
            if callable_key:
                return "python_callable"
            if runtime_code:
                return "python_code"
        if runtime_backend:
            return runtime_backend
        if callable_key:
            return "python_callable"
        if is_custom and runtime_code:
            return "python_code"
        return "builtin"

    @api.model
    def _is_module_loading_context(self):
        """Return True when records are loaded by module install/update."""
        return bool(
            self.env.context.get("install_mode") or self.env.context.get("module")
        )

    @api.constrains("node_type", "code", "group_id", "runtime_backend", "callable_key")
    def _check_custom_node_contract(self):
        """Validate custom node runtime contract.

        Contract:
            - Only custom node types (`x_*`) can define non-builtin runtimes.
            - python_code nodes require runtime code + required group.
            - python_callable nodes require callable_key + required group.
        """
        for record in self:
            node_type = (record.node_type or "").strip()
            runtime_code = (record.code or "").strip()
            callable_key = (record.callable_key or "").strip()
            is_custom = self._is_custom_node_type(node_type)
            runtime_backend = self._infer_runtime_backend(
                node_type=node_type,
                runtime_backend=record.runtime_backend,
                runtime_code=runtime_code,
                callable_key=callable_key,
            )

            if runtime_backend != "builtin" and not is_custom:
                raise ValidationError(
                    _(
                        "Custom runtime backends are only allowed for custom node types with prefix 'x_'. "
                        "Received node_type '%(key)s'.",
                        key=node_type,
                    )
                )

            if is_custom and runtime_backend == "builtin":
                raise ValidationError(
                    _(
                        "Custom node type '%(key)s' must define a custom runtime backend. "
                        "Use runtime code or a registered callable.",
                        key=node_type,
                    )
                )

            if runtime_code and runtime_backend != "python_code":
                raise ValidationError(
                    _(
                        "Runtime code is only valid when Runtime Backend is 'Python Code' "
                        "for node type '%(key)s'.",
                        key=node_type,
                    )
                )

            if callable_key and runtime_backend != "python_callable":
                raise ValidationError(
                    _(
                        "Callable Key is only valid when Runtime Backend is 'Python Callable' "
                        "for node type '%(key)s'.",
                        key=node_type,
                    )
                )

            if runtime_backend == "python_code" and not runtime_code:
                raise ValidationError(
                    _(
                        "Custom node type '%(key)s' requires runtime code when Runtime Backend is 'Python Code'.",
                        key=node_type,
                    )
                )

            if runtime_backend == "python_callable" and not callable_key:
                raise ValidationError(
                    _(
                        "Custom node type '%(key)s' requires a Callable Key when Runtime Backend is 'Python Callable'.",
                        key=node_type,
                    )
                )

            if (
                runtime_backend in ("python_code", "python_callable")
                and not record.group_id
            ):
                raise ValidationError(
                    _(
                        "Custom node type '%(key)s' requires a Required Group.",
                        key=node_type,
                    )
                )

            if runtime_backend == "builtin" and (runtime_code or callable_key):
                raise ValidationError(
                    _(
                        "Built-in node type '%(key)s' cannot define runtime code or callable registration.",
                        key=node_type,
                    )
                )

    def name_get(self):
        """Display name with category."""
        result = []
        for record in self:
            name = f"[{record.category}] {record.name}"
            result.append((record.id, name))
        return result

    # ------------------------------------------------------------------
    # CRUD overrides – invalidate ormcache on changes
    # ------------------------------------------------------------------

    @api.model_create_multi
    def create(self, vals_list):
        if not self._is_module_loading_context():
            for vals in vals_list:
                node_type = (vals.get("node_type") or "").strip()
                if node_type and not self._is_custom_node_type(node_type):
                    raise ValidationError(
                        _(
                            "Custom node type key '%(key)s' must start with 'x_'. "
                            "Base node types are module-managed.",
                            key=node_type,
                        )
                    )
        for vals in vals_list:
            node_type = (vals.get("node_type") or "").strip()
            vals["runtime_backend"] = self._infer_runtime_backend(
                node_type=node_type,
                runtime_backend=vals.get("runtime_backend"),
                runtime_code=vals.get("code"),
                callable_key=vals.get("callable_key"),
            )
        self.env.registry.clear_cache()
        return super().create(vals_list)

    def write(self, vals):
        if "node_type" in vals and not self._is_module_loading_context():
            node_type = (vals.get("node_type") or "").strip()
            if node_type and not self._is_custom_node_type(node_type):
                raise ValidationError(
                    _(
                        "Custom node type key '%(key)s' must start with 'x_'. "
                        "Base node types are module-managed.",
                        key=node_type,
                    )
                )

        needs_runtime_recompute = (
            "runtime_backend" in vals
            or "code" in vals
            or "callable_key" in vals
            or "node_type" in vals
        )
        if needs_runtime_recompute:
            for record in self:
                effective_node_type = (
                    vals.get("node_type") or record.node_type or ""
                ).strip()
                vals.setdefault(
                    "runtime_backend",
                    self._infer_runtime_backend(
                        node_type=effective_node_type,
                        runtime_backend=vals.get("runtime_backend")
                        or record.runtime_backend,
                        runtime_code=vals.get("code")
                        if "code" in vals
                        else record.code,
                        callable_key=vals.get("callable_key")
                        if "callable_key" in vals
                        else record.callable_key,
                    ),
                )

        if set(vals) & {
            "node_type",
            "output_schema",
            "active",
            "code",
            "group_id",
            "runtime_backend",
            "callable_key",
        }:
            self.env.registry.clear_cache()
        return super().write(vals)

    def unlink(self):
        self.env.registry.clear_cache()
        return super().unlink()

    # ------------------------------------------------------------------
    # Cached socket mapping (consumed by WorkflowExecutor)
    # ------------------------------------------------------------------

    @api.model
    @ormcache()
    def _get_output_socket_mapping(self):
        """Return {node_type_key: [socket_name, ...]} from output_schema.

        Cached via ormcache; invalidated on create/write/unlink of
        workflow.type records.  The mapping drives output routing in
        WorkflowExecutor._socket_to_index.
        """
        self.flush_model(["node_type", "output_schema", "active"])
        self.env.cr.execute(
            "SELECT node_type, output_schema "
            "FROM workflow_type "
            "WHERE active = true AND output_schema IS NOT NULL"
        )
        mapping = {}
        for node_type_key, raw_schema in self.env.cr.fetchall():
            schema = raw_schema
            if isinstance(schema, str):
                try:
                    schema = json.loads(schema)
                except (json.JSONDecodeError, TypeError):
                    continue
            if not isinstance(schema, dict) or not schema:
                continue
            sockets = [str(k) for k in schema if k]
            if sockets:
                mapping[node_type_key] = sockets
        return mapping

    @api.model
    @ormcache()
    def _get_custom_runtime_mapping(self):
        """Return custom node runtime contract by node_type.

        Shape:
            {
                "x_custom": {
                    "runtime_backend": "python_code",
                    "code": "...",
                    "callable_key": "...",
                    "group_id": 42,
                },
            }
        """
        self.flush_model(
            [
                "node_type",
                "code",
                "group_id",
                "active",
                "is_custom",
                "runtime_backend",
                "callable_key",
            ]
        )
        self.env.cr.execute(
            "SELECT node_type, runtime_backend, code, callable_key, group_id "
            "FROM workflow_type "
            "WHERE active = true AND is_custom = true"
        )
        mapping = {}
        for (
            node_type_key,
            runtime_backend,
            code,
            callable_key,
            group_id,
        ) in self.env.cr.fetchall():
            if not node_type_key:
                continue
            effective_backend = self._infer_runtime_backend(
                node_type=node_type_key,
                runtime_backend=runtime_backend,
                runtime_code=code,
                callable_key=callable_key,
            )
            mapping[node_type_key] = {
                "runtime_backend": effective_backend,
                "code": code or "",
                "callable_key": callable_key or "",
                "group_id": group_id,
            }
        return mapping

    @api.model
    def get_available_types(self):
        """Return all active node types for frontend.

        Called via RPC to populate node palette.
        Returns list of dicts with type definitions.
        """
        types = self.search([("active", "=", True)])

        def _normalize_schema(raw_schema):
            if isinstance(raw_schema, dict):
                return raw_schema
            if isinstance(raw_schema, str):
                try:
                    parsed = json.loads(raw_schema)
                except (json.JSONDecodeError, TypeError):
                    return {}
                return parsed if isinstance(parsed, dict) else {}
            return {}

        result = [
            {
                "id": t.id,
                "node_type": t.node_type,
                "name": t.name,
                "category": t.category,
                "description": t.description or "",
                "icon": t.icon or "",
                "color": t.color or "",
                "is_custom": bool(t.is_custom),
                "runtime_backend": self._infer_runtime_backend(
                    node_type=t.node_type,
                    runtime_backend=t.runtime_backend,
                    runtime_code=t.code,
                    callable_key=t.callable_key,
                ),
                "callable_key": t.callable_key or "",
                "config_schema": _normalize_schema(t.config_schema),
                "input_schema": _normalize_schema(t.input_schema),
                "output_schema": _normalize_schema(t.output_schema),
            }
            for t in types
        ]

        # Append virtual endpoint-derived node types from active connectors
        connectors = self.env["workflow.connector"].search([
            ("active", "=", True),
            ("endpoint_ids", "!=", False),
        ])
        for connector in connectors:
            result.extend(connector.build_endpoint_node_types())

        return result

    @api.model
    def sync_decorated_nodes(self):
        """Synchronize decorated Python nodes from WorkflowNodeRegistry to workflow.type.

        The frontend palette is backend-driven, so decorated nodes must be
        persisted as workflow.type rows. This method is safe to call repeatedly.
        """
        registry_entries = WorkflowNodeRegistry.get_all()
        if not registry_entries:
            return 0

        created_or_updated = 0
        group_user = self.env.ref("base.group_user")
        for node_type, entry in registry_entries.items():
            metadata = copy.deepcopy(entry.get("metadata") or {})
            callable_key = metadata.get("callable_key")
            if not callable_key:
                continue

            vals = {
                "name": metadata.get("name") or node_type,
                "node_type": node_type,
                "category": metadata.get("category") or "transform",
                "description": metadata.get("description") or "",
                "icon": metadata.get("icon") or "fa-cube",
                "sequence": metadata.get("sequence") or 10,
                "active": metadata.get("active", True),
                "config_schema": copy.deepcopy(metadata.get("config_schema") or {}),
                "input_schema": copy.deepcopy(metadata.get("input_schema") or {}),
                "output_schema": copy.deepcopy(metadata.get("output_schema") or {}),
                "color": metadata.get("color") or False,
                "runtime_backend": "python_callable",
                "callable_key": callable_key,
                "code": "",
                "group_id": metadata.get("group_id") or group_user.id,
            }

            record = self.search([("node_type", "=", node_type)], limit=1)
            if record:
                record.with_context(module="workflow_studio").write(vals)
            else:
                self.with_context(module="workflow_studio").create(vals)
            created_or_updated += 1
        return created_or_updated

    def _register_hook(self):
        result = super()._register_hook()
        try:
            self.sudo().sync_decorated_nodes()
        except Exception:
            _logger.exception(
                "Failed to synchronize decorated workflow nodes during registry hook."
            )
        return result
