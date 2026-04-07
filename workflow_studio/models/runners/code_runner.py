"""
Code Node Runner

Executes user-provided expressions using safe_eval.
Globals (available libraries) are provided by ir.workflow._get_eval_globals()
so other modules can extend them via standard Odoo inheritance.
"""

import re
from datetime import date, datetime

from odoo.tools.safe_eval import safe_eval

from ..context_objects import build_eval_context, to_plain
from .base import BaseNodeRunner

_RESULT_UNSET = object()


class CodeNodeRunner(BaseNodeRunner):
    """Runner for code node using safe_eval."""

    node_type = "code"

    def _get_globals(self):
        """Fetch eval globals from ir.workflow (single source of truth)."""
        return self.executor.env["ir.workflow"]._get_eval_globals()

    def get_eval_context(self, input_data, context):
        payload = input_data if input_data is not None else {}
        secure_context = (
            context.get("secure_eval_context") if isinstance(context, dict) else None
        )
        if isinstance(secure_context, dict):
            locals_dict = dict(secure_context)
            locals_dict["result"] = _RESULT_UNSET
        else:
            locals_dict = build_eval_context(payload, context, include_input_item=True)
            locals_dict["_now"] = datetime.now().strftime("%Y-%m-%dT%H:%M:%SZ")
            locals_dict["_today"] = date.today().strftime("%Y-%m-%d")
            locals_dict["result"] = _RESULT_UNSET

        globals_dict = self._get_globals()
        globals_dict.update(locals_dict)
        return locals_dict, globals_dict

    def execute(self, node_config, input_data, context):
        locals_dict, globals_dict = self.get_eval_context(input_data, context)
        code = node_config.get("code") or ""
        if not isinstance(code, str) or not code.strip():
            return {
                "outputs": [[input_data]],
                "json": input_data,
            }

        expression = self._normalize_code(code)
        translated = self._wrap_expression_as_result(expression)
        safe_eval(
            translated,
            globals_dict=globals_dict,
            locals_dict=locals_dict,
            mode="exec",
            nocopy=True,
        )
        result = locals_dict.get("result", _RESULT_UNSET)
        if result is _RESULT_UNSET:
            result = input_data
        result = to_plain(result)
        return {
            "outputs": [[result]],
            "json": result,
            "vars": locals_dict.get("_vars", context.get("vars", {})),
        }

    def _normalize_code(self, code):
        stripped = code.strip()
        if stripped.startswith("return "):
            stripped = "result = %s" % stripped[len("return ") :].strip()
        if stripped.endswith(";"):
            stripped = stripped[:-1].strip()

        template_match = re.fullmatch(r"\{\{(.+)\}\}", stripped)
        if template_match:
            return template_match.group(1).strip()

        return stripped

    def _wrap_expression_as_result(self, code):
        if not isinstance(code, str) or not code:
            return code
        try:
            compile(code, "<workflow_code>", "eval")
        except SyntaxError:
            return code
        return "result = %s" % code
