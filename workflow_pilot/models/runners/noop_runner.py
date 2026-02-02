# -*- coding: utf-8 -*-

"""
NoOp Node Runner

Pass-through node for placeholder usage.
"""

from .base import BaseNodeRunner


class NoOpNodeRunner(BaseNodeRunner):
    """No-op node runner that forwards input unchanged."""

    node_type = 'noop'

    def execute(self, node_config, input_data, context):
        return {
            'outputs': [[input_data]],
            'json': input_data,
        }
