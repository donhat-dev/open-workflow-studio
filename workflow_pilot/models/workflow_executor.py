# -*- coding: utf-8 -*-

"""
Workflow Executor - Backend Execution Engine

Stack-based execution following ADR-001 pattern.
Implements synchronous execution with partial result persistence.

Node Runners are imported from the runners package:
    - HttpNodeRunner: HTTP requests via requests library
    - IfNodeRunner: Conditional branching
    - LoopNodeRunner: Array iteration with back-edge pattern

Expression Evaluation:
    Translates _json.field to Python _json['field'] for safe_eval.
"""

import logging
import re
from datetime import datetime, date
import json
from odoo import api, fields, models, _
from odoo.exceptions import UserError, ValidationError

from .runners import (
    BaseNodeRunner,
    ExpressionEvaluator,
    HttpNodeRunner,
    IfNodeRunner,
    LoopNodeRunner,
    NoOpNodeRunner,
    VariableNodeRunner,
    ValidationNodeRunner,
    CodeNodeRunner,
    SwitchNodeRunner,
)
from .context_objects import ExecutionContext, to_plain, wrap_mutable
from .security.safe_env_proxy import SafeEnvProxy
from .security.secret_broker import SecretBrokerFactory

_logger = logging.getLogger(__name__)


# =============================================================================
# WORKFLOW EXECUTOR
# =============================================================================

class WorkflowExecutor:
    """Stack-based workflow execution engine.
    
    Follows ADR-001 architecture:
    - Push start nodes to stack
    - Pop and execute until stack empty or error
    - Route outputs based on connections and output data
    """
    
    # Pre-compiled patterns for sensitive data masking.
    # Avoids re.compile overhead on every _mask_sensitive_data call.
    _MASK_PATTERNS = [
        (re.compile(r'(sk-[a-zA-Z0-9]{20,})', re.IGNORECASE), '********'),
        (re.compile(r'(key-[a-zA-Z0-9]{20,})', re.IGNORECASE), '********'),
        (re.compile(r'(password["\s:=]+)[^\s,"]+', re.IGNORECASE), r'\1********'),
        (re.compile(r'(token["\s:=]+)[^\s,"]+', re.IGNORECASE), r'\1********'),
        (re.compile(r'(secret["\s:=]+)[^\s,"]+', re.IGNORECASE), r'\1********'),
        (re.compile(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b', re.IGNORECASE), '***@***.***'),
    ]

    # Node runner registry
    NODE_RUNNERS = {
        'http': HttpNodeRunner,
        'if': IfNodeRunner,
        'loop': LoopNodeRunner,
        'noop': NoOpNodeRunner,
        'variable': VariableNodeRunner,
        'validation': ValidationNodeRunner,
        'code': CodeNodeRunner,
        'switch': SwitchNodeRunner,
    }
    
    def __init__(self, env, workflow_run=None, snapshot=None, persist=True,
                 notify_channel=None, rollback_on_failure=False):
        """Initialize executor.

        Args:
            env: Odoo environment
            workflow_run: workflow.run record being executed
            snapshot: Workflow snapshot dict (used when persist=False)
            persist: Whether to persist run/node records
            notify_channel: res.partner record to send bus notifications to
                            (used for manual UI runs for real-time progress)
            rollback_on_failure: If True, rollback all DB side effects
                                 (ORM writes from code nodes, etc.) when
                                 execution fails.  Run/node records are
                                 re-persisted from in-memory state.
        """
        self.env = env
        self.run = workflow_run
        self.persist = bool(persist)
        self._notify_channel = notify_channel
        self._rollback_on_failure = bool(rollback_on_failure)

        if self.persist:
            if not self.run:
                raise UserError("WorkflowExecutor requires a workflow.run record when persist=True")
            self.snapshot = self.run.executed_snapshot
        else:
            self.snapshot = snapshot or {}
        
        # Execution state
        self.stack = []  # [{nodeId, inputData}]
        self.node_outputs = {}  # nodeId -> NodeOutput
        self.node_context = {}  # nodeId -> persistent state (loops)
        self._vars_dirty_paths = set()
        self.vars = wrap_mutable({}, tracker=self._track_var_path, path="")  # Workflow variables (mutable, dot-access)
        self.executed_order = []
        self.executed_connections = []  # [{connection_id, source, source_socket, target, target_socket, output_index, sequence}]
        self._last_error_node_id = None
        self._node_record_cache = {}  # node_id -> record (avoids N+1 queries)

        self.exec_context = ExecutionContext(
            node_outputs=self.node_outputs,
            vars_store=self.vars,
            node_context=self.node_context,
            execution=self._get_execution_context(),
            workflow=self._get_workflow_context(),
        )

        self.node_output_sockets = self._load_node_output_sockets()
        
        # Build lookup structures
        self._build_graph()
        
        # Initialize runners
        self.runners = {
            node_type: runner_class(self)
            for node_type, runner_class in self.NODE_RUNNERS.items()
        }

    # ========================================================================
    # Bus Notification (real-time UI progress)
    # ========================================================================

    def _send_bus_notification(self, notification_type, message):
        """Send a bus notification on a **separate cursor**.

        Using an independent cursor ensures the notification is committed
        and dispatched immediately (via pg NOTIFY) without affecting the
        main workflow transaction.  This preserves execution atomicity:
        if a later node fails the main transaction can still roll back
        while earlier progress notifications have already reached the UI.
        """
        try:
            with self.env.registry.cursor() as cr:
                env = self.env(cr=cr)
                env['bus.bus']._sendone(
                    self._notify_channel,
                    notification_type,
                    message,
                )
                # cursor auto-commits on context-manager exit →
                # precommit fires (bus.bus.create) → postcommit fires (NOTIFY)
        except Exception:
            _logger.debug(
                "Bus notification '%s' could not be sent on a separate cursor. Skipping.",
                notification_type,
                exc_info=True,
            )


    def _notify_node_start(self, node_id):
        """Send bus notification when a node begins execution.

        The UI uses this to show a spinner/running indicator on the node
        before the result arrives via ``_notify_node_done``.

        Notification type: ``workflow.execution/node_start``
        """
        if not self._notify_channel:
            return
        node = self.nodes.get(node_id, {})
        self._send_bus_notification(
            'workflow.execution/node_start',
            {
                'run_id': self.run.id if self.run else None,
                'node_id': node_id,
                'node_type': node.get('type'),
                'node_label': node.get('label', ''),
            },
        )

    def _notify_node_done(self, node_id, result, routed_connections=None):
        """Send bus notification after a node finishes execution.

        Only sends when ``_notify_channel`` is set (manual UI runs).
        Uses a separate DB cursor so the main transaction is untouched.

        Notification type: ``workflow.execution/node_done``
        """
        if not self._notify_channel:
            return
        node = self.nodes.get(node_id, {})
        has_error = bool(result.get('error'))
        routed_connections = routed_connections or []
        self._send_bus_notification(
            'workflow.execution/node_done',
            {
                'run_id': self.run.id if self.run else None,
                'node_id': node_id,
                'node_type': node.get('type'),
                'node_label': node.get('label', ''),
                'status': 'error' if has_error else 'success',
                'error': result.get('error') if has_error else None,
                'executed_order': list(self.executed_order),
                'routed_connections': routed_connections,
                'connection_ids': [
                    entry.get('connection_id')
                    for entry in routed_connections
                    if entry.get('connection_id')
                ],
                'sequence': len(self.executed_order) - 1,
            },
        )

    def _notify_execution_done(self, status='completed', error=None):
        """Send bus notification when the full execution finishes.

        Notification type: ``workflow.execution/done``
        """
        if not self._notify_channel:
            return
        self._send_bus_notification(
            'workflow.execution/done',
            {
                'run_id': self.run.id if self.run else None,
                'status': status,
                'error': error,
                'executed_order': list(self.executed_order),
                'executed_connections': list(self.executed_connections),
                'executed_connection_ids': self._get_executed_connection_ids(),
                'node_count': len(self.executed_order),
            },
        )

    def _get_executed_connection_ids(self):
        """Return traversed connection IDs in execution order."""
        return [
            entry.get('connection_id')
            for entry in self.executed_connections
            if entry.get('connection_id')
        ]

    def _load_node_output_sockets(self):
        """Load cached output socket mapping from workflow.type model.

        Delegates to workflow.type._get_output_socket_mapping() which is
        backed by ormcache (no DB query after first call until cache is
        cleared by workflow.type CRUD).

        If the model is unavailable (e.g. during module install),
        returns an empty dict and _socket_to_index will fall through
        to pattern-matching / generic fallback.
        """
        try:
            return self.env['workflow.type']._get_output_socket_mapping()
        except Exception:
            return {}
    
    def _build_graph(self):
        """Build node and connection lookup structures.

        Pre-computes adjacency lists and start-node sets so that
        execute / execute_until never iterate connections again.
        """
        self.nodes = {}
        self.connections = []
        self.connections_by_source = {}
        self._reverse_adj = {}   # target -> [source, ...]
        self._forward_adj = {}   # source -> [target, ...]
        self._nodes_with_incoming = set()

        for node in self.snapshot.get('nodes', []):
            self.nodes[node['id']] = node
        
        for conn in self.snapshot.get('connections', []):
            self.connections.append(conn)
            source = conn.get('source')
            target = conn.get('target')
            if source:
                self.connections_by_source.setdefault(source, []).append(conn)
            if source and target:
                self._forward_adj.setdefault(source, []).append(target)
                self._reverse_adj.setdefault(target, []).append(source)
            if target:
                self._nodes_with_incoming.add(target)

    def _is_node_disabled(self, node_id):
        """Check if a node is disabled via its meta.disabled flag."""
        node = self.nodes.get(node_id, {})
        meta = node.get('meta') or {}
        return bool(meta.get('disabled'))

    # ========================================================================
    # Savepoint helpers (rollback-on-failure)
    # ========================================================================

    @staticmethod
    def _release_savepoint(savepoint, rollback=False):
        """Close or rollback a savepoint safely.

        Args:
            savepoint: Savepoint object or None.
            rollback: If True, rollback (discard changes);
                      otherwise release (keep changes).

        Returns:
            None — convenient for ``sp = self._release_savepoint(sp)``.
        """
        if not savepoint:
            return None
        try:
            # NOTE:
            # In Odoo, savepoint.close() defaults to rollback=True.
            # Always pass the rollback flag explicitly; otherwise successful
            # runs would rollback node_run records (executed_order becomes
            # empty when fetching /workflow_pilot/run/<id>).
            savepoint.close(rollback=bool(rollback))
        except Exception:
            _logger.debug(
                "Savepoint %s failed",
                "rollback" if rollback else "close",
                exc_info=True,
            )
        return None

    def _persist_node_runs_from_memory(self):
        """Re-create workflow.run.node records from in-memory execution state.

        Called after a savepoint rollback to preserve execution history
        for debugging while all business-logic side effects (ORM writes
        performed by code nodes, etc.) have been discarded.

        ``executed_order`` and ``node_outputs`` survive the rollback
        because they are plain Python dicts/lists, not ORM records.
        """
        if not self.run:
            return
        RunNode = self.env['workflow.run.node']
        now = fields.Datetime.now()
        for seq, node_id in enumerate(self.executed_order):
            node = self.nodes.get(node_id, {})
            output = self.node_outputs.get(node_id, {})
            has_error = bool(output.get('error'))
            output_json = output.get('json')
            output_display = (
                self._mask_sensitive_data(to_plain(output_json))
                if output_json is not None else None
            )
            RunNode.create({
                'run_id': self.run.id,
                'node_id': node_id,
                'node_type': node.get('type'),
                'node_label': node.get('label', ''),
                'status': 'failed' if has_error else 'completed',
                'started_at': now,
                'completed_at': now,
                'output_data': output_display,
                'output_socket': self._get_primary_output_socket(node, output),
                'error_message': output.get('error') if has_error else None,
                'sequence': seq,
            })

    def execute(self, input_data=None):
        """Execute workflow from start to completion.
        
        Args:
            input_data: Initial input data
            
        Returns:
            Final output data
            
        Raises:
            UserError: On execution failure
        """
        savepoint = None
        try:
            # Update run status
            if self.persist:
                self.run.write({
                    'status': 'running',
                    'started_at': fields.Datetime.now(),
                })
                self.env.cr.commit()
            
            # Find start nodes (nodes with no incoming connections)
            start_nodes = self._find_start_nodes()
            if not start_nodes:
                raise UserError(_("Workflow has no start nodes"))
            
            # Push start nodes to stack
            for node_id in start_nodes:
                self.stack.append({
                    'nodeId': node_id,
                    'inputData': input_data or {},
                })
            
            # Savepoint: when rollback_on_failure is enabled, wrap
            # the execution loop so all ORM side effects can be undone
            # on failure while run/node records are re-persisted from
            # in-memory state for debugging.
            if self._rollback_on_failure:
                savepoint = self.env.cr.savepoint(flush=True)
            
            # Execute until stack empty
            iteration = 0
            max_iterations = 1000
            
            while self.stack and iteration < max_iterations:
                iteration += 1
                entry = self.stack.pop()
                node_id = entry['nodeId']
                input_data = entry['inputData']

                # Skip disabled nodes (stop path propagation)
                if self._is_node_disabled(node_id):
                    _logger.debug("Skipping disabled node %s", node_id)
                    continue
                
                # Notify frontend that a node is about to run (spinner)
                self._notify_node_start(node_id)

                # Execute node
                try:
                    result = self._execute_node(node_id, input_data)
                except Exception as exc:
                    self._last_error_node_id = node_id
                    failed_result = {
                        'outputs': [],
                        'json': None,
                        'error': str(exc),
                    }
                    self.node_outputs[node_id] = failed_result
                    self.executed_order.append(node_id)
                    # Emit a final node status for UI before global done(failed)
                    self._notify_node_done(node_id, failed_result, [])
                    raise

                # Store output
                self.node_outputs[node_id] = result
                self.executed_order.append(node_id)

                # Route outputs to connected nodes
                routed_connections = self._route_outputs(node_id, result)

                # Notify frontend of node completion (real-time progress).
                # Uses a separate DB cursor so the main transaction stays
                # intact (no mid-loop commit needed).
                self._notify_node_done(node_id, result, routed_connections)
            
            if iteration >= max_iterations:
                raise UserError(_("Workflow exceeded maximum iterations (possible infinite loop)"))
            
            # Success: release savepoint (keep all changes)
            savepoint = self._release_savepoint(savepoint)
            
            # Complete run
            output_data_raw = self._collect_final_output()
            output_data_display = self._mask_sensitive_data(output_data_raw)
            if self.persist:
                self.run.write({
                    'status': 'completed',
                    'completed_at': fields.Datetime.now(),
                    'output_data': output_data_display,
                    'executed_connections': list(self.executed_connections),
                    'node_count_executed': len(self.node_outputs),
                    'execution_count': iteration,
                })

            # Notify frontend that execution is done
            self._notify_execution_done(status='completed')

            return output_data_display
            
        except Exception as e:
            # Rollback DB side effects when enabled
            if savepoint:
                self._release_savepoint(savepoint, rollback=True)
                savepoint = None
                # Re-persist execution records for debugging
                if self.persist:
                    self._persist_node_runs_from_memory()
            # Mark run as failed
            if self.persist:
                values = {
                    'status': 'failed',
                    'completed_at': fields.Datetime.now(),
                    'error_message': str(e),
                    'executed_connections': list(self.executed_connections),
                }
                if self._last_error_node_id:
                    values['error_node_id'] = self._last_error_node_id
                self.run.write(values)
                self.env.cr.commit()
            # Notify frontend that execution failed
            self._notify_execution_done(status='failed', error=str(e))
            raise

    def execute_until(self, target_node_id, input_data=None, max_iterations=1000):
        """Execute workflow until target node is reached.

        Args:
            target_node_id: Node ID to stop after execution
            input_data: Initial input data
            max_iterations: Safety limit for stack iterations

        Returns:
            dict with node_outputs, executed_order, execution_count, target_node_id
        """
        if not target_node_id:
            raise UserError(_("Target node is required for preview execution"))

        # Find start nodes (nodes with no incoming connections)
        start_nodes = self._find_start_nodes_for_target(target_node_id)
        if not start_nodes:
            raise UserError(_("Workflow has no start nodes"))

        # Push start nodes to stack
        for node_id in start_nodes:
            self.stack.append({
                'nodeId': node_id,
                'inputData': input_data or {},
            })

        # Savepoint for rollback-on-failure
        savepoint = None
        if self._rollback_on_failure:
            savepoint = self.env.cr.savepoint(flush=True)

        # Execute until target node or stack empty
        iteration = 0
        target_reached = False
        target_result = None
        error_message = None
        error_node_id = None
        while self.stack and iteration < max_iterations:
            iteration += 1
            entry = self.stack.pop()
            node_id = entry['nodeId']
            node_input = entry['inputData']

            # Skip disabled nodes (stop path propagation)
            if self._is_node_disabled(node_id):
                _logger.debug("Skipping disabled node %s (preview)", node_id)
                continue

            # Execute node
            try:
                result = self._execute_node(node_id, node_input, persist=False)
            except Exception as exc:
                # Rollback side effects on failure
                savepoint = self._release_savepoint(savepoint, rollback=True)
                error_message = str(exc)
                error_node_id = node_id
                result = {
                    'outputs': [],
                    'json': None,
                    'error': error_message,
                }
                self.node_outputs[node_id] = result
                self.executed_order.append(node_id)
                target_result = result
                break

            # Store output
            self.node_outputs[node_id] = result
            self.executed_order.append(node_id)

            # Stop after target node executes
            if node_id == target_node_id:
                target_reached = True
                target_result = result
                break

            # Route outputs to connected nodes
            self._route_outputs(node_id, result)

        if iteration >= max_iterations:
            savepoint = self._release_savepoint(savepoint, rollback=True)
            raise UserError(_("Workflow exceeded maximum iterations (possible infinite loop)"))

        if error_message:
            return {
                'status': 'failed',
                'error': error_message,
                'error_node_id': error_node_id,
                'node_outputs': self.node_outputs,
                'executed_order': self.executed_order,
                'executed_connections': self.executed_connections,
                'executed_connection_ids': self._get_executed_connection_ids(),
                'execution_count': iteration,
                'target_node_id': target_node_id,
                'context_snapshot': self._build_context_snapshot(error_node_id, target_result),
            }

        if not target_reached:
            savepoint = self._release_savepoint(savepoint, rollback=True)
            raise UserError(_("Target node %s was not reached") % target_node_id)

        # Success: release savepoint (keep changes)
        savepoint = self._release_savepoint(savepoint)

        return {
            'status': 'completed',
            'node_outputs': self.node_outputs,
            'executed_order': self.executed_order,
            'executed_connections': self.executed_connections,
            'executed_connection_ids': self._get_executed_connection_ids(),
            'execution_count': iteration,
            'target_node_id': target_node_id,
            'context_snapshot': self._build_context_snapshot(target_node_id, target_result),
        }
    
    def _find_start_nodes(self):
        """Find enabled nodes with no incoming connections.

        Disabled start nodes are excluded — they (and their downstream
        paths) are not executed.

        Raises:
            UserError: If no enabled start nodes remain after filtering.
        """
        start_nodes = [
            node_id for node_id in self.nodes
            if node_id not in self._nodes_with_incoming
            and not self._is_node_disabled(node_id)
        ]
        if not start_nodes:
            all_starts = [
                node_id for node_id in self.nodes
                if node_id not in self._nodes_with_incoming
            ]
            if all_starts:
                raise UserError(_("All start nodes are disabled. Enable at least one start node to execute."))
            raise UserError(_("Workflow must have at least one start node (a node without incoming connections)."))
        return start_nodes

    def _find_start_nodes_for_target(self, target_node_id):
        """Find start nodes that lead to target node (preview flow).

        Uses pre-built reverse adjacency (_reverse_adj) for BFS.
        _get_node_ancestors already returns ALL nodes that can reach
        target, so a separate forward-path check is unnecessary.
        """
        start_nodes = self._find_start_nodes()
        if not target_node_id:
            return start_nodes

        ancestors = self._get_node_ancestors(target_node_id)
        ancestors.add(target_node_id)

        filtered = [
            node_id for node_id in start_nodes
            if node_id in ancestors
        ]

        if not filtered:
            if target_node_id in start_nodes:
                return [target_node_id]
            return start_nodes

        return filtered

    def _get_node_ancestors(self, target_node_id):
        """Get all ancestor node IDs of a target node (BFS backwards).

        Uses pre-built _reverse_adj from _build_graph.
        """
        ancestors = set()
        visited = set()
        queue = [target_node_id]

        while queue:
            current = queue.pop(0)
            for parent in self._reverse_adj.get(current, []):
                if parent not in visited:
                    visited.add(parent)
                    ancestors.add(parent)
                    queue.append(parent)

        return ancestors
    
    def _execute_node_core(self, node_id, input_data, node=None):
        """Execute a single node (no persistence).

        Args:
            node_id: Node ID to execute
            input_data: Input data for node
            node: Pre-fetched node dict (avoids duplicate lookup)
        """
        if node is None:
            node = self.nodes.get(node_id)
        if not node:
            raise UserError(_("Node not found: %s") % node_id)

        node_type = node.get('type')
        config = node.get('config', {})

        # Build execution context (single in-memory context)
        context = self.exec_context.get_runtime_context(
            node_id=node_id,
            execution=self._get_execution_context(),
            workflow=self._get_workflow_context(),
        )

        if node_type == 'code':
            context['secure_eval_context'] = self._get_secure_eval_context(node_id, input_data)

        # Get runner for node type
        runner = self.runners.get(node_type)
        if not runner:
            return {
                'outputs': [[input_data]],
                'json': input_data,
            }
        result = runner.execute(config, input_data, context)
        if node_type == 'code':
            self._sanitize_dirty_vars()
        return result

    def _get_execution_context(self):
        if not self.run:
            return None
        return {
            'id': self.run.id,
            'name': self.run.name,
            'status': self.run.status,
            'started_at': self.run.started_at,
            'completed_at': self.run.completed_at,
            'duration_seconds': self.run.duration_seconds,
            'execution_count': self.run.execution_count,
        }

    def _get_workflow_context(self):
        if self.run and self.run.workflow_id:
            workflow = self.run.workflow_id
            return {
                'id': workflow.id,
                'name': workflow.name,
                'active': workflow.active,
            }

        metadata = self.snapshot.get('metadata') or {}
        workflow = metadata.get('workflow')
        if isinstance(workflow, dict):
            return workflow
        return None

    def _get_env_with_user(self, user):
        """Return env switched to *user*"""
        return self.env(user=user)

    def _get_node_record(self, node_id):
        """Get workflow.node record, cached per execution to avoid N+1."""
        if not self.run or not self.run.workflow_id:
            return None
        cached = self._node_record_cache.get(node_id)
        if cached is not None:
            return cached
        record = self.env['workflow.node'].search([
            ('workflow_id', '=', self.run.workflow_id.id),
            ('node_id', '=', node_id),
        ], limit=1)
        self._node_record_cache[node_id] = record
        return record

    def _get_secure_eval_context(self, node_id, input_data):
        """
        Build secure evaluation context for code/expression nodes.
        
        Includes:
        - SafeEnvProxy (blocks sudo, enforces allowlist/denylist)
        - SecretBroker (secret.get(key))
        - Standard namespaces (_json, _vars, _node, etc.)
        
        Hooks are auto-registered via @SafeEnvProxy.pre_hook decorator.
        The audit_model_access hook is defined in safe_env_proxy.py.
        
        Args:
            node_id: Current node ID
            input_data: Input data for node
            
        Returns:
            dict: Secure evaluation context
        """
        # Get workflow for security config
        workflow = None
        if self.run and self.run.workflow_id:
            workflow = self.run.workflow_id
        elif self.snapshot.get('metadata', {}).get('workflow', {}).get('id'):
            workflow_id = self.snapshot['metadata']['workflow']['id']
            workflow = self.env['ir.workflow'].browse(workflow_id)
        
        # Determine effective user for execution
        effective_user = self.env.user
        if workflow and workflow.run_as_user_id:
            effective_user = workflow.run_as_user_id
        
        # Create environment with effective user
        effective_env = self._get_env_with_user(effective_user)
        
        # Get node record for audit
        node_record_id = None
        node_record = self._get_node_record(node_id)
        if node_record:
            node_record_id = node_record.id
        
        # Build execution context for hooks
        hook_context = {
            'env': self.env,
            'run_id': self.run.id if self.run else None,
            'node_id': node_record_id,
            'workflow_id': workflow.id if workflow else None,
            'persist': self.persist,
        }
        
        # Create safe environment proxy with context
        # Hooks are auto-bound from @SafeEnvProxy.pre_hook decorators
        if workflow:
            safe_env = SafeEnvProxy.from_workflow(effective_env, workflow, context=hook_context)
        else:
            safe_env = SafeEnvProxy(effective_env, context=hook_context)
        
        # Create secret broker (runtime mode = unmasked)
        run_id = self.run.id if self.run else None
        workflow_id = workflow.id if workflow else None
        secret = SecretBrokerFactory.for_execution(
            self.env, 
            run_id=run_id, 
            node_id=node_record_id,
            workflow_id=workflow_id
        )
        
        def setvar(path, value):
            cleaned = self._sanitize_value(value, path="_vars.%s" % path)
            self._set_var_path(path, wrap_mutable(cleaned))
            return self._get_var_path(path)

        _missing = object()

        def getvar(path, default=None):
            value = self._get_var_path(path, _missing)
            return default if value is _missing else value

        eval_context = self.exec_context.get_eval_context(
            input_data,
            include_input_item=True,
            node_id=node_id,
        )

        eval_context['env'] = safe_env
        eval_context['secret'] = secret
        eval_context['setvar'] = setvar
        eval_context['getvar'] = getvar
        eval_context['result'] = None

        return eval_context

    def _redact_output(self, output, node_id=None):
        """
        Redact output for display.

        Args:
            output: Raw output data
            node_id: Node ID for security checks

        Returns:
            dict with raw/display objects and serialized strings
        """
        output_raw = to_plain(output)
        output_display = output_raw

        if not self._can_unmask_output(node_id):
            output_display = self._mask_sensitive_data(output_raw)

        return {
            'raw': output_raw,
            'display': output_display,
            'raw_text': self._serialize_output(output_raw),
            'display_text': self._serialize_output(output_display),
        }

    def _can_unmask_output(self, node_id):
        if not node_id or not self.run:
            return False
        node_record = self._get_node_record(node_id)
        if not node_record:
            return False
        return node_record._should_unmask_for_user(self.env.user, run=self.run)

    def _serialize_output(self, output):
        if isinstance(output, str):
            return output
        try:
            return json.dumps(output, ensure_ascii=True)
        except Exception:
            return str(output)

    def _mask_sensitive_data(self, value):
        """Mask sensitive patterns (API keys, passwords, tokens, emails).

        Uses pre-compiled _MASK_PATTERNS to avoid re.compile overhead.
        Expects *value* to already be plain (no DotDict wrappers); callers
        that pass raw output should call to_plain() beforehand.
        """
        if isinstance(value, dict):
            return {
                key: self._mask_sensitive_data(item)
                for key, item in value.items()
            }
        if isinstance(value, (list, tuple)):
            return [self._mask_sensitive_data(item) for item in value]
        if not isinstance(value, str):
            return value

        result = value
        for compiled, replacement in self._MASK_PATTERNS:
            result = compiled.sub(replacement, result)

        return result

    def _execute_node(self, node_id, input_data, persist=None):
        """Execute a single node.
        
        Args:
            node_id: Node ID to execute
            input_data: Input data for node
            
        Returns:
            NodeOutput dict with outputs, json, etc.
        """
        if persist is None:
            persist = self.persist

        node = self.nodes.get(node_id)
        if not node:
            raise UserError(_("Node not found: %s") % node_id)

        if not persist:
            return self._execute_node_core(node_id, input_data, node=node)

        node_type = node.get('type')

        # Create node run record
        started_at = datetime.now()
        node_run = self.env['workflow.run.node'].create({
            'run_id': self.run.id,
            'node_id': node_id,
            'node_type': node_type,
            'node_label': node.get('label', ''),
            'status': 'running',
            'started_at': started_at,
            'input_data': input_data,
            # Sequence must track execution events, not unique node ids.
            # Using executed_order length preserves correct order for loops
            # where a node can run multiple times.
            'sequence': len(self.executed_order),
        })

        try:
            result = self._execute_node_core(node_id, input_data, node=node)

            redacted = self._redact_output(result.get('json'), node_id)

            # Update node run record
            completed_at = datetime.now()
            duration_ms = (completed_at - started_at).total_seconds() * 1000

            # Determine output socket used
            output_socket = self._get_primary_output_socket(node, result)

            node_run.write({
                'status': 'completed',
                'completed_at': completed_at,
                'duration_ms': duration_ms,
                'output_data': redacted['display'],
                'output_socket': output_socket,
            })

            node_record = self._get_node_record(node_id)
            if node_record:
                self.env['workflow.node.output'].create({
                    'run_id': self.run.id,
                    'node_id': node_record.id,
                    'output_raw': redacted['raw_text'],
                    'output_display': redacted['display_text'],
                    'output_json': redacted['display_text'],
                })

            return result

        except Exception as e:
            # Mark node as failed
            node_run.write({
                'status': 'failed',
                'completed_at': datetime.now(),
                'error_message': str(e),
            })

            # Update run with error node
            if self.persist:
                self.run.write({
                    'error_node_id': node_id,
                })

            raise UserError(_("Node '%s' failed: %s") % (node.get('label', node_id), str(e)))
    
    def _route_outputs(self, node_id, result):
        """Route node outputs to connected nodes.
        
        Args:
            node_id: Source node ID
            result: NodeOutput from execution

        Returns:
            list[dict]: Routed connection entries for this node.
        """
        outputs = result.get('outputs', [[result.get('json')]])
        connections = self.connections_by_source.get(node_id, [])
        routed_connections = []
        
        # Get node to determine socket names
        node = self.nodes.get(node_id, {})
        
        for conn in connections:
            source_handle = conn.get('sourceHandle', 'output')
            target_id = conn.get('target')
            
            if not target_id:
                continue
            
            # Map socket name to output index
            output_index = self._socket_to_index(node, source_handle)
            
            # Skip unmatched sockets (-1 means socket name not found)
            if output_index < 0:
                continue
            
            if output_index < len(outputs):
                output_data = outputs[output_index]
                
                # Only push if output has data (data-driven routing)
                if output_data:
                    # Get first item for single input
                    input_data = output_data[0] if len(output_data) == 1 else output_data

                    connection_event = {
                        'connection_id': conn.get('id'),
                        'source': node_id,
                        'source_socket': source_handle,
                        'target': target_id,
                        'target_socket': conn.get('targetHandle'),
                        'output_index': output_index,
                        'sequence': len(self.executed_connections),
                    }
                    self.executed_connections.append(connection_event)
                    routed_connections.append(connection_event)
                    
                    self.stack.append({
                        'nodeId': target_id,
                        'inputData': input_data,
                    })

        return routed_connections

    def _get_primary_output_socket(self, node, result):
        """Return first non-empty output socket name for persistence."""
        outputs = (result or {}).get('outputs') or []
        for index, output_data in enumerate(outputs):
            if output_data:
                return self._output_index_to_socket_name(node, index)
        return None

    def _output_index_to_socket_name(self, node, index):
        """Convert output index to socket name for a node."""
        node_type = (node or {}).get('type', '')
        sockets = self.node_output_sockets.get(node_type) or []
        if 0 <= index < len(sockets):
            return sockets[index]
        return str(index)
    
    # Pre-compiled pattern for dynamic switch sockets (case_1, case_2, etc.)
    _CASE_SOCKET_RE = re.compile(r'case_?(\d+)$')

    # Generic fallback for common socket names when node type is unknown.
    _GENERIC_SOCKET_MAP = {'output': 0, 'result': 0, 'data': 0}

    def _socket_to_index(self, node, socket_name):
        """Map socket name to output index based on node type definition.

        Lookup chain:
        1. Runtime mapping from workflow.type (ormcache-backed)
        2. Pattern match for dynamic sockets (case_N, default)
        3. Generic fallback for common names
        4. -1 (unknown → skipped by _route_outputs)

        Returns:
            int: Socket index (>= 0) or -1 if socket is unknown.
        """
        if not socket_name:
            return -1

        node_type = node.get('type', '')

        # 1. Try node-type-aware lookup first
        sockets = self.node_output_sockets.get(node_type)
        if sockets:
            try:
                return sockets.index(socket_name)
            except ValueError:
                pass  # Fall through to pattern matching

        # 2. Pattern matching for dynamic sockets (switch case_N)
        match = self._CASE_SOCKET_RE.match(socket_name)
        if match:
            index = int(match.group(1)) - 1
            return max(index, 0)
        if socket_name == 'default':
            return 3

        # 3. Generic fallback for common names (unknown node types)
        return self._GENERIC_SOCKET_MAP.get(socket_name, -1)
    
    def _collect_final_output(self):
        """Collect final output from leaf nodes."""
        # Find nodes with no outgoing connections
        nodes_with_outgoing = set()
        for conn in self.connections:
            source = conn.get('source')
            if source:
                nodes_with_outgoing.add(source)
        
        final_outputs = {}
        for node_id in self.nodes:
            if node_id not in nodes_with_outgoing and node_id in self.node_outputs:
                final_outputs[node_id] = self.node_outputs[node_id].get('json')
        
        # Return single output if only one leaf, otherwise dict
        if len(final_outputs) == 1:
            return list(final_outputs.values())[0]
        return final_outputs

    def _track_var_path(self, path):
        if not isinstance(path, str):
            return
        if '[' in path:
            path = path.split('[', 1)[0]
        self._vars_dirty_paths.add(path)

    def _sanitize_dirty_vars(self):
        if not self._vars_dirty_paths:
            return
        dirty_paths = self._collapse_dirty_paths(self._vars_dirty_paths)
        self._vars_dirty_paths = set()
        if "" in dirty_paths:
            self.vars = self._sanitize_vars(self.vars)
            self.exec_context.update_vars(self.vars)
            self._vars_dirty_paths.clear()
            return
        _missing = object()
        for path in dirty_paths:
            raw_value = self._get_var_path(path, default=_missing)
            if raw_value is _missing:
                continue
            cleaned = self._sanitize_value(to_plain(raw_value), path="_vars.%s" % path)
            self._set_var_path(path, cleaned)
        self._vars_dirty_paths.clear()

    def _collapse_dirty_paths(self, paths):
        if "" in paths:
            return {""}
        ordered = sorted(paths, key=lambda value: value.count("."))
        collapsed = set()
        for path in ordered:
            skip = False
            for existing in collapsed:
                if path == existing:
                    skip = True
                    break
                if path.startswith(existing) and len(path) > len(existing):
                    next_char = path[len(existing)]
                    if next_char in ".[":
                        skip = True
                        break
            if not skip:
                collapsed.add(path)
        return collapsed

    def _sanitize_vars(self, value):
        cleaned = self._sanitize_value(to_plain(value), path="_vars")
        return wrap_mutable(cleaned, tracker=self._track_var_path, path="")

    def _sanitize_value(self, value, path="value"):
        if value is None or isinstance(value, (str, int, float, bool)):
            return value
        if isinstance(value, (datetime, date)):
            return value.isoformat()
        if isinstance(value, dict):
            cleaned = {}
            for key, item in value.items():
                if not isinstance(key, str):
                    raise UserError(
                        _("Invalid vars key at %s (expected string): %s") % (path, key)
                    )
                cleaned[key] = self._sanitize_value(item, path="%s.%s" % (path, key))
            return cleaned
        if isinstance(value, (list, tuple)):
            return [
                self._sanitize_value(item, path="%s[%s]" % (path, idx))
                for idx, item in enumerate(value)
            ]
        raise UserError(
            _("Invalid vars value at %s (type %s)") % (path, type(value).__name__)
        )

    def _split_var_path(self, path):
        if not isinstance(path, str):
            raise UserError(_("Variable path must be a string"))
        return [segment for segment in path.split('.') if segment]

    def _get_var_path(self, path, default=None):
        parts = self._split_var_path(path)
        if not parts:
            return default
        current = self.vars
        for part in parts:
            if not isinstance(current, dict) or part not in current:
                return default
            current = current.get(part)
        return current

    def _set_var_path(self, path, value):
        parts = self._split_var_path(path)
        if not parts:
            raise UserError(_("Variable path is required"))
        if not isinstance(self.vars, dict):
            self.vars = wrap_mutable({})
            self.exec_context.update_vars(self.vars)
        current = self.vars
        prefix = ""
        for part in parts[:-1]:
            prefix = "%s.%s" % (prefix, part) if prefix else part
            next_val = current.get(part)
            if not isinstance(next_val, dict):
                next_val = wrap_mutable({}, tracker=self._track_var_path, path=prefix)
                current[part] = next_val
            current = next_val
        current[parts[-1]] = value

    def _build_context_snapshot(self, target_node_id, target_result):
        """Build context snapshot at target node execution."""
        self.exec_context.update_runtime(
            execution=self._get_execution_context(),
            workflow=self._get_workflow_context(),
        )
        return self.exec_context.build_snapshot(target_node_id, target_result)
