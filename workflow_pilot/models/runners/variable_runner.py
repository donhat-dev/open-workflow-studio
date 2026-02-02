# -*- coding: utf-8 -*-

"""
Variable Node Runner

Implements workflow variable operations.
"""

import json
import re

from odoo.tools.safe_eval import safe_eval

from .base import BaseNodeRunner, ExpressionEvaluator


class VariableNodeRunner(BaseNodeRunner):
    """Runner for variable node operations."""

    node_type = 'variable'

    def execute(self, node_config, input_data, context):
        payload = input_data or {}
        eval_context = {
            '_json': payload,
            '_node': context.get('node', {}),
            '_vars': context.get('vars', {}),
            '_input': {'item': payload, 'json': payload},
        }
        vars_store = context.get('vars', {})

        operation = node_config.get('operation', 'set')
        var_name = (node_config.get('variableName') or '').strip()
        raw_value = node_config.get('value')

        if not var_name:
            return self._error_result('Variable name is required')

        value = self._resolve_value(raw_value, eval_context)
        value = self._coerce_value(value)

        result = {
            'success': True,
            'operation': operation,
            'variable': var_name,
            'value': None,
        }

        if operation == 'set':
            self._set_path(vars_store, var_name, value)
            result['value'] = value
        elif operation == 'get':
            result['value'] = self._get_path(vars_store, var_name)
        elif operation == 'append':
            current = self._get_path(vars_store, var_name)
            if current is None:
                current = []
            elif not isinstance(current, list):
                current = [current]
            current.append(value)
            self._set_path(vars_store, var_name, current)
            result['value'] = current
        elif operation == 'merge':
            current = self._get_path(vars_store, var_name)
            if isinstance(current, dict) and isinstance(value, dict):
                merged = {**current, **value}
            else:
                merged = value
            self._set_path(vars_store, var_name, merged)
            result['value'] = merged
        elif operation == 'increment':
            increment = self._to_number(value, fallback=1)
            current = self._get_path(vars_store, var_name)
            base = self._to_number(current, fallback=0)
            new_value = base + increment
            self._set_path(vars_store, var_name, new_value)
            result['value'] = new_value
        elif operation == 'delete':
            self._delete_path(vars_store, var_name)
            result['value'] = None
        else:
            return self._error_result('Unknown operation: %s' % operation)

        return {
            'outputs': [[result]],
            'json': result,
        }

    def _resolve_value(self, raw_value, eval_context):
        if not isinstance(raw_value, str):
            return raw_value

        stripped = raw_value.strip()
        if not stripped:
            return raw_value

        template_match = re.fullmatch(r'\{\{(.+)\}\}', stripped)
        if template_match:
            inner_expr = template_match.group(1).strip()
            translated = ExpressionEvaluator.translate_expression(inner_expr)
            try:
                return safe_eval(translated, eval_context, mode='eval')
            except Exception:
                return raw_value

        if '{{' in raw_value and '}}' in raw_value:
            try:
                return ExpressionEvaluator.evaluate(raw_value, eval_context)
            except Exception:
                return raw_value

        return raw_value

    def _coerce_value(self, value):
        if isinstance(value, str):
            stripped = value.strip()
            if not stripped:
                return value
            if stripped.lower() in ('true', 'false'):
                return stripped.lower() == 'true'
            if stripped.startswith('{') or stripped.startswith('['):
                try:
                    return json.loads(stripped)
                except Exception:
                    return value
        return value

    def _to_number(self, value, fallback=0):
        if isinstance(value, (int, float)):
            return float(value)
        if isinstance(value, str):
            stripped = value.strip()
            if not stripped:
                return fallback
            try:
                return float(stripped)
            except ValueError:
                return fallback
        return fallback

    def _split_path(self, path):
        return [segment for segment in path.split('.') if segment]

    def _get_path(self, data, path):
        if not isinstance(data, dict):
            return None
        parts = self._split_path(path)
        current = data
        for part in parts:
            if not isinstance(current, dict) or part not in current:
                return None
            current = current.get(part)
        return current

    def _set_path(self, data, path, value):
        if not isinstance(data, dict):
            return
        parts = self._split_path(path)
        if not parts:
            return
        current = data
        for part in parts[:-1]:
            if part not in current or not isinstance(current.get(part), dict):
                current[part] = {}
            current = current[part]
        current[parts[-1]] = value

    def _delete_path(self, data, path):
        if not isinstance(data, dict):
            return
        parts = self._split_path(path)
        if not parts:
            return
        current = data
        for part in parts[:-1]:
            if not isinstance(current, dict) or part not in current:
                return
            current = current.get(part)
        if isinstance(current, dict):
            current.pop(parts[-1], None)

    def _error_result(self, message):
        result = {
            'success': False,
            'error': message,
        }
        return {
            'outputs': [[result]],
            'json': result,
        }
