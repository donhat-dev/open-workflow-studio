# -*- coding: utf-8 -*-

import copy
import logging
import uuid

from odoo.tests import common, tagged

from ..models.workflow_executor import WorkflowExecutor
from ..workflow import WorkflowExecutionRegistry, WorkflowNodeRegistry, workflow


@tagged('post_install', '-at_install')
class TestWorkflowExtensionApi(common.TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.Workflow = cls.env['ir.workflow']
        cls.WorkflowType = cls.env['workflow.type']

    def setUp(self):
        super().setUp()
        self._execution_handlers_backup = {
            event_name: list(handlers)
            for event_name, handlers in WorkflowExecutionRegistry._handlers.items()
        }
        self._nodes_by_type_backup = WorkflowNodeRegistry._nodes_by_type.copy()
        self._nodes_by_callable_key_backup = WorkflowNodeRegistry._nodes_by_callable_key.copy()

    def tearDown(self):
        WorkflowExecutionRegistry._handlers = {
            event_name: list(handlers)
            for event_name, handlers in self._execution_handlers_backup.items()
        }
        WorkflowNodeRegistry._nodes_by_type = self._nodes_by_type_backup.copy()
        WorkflowNodeRegistry._nodes_by_callable_key = self._nodes_by_callable_key_backup.copy()
        super().tearDown()

    def _create_published_workflow(self, trigger_node_type='schedule_trigger', node_id='n_trigger'):
        workflow_record = self.Workflow.create({
            'name': 'WF Events %s' % uuid.uuid4().hex[:8],
        })
        snapshot = {
            'nodes': [
                {
                    'id': node_id,
                    'type': trigger_node_type,
                    'label': 'Trigger',
                    'config': {},
                },
                {
                    'id': 'n_noop',
                    'type': 'noop',
                    'label': 'Noop',
                    'config': {},
                },
            ],
            'connections': [
                {
                    'id': 'c_trigger_noop',
                    'source': node_id,
                    'sourceHandle': 'output',
                    'target': 'n_noop',
                    'targetHandle': 'input',
                },
            ],
            'metadata': {},
        }
        workflow_record.write({'draft_snapshot': snapshot})
        workflow_record.action_publish()
        return workflow_record

    # ------------------------------------------------------------------ #
    # @workflow.execution: dispatch ordering
    # ------------------------------------------------------------------ #

    def test_execution_registry_dispatch_applies_mutations_in_order(self):
        """Same-priority handlers dispatch in qualname DESC order."""
        calls = []

        @workflow.execution('test_event')
        def first(event):
            payload = dict(event)
            payload.setdefault('steps', []).append('first')
            payload['value'] = 1
            calls.append('first')
            return payload

        @workflow.execution('test_event')
        def second(event):
            payload = dict(event)
            payload.setdefault('steps', []).append('second')
            payload['value'] = payload.get('value', 0) + 1
            calls.append('second')
            return payload

        payload = WorkflowExecutionRegistry.dispatch('test_event', {'steps': []})

        # qualname DESC: 'second' > 'first', so second runs first
        self.assertEqual(calls, ['second', 'first'])
        self.assertEqual(payload['steps'], ['second', 'first'])
        self.assertEqual(payload['value'], 1)

    def test_execution_priority_higher_runs_first(self):
        """Higher priority number runs first (priority DESC)."""
        calls = []

        @workflow.execution('test_priority', priority=1)
        def low_priority(event):
            calls.append('low')
            return event

        @workflow.execution('test_priority', priority=10)
        def high_priority(event):
            calls.append('high')
            return event

        @workflow.execution('test_priority', priority=5)
        def mid_priority(event):
            calls.append('mid')
            return event

        WorkflowExecutionRegistry.dispatch('test_priority', {})
        self.assertEqual(calls, ['high', 'mid', 'low'])

    def test_execution_priority_tiebreaker_qualname_desc(self):
        """Same priority → qualname DESC determines order."""
        calls = []

        @workflow.execution('test_tie', priority=5)
        def alpha(event):
            calls.append('alpha')
            return event

        @workflow.execution('test_tie', priority=5)
        def zeta(event):
            calls.append('zeta')
            return event

        WorkflowExecutionRegistry.dispatch('test_tie', {})
        # 'z' > 'a' → zeta before alpha
        self.assertEqual(calls, ['zeta', 'alpha'])

    # ------------------------------------------------------------------ #
    # @workflow.execution: unregister
    # ------------------------------------------------------------------ #

    def test_execution_unregister_removes_handler(self):
        calls = []

        @workflow.execution('test_unreg')
        def handler(event):
            calls.append('called')
            return event

        WorkflowExecutionRegistry.dispatch('test_unreg', {})
        self.assertEqual(calls, ['called'])

        WorkflowExecutionRegistry.unregister('test_unreg', handler)
        calls.clear()
        WorkflowExecutionRegistry.dispatch('test_unreg', {})
        self.assertEqual(calls, [])

    # ------------------------------------------------------------------ #
    # Trigger launch: execution mode
    # ------------------------------------------------------------------ #

    def test_trigger_launch_emits_schedule_execution_mode(self):
        observed = []

        @workflow.execution('launch_requested')
        def capture_launch(event):
            observed.append({
                'execution_mode': event.get('execution_mode'),
                'trigger_type': event.get('trigger_type'),
                'launch_intent': event.get('launch_intent'),
                'start_node_id': event.get('start_node_id'),
            })
            return event

        workflow_record = self._create_published_workflow(
            trigger_node_type='schedule_trigger',
            node_id='n_schedule',
        )

        result = workflow_record._execute_from_trigger(
            'n_schedule',
            'schedule',
            {'from_test': True},
        )

        self.assertEqual(result['execution_mode'], 'schedule')
        self.assertTrue(observed)
        self.assertEqual(observed[-1]['execution_mode'], 'schedule')
        self.assertEqual(observed[-1]['trigger_type'], 'schedule')
        self.assertEqual(observed[-1]['launch_intent'], 'trigger')
        self.assertEqual(observed[-1]['start_node_id'], 'n_schedule')

    # ------------------------------------------------------------------ #
    # @workflow.node: callable sync + execution
    # ------------------------------------------------------------------ #

    def test_workflow_node_decorator_syncs_and_executes_callable(self):
        node_type = 'x_callable_%s' % uuid.uuid4().hex[:8]

        @workflow.node(
            node_type=node_type,
            name='Callable Node',
            category='transform',
            icon='fa-magic',
        )
        def callable_node(context, input_data, config):
            return {
                'payload': input_data,
                'flag': config.get('flag'),
            }

        synced = self.WorkflowType.sudo().sync_decorated_nodes()
        self.assertGreaterEqual(synced, 1)

        runtime_type = self.WorkflowType.search([('node_type', '=', node_type)], limit=1)
        self.assertTrue(runtime_type)
        self.assertEqual(runtime_type.runtime_backend, 'python_callable')
        self.assertTrue(runtime_type.callable_key)

        snapshot = {
            'nodes': [
                {
                    'id': 'n_start',
                    'type': 'manual_trigger',
                    'label': 'Manual Trigger',
                    'config': {},
                },
                {
                    'id': 'n_callable',
                    'type': node_type,
                    'label': 'Callable Node',
                    'config': {'flag': 'ok'},
                },
            ],
            'connections': [
                {
                    'id': 'c_start_callable',
                    'source': 'n_start',
                    'sourceHandle': 'output',
                    'target': 'n_callable',
                    'targetHandle': 'input',
                },
            ],
            'metadata': {},
        }
        executor = WorkflowExecutor(
            self.env,
            workflow_run=None,
            snapshot=copy.deepcopy(snapshot),
            persist=False,
        )

        output = executor.execute({'hello': 'world'})

        self.assertEqual(output['payload'], {'hello': 'world'})
        self.assertEqual(output['flag'], 'ok')

    # ------------------------------------------------------------------ #
    # @workflow.node: registration-time warnings
    # ------------------------------------------------------------------ #

    def test_workflow_node_logs_warning_for_missing_doc(self):
        """Missing __doc__ on decorated node triggers a warning log."""
        node_type = 'x_warn_%s' % uuid.uuid4().hex[:8]
        with self.assertLogs('odoo.addons.workflow_studio.workflow', level='WARNING') as log_cm:
            @workflow.node(
                node_type=node_type,
                name='No Doc Node',
                category='transform',
                icon='fa-cube',
                group_id='base.group_user',
            )
            def no_doc_node(context, input_data, config):
                return input_data

        warning_messages = [r for r in log_cm.output if 'missing docstring' in r]
        self.assertTrue(warning_messages, "Expected a warning about missing docstring")

    # ------------------------------------------------------------------ #
    # Event-driven execution pipeline (decomposition)
    # ------------------------------------------------------------------ #

    def test_event_driven_execution_pipeline(self):
        """pre_execution creates executor, post_execution persists results."""
        observed_events = []

        @workflow.execution('pre_execution', priority=1)
        def observe_pre(event):
            observed_events.append(('pre', bool(event.get('executor'))))
            return event

        @workflow.execution('post_execution', priority=1)
        def observe_post(event):
            executor = event.get('executor')
            result = executor.execution_result if executor else {}
            observed_events.append(('post', result.get('success')))
            return event

        wf = self._create_published_workflow(
            trigger_node_type='manual_trigger',
            node_id='n_manual',
        )
        result = wf.launch(
            execution_mode='manual',
            start_node_ids=['n_manual'],
        )
        self.assertEqual(result['status'], 'completed')
        # pre observer sees executor (created by priority=10 handler)
        self.assertIn(('pre', True), observed_events)
        # post observer sees success
        self.assertIn(('post', True), observed_events)

    def test_executor_lean_mode(self):
        """Executor runs lean (no internal lifecycle management)."""
        snapshot = {
            'nodes': [
                {
                    'id': 'n_start',
                    'type': 'manual_trigger',
                    'label': 'Manual Trigger',
                    'config': {},
                },
                {
                    'id': 'n_noop',
                    'type': 'noop',
                    'label': 'Noop',
                    'config': {},
                },
            ],
            'connections': [
                {
                    'id': 'c1',
                    'source': 'n_start',
                    'sourceHandle': 'output',
                    'target': 'n_noop',
                    'targetHandle': 'input',
                },
            ],
            'metadata': {},
        }
        executor = WorkflowExecutor(
            self.env,
            workflow_run=None,
            snapshot=copy.deepcopy(snapshot),
            persist=False,
        )
        output = executor.execute({'test': 1})
        self.assertIsNotNone(executor.execution_result)
        self.assertTrue(executor.execution_result['success'])

