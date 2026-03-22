# -*- coding: utf-8 -*-

import json

from odoo.tests import common, tagged

from ..models.runners.record_operation_runner import RecordOperationNodeRunner
from ..models.workflow_executor import WorkflowExecutor


@tagged('post_install', '-at_install')
class TestRecordOutputRefs(common.TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.partner = cls.env['res.partner'].create({
            'name': 'Workflow Record Ref Test Partner',
        })

    def _new_executor(self):
        return WorkflowExecutor(
            self.env,
            workflow_run=None,
            snapshot={'nodes': [], 'connections': []},
            persist=False,
        )

    def test_normalize_single_record_to_marker(self):
        executor = self._new_executor()

        marker = executor._normalize_output_value(self.partner)

        self.assertIn(executor._RECORD_REFS_KEY, marker)
        self.assertEqual(marker[executor._RECORD_REFS_COUNT_KEY], 1)
        self.assertFalse(marker[executor._RECORD_REFS_TRUNCATED_KEY])
        self.assertEqual(marker[executor._RECORD_REFS_MODEL_KEY], 'res.partner')
        self.assertEqual(marker[executor._RECORD_REFS_KEY][0]['model'], 'res.partner')
        self.assertEqual(marker[executor._RECORD_REFS_KEY][0]['id'], self.partner.id)

    def test_normalize_nested_recordset(self):
        executor = self._new_executor()

        payload = {
            'status': 'ok',
            'partner': self.partner,
            'items': [
                {'owner': self.partner},
            ],
        }

        normalized = executor._normalize_output_value(payload)

        self.assertEqual(normalized['status'], 'ok')
        self.assertIn(executor._RECORD_REFS_KEY, normalized['partner'])
        self.assertIn(executor._RECORD_REFS_KEY, normalized['items'][0]['owner'])

    def test_serialize_recordset_marker_json(self):
        executor = self._new_executor()

        payload = {
            'partner': self.partner,
        }

        serialized = executor._serialize_output(payload)
        parsed = json.loads(serialized)

        self.assertIn('partner', parsed)
        self.assertIn(executor._RECORD_REFS_KEY, parsed['partner'])
        self.assertEqual(
            parsed['partner'][executor._RECORD_REFS_KEY][0]['id'],
            self.partner.id,
        )

    def test_redact_output_keeps_marker_json_safe(self):
        executor = self._new_executor()

        redacted = executor._redact_output({'partner': self.partner}, node_id=None)

        self.assertIn('display', redacted)
        self.assertIn('partner', redacted['display'])
        self.assertIn(executor._RECORD_REFS_KEY, redacted['display']['partner'])
        self.assertTrue(isinstance(redacted['display_text'], str))
        parsed = json.loads(redacted['display_text'])
        self.assertIn(executor._RECORD_REFS_KEY, parsed['partner'])

    def test_record_operation_search_records_normalize_to_marker(self):
        executor = self._new_executor()
        runner = RecordOperationNodeRunner(executor)

        result = runner._run_search(
            self.env['res.partner'],
            {
                'domain_expr': "[('id', '=', %d)]" % self.partner.id,
                'fields_expr': "={{ ['id', 'display_name'] }}",
                'limit': '1',
            },
            {},
        )

        normalized = executor._normalize_output_value(result)

        self.assertEqual(normalized['count'], 1)
        self.assertIn(executor._RECORD_REFS_KEY, normalized['records'])
        self.assertEqual(
            normalized['records'][executor._RECORD_REFS_KEY][0]['id'],
            self.partner.id,
        )

    def test_record_operation_create_records_normalize_to_marker(self):
        executor = self._new_executor()
        runner = RecordOperationNodeRunner(executor)

        result = runner._run_create(
            self.env['res.partner'],
            {
                'vals_expr': '{"name": "Created From Record Ref Test"}',
            },
            {},
        )

        normalized = executor._normalize_output_value(result)

        self.assertEqual(normalized['count'], 1)
        self.assertIn(executor._RECORD_REFS_KEY, normalized['records'])
        self.assertEqual(len(normalized['ids']), 1)
