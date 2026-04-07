import copy
import uuid

from odoo.exceptions import UserError, ValidationError
from odoo.tests import common, new_test_user, tagged

from ..models.workflow_executor import WorkflowExecutor


@tagged("post_install", "-at_install")
class TestCustomNodeRuntime(common.TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.WorkflowType = cls.env["workflow.type"]
        cls.Workflow = cls.env["ir.workflow"]

        cls.runtime_group = cls.env["res.groups"].create(
            {
                "name": "Workflow Runtime Test Group %s" % uuid.uuid4().hex[:8],
            }
        )

        cls.allowed_user = new_test_user(
            cls.env,
            login="workflow_allowed_%s" % uuid.uuid4().hex[:8],
            groups="base.group_user",
        )
        cls.allowed_user.write({"groups_id": [(4, cls.runtime_group.id)]})

        cls.denied_user = new_test_user(
            cls.env,
            login="workflow_denied_%s" % uuid.uuid4().hex[:8],
            groups="base.group_user",
        )

    def _new_custom_key(self, suffix):
        return "x_%s_%s" % (suffix, uuid.uuid4().hex[:8])

    def _new_builtin_key(self, suffix):
        return "builtin_%s_%s" % (suffix, uuid.uuid4().hex[:8])

    def _create_custom_type(
        self, node_type=None, code="result = _json", group=None, active=True
    ):
        vals = {
            "name": "Custom Type %s" % uuid.uuid4().hex[:6],
            "node_type": node_type or self._new_custom_key("runtime"),
            "category": "transform",
            "active": active,
            "code": code,
            "group_id": (group or self.runtime_group).id,
        }
        return self.WorkflowType.create(vals)

    def _create_builtin_type(self, node_type=None, **extra_vals):
        vals = {
            "name": "Built-in Type %s" % uuid.uuid4().hex[:6],
            "node_type": node_type or self._new_builtin_key("runtime"),
            "category": "transform",
        }
        vals.update(extra_vals)
        return self.WorkflowType.with_context(module="workflow_studio").create(vals)

    def _create_workflow(self, run_as_user=None):
        return self.Workflow.create(
            {
                "name": "WF Runtime %s" % uuid.uuid4().hex[:8],
                "run_as_user_id": run_as_user.id if run_as_user else False,
            }
        )

    def _build_snapshot(self, custom_node_type, workflow=None, node_config=None):
        snapshot = {
            "nodes": [
                {
                    "id": "n_start",
                    "type": "manual_trigger",
                    "label": "Manual Trigger",
                    "config": {},
                },
                {
                    "id": "n_custom",
                    "type": custom_node_type,
                    "label": "Custom Node",
                    "config": node_config or {},
                },
            ],
            "connections": [
                {
                    "id": "c_start_custom",
                    "source": "n_start",
                    "sourceHandle": "output",
                    "target": "n_custom",
                    "targetHandle": "input",
                },
            ],
            "metadata": {},
        }
        if workflow:
            snapshot["metadata"]["workflow"] = {
                "id": workflow.id,
                "name": workflow.name,
                "active": workflow.active,
            }
        return snapshot

    def _execute_snapshot(self, snapshot, input_data=None):
        executor = WorkflowExecutor(
            self.env,
            workflow_run=None,
            snapshot=copy.deepcopy(snapshot),
            persist=False,
        )
        result = executor.execute(input_data or {})
        return executor, result

    def test_is_custom_computed_and_available_types_flag(self):
        custom_type = self._create_custom_type(node_type=self._new_custom_key("flag"))
        builtin_type = self._create_builtin_type(
            node_type=self._new_builtin_key("flag")
        )

        self.assertTrue(custom_type.is_custom)
        self.assertFalse(builtin_type.is_custom)

        by_key = {
            item["node_type"]: item for item in self.WorkflowType.get_available_types()
        }
        self.assertTrue(by_key[custom_type.node_type]["is_custom"])
        self.assertFalse(by_key[builtin_type.node_type]["is_custom"])

    def test_get_available_types_http_contains_suggestion_metadata(self):
        available = self.WorkflowType.get_available_types()
        http_type = next(
            (item for item in available if item.get("node_type") == "http"), None
        )

        self.assertTrue(http_type, "HTTP node type must be present in available types")

        config_schema = http_type.get("config_schema") or {}
        self.assertIn("url", config_schema)
        self.assertIn("query_params", config_schema)
        self.assertIn("headers", config_schema)

        self.assertTrue(
            isinstance(config_schema["url"].get("suggestions"), list),
            "HTTP url control must expose suggestions list",
        )
        self.assertTrue(
            isinstance(config_schema["query_params"].get("suggestionsByKey"), dict),
            "HTTP query_params control must expose suggestionsByKey map",
        )
        self.assertTrue(
            isinstance(config_schema["headers"].get("suggestionsByKey"), dict),
            "HTTP headers control must expose suggestionsByKey map",
        )

    def test_get_available_types_normalizes_string_backed_http_schema(self):
        http_type = self.WorkflowType.search([("node_type", "=", "http")], limit=1)
        self.assertTrue(http_type, "HTTP workflow.type record must exist")

        original_config = http_type.config_schema
        original_input = http_type.input_schema
        original_output = http_type.output_schema

        try:
            self.env.cr.execute(
                """
                UPDATE workflow_type
                   SET config_schema = %s,
                       input_schema = %s,
                       output_schema = %s
                 WHERE id = %s
                """,
                [
                    http_type.read(["config_schema"])[0]["config_schema"],
                    http_type.read(["input_schema"])[0]["input_schema"],
                    http_type.read(["output_schema"])[0]["output_schema"],
                    http_type.id,
                ],
            )
            self.WorkflowType.invalidate_model(
                ["config_schema", "input_schema", "output_schema"]
            )

            available = self.WorkflowType.get_available_types()
            http_available = next(
                (item for item in available if item.get("node_type") == "http"), None
            )

            self.assertTrue(http_available, "HTTP node type must still be available")
            self.assertIn("url", http_available.get("config_schema") or {})
            self.assertIn("data", http_available.get("input_schema") or {})
            self.assertIn("response", http_available.get("output_schema") or {})
        finally:
            http_type.write(
                {
                    "config_schema": original_config,
                    "input_schema": original_input,
                    "output_schema": original_output,
                }
            )

    def test_non_module_create_rejects_builtin_key(self):
        with self.assertRaises(ValidationError):
            self.WorkflowType.create(
                {
                    "name": "Should Fail",
                    "node_type": self._new_builtin_key("create"),
                    "category": "transform",
                }
            )

    def test_non_module_write_rejects_builtin_key(self):
        custom_type = self._create_custom_type(node_type=self._new_custom_key("write"))
        with self.assertRaises(ValidationError):
            custom_type.write({"node_type": self._new_builtin_key("write")})

    def test_custom_contract_enforced(self):
        with self.assertRaises(ValidationError):
            self.WorkflowType.create(
                {
                    "name": "Missing Code",
                    "node_type": self._new_custom_key("missing_code"),
                    "category": "transform",
                    "group_id": self.runtime_group.id,
                }
            )

        with self.assertRaises(ValidationError):
            self.WorkflowType.create(
                {
                    "name": "Missing Group",
                    "node_type": self._new_custom_key("missing_group"),
                    "category": "transform",
                    "code": "result = _json",
                }
            )

        with self.assertRaises(ValidationError):
            self._create_builtin_type(
                node_type=self._new_builtin_key("runtime_code"),
                code="result = _json",
            )

    def test_custom_runtime_mapping_active_custom_only(self):
        active_custom = self._create_custom_type(
            node_type=self._new_custom_key("active"),
            code='result = {"active": True}',
            active=True,
        )
        inactive_custom = self._create_custom_type(
            node_type=self._new_custom_key("inactive"),
            code='result = {"active": False}',
            active=False,
        )
        builtin = self._create_builtin_type(node_type=self._new_builtin_key("mapping"))

        mapping = self.WorkflowType._get_custom_runtime_mapping()

        self.assertIn(active_custom.node_type, mapping)
        self.assertNotIn(inactive_custom.node_type, mapping)
        self.assertNotIn(builtin.node_type, mapping)
        self.assertEqual(
            mapping[active_custom.node_type]["group_id"], self.runtime_group.id
        )
        self.assertIn("active", mapping[active_custom.node_type]["code"])

    def test_executor_executes_custom_runtime_code(self):
        node_type = self._new_custom_key("exec_success")
        self._create_custom_type(
            node_type=node_type,
            code=(
                "result = {"
                '"payload": _json, '
                '"node_type": _node_type, '
                '"cfg": _node_config.get("flag")'
                "}"
            ),
        )

        workflow = self._create_workflow(run_as_user=self.allowed_user)
        snapshot = self._build_snapshot(
            custom_node_type=node_type,
            workflow=workflow,
            node_config={"flag": "ok"},
        )

        executor, output = self._execute_snapshot(
            snapshot, input_data={"hello": "world"}
        )

        self.assertEqual(output["payload"], {"hello": "world"})
        self.assertEqual(output["node_type"], node_type)
        self.assertEqual(output["cfg"], "ok")
        self.assertEqual(executor.executed_order, ["n_start", "n_custom"])
        self.assertEqual(executor._get_executed_connection_ids(), ["c_start_custom"])

    def test_executor_denies_user_without_required_group(self):
        node_type = self._new_custom_key("exec_denied")
        self._create_custom_type(
            node_type=node_type,
            code="result = _json",
        )

        workflow = self._create_workflow(run_as_user=self.denied_user)
        snapshot = self._build_snapshot(custom_node_type=node_type, workflow=workflow)

        with self.assertRaises(UserError):
            self._execute_snapshot(snapshot, input_data={"a": 1})

    def test_executor_fails_for_unknown_custom_type(self):
        unknown_node_type = self._new_custom_key("unknown")
        workflow = self._create_workflow(run_as_user=self.allowed_user)
        snapshot = self._build_snapshot(
            custom_node_type=unknown_node_type, workflow=workflow
        )

        with self.assertRaises(ValidationError):
            self._execute_snapshot(snapshot, input_data={"a": 1})
