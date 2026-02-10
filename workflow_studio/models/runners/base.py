# -*- coding: utf-8 -*-

"""
Base Node Runner and Expression Evaluator

Provides foundation for node execution:
    - ExpressionEvaluator: Evaluates template expressions with safe_eval
    - BaseNodeRunner: Abstract base class for node execution
"""

import re
import logging

from odoo.tools.safe_eval import safe_eval

_logger = logging.getLogger(__name__)


# =============================================================================
# EXPRESSION EVALUATOR
# =============================================================================

class ExpressionEvaluator:
    """Evaluates template expressions using safe_eval.

    Expressions are evaluated only inside {{ ... }} blocks.
    The expression content is passed through as-is (no translation).
    """

    _TEMPLATE_RE = re.compile(r'\{\{(.+?)\}\}')

    @classmethod
    def translate_expression(cls, expr):
        """Return expression as-is (no translation)."""
        return expr
    
    @classmethod
    def evaluate(cls, expr, context):
        """Evaluate expression with given context.
        
        Args:
            expr: Expression string
            context: Dict with json, node, vars, etc.
            
        Returns:
            Evaluated result
            
        Raises:
            ValueError: If expression evaluation fails
        """
        if not isinstance(expr, str):
            return expr
            
        # Check for template syntax {{ ... }}
        if cls._TEMPLATE_RE.search(expr):
            # String interpolation mode
            def replace_template(match):
                inner_expr = match.group(1).strip()
                try:
                    result = safe_eval(inner_expr, context, mode='eval')
                    return str(result) if result is not None else ''
                except Exception as e:
                    _logger.warning(f"Expression evaluation failed: {inner_expr} -> {e}")
                    return ''
            
            return cls._TEMPLATE_RE.sub(replace_template, expr)
        
        # Return as-is if not an explicit template expression
        return expr


# =============================================================================
# BASE NODE RUNNER
# =============================================================================

class BaseNodeRunner:
    """Base class for node execution."""
    
    node_type = None
    
    def __init__(self, executor):
        self.executor = executor
        
    def execute(self, node_config, input_data, context):
        """Execute node and return outputs.
        
        Args:
            node_config: Node configuration dict
            input_data: Input data from previous node
            context: Execution context with json, node, vars
            
        Returns:
            dict with 'outputs' (2D array) and 'json' (first output item)
        """
        raise NotImplementedError
