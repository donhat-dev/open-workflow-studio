# -*- coding: utf-8 -*-

"""
Record Operation Node Runner

Phase-1 operations:
    - search
    - create
    - write
    - delete (unlink)
"""

import re

from odoo.tools.safe_eval import safe_eval

from ..context_objects import build_eval_context
from .base import BaseNodeRunner, ExpressionEvaluator


class RecordOperationNodeRunner(BaseNodeRunner):
    """Runner for record_operation node."""

    node_type = 'record_operation'
    _TEMPLATE_RE = re.compile(r'^\s*\{\{(.+)\}\}\s*$')

    def execute(self, node_config, input_data, context):
        payload = input_data or {}
        eval_context = self._get_eval_context(payload, context)

        operation = str(node_config.get('operation') or 'search').strip().lower()
        model_name = self._resolve_model_name(node_config.get('model'), eval_context)
        if not model_name:
            raise ValueError("Model is required")

        model = eval_context['env'][model_name]

        if operation == 'search':
            result = self._run_search(model, node_config, eval_context)
        elif operation == 'create':
            result = self._run_create(model, node_config, eval_context)
        elif operation == 'write':
            result = self._run_write(model, node_config, eval_context)
        elif operation == 'delete':
            result = self._run_delete(model, node_config, eval_context)
        else:
            raise ValueError("Unsupported operation: %s" % operation)

        return {
            'outputs': [[result]],
            'json': result,
        }

    def _get_eval_context(self, payload, context):
        secure_context = context.get('secure_eval_context') if isinstance(context, dict) else None
        if isinstance(secure_context, dict) and secure_context.get('env'):
            return secure_context
        # Fallback for non-runtime contexts
        fallback = build_eval_context(payload, context, include_input_item=True)
        if 'env' not in fallback:
            raise ValueError("Secure env context is required for record operations")
        return fallback

    def _resolve_model_name(self, raw_model, eval_context):
        value = self._resolve_value(raw_model, eval_context)
        if value is None:
            return ''
        return str(value).strip()

    def _resolve_value(self, raw_value, eval_context):
        if not isinstance(raw_value, str):
            return raw_value

        stripped = raw_value.strip()
        if not stripped:
            return raw_value

        template_match = self._TEMPLATE_RE.match(stripped)
        if template_match:
            expr = template_match.group(1).strip()
            return safe_eval(expr, eval_context, mode='eval')

        if '{{' in raw_value and '}}' in raw_value:
            return ExpressionEvaluator.evaluate(raw_value, eval_context)

        return raw_value

    def _resolve_int(self, raw_value, eval_context, default=None):
        value = self._resolve_value(raw_value, eval_context)
        if value is None or value == '':
            return default
        try:
            return int(value)
        except (TypeError, ValueError):
            return default

    def _resolve_domain(self, node_config, eval_context):
        """Resolve domain_expr to a Python list.

        Accepts three formats:
          1. ``{{ [('field', '=', val)] }}`` — expression template (legacy)
          2. ``[('field', '=', val)]``       — plain Odoo domain string from DomainSelector
          3. Already a list (from expression evaluation)
        """
        raw = node_config.get('domain_expr') or '[]'
        domain = self._resolve_value(raw, eval_context)
        if domain is None:
            return []
        if isinstance(domain, list):
            return domain
        # Plain Odoo domain string from DomainSelector: "[('name', 'ilike', 'test')]"
        if isinstance(domain, str):
            stripped = domain.strip()
            if not stripped or stripped == '[]':
                return []
            parsed = safe_eval(stripped, eval_context, mode='eval')
            if isinstance(parsed, list):
                return parsed
        raise ValueError("domain_expr must evaluate to a list, got: %r" % type(domain).__name__)

    def _resolve_fields(self, node_config, eval_context):
        fields_value = self._resolve_value(node_config.get('fields_expr', "{{ ['id', 'display_name'] }}"), eval_context)
        if fields_value in (None, ''):
            return ['id', 'display_name']
        if not isinstance(fields_value, list):
            raise ValueError("Fields must evaluate to a list")
        return [str(field) for field in fields_value if field]

    def _resolve_vals(self, node_config, eval_context):
        """Resolve vals_expr to a dict (or list of dicts for batch create).

        Accepts three formats:
          1. ``{{ {...} }}``               — expression template (legacy)
          2. ``'{"name": "{{ expr }}"}'``  — JSON object string from FieldValuesControl
          3. Already a dict/list (from expression evaluation)

        For JSON-format dicts, each value that contains ``{{ }}`` is evaluated
        individually so field values can still use expression syntax.
        """
        import json
        raw = node_config.get('vals_expr') or '{}'
        vals = self._resolve_value(raw, eval_context)
        if vals is None:
            return {}
        if isinstance(vals, dict):
            return self._eval_val_expressions(vals, eval_context)
        if isinstance(vals, list):
            return [
                self._eval_val_expressions(item, eval_context) if isinstance(item, dict) else item
                for item in vals
            ]
        if isinstance(vals, str):
            stripped = vals.strip()
            if not stripped or stripped in ('{}', '[]'):
                return {}
            # Try JSON (from FieldValuesControl serialization)
            try:
                parsed = json.loads(stripped)
                if isinstance(parsed, dict):
                    return self._eval_val_expressions(parsed, eval_context)
                if isinstance(parsed, list):
                    return [
                        self._eval_val_expressions(item, eval_context) if isinstance(item, dict) else item
                        for item in parsed
                    ]
            except (ValueError, TypeError):
                pass
            # Fallback: Python literal via safe_eval (backward compat)
            parsed = safe_eval(stripped, eval_context, mode='eval')
            if isinstance(parsed, dict):
                return self._eval_val_expressions(parsed, eval_context)
            if isinstance(parsed, list):
                return [
                    self._eval_val_expressions(item, eval_context) if isinstance(item, dict) else item
                    for item in parsed
                ]
        raise ValueError("vals_expr must evaluate to an object or list of objects")

    def _eval_val_expressions(self, d, eval_context):
        """Evaluate any ``{{ }}`` expression values inside a dict."""
        result = {}
        for k, v in d.items():
            if isinstance(v, str) and '{{' in v and '}}' in v:
                result[k] = self._resolve_value(v, eval_context)
            else:
                result[k] = v
        return result

    def _resolve_ids(self, node_config, eval_context):
        ids_value = self._resolve_value(node_config.get('ids_expr', '{{ [] }}'), eval_context)
        if ids_value in (None, ''):
            return []
        if isinstance(ids_value, int):
            return [ids_value]
        if isinstance(ids_value, (list, tuple, set)):
            result = []
            for value in ids_value:
                try:
                    result.append(int(value))
                except (TypeError, ValueError):
                    continue
            return result
        raise ValueError("Record IDs must evaluate to int or list of ints")

    def _resolve_target_records(self, model, node_config, eval_context):
        ids = self._resolve_ids(node_config, eval_context)
        if ids:
            return model.browse(ids)

        domain = self._resolve_domain(node_config, eval_context)
        limit = self._resolve_int(node_config.get('limit'), eval_context, default=None)
        return model.search(domain, limit=limit or None)

    def _run_search(self, model, node_config, eval_context):
        domain = self._resolve_domain(node_config, eval_context)
        fields_list = self._resolve_fields(node_config, eval_context)
        limit = self._resolve_int(node_config.get('limit'), eval_context, default=20)
        order_value = self._resolve_value(node_config.get('order'), eval_context)
        order = str(order_value).strip() if order_value else None

        records = model.search(domain, limit=limit or None, order=order or None)
        return {
            'success': True,
            'operation': 'search',
            'model': model._name,
            'count': len(records),
            'ids': records.ids,
            'records': records.read(fields_list) if fields_list else records.read(['id', 'display_name']),
            'fields': fields_list,
            'limit': limit,
            'order': order or '',
        }

    def _run_create(self, model, node_config, eval_context):
        vals = self._resolve_vals(node_config, eval_context)
        created = model.create(vals)
        return {
            'success': True,
            'operation': 'create',
            'model': model._name,
            'count': len(created),
            'ids': created.ids,
            'records': created.read(['id', 'display_name']),
        }

    def _run_write(self, model, node_config, eval_context):
        vals = self._resolve_vals(node_config, eval_context)
        if not isinstance(vals, dict):
            raise ValueError("Write operation requires values object")

        records = self._resolve_target_records(model, node_config, eval_context)
        count = len(records)
        if count:
            records.write(vals)

        return {
            'success': True,
            'operation': 'write',
            'model': model._name,
            'count': count,
            'ids': records.ids,
            'values': vals,
        }

    def _run_delete(self, model, node_config, eval_context):
        records = self._resolve_target_records(model, node_config, eval_context)
        ids = list(records.ids)
        count = len(ids)
        if count:
            records.unlink()

        return {
            'success': True,
            'operation': 'delete',
            'model': model._name,
            'count': count,
            'ids': ids,
        }