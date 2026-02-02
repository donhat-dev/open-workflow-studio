# -*- coding: utf-8 -*-

"""
IF Node Runner

Conditional branching node that routes data based on expression evaluation.
"""

import logging
import re

from odoo.tools.safe_eval import safe_eval

from .base import BaseNodeRunner, ExpressionEvaluator

_logger = logging.getLogger(__name__)


class IfNodeRunner(BaseNodeRunner):
    """IF conditional branching node.
    
    Config:
        condition: Expression that evaluates to truthy/falsy
        
    Outputs:
        [0]: True branch - receives input if condition is truthy
        [1]: False branch - receives input if condition is falsy
    """
    
    node_type = 'if'
    
    def execute(self, node_config, input_data, context):
        payload = input_data or {}
        eval_context = {
            '_json': payload,
            '_node': context.get('node', {}),
            '_vars': context.get('vars', {}),
            '_input': {'item': payload, 'json': payload},
        }

        if any(key in node_config for key in ('leftOperand', 'operator', 'rightOperand')):
            left_raw = node_config.get('leftOperand', '')
            right_raw = node_config.get('rightOperand', '')
            operator = node_config.get('operator', 'eq')

            left = self._resolve_value(left_raw, eval_context)
            right = self._resolve_value(right_raw, eval_context)

            left, right = self._coerce_numbers(left, right)
            condition_result = self._compare(operator, left, right)
        else:
            condition_expr = node_config.get('condition', 'false')
            try:
                raw_result = self._resolve_value(condition_expr, eval_context)
                condition_result = self._to_bool(raw_result)
            except Exception as e:
                _logger.warning("IF condition evaluation failed: %s, treating as false", e)
                condition_result = False

        if condition_result:
            return {
                'outputs': [[input_data], []],
                'json': input_data,
                'branch': 'true',
            }

        return {
            'outputs': [[], [input_data]],
            'json': input_data,
            'branch': 'false',
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
            except Exception as e:
                _logger.warning("IF template evaluation failed: %s", e)
                return raw_value

        if '{{' in raw_value and '}}' in raw_value:
            try:
                return ExpressionEvaluator.evaluate(raw_value, eval_context)
            except Exception as e:
                _logger.warning("IF expression evaluation failed: %s", e)
                return raw_value

        return raw_value

    def _coerce_numbers(self, left, right):
        left_num = self._maybe_number(left)
        right_num = self._maybe_number(right)
        if isinstance(left_num, (int, float)) and isinstance(right_num, (int, float)):
            return left_num, right_num
        return left, right

    def _maybe_number(self, value):
        if isinstance(value, (int, float)):
            return value
        if isinstance(value, str):
            stripped = value.strip()
            if not stripped:
                return value
            try:
                return float(stripped)
            except ValueError:
                return value
        return value

    def _compare(self, operator, left, right):
        if operator == 'eq':
            return left == right
        if operator == 'neq':
            return left != right
        if operator == 'gt':
            return left > right
        if operator == 'gte':
            return left >= right
        if operator == 'lt':
            return left < right
        if operator == 'lte':
            return left <= right
        if operator == 'contains':
            if isinstance(left, (list, tuple, set)):
                return right in left
            if isinstance(left, dict):
                return right in left
            return str(left).find(str(right)) != -1
        if operator == 'startsWith':
            return str(left).startswith(str(right))
        if operator == 'endsWith':
            return str(left).endswith(str(right))
        if operator == 'empty':
            return self._is_empty(left)
        if operator == 'notEmpty':
            return not self._is_empty(left)
        if operator == 'truthy':
            return bool(left)
        if operator == 'falsy':
            return not bool(left)
        return False

    def _is_empty(self, value):
        if value is None:
            return True
        if value == '':
            return True
        if isinstance(value, (list, tuple, set, dict)) and len(value) == 0:
            return True
        return False

    def _to_bool(self, value):
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            lowered = value.strip().lower()
            if lowered in ('true', '1', 'yes', 'y', 'on'):
                return True
            if lowered in ('false', '0', 'no', 'n', 'off', ''):
                return False
        return bool(value)
