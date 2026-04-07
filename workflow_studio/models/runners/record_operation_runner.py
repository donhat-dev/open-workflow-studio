"""
Record Operation Node Runner

Phase-1 operations:
    - search
    - create
    - write
    - delete (unlink)
"""

from odoo.tools.safe_eval import safe_eval

from ..context_objects import build_eval_context
from .base import BaseNodeRunner


class RecordOperationNodeRunner(BaseNodeRunner):
    """Runner for record_operation node."""

    node_type = "record_operation"

    def execute(self, node_config, input_data, context):
        payload = input_data or {}
        eval_context = self._get_eval_context(payload, context)

        operation = str(node_config.get("operation") or "search").strip().lower()
        model_name = self._resolve_model_name(node_config.get("model"), eval_context)
        if not model_name:
            raise ValueError("Model is required")

        model = eval_context["env"][model_name]

        if operation == "search":
            result = self._run_search(model, node_config, eval_context)
        elif operation == "create":
            result = self._run_create(model, node_config, eval_context)
        elif operation == "write":
            result = self._run_write(model, node_config, eval_context)
        elif operation == "delete":
            result = self._run_delete(model, node_config, eval_context)
        else:
            raise ValueError("Unsupported operation: %s" % operation)

        return {
            "outputs": [[result]],
            "json": result,
        }

    def _get_eval_context(self, payload, context):
        secure_context = (
            context.get("secure_eval_context") if isinstance(context, dict) else None
        )
        if isinstance(secure_context, dict) and secure_context.get("env"):
            return secure_context
        # Fallback for non-runtime contexts
        fallback = build_eval_context(payload, context, include_input_item=True)
        if "env" not in fallback:
            raise ValueError("Secure env context is required for record operations")
        return fallback

    def _resolve_model_name(self, raw_model, eval_context):
        value = self.resolver.resolve(raw_model, eval_context)
        if value is None:
            return ""
        return str(value).strip()

    def _resolve_int(self, raw_value, eval_context, default=None):
        return self.resolver.resolve_int(raw_value, eval_context, default=default)

    def _coerce_field_value(self, model, field_name, value):
        """Coerce *value* to the Python type expected by *model*.*field_name*.

        Fixes the common case where UI/JSON serialisation delivers every value
        as a ``str`` even when the field is Integer, Float, Boolean, etc.
        Non-string values are returned as-is after minimal normalisation.
        Unknown fields are returned unchanged so Odoo surfaces the real error.
        """
        if value is None:
            return value

        field = model._fields.get(field_name)
        if field is None:
            return value  # unknown field – let Odoo raise

        ftype = field.type

        if not isinstance(value, str):
            if ftype == "boolean" and isinstance(value, int):
                return bool(value)
            return value

        stripped = value.strip()

        if ftype in ("integer", "many2one"):
            if stripped == "" or stripped.lower() in ("false", "none"):
                return False
            try:
                return int(stripped)
            except (ValueError, TypeError):
                return value

        if ftype == "float":
            if stripped == "":
                return 0.0
            try:
                return float(stripped)
            except (ValueError, TypeError):
                return value

        if ftype == "boolean":
            if stripped.lower() in ("true", "1", "yes"):
                return True
            if stripped.lower() in ("false", "0", "no", ""):
                return False
            return bool(stripped)

        # char, text, html, date, datetime, selection, many2many, one2many – keep as-is
        return value

    def _resolve_domain(self, node_config, eval_context):
        """Resolve domain_expr to a Python list.

        Accepts three formats:
                    1. ``={{ [('field', '=', val)] }}`` — explicit expression mode
                    2. ``[('field', '=', val)]``       — plain Odoo domain string from DomainSelector
                    3. Already a list

                After resolving the domain to a list, per-value explicit ``=...``
                expressions inside individual tuples are resolved.
        """
        raw = node_config.get("domain_expr") or "[]"
        return self.resolver.resolve_domain(raw, eval_context)

    def _resolve_domain_values(self, domain_list, eval_context):
        """Walk a domain list and resolve explicit ``=...`` tuple values.

        Handles domain connectors (``&``, ``|``, ``!``) which appear as plain
        strings amid the tuple elements.  Tuples are ``(field, op, value)``
        where *value* may be an explicit ``=...`` string that needs resolution.

        Non-prefixed strings stay literal, matching the strict global
        expression contract.
        """
        result = []
        for item in domain_list:
            if isinstance(item, str):
                # Domain connector: '&', '|', '!'
                result.append(item)
            elif isinstance(item, (list, tuple)):
                if len(item) == 3:
                    field, op, value = item
                    value = self.resolver._resolve_leaf_value(value, eval_context)
                    result.append((field, op, value))
                else:
                    result.append(item)
            else:
                result.append(item)
        return result

    def _resolve_fields(self, node_config, eval_context):
        """Resolve fields_expr to a list of field names.

        Accepts three formats:
                    1. ``={{ ['field1', 'field2'] }}`` — explicit expression mode
                    2. ``'field1, field2'``           — comma-separated string from FieldSelector
                    3. Already a list of field names

        If the resolved value is empty or None, defaults to ['id', 'display_name'].
        Returns a list of strings.
        """

        fields_value = self.resolver.resolve(
            node_config.get("fields_expr", "={{ ['id', 'display_name'] }}"),
            eval_context,
        )
        if fields_value in (None, ""):
            return ["id", "display_name"]
        if isinstance(fields_value, str):
            return [field.strip() for field in fields_value.split(",") if field.strip()]
        if not isinstance(fields_value, list):
            raise ValueError("Fields must evaluate to a list")
        return [str(field) for field in fields_value if field]

    def _is_full_template_string(self, value):
        if not isinstance(value, str):
            return False
        stripped = value.strip()
        return stripped.startswith("{{") and stripped.endswith("}}")

    def _should_defer_vals_string_resolution(self, raw_value):
        """Defer interpolation for JSON-like vals strings containing templates.

        This keeps strings like ``{"name": "{{ _input.json.name }}"}``
        intact so they can be parsed first (JSON -> dict) and then evaluated
        field-by-field in :meth:`_eval_val_expressions`.
        """
        if not isinstance(raw_value, str):
            return False

        stripped = raw_value.strip()
        if not stripped or self._is_full_template_string(stripped):
            return False

        is_json_object = stripped.startswith("{") and stripped.endswith("}")
        is_json_array = (
            stripped.startswith("[") and stripped.endswith("]") and "{" in stripped
        )
        return is_json_object or is_json_array

    def _resolve_vals(self, node_config, eval_context, model=None):
        """Resolve vals_expr to a dict (or list of dicts for batch create).

                Accepts three formats:
                    1. ``={...}`` or ``={{ {...} }}`` — explicit expression mode
                    2. ``'{"name": "=..."}'``        — JSON object string from FieldValuesControl
                    3. Already a dict/list

                For JSON-format dicts, each value that starts with ``=`` is evaluated
                individually so field values can still use explicit expression syntax.

        When *model* is provided, string values are coerced to the field’s
        expected Python type via :meth:`_coerce_field_value`.
        """
        import json

        raw = node_config.get("vals_expr") or "{}"
        literal_prefixed_raw = self.resolver.is_literal_prefixed_string(raw)

        if self._should_defer_vals_string_resolution(raw):
            vals = raw
        else:
            vals = self.resolver.resolve(raw, eval_context)

        if vals is None:
            return {}
        if isinstance(vals, dict):
            return self._eval_val_expressions(vals, eval_context, model=model)
        if isinstance(vals, list):
            return [
                self._eval_val_expressions(item, eval_context, model=model)
                if isinstance(item, dict)
                else self._resolve_val_item(item, eval_context)
                for item in vals
            ]
        if isinstance(vals, str):
            stripped = vals.strip()
            if not stripped or stripped in ("{}", "[]"):
                return {}
            if literal_prefixed_raw:
                raise ValueError(
                    "Values expressions must wrap dynamic content in {{ ... }} when using '=' prefix"
                )
            # Try JSON (from FieldValuesControl serialization)
            try:
                parsed = json.loads(stripped)
                if isinstance(parsed, dict):
                    return self._eval_val_expressions(parsed, eval_context, model=model)
                if isinstance(parsed, list):
                    return [
                        self._eval_val_expressions(item, eval_context, model=model)
                        if isinstance(item, dict)
                        else self._resolve_val_item(item, eval_context)
                        for item in parsed
                    ]
            except (ValueError, TypeError):
                pass
            # Fallback: Python literal via safe_eval (backward compat)
            parsed = safe_eval(stripped, eval_context, mode="eval")
            if isinstance(parsed, dict):
                return self._eval_val_expressions(parsed, eval_context, model=model)
            if isinstance(parsed, list):
                return [
                    self._eval_val_expressions(item, eval_context, model=model)
                    if isinstance(item, dict)
                    else self._resolve_val_item(item, eval_context)
                    for item in parsed
                ]
        raise ValueError("vals_expr must evaluate to an object or list of objects")

    def _resolve_val_item(self, value, eval_context):
        """Resolve explicit ``=...`` expressions recursively in nested vals payloads."""
        if isinstance(value, dict):
            return {
                self._resolve_val_key(key, eval_context): self._resolve_val_item(
                    item, eval_context
                )
                for key, item in value.items()
            }
        if isinstance(value, list):
            return [self._resolve_val_item(item, eval_context) for item in value]
        if self.resolver.should_resolve_string(value):
            return self.resolver.resolve(value, eval_context)
        return value

    def _resolve_val_key(self, key, eval_context):
        if isinstance(key, str):
            resolved = self.resolver.resolve(key, eval_context)
            return "" if resolved is None else str(resolved)
        return "" if key is None else str(key)

    def _eval_val_expressions(self, d, eval_context, model=None):
        """Evaluate any explicit ``=...`` expression values inside a dict.

        When *model* is provided, resolved values – and plain non-expression
        string values – are coerced to the correct Python type for each field
        via :meth:`_coerce_field_value` instead of always staying ``str``.
        """
        result = {}
        for k, v in d.items():
            resolved_key = self._resolve_val_key(k, eval_context)
            resolved = self._resolve_val_item(v, eval_context)
            result[resolved_key] = (
                self._coerce_field_value(model, resolved_key, resolved)
                if model is not None
                else resolved
            )
        return result

    def _resolve_ids(self, node_config, eval_context):
        ids_value = self.resolver.resolve(
            node_config.get("ids_expr", "={{ [] }}"), eval_context
        )
        if ids_value in (None, ""):
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

    def _resolve_order(self, node_config, eval_context):
        order_value = self.resolver.resolve(node_config.get("order"), eval_context)
        if order_value is None:
            return ""
        return str(order_value).strip()

    def _resolve_target_records(self, model, node_config, eval_context):
        ids = self._resolve_ids(node_config, eval_context)
        if ids:
            return model.browse(ids)

        domain = self._resolve_domain(node_config, eval_context)
        limit = self._resolve_int(node_config.get("limit"), eval_context, default=None)
        return model.search(domain, limit=limit or None)

    def _run_search(self, model, node_config, eval_context):
        domain = self._resolve_domain(node_config, eval_context)
        fields_list = self._resolve_fields(node_config, eval_context)
        limit = self._resolve_int(node_config.get("limit"), eval_context, default=20)
        order = self._resolve_order(node_config, eval_context)

        records = model.search(domain, limit=limit or None, order=order or None)
        return {
            "success": True,
            "operation": "search",
            "model": model._name,
            "count": len(records),
            "ids": records.ids,
            "records": records,
            "fields": fields_list,
            "limit": limit,
            "order": order or "",
        }

    def _run_create(self, model, node_config, eval_context):
        vals = self._resolve_vals(node_config, eval_context, model=model)
        created = model.create(vals)
        return {
            "success": True,
            "operation": "create",
            "model": model._name,
            "count": len(created),
            "ids": created.ids,
            "records": created,
        }

    def _run_write(self, model, node_config, eval_context):
        vals = self._resolve_vals(node_config, eval_context, model=model)
        if not isinstance(vals, dict):
            raise ValueError("Write operation requires values object")

        records = self._resolve_target_records(model, node_config, eval_context)
        count = len(records)
        if count:
            records.write(vals)

        return {
            "success": True,
            "operation": "write",
            "model": model._name,
            "count": count,
            "ids": records.ids,
            "values": vals,
        }

    def _run_delete(self, model, node_config, eval_context):
        records = self._resolve_target_records(model, node_config, eval_context)
        ids = list(records.ids)
        count = len(ids)
        if count:
            records.unlink()

        return {
            "success": True,
            "operation": "delete",
            "model": model._name,
            "count": count,
            "ids": ids,
        }
