# -*- coding: utf-8 -*-

from odoo.tests import common, tagged

from ..models.context_objects import (
    ReadonlyDotDict,
    build_eval_context,
    wrap_readonly,
)


@tagged('post_install', '-at_install')
class TestContextObjects(common.TransactionCase):

    def test_readonly_dot_dict_prefers_key_over_items_method(self):
        wrapped = wrap_readonly({
            'items': [
                {'id': 1},
                {'id': 2},
            ],
            'headers': {
                'authorization': 'Bearer token',
            },
        })

        self.assertIsInstance(wrapped, ReadonlyDotDict)
        self.assertEqual(wrapped.items, [{'id': 1}, {'id': 2}])
        self.assertFalse(callable(wrapped.items))
        self.assertEqual(wrapped['items'], [{'id': 1}, {'id': 2}])
        self.assertEqual(
            type(wrapped).items(wrapped),
            [
                ('items', [{'id': 1}, {'id': 2}]),
                ('headers', {'authorization': 'Bearer token'}),
            ],
        )

    def test_readonly_dot_dict_items_method_still_available_when_no_items_key(self):
        wrapped = wrap_readonly({'foo': 1})

        self.assertTrue(callable(wrapped.items))
        self.assertEqual(wrapped.items(), [('foo', 1)])

    def test_build_eval_context_exposes_input_items_as_data(self):
        payload = [
            {'sku': 'A'},
            {'sku': 'B'},
        ]

        eval_context = build_eval_context(payload, {}, include_input_item=True)

        self.assertEqual(eval_context['_input'].items, payload)
        self.assertEqual(eval_context['_input'].item['sku'], 'A')
