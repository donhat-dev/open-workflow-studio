# -*- coding: utf-8 -*-

"""
Base Node Runner and Expression Evaluator

Provides foundation for node execution:
    - ExpressionEvaluator: Translates _json.field to Python _json['field'] for safe_eval
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
    """Evaluates n8n-style expressions using safe_eval.
    
    Translates:
        _json.field → _json['field']
        _json.items[0].name → _json['items'][0]['name']
        _node.Http.data → _node['Http']['data']
        _vars.count → _vars['count']
        $json.field → _json['field'] (legacy $ prefix)
        json.field → _json['field'] (legacy bare namespace)
        vars.count → _vars['count'] (legacy bare namespace)
    """
    
    # Pattern to match $namespace.path or _namespace.path expressions
    NAMESPACE_PATTERN = re.compile(r'(\$|_)(\w+)((?:\.\w+|\[\d+\])*)')
    
    # Pattern to match bare namespace.path expressions (without prefix)
    # Matches: json.field, node.Http, vars.count, input.item, loop.item
    BARE_NAMESPACE_PATTERN = re.compile(r'\b(json|node|vars|input|loop)((?:\.\w+|\[\d+\])+)')

    NAMESPACE_MAP = {
        'json': '_json',
        'node': '_node',
        'vars': '_vars',
        'input': '_input',
        'loop': '_loop',
    }
    
    @classmethod
    def translate_expression(cls, expr):
        """Translate n8n expression to Python expression.
        
        Supports both:
        - _json.items[0].name → _json['items'][0]['name']
        - json.items[0].name → _json['items'][0]['name']
        
        Args:
            expr: Expression string, e.g., "_json.items[0].name" or "json.items[0].name"
            
        Returns:
            Python expression string, e.g., "json['items'][0]['name']"
        """
        if not isinstance(expr, str):
            return expr
            
        def replace_namespace(match):
            """Helper to convert namespace.path to namespace['path']."""
            if match.group(1) in ('$', '_'):
                namespace = match.group(2)
                path = match.group(3) or ''
            else:
                namespace = match.group(1)
                path = match.group(2) or ''
            target = cls.NAMESPACE_MAP.get(namespace, namespace)
            
            # Build Python path
            result = target
            if path:
                # Split by dots and brackets
                parts = re.split(r'\.(?![^\[]*\])', path.lstrip('.'))
                for part in parts:
                    if not part:
                        continue
                    # Handle array access like items[0]
                    bracket_match = re.match(r'(\w+)(\[\d+\])?', part)
                    if bracket_match:
                        field = bracket_match.group(1) or ''
                        if not field:
                            continue
                        index = bracket_match.group(2) or ''
                        result += f"['{field}']{index}"
            
            return result
        
        # First translate $namespace.path or _namespace.path
        result = cls.NAMESPACE_PATTERN.sub(replace_namespace, expr)
        
        # Then translate bare namespace.path (legacy without prefix)
        result = cls.BARE_NAMESPACE_PATTERN.sub(replace_namespace, result)
        
        return result
    
    @classmethod
    def evaluate(cls, expr, context):
        """Evaluate expression with given context.
        
        Supports both syntaxes:
        - _json.field (preferred)
        - $json.field (legacy with $ prefix)
        - json.field (legacy bare namespace)
        
        Args:
            expr: Expression string (n8n or Python style)
            context: Dict with json, node, vars, etc.
            
        Returns:
            Evaluated result
            
        Raises:
            ValueError: If expression evaluation fails
        """
        if not isinstance(expr, str):
            return expr
            
        # Check for template syntax {{ ... }}
        template_pattern = re.compile(r'\{\{(.+?)\}\}')
        if template_pattern.search(expr):
            # String interpolation mode
            def replace_template(match):
                inner_expr = match.group(1).strip()
                translated = cls.translate_expression(inner_expr)
                try:
                    result = safe_eval(translated, context, mode='eval')
                    return str(result) if result is not None else ''
                except Exception as e:
                    _logger.warning(f"Expression evaluation failed: {inner_expr} -> {e}")
                    return ''
            
            return template_pattern.sub(replace_template, expr)
        
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
