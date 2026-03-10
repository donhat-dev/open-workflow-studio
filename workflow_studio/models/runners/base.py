# -*- coding: utf-8 -*-

"""
Base Node Runner and Smart Expression Resolver

Provides foundation for node execution:
        - SmartExpressionResolver: Unified strict `=`-prefixed expression resolution
            with template-only evaluation boundaries
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
    """Unified strict expression resolver with explicit `=` contract.

    Resolution tiers:
        1. Non-string value → return as-is
        2. Non-prefixed string → return literal string as-is
        3. Prefixed ``=...`` → explicit expression-string mode

    Inside prefixed expression mode, the body may be:
        - full template body: ``={{ _json.id }}``
        - mixed interpolation: ``=Name is {{ _json.name }}``
        - plain text literal: ``=_json.id`` → ``"_json.id"``
    """

    _TEMPLATE_RE = re.compile(r'\{\{(.+?)\}\}')
    _FULL_TEMPLATE_RE = re.compile(r'^\s*\{\{(.+)\}\}\s*$')

    def is_expression_mode(self, value):
        return isinstance(value, str) and value.startswith('=')

    def strip_expression_prefix(self, value):
        if not isinstance(value, str):
            return value
        return value[1:] if self.is_expression_mode(value) else value

    def should_resolve_string(self, value):
        return isinstance(value, str) and self.is_expression_mode(value)

    def has_template_markers(self, value):
        return isinstance(value, str) and bool(self._TEMPLATE_RE.search(value))

    def is_literal_prefixed_string(self, value):
        if not self.is_expression_mode(value):
            return False
        body = self.strip_expression_prefix(value)
        return not self.has_template_markers(body)

    def _interpolate_templates(self, value, eval_context):
        def _replace(match):
            inner = match.group(1).strip()
            try:
                result = safe_eval(inner, eval_context, mode='eval')
                return str(result) if result is not None else ''
            except Exception as e:
                _logger.warning("Expression interpolation failed: %s -> %s", inner, e)
                return ''

        return self._TEMPLATE_RE.sub(_replace, value)

    def _resolve_prefixed_expression(self, value, eval_context):
        body = self.strip_expression_prefix(value)
        if not isinstance(body, str):
            return body

        stripped = body.strip()
        if not stripped:
            return ''

        full_match = self._FULL_TEMPLATE_RE.match(stripped)
        if full_match:
            inner_expr = full_match.group(1).strip()
            try:
                return safe_eval(inner_expr, eval_context, mode='eval')
            except Exception as e:
                _logger.warning("Prefixed expression evaluation failed: %s -> %s", inner_expr, e)
                return body

        if self._TEMPLATE_RE.search(body):
            return self._interpolate_templates(body, eval_context)

        return body

    def resolve(self, value, eval_context):
        """Resolve *value* using the strict explicit-prefix strategy."""
        if not isinstance(value, str):
            return value

        if value == '':
            return value

        if not self.is_expression_mode(value):
            return value

        return self._resolve_prefixed_expression(value, eval_context)

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
        if self.is_literal_prefixed_string(value):
            return default
        result = self.resolve(value, eval_context)
        if result is None or result == '':
            return default
        try:
            return int(result)
        except (TypeError, ValueError):
            return default

    def resolve_list(self, value, eval_context, default=None):
        """Resolve and coerce to list (or *default*)."""
        if self.is_literal_prefixed_string(value):
            return default if default is not None else []
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
                    - ``={{ [('field', '=', val)] }}`` — explicit expression mode
                    - ``[('field', '=', val)]``  — plain Odoo domain string
                    - Already a ``list``

                After resolving to a list, per-leaf explicit ``=...`` expressions are
                resolved individually.
        """
        import ast
        raw = domain_value
        if raw is None:
            return []
        if self.is_literal_prefixed_string(raw):
            raise ValueError(
                "Domain expressions must wrap dynamic content in {{ ... }} when using '=' prefix"
            )
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
        """Walk domain list and resolve explicit ``=...`` leaf values.

        Domain connectors (``&``, ``|``, ``!``) pass through unchanged.
        Non-prefixed strings are treated as literal values.
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
        """Resolve a single domain leaf value using the strict `=` contract."""
        if not isinstance(value, str):
            return value

        if value == '':
            return value

        if self.is_expression_mode(value):
            return self._resolve_prefixed_expression(value, eval_context)

        return value


# Singleton for reuse across runners
_resolver = SmartExpressionResolver()


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
