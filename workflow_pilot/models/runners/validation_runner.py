# -*- coding: utf-8 -*-

"""
Validation Node Runner

Validates input data against required fields and simple schema rules.
"""

import json
import re

from .base import BaseNodeRunner


class ValidationNodeRunner(BaseNodeRunner):
    """Runner for validation node."""

    node_type = 'validation'

    def execute(self, node_config, input_data, context):
        data = input_data or {}
        errors = []

        required_fields = node_config.get('requiredFields') or ''
        for field in self._split_required(required_fields):
            value = self._get_path(data, field)
            if self._is_empty(value):
                errors.append({'field': field, 'error': 'Required field missing'})

        custom_rules = node_config.get('customRules') or []
        for rule in custom_rules:
            field = rule.get('key') if isinstance(rule, dict) else None
            pattern = rule.get('value') if isinstance(rule, dict) else None
            if not field or not pattern:
                continue
            value = self._get_path(data, field)
            if value is None:
                errors.append({'field': field, 'error': 'Field not found'})
                continue
            try:
                if not re.search(pattern, str(value)):
                    errors.append({'field': field, 'error': 'Pattern mismatch'})
            except re.error:
                errors.append({'field': field, 'error': 'Invalid regex pattern'})

        schema = self._parse_schema(node_config.get('schema'))
        if schema is None and node_config.get('schema'):
            errors.append({'field': 'schema', 'error': 'Invalid schema JSON'})
        if isinstance(schema, dict):
            errors.extend(self._validate_schema(data, schema))

        valid = len(errors) == 0
        result = {
            'valid': valid,
            'data': data,
            'errors': errors,
        }

        outputs = [[data], []] if valid else [[], [result]]
        return {
            'outputs': outputs,
            'json': result,
        }

    def _split_required(self, required_fields):
        if not isinstance(required_fields, str):
            return []
        return [field.strip() for field in required_fields.split(',') if field.strip()]

    def _parse_schema(self, schema_value):
        if not schema_value:
            return None
        if isinstance(schema_value, dict):
            return schema_value
        if isinstance(schema_value, str):
            try:
                return json.loads(schema_value)
            except Exception:
                return None
        return None

    def _validate_schema(self, data, schema):
        errors = []
        for field, rules in schema.items():
            value = self._get_path(data, field)
            if value is None:
                continue
            if not isinstance(rules, dict):
                continue
            expected_type = rules.get('type')
            if expected_type and not self._is_type(value, expected_type):
                errors.append({'field': field, 'error': 'Invalid type'})
                continue
            if expected_type == 'string':
                min_len = rules.get('minLength')
                max_len = rules.get('maxLength')
                if min_len is not None and len(str(value)) < min_len:
                    errors.append({'field': field, 'error': 'Too short'})
                if max_len is not None and len(str(value)) > max_len:
                    errors.append({'field': field, 'error': 'Too long'})
            if expected_type == 'number':
                min_val = rules.get('min')
                max_val = rules.get('max')
                try:
                    number_value = float(value)
                except (TypeError, ValueError):
                    errors.append({'field': field, 'error': 'Invalid number'})
                    continue
                if min_val is not None and number_value < min_val:
                    errors.append({'field': field, 'error': 'Below minimum'})
                if max_val is not None and number_value > max_val:
                    errors.append({'field': field, 'error': 'Above maximum'})
        return errors

    def _is_type(self, value, expected_type):
        if expected_type == 'string':
            return isinstance(value, str)
        if expected_type == 'number':
            return isinstance(value, (int, float))
        if expected_type == 'boolean':
            return isinstance(value, bool)
        if expected_type == 'object':
            return isinstance(value, dict)
        if expected_type == 'array':
            return isinstance(value, list)
        return True

    def _get_path(self, data, path):
        if not isinstance(data, dict):
            return None
        parts = [segment for segment in str(path).split('.') if segment]
        current = data
        for part in parts:
            if not isinstance(current, dict) or part not in current:
                return None
            current = current.get(part)
        return current

    def _is_empty(self, value):
        if value is None:
            return True
        if value == '':
            return True
        if isinstance(value, (list, tuple, set, dict)) and len(value) == 0:
            return True
        return False
