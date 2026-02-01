# -*- coding: utf-8 -*-

"""
IF Node Runner

Conditional branching node that routes data based on expression evaluation.
"""

import logging

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
        # Build context for expression evaluation
        eval_context = {
            'json': input_data or {},
            'node': context.get('node', {}),
            'vars': context.get('vars', {}),
        }
        
        # Evaluate condition
        condition_expr = node_config.get('condition', 'false')
        
        try:
            condition_result = ExpressionEvaluator.evaluate(condition_expr, eval_context)
        except Exception as e:
            _logger.warning(f"IF condition evaluation failed: {e}, treating as false")
            condition_result = False
        
        # Route to appropriate branch
        if condition_result:
            return {
                'outputs': [[input_data], []],  # True branch gets data, false empty
                'json': input_data,
                'branch': 'true',
            }
        else:
            return {
                'outputs': [[], [input_data]],  # False branch gets data, true empty
                'json': input_data,
                'branch': 'false',
            }
