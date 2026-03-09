# -*- coding: utf-8 -*-

"""
Switch Node Runner

Routes data to one of multiple branches based on equality checks.
"""

from ..context_objects import build_eval_context
from .base import BaseNodeRunner


class SwitchNodeRunner(BaseNodeRunner):
    """Runner for switch node."""

    node_type = 'switch'

    def execute(self, node_config, input_data, context):
        payload = input_data or {}
        eval_context = build_eval_context(payload, context, include_input_item=True)

        switch_value = self.resolver.resolve(node_config.get('switchValue', ''), eval_context)
        case1 = self.resolver.resolve(node_config.get('case1', ''), eval_context)
        case2 = self.resolver.resolve(node_config.get('case2', ''), eval_context)
        case3 = self.resolver.resolve(node_config.get('case3', ''), eval_context)

        switch_value, case1 = self._coerce_numbers(switch_value, case1)
        switch_value, case2 = self._coerce_numbers(switch_value, case2)
        switch_value, case3 = self._coerce_numbers(switch_value, case3)

        output_index = 3
        if case1 != '':
            if switch_value == case1:
                output_index = 0
        if output_index == 3 and case2 != '':
            if switch_value == case2:
                output_index = 1
        if output_index == 3 and case3 != '':
            if switch_value == case3:
                output_index = 2

        outputs = [[], [], [], []]
        outputs[output_index] = [input_data]

        return {
            'outputs': outputs,
            'json': input_data,
            'branch': output_index,
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
