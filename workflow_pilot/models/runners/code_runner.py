# -*- coding: utf-8 -*-

"""
Code Node Runner

Executes user-provided expressions using safe_eval.
"""

import math
import re

from odoo.tools import safe_eval as safe_eval_module
from odoo.tools.safe_eval import safe_eval

from .base import BaseNodeRunner, ExpressionEvaluator


_RESULT_UNSET = object()


class CodeNodeRunner(BaseNodeRunner):
    """Runner for code node using safe_eval."""

    node_type = 'code'
    DOTTED_CONTEXT_PATTERN = re.compile(
        r'\b(_json|_input|_vars|_node|_execution|_workflow)((?:\.\w+|\[\d+\])+)'
    )
    BARE_CONTEXT_PATTERN = re.compile(r'\b(vars|node|input)((?:\.\w+|\[\d+\])+)')
    LEGACY_NAMESPACE_MAP = {
        'json': '_json',
        'input': '_input',
        'vars': '_vars',
        'node': '_node',
    }
    BARE_NAMESPACE_MAP = {
        'vars': '_vars',
        'node': '_node',
        'input': '_input',
    }

    def get_eval_context(self, input_data, context):
        payload = input_data if input_data is not None else {}
        locals_dict = {
            '_input': payload,
            '_json': payload,
            '_vars': context.get('vars', {}),
            '_node': context.get('node', {}),
            '_execution': context.get('execution'),
            '_workflow': context.get('workflow'),
            '_now': safe_eval_module.datetime.datetime.now(),
            '_today': safe_eval_module.datetime.date.today(),
            'result': _RESULT_UNSET,
        }
        globals_dict = {
            'datetime': safe_eval_module.datetime,
            'dateutil': safe_eval_module.dateutil,
            'time': safe_eval_module.time,
            'json': safe_eval_module.json,
        }
        globals_dict.update(locals_dict)
        return locals_dict, globals_dict

    def execute(self, node_config, input_data, context):
        locals_dict, globals_dict = self.get_eval_context(input_data, context)
        code = node_config.get('code') or ''
        if not isinstance(code, str) or not code.strip():
            return {
                'outputs': [[input_data]],
                'json': input_data,
            }

        expression = self._normalize_code(code)
        try:
            translated = self._translate_legacy_syntax(expression)
            translated = self._translate_dotted_context(translated)
            translated = self._wrap_expression_as_result(translated)
            safe_eval(
                translated,
                globals_dict=globals_dict,
                locals_dict=locals_dict,
                mode='exec',
                nocopy=True,
            )
            result = locals_dict.get('result', _RESULT_UNSET)
            if result is _RESULT_UNSET:
                result = input_data
            return {
                'outputs': [[result]],
                'json': result,
                'vars': locals_dict.get('_vars', context.get('vars', {})),
            }
        except Exception as e:
            error_payload = {
                'error': str(e),
            }
            return {
                'outputs': [[error_payload]],
                'json': error_payload,
                'error': str(e),
            }

    def _normalize_code(self, code):
        stripped = code.strip()
        if stripped.startswith('return '):
            stripped = 'result = %s' % stripped[len('return '):].strip()
        if stripped.endswith(';'):
            stripped = stripped[:-1].strip()

        template_match = re.fullmatch(r'\{\{(.+)\}\}', stripped)
        if template_match:
            return template_match.group(1).strip()

        return stripped

    def _translate_legacy_syntax(self, code):
        if not isinstance(code, str):
            return code

        def replace_namespace(match):
            namespace = match.group(1)
            path = match.group(2)
            target = self.LEGACY_NAMESPACE_MAP.get(namespace, namespace)
            result = target
            if path:
                parts = re.split(r'\.(?![^\[]*\])', path.lstrip('.'))
                for part in parts:
                    if not part:
                        continue
                    bracket_match = re.match(r'(\w+)(\[\d+\])?', part)
                    if bracket_match:
                        field = bracket_match.group(1)
                        index = bracket_match.group(2) or ''
                        result += "['%s']%s" % (field, index)
            return result

        return ExpressionEvaluator.NAMESPACE_PATTERN.sub(replace_namespace, code)

    def _translate_dotted_context(self, code):
        if not isinstance(code, str):
            return code

        def replace_namespace(match, namespace_map):
            namespace = match.group(1)
            path = match.group(2)
            target = namespace_map.get(namespace, namespace)
            result = target
            if path:
                parts = re.split(r'\.(?![^\[]*\])', path.lstrip('.'))
                for part in parts:
                    if not part:
                        continue
                    bracket_match = re.match(r'(\w+)(\[\d+\])?', part)
                    if bracket_match:
                        field = bracket_match.group(1)
                        index = bracket_match.group(2) or ''
                        result += "['%s']%s" % (field, index)
            return result

        updated = self.DOTTED_CONTEXT_PATTERN.sub(
            lambda match: replace_namespace(match, {}),
            code,
        )
        return self.BARE_CONTEXT_PATTERN.sub(
            lambda match: replace_namespace(match, self.BARE_NAMESPACE_MAP),
            updated,
        )

    def _wrap_expression_as_result(self, code):
        if not isinstance(code, str) or not code:
            return code
        try:
            compile(code, '<workflow_code>', 'eval')
        except SyntaxError:
            return code
        return 'result = %s' % code
