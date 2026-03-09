# -*- coding: utf-8 -*-

"""
Base Node Runner, Expression Evaluator, and Smart Expression Resolver

Provides foundation for node execution:
    - SmartExpressionResolver: Unified expression resolution (type-preserving)
    - ExpressionEvaluator: Legacy evaluator (deprecated, delegates to resolver)
    - BaseNodeRunner: Abstract base class for node execution
"""

import re
import logging

from odoo.tools.safe_eval import safe_eval

_logger = logging.getLogger(__name__)


# =============================================================================
# SMART EXPRESSION RESOLVER (unified, type-preserving)
# =============================================================================

class SmartExpressionResolver:
    """Unified expression resolver with n8n-aligned smart interpolation.

    Resolution tiers:
        1. Non-string value → return as-is
        2. Single ``{{ expr }}`` (full match) → safe_eval → **return raw type**
        3. Mixed ``text {{ a }} more {{ b }}`` → string interpolation → str
        4. No ``{{ }}`` → return literal string as-is

    This replaces both ``ExpressionEvaluator.evaluate()`` (always string) and
    the duplicated per-runner ``_resolve_value()`` (ad-hoc dual-regex).
    """

    _TEMPLATE_RE = re.compile(r'\{\{(.+?)\}\}')
    _FULL_TEMPLATE_RE = re.compile(r'^\s*\{\{(.+)\}\}\s*$')

    def resolve(self, value, eval_context):
        """Resolve *value* using the 3-tier strategy.

        Returns the raw Python type when the value is a single ``{{ expr }}``,
        a string when mixed templates are present, or the literal value
        otherwise.
        """
        if not isinstance(value, str):
            return value

        stripped = value.strip()
        if not stripped:
            return value

        # Tier 1: Full template → type-preserving eval
        full_match = self._FULL_TEMPLATE_RE.match(stripped)
        if full_match:
            inner_expr = full_match.group(1).strip()
            try:
                return safe_eval(inner_expr, eval_context, mode='eval')
            except Exception as e:
                _logger.warning("Expression evaluation failed: %s -> %s", inner_expr, e)
                return value

        # Tier 2: Partial/mixed templates → string interpolation
        if self._TEMPLATE_RE.search(value):
            def _replace(match):
                inner = match.group(1).strip()
                try:
                    result = safe_eval(inner, eval_context, mode='eval')
                    return str(result) if result is not None else ''
                except Exception as e:
                    _logger.warning("Expression interpolation failed: %s -> %s", inner, e)
                    return ''
            return self._TEMPLATE_RE.sub(_replace, value)

        # Tier 3: No templates → literal passthrough
        return value

    # ------------------------------------------------------------------
    # Typed convenience helpers
    # ------------------------------------------------------------------

    def resolve_str(self, value, eval_context):
        """Resolve and always return a string."""
        result = self.resolve(value, eval_context)
        if result is None:
            return ''
        return str(result)

    def resolve_int(self, value, eval_context, default=None):
        """Resolve and coerce to int (or *default*)."""
        result = self.resolve(value, eval_context)
        if result is None or result == '':
            return default
        try:
            return int(result)
        except (TypeError, ValueError):
            return default

    def resolve_list(self, value, eval_context, default=None):
        """Resolve and coerce to list (or *default*)."""
        result = self.resolve(value, eval_context)
        if result is None:
            return default if default is not None else []
        if isinstance(result, (list, tuple)):
            return list(result)
        if isinstance(result, str):
            stripped = result.strip()
            if not stripped or stripped == '[]':
                return default if default is not None else []
            # Attempt JSON parse
            import json
            try:
                parsed = json.loads(stripped)
                if isinstance(parsed, list):
                    return parsed
            except (ValueError, TypeError):
                pass
        return default if default is not None else []

    def resolve_domain(self, domain_value, eval_context):
        """Resolve a domain value (list or string) to a Python domain list.

        Accepts:
          - ``{{ [('field', '=', val)] }}`` — full expression template
          - ``[('field', '=', val)]``       — plain Odoo domain string
          - Already a ``list``

        After resolving to a list, per-leaf ``{{ }}`` expressions are
        resolved individually for backward compatibility.
        """
        import ast
        raw = domain_value
        if raw is None:
            return []
        resolved = self.resolve(raw, eval_context)
        if resolved is None:
            return []
        if isinstance(resolved, list):
            return self._resolve_domain_leaves(resolved, eval_context)
        if isinstance(resolved, str):
            stripped = resolved.strip()
            if not stripped or stripped == '[]':
                return []
            try:
                parsed = ast.literal_eval(stripped)
            except (ValueError, SyntaxError):
                parsed = safe_eval(stripped, eval_context, mode='eval')
            if isinstance(parsed, list):
                return self._resolve_domain_leaves(parsed, eval_context)
        raise ValueError(
            "Domain must evaluate to a list, got: %r" % type(resolved).__name__
        )

    def _resolve_domain_leaves(self, domain_list, eval_context):
        """Walk domain list and resolve ``{{ }}`` in individual leaf values.

        Domain connectors (``&``, ``|``, ``!``) pass through unchanged.
        Leaf values use strict full-template-only resolution (no partial
        interpolation) to avoid SQL type mismatches.
        """
        result = []
        for item in domain_list:
            if isinstance(item, str):
                result.append(item)
            elif isinstance(item, (list, tuple)):
                if len(item) == 3:
                    field, op, value = item
                    value = self._resolve_leaf_value(value, eval_context)
                    result.append((field, op, value))
                else:
                    result.append(item)
            else:
                result.append(item)
        return result

    def _resolve_leaf_value(self, value, eval_context):
        """Resolve a single domain leaf value (strict: full ``{{ }}`` only).

        Partial templates are rejected to prevent SQL type mismatches.
        """
        if not isinstance(value, str):
            return value

        stripped = value.strip()
        if not stripped:
            return value

        full_match = self._FULL_TEMPLATE_RE.match(stripped)
        if full_match:
            inner = full_match.group(1).strip()
            return safe_eval(inner, eval_context, mode='eval')

        if '{{' in stripped and '}}' in stripped:
            raise ValueError(
                "Partial expression templates are not supported in domain values. "
                "Wrap the entire value as a single expression: "
                "{{ [_input.json.id] }} instead of [{{ _input.json.id }}]. "
                "Got: %s" % stripped
            )

        return value


# Singleton for reuse across runners
_resolver = SmartExpressionResolver()


# =============================================================================
# EXPRESSION EVALUATOR (deprecated — delegates to SmartExpressionResolver)
# =============================================================================

class ExpressionEvaluator:
    """Evaluates template expressions using safe_eval.

    .. deprecated::
        Use ``SmartExpressionResolver`` instead. This class is kept for
        backward compatibility and delegates to ``resolve_str`` (always
        returns a string, matching the original behavior).
    """

    _TEMPLATE_RE = re.compile(r'\{\{(.+?)\}\}')

    @classmethod
    def translate_expression(cls, expr):
        """Return expression as-is (no translation)."""
        return expr

    @classmethod
    def evaluate(cls, expr, context):
        """Evaluate expression with given context.

        .. deprecated:: Use ``SmartExpressionResolver.resolve()`` instead.
        """
        return _resolver.resolve_str(expr, context)


# =============================================================================
# BASE NODE RUNNER
# =============================================================================

class BaseNodeRunner:
    """Base class for node execution."""

    node_type = None

    def __init__(self, executor):
        self.executor = executor
        self.resolver = _resolver

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
