# -*- coding: utf-8 -*-

"""
IF Node Runner

Conditional branching node that routes data based on expression evaluation.
"""

import logging

from ..context_objects import build_eval_context
from .base import BaseNodeRunner

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
        eval_context = build_eval_context(payload, context, include_input_item=True)

        if any(key in node_config for key in ('leftOperand', 'operator', 'rightOperand')):
            left_raw = node_config.get('leftOperand', '')
            right_raw = node_config.get('rightOperand', '')
            operator = node_config.get('operator', 'eq')

            left = self.resolver.resolve(left_raw, eval_context)
            right = self.resolver.resolve(right_raw, eval_context)

            left, right = self._coerce_numbers(left, right)
            condition_result = self._compare(operator, left, right)
        else:
            condition_expr = node_config.get('condition', 'false')
            try:
                raw_result = self.resolver.resolve(condition_expr, eval_context)
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
