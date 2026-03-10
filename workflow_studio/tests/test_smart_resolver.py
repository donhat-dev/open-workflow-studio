# -*- coding: utf-8 -*-

"""
Unit tests for SmartExpressionResolver.

Tests the strict equals-prefix expression resolution:
    1. Only `={{ ... }}` or `=...{{ ... }}...` triggers evaluation
    2. Bare `=...` without `{{ ... }}` stays literal after the prefix
    3. Bare `{{ ... }}` stays literal
    4. No `=` → literal passthrough
"""

from odoo.tests import common, tagged

from ..models.runners.base import SmartExpressionResolver


@tagged('post_install', '-at_install')
class TestSmartExpressionResolver(common.TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.resolver = SmartExpressionResolver()
        cls.ctx = {
            '_json': {'id': 42, 'name': 'Alice', 'tags': ['a', 'b'], 'active': True},
            '_input': {'json': {'id': 42, 'name': 'Alice'}},
            '_vars': {'counter': 10},
            'True': True,
            'False': False,
            'None': None,
        }

    # ------------------------------------------------------------------
    # resolve() — strict legacy bare-template passthrough
    # ------------------------------------------------------------------

    def test_legacy_single_expr_int_is_literal(self):
        result = self.resolver.resolve('{{ _json.id }}', self.ctx)
        self.assertEqual(result, '{{ _json.id }}')
        self.assertIsInstance(result, str)

    def test_legacy_single_expr_string_is_literal(self):
        result = self.resolver.resolve('{{ _json.name }}', self.ctx)
        self.assertEqual(result, '{{ _json.name }}')
        self.assertIsInstance(result, str)

    def test_legacy_single_expr_list_is_literal(self):
        result = self.resolver.resolve('{{ _json.tags }}', self.ctx)
        self.assertEqual(result, '{{ _json.tags }}')
        self.assertIsInstance(result, str)

    def test_legacy_single_expr_bool_is_literal(self):
        result = self.resolver.resolve('{{ _json.active }}', self.ctx)
        self.assertEqual(result, '{{ _json.active }}')

    def test_legacy_single_expr_none_is_literal(self):
        result = self.resolver.resolve('{{ None }}', self.ctx)
        self.assertEqual(result, '{{ None }}')

    def test_legacy_single_expr_dict_is_literal(self):
        result = self.resolver.resolve('{{ _json }}', self.ctx)
        self.assertEqual(result, '{{ _json }}')

    def test_legacy_single_expr_arithmetic_is_literal(self):
        result = self.resolver.resolve('{{ _json.id + 8 }}', self.ctx)
        self.assertEqual(result, '{{ _json.id + 8 }}')

    def test_legacy_single_expr_list_literal_is_literal(self):
        result = self.resolver.resolve('{{ [1, 2, 3] }}', self.ctx)
        self.assertEqual(result, '{{ [1, 2, 3] }}')

    def test_legacy_single_expr_with_whitespace_is_literal(self):
        result = self.resolver.resolve('  {{ _json.id }}  ', self.ctx)
        self.assertEqual(result, '  {{ _json.id }}  ')

    # ------------------------------------------------------------------
    # resolve() — prefixed mode with template-only evaluation
    # ------------------------------------------------------------------

    def test_prefixed_expr_without_templates_is_literal(self):
        result = self.resolver.resolve('=_json.id', self.ctx)
        self.assertEqual(result, '_json.id')
        self.assertIsInstance(result, str)

    def test_prefixed_expr_legacy_wrapper(self):
        result = self.resolver.resolve('={{ _json.tags }}', self.ctx)
        self.assertEqual(result, ['a', 'b'])
        self.assertIsInstance(result, list)

    def test_prefixed_expr_full_template_int(self):
        result = self.resolver.resolve('={{ _json.id }}', self.ctx)
        self.assertEqual(result, 42)
        self.assertIsInstance(result, int)

    def test_prefixed_expr_mixed_template(self):
        result = self.resolver.resolve('=Name is {{ _json.name }}', self.ctx)
        self.assertEqual(result, 'Name is Alice')

    def test_prefixed_expr_literal_fallback(self):
        result = self.resolver.resolve('=plain text', self.ctx)
        self.assertEqual(result, 'plain text')

    # ------------------------------------------------------------------
    # resolve() — bare mixed templates stay literal
    # ------------------------------------------------------------------

    def test_mixed_interpolation_is_literal_without_prefix(self):
        result = self.resolver.resolve('Hello {{ _json.name }}!', self.ctx)
        self.assertEqual(result, 'Hello {{ _json.name }}!')
        self.assertIsInstance(result, str)

    def test_mixed_multiple_templates_is_literal_without_prefix(self):
        result = self.resolver.resolve('{{ _json.name }} ({{ _json.id }})', self.ctx)
        self.assertEqual(result, '{{ _json.name }} ({{ _json.id }})')

    def test_mixed_url_pattern_is_literal_without_prefix(self):
        result = self.resolver.resolve(
            'https://api.example.com/users/{{ _json.id }}/profile', self.ctx
        )
        self.assertEqual(result, 'https://api.example.com/users/{{ _json.id }}/profile')

    # ------------------------------------------------------------------
    # resolve() — Tier 3: no templates → literal passthrough
    # ------------------------------------------------------------------

    def test_literal_string(self):
        result = self.resolver.resolve('plain text', self.ctx)
        self.assertEqual(result, 'plain text')

    def test_literal_empty(self):
        result = self.resolver.resolve('', self.ctx)
        self.assertEqual(result, '')

    def test_literal_whitespace(self):
        result = self.resolver.resolve('   ', self.ctx)
        self.assertEqual(result, '   ')

    # ------------------------------------------------------------------
    # resolve() — non-string passthrough
    # ------------------------------------------------------------------

    def test_non_string_int(self):
        result = self.resolver.resolve(42, self.ctx)
        self.assertEqual(result, 42)

    def test_non_string_list(self):
        result = self.resolver.resolve([1, 2], self.ctx)
        self.assertEqual(result, [1, 2])

    def test_non_string_none(self):
        result = self.resolver.resolve(None, self.ctx)
        self.assertIsNone(result)

    def test_non_string_dict(self):
        result = self.resolver.resolve({'key': 'val'}, self.ctx)
        self.assertEqual(result, {'key': 'val'})

    # ------------------------------------------------------------------
    # resolve() — error cases
    # ------------------------------------------------------------------

    def test_invalid_prefixed_expr_returns_original_body(self):
        result = self.resolver.resolve('={{ nonexistent_var }}', self.ctx)
        self.assertEqual(result, '{{ nonexistent_var }}')

    def test_prefixed_mixed_invalid_expr_returns_empty_replacement(self):
        result = self.resolver.resolve('=Hi {{ bad_var }}!', self.ctx)
        self.assertEqual(result, 'Hi !')

    # ------------------------------------------------------------------
    # resolve_str()
    # ------------------------------------------------------------------

    def test_resolve_str_from_int(self):
        result = self.resolver.resolve_str('={{ _json.id }}', self.ctx)
        self.assertEqual(result, '42')
        self.assertIsInstance(result, str)

    def test_resolve_str_none_returns_empty(self):
        result = self.resolver.resolve_str(None, self.ctx)
        self.assertEqual(result, '')

    def test_resolve_str_literal(self):
        result = self.resolver.resolve_str('hello', self.ctx)
        self.assertEqual(result, 'hello')

    def test_resolve_str_legacy_expr_stays_literal(self):
        result = self.resolver.resolve_str('{{ _json.id }}', self.ctx)
        self.assertEqual(result, '{{ _json.id }}')

    def test_resolve_str_prefixed_without_templates_stays_literal(self):
        result = self.resolver.resolve_str('=_json.id', self.ctx)
        self.assertEqual(result, '_json.id')

    # ------------------------------------------------------------------
    # resolve_int()
    # ------------------------------------------------------------------

    def test_resolve_int_from_expr(self):
        result = self.resolver.resolve_int('={{ _json.id }}', self.ctx)
        self.assertEqual(result, 42)

    def test_resolve_int_from_literal(self):
        result = self.resolver.resolve_int('10', self.ctx)
        self.assertEqual(result, 10)

    def test_resolve_int_empty_returns_default(self):
        result = self.resolver.resolve_int('', self.ctx, default=5)
        self.assertEqual(result, 5)

    def test_resolve_int_invalid_returns_default(self):
        result = self.resolver.resolve_int('not_a_number', self.ctx, default=-1)
        self.assertEqual(result, -1)

    def test_resolve_int_legacy_expr_returns_default(self):
        result = self.resolver.resolve_int('{{ _json.id }}', self.ctx, default=-1)
        self.assertEqual(result, -1)

    def test_resolve_int_prefixed_without_templates_returns_default(self):
        result = self.resolver.resolve_int('=_json.id', self.ctx, default=-1)
        self.assertEqual(result, -1)

    # ------------------------------------------------------------------
    # resolve_list()
    # ------------------------------------------------------------------

    def test_resolve_list_from_expr(self):
        result = self.resolver.resolve_list('={{ _json.tags }}', self.ctx)
        self.assertEqual(result, ['a', 'b'])

    def test_resolve_list_prefixed_without_templates_returns_default(self):
        result = self.resolver.resolve_list('=[1, 2, 3]', self.ctx, default=[])
        self.assertEqual(result, [])

    def test_resolve_list_none_returns_default(self):
        result = self.resolver.resolve_list(None, self.ctx, default=[])
        self.assertEqual(result, [])

    def test_resolve_list_from_json_string(self):
        result = self.resolver.resolve_list('[1, 2, 3]', self.ctx)
        self.assertEqual(result, [1, 2, 3])

    def test_resolve_list_legacy_expr_returns_default(self):
        result = self.resolver.resolve_list('{{ _json.tags }}', self.ctx, default=[])
        self.assertEqual(result, [])

    # ------------------------------------------------------------------
    # resolve_domain()
    # ------------------------------------------------------------------

    def test_resolve_domain_full_expr(self):
        result = self.resolver.resolve_domain("={{ [('id', '=', _json.id)] }}", self.ctx)
        self.assertEqual(result, [('id', '=', 42)])

    def test_resolve_domain_prefixed_without_templates_rejected(self):
        with self.assertRaises(ValueError):
            self.resolver.resolve_domain("=[('id', '=', _json.id)]", self.ctx)

    def test_resolve_domain_plain_string(self):
        result = self.resolver.resolve_domain(
            "[('name', 'ilike', 'test')]", self.ctx
        )
        self.assertEqual(result, [('name', 'ilike', 'test')])

    def test_resolve_domain_empty(self):
        result = self.resolver.resolve_domain('[]', self.ctx)
        self.assertEqual(result, [])

    def test_resolve_domain_none(self):
        result = self.resolver.resolve_domain(None, self.ctx)
        self.assertEqual(result, [])

    def test_resolve_domain_already_list(self):
        result = self.resolver.resolve_domain(
            [('active', '=', True)], self.ctx
        )
        self.assertEqual(result, [('active', '=', True)])

    def test_resolve_domain_leaf_with_expr(self):
        """Bare per-leaf templates stay literal without '=' prefix."""
        domain = [('id', '=', '{{ _json.id }}')]
        result = self.resolver.resolve_domain(domain, self.ctx)
        self.assertEqual(result, [('id', '=', '{{ _json.id }}')])

    def test_resolve_domain_leaf_with_prefixed_expr(self):
        domain = [('id', '=', '=_json.id')]
        result = self.resolver.resolve_domain(domain, self.ctx)
        self.assertEqual(result, [('id', '=', '_json.id')])

    def test_resolve_domain_leaf_with_prefixed_full_template(self):
        domain = [('id', '=', '={{ _json.id }}')]
        result = self.resolver.resolve_domain(domain, self.ctx)
        self.assertEqual(result, [('id', '=', 42)])

    def test_resolve_domain_leaf_with_prefixed_interpolation(self):
        domain = [('name', '=', '=Name is {{ _json.name }}')]
        result = self.resolver.resolve_domain(domain, self.ctx)
        self.assertEqual(result, [('name', '=', 'Name is Alice')])

    def test_resolve_domain_leaf_partial_rejected(self):
        """Partial templates in leaf values stay literal without '=' prefix."""
        domain = [('id', 'in', '[{{ _json.id }}]')]
        result = self.resolver.resolve_domain(domain, self.ctx)
        self.assertEqual(result, [('id', 'in', '[{{ _json.id }}]')])

    def test_resolve_domain_connectors_preserved(self):
        domain = ['|', ('id', '=', 1), ('id', '=', 2)]
        result = self.resolver.resolve_domain(domain, self.ctx)
        self.assertEqual(result, ['|', ('id', '=', 1), ('id', '=', 2)])

    # ------------------------------------------------------------------
