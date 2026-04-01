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
import inspect
import re
import time
from datetime import datetime, date, timedelta
import json
from odoo import api, fields, models, _
from odoo.exceptions import UserError, ValidationError
from odoo.tools import config

from .runners import (
    BaseNodeRunner,
    HttpNodeRunner,
    IfNodeRunner,
    LoopNodeRunner,
    NoOpNodeRunner,
    VariableNodeRunner,
    ValidationNodeRunner,
    CodeNodeRunner,
    SwitchNodeRunner,
    RecordOperationNodeRunner,
    ScheduleTriggerNodeRunner,
    WebhookTriggerNodeRunner,
    RecordEventTriggerNodeRunner,
)
from .context_objects import ExecutionContext, to_plain, wrap_mutable
from .security.safe_env_proxy import SafeEnvProxy
from .security.safe_model_proxy import SafeModelProxy
from .security.secret_broker import SecretBrokerFactory
from ..workflow import WorkflowNodeRegistry

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

    # Marker keys for Odoo record references in execution output.
    _RECORD_REFS_KEY = '__wf_record_refs__'
    _RECORD_REFS_COUNT_KEY = '__wf_record_refs_count__'
    _RECORD_REFS_TRUNCATED_KEY = '__wf_record_refs_truncated__'
    _RECORD_REFS_MODEL_KEY = '__wf_record_refs_model__'
    _MAX_RECORD_REFS = 100
    _MAX_NORMALIZE_DEPTH = 20

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
        'record_operation': RecordOperationNodeRunner,
        'schedule_trigger': ScheduleTriggerNodeRunner,
        'webhook_trigger': WebhookTriggerNodeRunner,
        'record_event_trigger': RecordEventTriggerNodeRunner,
    }
    
    def __init__(self, env, workflow_run=None, snapshot=None, persist=True,
                 notify_channel=None, rollback_on_failure=False,
                 manage_run_lifecycle=True):
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
            manage_run_lifecycle: If True (default), executor manages run
                                  status writes, node-run persistence, and
                                  event emission internally.  Set to False
                                  when lifecycle is managed externally by
                                  ``@workflow.execution`` event handlers.
        """
        self.env = env
        self.run = workflow_run
        self.persist = bool(persist)
        self._notify_channel = notify_channel
        self._rollback_on_failure = bool(rollback_on_failure)
        self._manage_run_lifecycle = bool(manage_run_lifecycle)

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
        self._node_run_buffer = []   # in-memory node run data for batch persist
        self._cached_execution_context = None
        self._cached_workflow_context = None
        self.execution_result = None  # populated by execute() for external lifecycle handlers

        # Bus notification batching (time-based)
        self._pending_batch = []        # [{node_id, status, node_type, node_label}]
        self._pending_connections = []  # [routed_connection entries]
        self._last_flush_time = 0.0    # monotonic timestamp of last bus flush
        self._bus_flush_interval = 0.15 # 150ms wall-clock threshold

        self.exec_context = ExecutionContext(
            node_outputs=self.node_outputs,
            vars_store=self.vars,
            node_context=self.node_context,
            execution=self._get_execution_context(),
            workflow=self._get_workflow_context(),
        )

        self.node_output_sockets = self._load_node_output_sockets()
        self.custom_runtime_types = self._load_custom_runtime_types()
        
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


    def _bus_append(self, node_id, status, routed_connections=None):
        """Append a node result to the pending bus batch."""
        if not self._notify_channel:
            return
        node = self.nodes.get(node_id, {})
        self._pending_batch.append({
            'node_id': node_id,
            'status': status,
            'node_type': node.get('type'),
            'node_label': node.get('label', ''),
        })
        if routed_connections:
            self._pending_connections.extend(routed_connections)

    def _bus_should_flush(self):
        """Check if enough wall-clock time has passed to warrant a flush."""
        if not self._notify_channel or not self._pending_batch:
            return False
        return (time.monotonic() - self._last_flush_time) >= self._bus_flush_interval

    def _bus_flush(self, next_node_id=None, final_status=None, error=None):
        """Flush pending batch as a single ``workflow.execution/progress`` notification.

        Args:
            next_node_id: Node about to execute (UI shows as 'running').
            final_status: 'completed' or 'failed' when execution ends.
            error: Error message (only with final_status='failed').
        """
        if not self._notify_channel:
            return
        if not self._pending_batch and not final_status:
            return

        message = {
            'run_id': self.run.id if self.run else None,
            'completed_nodes': list(self._pending_batch),
            'connections': list(self._pending_connections),
            'next_running_node_id': next_node_id,
        }

        if final_status:
            message['status'] = final_status
            message['error'] = error
            message['executed_order'] = list(self.executed_order)
            message['executed_connections'] = list(self.executed_connections)
            message['executed_connection_ids'] = self._get_executed_connection_ids()
            message['node_count'] = len(self.executed_order)

        self._send_bus_notification('workflow.execution/progress', message)
        self._pending_batch.clear()
        self._pending_connections.clear()
        self._last_flush_time = time.monotonic()

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

    def _load_custom_runtime_types(self):
        """Load custom runtime contract mapping from workflow.type."""
        try:
            return self.env['workflow.type']._get_custom_runtime_mapping()
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
            # empty when fetching /workflow_studio/run/<id>).
            savepoint.close(rollback=bool(rollback))
        except Exception:
            _logger.debug(
                "Savepoint %s failed",
                "rollback" if rollback else "close",
                exc_info=True,
            )
        return None

    def _persist_all_node_runs(self):
        """Batch-create all workflow.run.node and workflow.node.output records.

        Called once after the execution loop completes (success or failure).
        Uses a single ``create(vals_list)`` call per model instead of N
        individual creates, reducing SQL round-trips from ~3N to ~2.

        Redaction (``_redact_output``) is deferred to this batch step so
        that the hot execution loop never pays for ``to_plain`` +
        regex masking + ``json.dumps`` per iteration.

        Also used after a savepoint rollback to re-persist execution
        history for debugging.
        """
        if not self.run:
            return

        # Build vals list for workflow.run.node
        run_node_vals = []
        output_vals = []
        for entry in self._node_run_buffer:
            # Derive completed_at from started_at + duration_ms
            started_at = entry['started_at']
            duration_ms = entry.get('duration_ms', 0)
            completed_at = started_at + timedelta(milliseconds=duration_ms)

            # Redact output in batch (Bottleneck C: deferred from hot loop)
            raw_json = entry.get('_raw_json')
            redacted = None
            output_display = None
            if raw_json is not None:
                redacted = self._redact_output(raw_json, entry['node_id'])
                output_display = redacted['display']

            # Normalize input_data for storage (plain Python, truncated)
            raw_input = entry.get('_input_data')
            input_display = None
            if raw_input is not None:
                try:
                    plain_input = to_plain(raw_input)
                    input_json_str = json.dumps(plain_input, ensure_ascii=False)
                    # Truncate large payloads to stay within DB field limits
                    if len(input_json_str) > 65536:
                        plain_input = {'__truncated__': True, 'preview': input_json_str[:512]}
                    input_display = plain_input
                except Exception:
                    input_display = None

            run_node_vals.append({
                'run_id': self.run.id,
                'node_id': entry['node_id'],
                'node_type': entry['node_type'],
                'node_label': entry['node_label'],
                'status': entry['status'],
                'started_at': started_at,
                'completed_at': completed_at,
                'duration_ms': duration_ms,
                'input_data': input_display,
                'output_data': output_display,
                'output_socket': entry.get('output_socket'),
                'error_message': entry.get('error_message'),
                'sequence': entry['sequence'],
            })

            # Collect workflow.node.output in same loop (reuse redacted result)
            if redacted is not None:
                node_record = self._get_node_record(entry['node_id'])
                if node_record:
                    output_vals.append({
                        'run_id': self.run.id,
                        'node_id': node_record.id,
                        'output_raw': redacted['raw_text'],
                        'output_display': redacted['display_text'],
                        'output_json': redacted['display_text'],
                    })

        if run_node_vals:
            self.env['workflow.run.node'].create(run_node_vals)

        if output_vals:
            self.env['workflow.node.output'].create(output_vals)

    def _commit_progress(self):
        if not self.persist or config['test_enable']:
            return
        self.env.cr.commit()

    def execute(self, input_data=None, start_node_ids=None):
        """Execute workflow from start to completion.

        When ``_manage_run_lifecycle`` is True (default), the executor
        manages run status writes, node-run persistence, event
        emission, and progress commits internally.

        When ``_manage_run_lifecycle`` is False, the executor only runs
        the stack loop, bus notifications, and savepoint management.
        The caller (typically ``@workflow.execution`` event handlers on
        ``ir.workflow``) is responsible for run lifecycle management.

        Args:
            input_data: Initial input data
            start_node_ids: Optional list of specific node IDs to start from.
                            If None, auto-discovers start nodes (no incoming).

        Returns:
            Final output data (display-safe, masked)

        Raises:
            UserError: On execution failure
        """
        start = time.monotonic()
        savepoint = None
        launch_input_data = input_data or {}

        try:
            # -- Lifecycle: mark run as running ---
            if self._manage_run_lifecycle and self.persist:
                self.run.write({
                    'status': 'running',
                    'started_at': fields.Datetime.now(),
                })
                self._invalidate_context_cache()
                self._commit_progress()
                self._emit_run_event(
                    'pre_execution',
                    input_data=launch_input_data,
                    start_node_ids=list(start_node_ids or self.run.start_node_ids or []),
                )

            # Find start nodes (explicit or auto-discover)
            if start_node_ids:
                start_nodes = start_node_ids
            else:
                start_nodes = self._find_start_nodes()
            if not start_nodes:
                raise UserError(_("Workflow has no start nodes"))

            # Push start nodes to stack
            for node_id in start_nodes:
                self.stack.append({
                    'nodeId': node_id,
                    'inputData': launch_input_data,
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
            self._last_flush_time = time.monotonic()

            while self.stack and iteration < max_iterations:
                iteration += 1
                entry = self.stack.pop()
                node_id = entry['nodeId']
                input_data = entry['inputData']

                # Skip disabled nodes (stop path propagation)
                if self._is_node_disabled(node_id):
                    _logger.debug("Skipping disabled node %s", node_id)
                    continue

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
                    self._bus_append(node_id, 'error')
                    self._bus_flush(final_status='failed', error=str(exc))
                    raise

                # Store output
                self.node_outputs[node_id] = result
                self.executed_order.append(node_id)

                # Route outputs to connected nodes
                routed_connections = self._route_outputs(node_id, result)

                # Append to bus batch; flush when wall-clock threshold exceeded
                self._bus_append(node_id, 'success', routed_connections)
                if self._bus_should_flush():
                    next_id = self.stack[-1]['nodeId'] if self.stack else None
                    self._bus_flush(next_node_id=next_id)

            if iteration >= max_iterations:
                raise UserError(_("Workflow exceeded maximum iterations (possible infinite loop)"))

            # Success: release savepoint (keep all changes)
            savepoint = self._release_savepoint(savepoint)

            # Collect and normalise output
            output_data_raw = self._collect_final_output()
            output_data_raw = self._normalize_output_value(output_data_raw)
            output_data_display = self._mask_sensitive_data(output_data_raw)
            output_data_display = self._normalize_output_value(output_data_display)
            end = time.monotonic()
            duration = end - start

            # Expose execution result metadata for external handlers
            self.execution_result = {
                'success': True,
                'output_data': output_data_display,
                'execution_count': iteration,
                'node_count_executed': len(self.node_outputs),
                'executed_connections': list(self.executed_connections),
                'duration_seconds': duration,
            }

            # -- Lifecycle: persist node runs + complete run ---
            if self._manage_run_lifecycle and self.persist:
                self._persist_all_node_runs()
                self.run.write({
                    'status': 'completed',
                    'completed_at': fields.Datetime.now(),
                    'output_data': output_data_display,
                    'executed_connections': list(self.executed_connections),
                    'node_count_executed': len(self.node_outputs),
                    'execution_count': iteration,
                    'duration_seconds': duration,
                })
                self._invalidate_context_cache()
                self._emit_run_event(
                    'post_execution',
                    input_data=launch_input_data,
                    output_data=output_data_display,
                    execution_count=iteration,
                    node_count_executed=len(self.node_outputs),
                    executed_connections=list(self.executed_connections),
                    duration_seconds=duration,
                )

            # Final flush: remaining batch + done status
            self._bus_flush(final_status='completed')

            _logger.info("Workflow execution completed in %.4f seconds", duration)

            return output_data_display

        except Exception as e:
            failed_duration = time.monotonic() - start
            # Rollback DB side effects when enabled
            if savepoint:
                self._release_savepoint(savepoint, rollback=True)
                savepoint = None

            # Expose failure metadata for external handlers
            self.execution_result = {
                'success': False,
                'error': str(e),
                'error_node_id': self._last_error_node_id,
                'execution_count': len(self.executed_order),
                'node_count_executed': len(self.node_outputs),
                'executed_connections': list(self.executed_connections),
                'duration_seconds': failed_duration,
            }

            # -- Lifecycle: persist for debugging + mark failed ---
            if self._manage_run_lifecycle and self.persist:
                self._persist_all_node_runs()
                values = {
                    'status': 'failed',
                    'completed_at': fields.Datetime.now(),
                    'duration_seconds': failed_duration,
                    'error_message': str(e),
                    'executed_connections': list(self.executed_connections),
                }
                if self._last_error_node_id:
                    values['error_node_id'] = self._last_error_node_id
                self.run.write(values)
                self._invalidate_context_cache()
                self._emit_run_event(
                    'post_execution',
                    input_data=launch_input_data,
                    error=str(e),
                    error_node_id=self._last_error_node_id,
                    execution_count=len(self.executed_order),
                    node_count_executed=len(self.node_outputs),
                    executed_connections=list(self.executed_connections),
                    duration_seconds=failed_duration,
                )
                self._commit_progress()
            # Final flush: remaining batch + failed status
            self._bus_flush(final_status='failed', error=str(e))
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
        is_custom_node = self._is_custom_node_type(node_type)
        custom_runtime = self.custom_runtime_types.get(node_type) if is_custom_node else None
        if is_custom_node and not custom_runtime:
            raise ValidationError(_(
                "Custom node type '%(key)s' is not configured or inactive in workflow.type.",
                key=node_type,
            ))

        # Build execution context (single in-memory context)
        context = self.exec_context.get_runtime_context(
            node_id=node_id,
            execution=self._get_execution_context(),
            workflow=self._get_workflow_context(),
        )

        if node_type in ('code', 'record_operation') or is_custom_node:
            context['secure_eval_context'] = self._get_secure_eval_context(node_id, input_data)

        if is_custom_node:
            result = self._execute_custom_node_runtime(
                node_type=node_type,
                node_config=config,
                input_data=input_data,
                context=context,
                runtime_meta=custom_runtime,
            )
            self._sanitize_dirty_vars()
            return result

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

    @staticmethod
    def _is_custom_node_type(node_type):
        return isinstance(node_type, str) and node_type.startswith('x_')

    def _validate_custom_node_runtime(self, node_type, runtime_meta):
        """Validate runtime contract for custom node type."""
        runtime_backend = (runtime_meta or {}).get('runtime_backend') or 'python_code'
        code = (runtime_meta or {}).get('code')
        callable_key = (runtime_meta or {}).get('callable_key')
        required_group_id = (runtime_meta or {}).get('group_id')

        if runtime_backend == 'python_code':
            if not isinstance(code, str) or not code.strip():
                raise ValidationError(_(
                    "Custom node type '%(key)s' has empty runtime code.",
                    key=node_type,
                ))
        elif runtime_backend == 'python_callable':
            if not isinstance(callable_key, str) or not callable_key.strip():
                raise ValidationError(_(
                    "Custom node type '%(key)s' has empty Callable Key.",
                    key=node_type,
                ))
        else:
            raise ValidationError(_(
                "Custom node type '%(key)s' uses unsupported runtime backend '%(backend)s'.",
                key=node_type,
                backend=runtime_backend,
            ))

        if not required_group_id:
            raise ValidationError(_(
                "Custom node type '%(key)s' is missing Required Group.",
                key=node_type,
            ))

    def _check_custom_node_permission(self, node_type, runtime_meta):
        """Enforce group-based runtime permission for custom nodes."""
        required_group_id = (runtime_meta or {}).get('group_id')
        if not required_group_id:
            raise ValidationError(_(
                "Custom node type '%(key)s' is missing Required Group.",
                key=node_type,
            ))

        user = self._get_effective_execution_user()
        if required_group_id in user.groups_id.ids:
            return

        group = self.env['res.groups'].browse(required_group_id)
        group_name = group.display_name if group.exists() else str(required_group_id)
        raise UserError(_(
            "User '%(user)s' cannot execute custom node type '%(key)s'. "
            "Required group: %(group)s.",
            user=user.display_name,
            key=node_type,
            group=group_name,
        ))

    def _execute_custom_node_runtime(self, node_type, node_config, input_data, context, runtime_meta):
        """Execute custom node runtime code or callable backend."""
        self._validate_custom_node_runtime(node_type, runtime_meta)
        self._check_custom_node_permission(node_type, runtime_meta)

        runtime_backend = (runtime_meta or {}).get('runtime_backend') or 'python_code'
        if runtime_backend == 'python_callable':
            return self._execute_callable_node_runtime(
                node_type=node_type,
                node_config=node_config,
                input_data=input_data,
                context=context,
                runtime_meta=runtime_meta,
            )

        secure_context = context.get('secure_eval_context')
        if isinstance(secure_context, dict):
            secure_context['_config'] = node_config or {}
            secure_context['_node_config'] = node_config or {}
            secure_context['_node_type'] = node_type

        code_runner = self.runners.get('code')
        if not code_runner:
            raise ValidationError(_("Code runner is unavailable for custom node runtime execution."))

        runtime_config = {
            'code': (runtime_meta.get('code') or '').strip(),
        }
        return code_runner.execute(runtime_config, input_data, context)

    def _resolve_workflow_callable(self, node_type, runtime_meta):
        callable_key = (runtime_meta or {}).get('callable_key') or ''
        entry = None
        if callable_key:
            entry = WorkflowNodeRegistry.get_by_callable_key(callable_key)
        if not entry:
            entry = WorkflowNodeRegistry.get_node(node_type)
        if not entry or not callable(entry.get('func')):
            raise ValidationError(_(
                "Custom node type '%(key)s' refers to an unavailable Python callable.",
                key=node_type,
            ))
        return entry

    def _normalize_runtime_outputs(self, outputs):
        if not isinstance(outputs, list):
            return [[self._normalize_output_value(outputs)]]
        normalized = []
        for output in outputs:
            if output is None:
                normalized.append([None])
                continue
            if isinstance(output, list):
                normalized.append([
                    self._normalize_output_value(item)
                    for item in output
                ])
                continue
            normalized.append([self._normalize_output_value(output)])
        return normalized

    def _normalize_callable_node_result(self, result):
        plain_result = to_plain(result)
        if isinstance(plain_result, dict) and (
            'outputs' in plain_result or 'json' in plain_result or 'error' in plain_result
        ):
            payload = dict(plain_result)
            outputs = payload.get('outputs')
            json_value = payload.get('json')
            if outputs is not None:
                outputs = self._normalize_runtime_outputs(outputs)
                payload['outputs'] = outputs
                if 'json' not in payload:
                    if outputs:
                        first_output = outputs[0] if len(outputs) >= 1 else []
                        if isinstance(first_output, list):
                            json_value = first_output[0] if len(first_output) == 1 else first_output
                        else:
                            json_value = first_output
                        payload['json'] = json_value
                    else:
                        payload['json'] = None
            else:
                normalized_json = self._normalize_output_value(json_value)
                payload['json'] = normalized_json
                payload['outputs'] = [[normalized_json]]
            return payload

        normalized = self._normalize_output_value(plain_result)
        return {
            'outputs': [[normalized]],
            'json': normalized,
        }

    def _call_workflow_node_function(self, func, context, input_data, node_config):
        try:
            signature = inspect.signature(func)
        except (TypeError, ValueError):
            signature = None

        if signature:
            positional_params = [
                param for param in signature.parameters.values()
                if param.kind in (
                    inspect.Parameter.POSITIONAL_ONLY,
                    inspect.Parameter.POSITIONAL_OR_KEYWORD,
                )
            ]
            required_count = len([
                param for param in positional_params
                if param.default is inspect._empty
            ])
            if required_count <= 1 and len(positional_params) <= 1:
                return func(context)
            if required_count <= 2 and len(positional_params) <= 2:
                return func(context, input_data)
        return func(context, input_data, node_config or {})

    def _execute_callable_node_runtime(self, node_type, node_config, input_data, context, runtime_meta):
        entry = self._resolve_workflow_callable(node_type, runtime_meta)
        func = entry['func']

        secure_context = context.get('secure_eval_context')
        if isinstance(secure_context, dict):
            secure_context['_config'] = node_config or {}
            secure_context['_node_config'] = node_config or {}
            secure_context['_node_type'] = node_type

        try:
            result = self._call_workflow_node_function(
                func,
                context,
                input_data,
                node_config,
            )
        except TypeError as exc:
            raise ValidationError(_(
                "Workflow node callable for '%(key)s' could not be invoked: %(error)s",
                key=node_type,
                error=str(exc),
            )) from exc

        return self._normalize_callable_node_result(result)

    def _emit_run_event(self, event_name, **extra):
        if not self.run:
            return None
        payload = {
            'workflow': self._get_execution_workflow(),
            'run': self.run,
            'execution_mode': self.run.execution_mode,
            'status': self.run.status,
            'input_data': self.run.input_data or {},
            'start_node_ids': list(self.run.start_node_ids or []),
            'start_node_id': (self.run.start_node_ids or [None])[0] if self.run.start_node_ids else None,
            'trigger_type': self.run.execution_mode,
        }
        payload.update(extra)
        return self.run._emit_workflow_event(event_name, payload)

    def _get_execution_context(self):
        if self._cached_execution_context is not None:
            return self._cached_execution_context
        if not self.run:
            return None
        ctx = {
            'id': self.run.id,
            'name': self.run.name,
            'status': self.run.status,
            'started_at': self.run.started_at,
            'completed_at': self.run.completed_at,
            'duration_seconds': self.run.duration_seconds,
            'execution_count': self.run.execution_count,
        }
        self._cached_execution_context = ctx
        return ctx

    def _get_workflow_context(self):
        if self._cached_workflow_context is not None:
            return self._cached_workflow_context
        workflow = self._get_execution_workflow()
        if workflow:
            ctx = {
                'id': workflow.id,
                'name': workflow.name,
                'active': workflow.active,
            }
            self._cached_workflow_context = ctx
            return ctx

        metadata = self.snapshot.get('metadata') or {}
        workflow = metadata.get('workflow')
        if isinstance(workflow, dict):
            self._cached_workflow_context = workflow
            return workflow
        return None

    def _invalidate_context_cache(self):
        """Clear cached execution/workflow contexts.

        Call after run status changes (e.g. 'running' → 'completed')
        so that ``_build_context_snapshot`` sees fresh values.
        """
        self._cached_execution_context = None
        self._cached_workflow_context = None

    def _get_execution_workflow(self):
        """Resolve workflow record for current execution context."""
        if self.run and self.run.workflow_id:
            return self.run.workflow_id

        metadata = self.snapshot.get('metadata') or {}
        workflow_data = metadata.get('workflow')
        workflow_id = workflow_data.get('id') if isinstance(workflow_data, dict) else None
        if not workflow_id:
            return None

        workflow = self.env['ir.workflow'].browse(workflow_id)
        return workflow if workflow.exists() else None

    def _get_effective_execution_user(self):
        """Resolve effective execution user (run_as_user fallback)."""
        workflow = self._get_execution_workflow()
        if workflow and workflow.run_as_user_id:
            return workflow.run_as_user_id
        return self.env.user

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
        workflow = self._get_execution_workflow()

        # Determine effective user for execution
        effective_user = self._get_effective_execution_user()
        
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
        output_raw = self._normalize_output_value(to_plain(output))
        output_display = output_raw

        if not self._can_unmask_output(node_id):
            output_display = self._mask_sensitive_data(output_raw)

        output_display = self._normalize_output_value(output_display)

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
        output = self._normalize_output_value(output)
        if isinstance(output, str):
            return output
        try:
            return json.dumps(output, ensure_ascii=True)
        except Exception:
            return str(output)

    def _is_record_refs_marker(self, value):
        return isinstance(value, dict) and self._RECORD_REFS_KEY in value

    def _build_record_refs_marker(self, recordset):
        ids = list(recordset.ids or [])
        limited_ids = ids[:self._MAX_RECORD_REFS]
        refs = [
            {
                'model': recordset._name,
                'id': rid,
            }
            for rid in limited_ids
        ]
        return {
            self._RECORD_REFS_KEY: refs,
            self._RECORD_REFS_MODEL_KEY: recordset._name,
            self._RECORD_REFS_COUNT_KEY: len(ids),
            self._RECORD_REFS_TRUNCATED_KEY: len(ids) > len(limited_ids),
        }

    def _normalize_output_value(self, value, depth=0):
        """Convert output value to JSON-safe structure.

        Key responsibility in Phase 1:
        - convert Odoo record/recordset values to record-ref markers.
        """
        if depth > self._MAX_NORMALIZE_DEPTH:
            return str(value)

        if isinstance(value, SafeModelProxy):
            value = value._model

        if isinstance(value, models.BaseModel):
            return self._build_record_refs_marker(value)

        if value is None or isinstance(value, (str, int, float, bool)):
            return value

        if isinstance(value, (datetime, date)):
            return value.isoformat()

        if isinstance(value, bytes):
            return value.decode('utf-8', errors='replace')

        if isinstance(value, dict):
            if self._is_record_refs_marker(value):
                refs = value.get(self._RECORD_REFS_KEY) or []
                normalized_refs = []
                for ref in refs:
                    if not isinstance(ref, dict):
                        continue
                    model_name = ref.get('model')
                    record_id = ref.get('id')
                    if not model_name:
                        continue
                    try:
                        record_id = int(record_id)
                    except Exception:
                        continue
                    normalized_refs.append({
                        'model': model_name,
                        'id': record_id,
                    })
                count = value.get(self._RECORD_REFS_COUNT_KEY)
                if not isinstance(count, int):
                    count = len(normalized_refs)
                return {
                    self._RECORD_REFS_KEY: normalized_refs,
                    self._RECORD_REFS_MODEL_KEY: value.get(self._RECORD_REFS_MODEL_KEY),
                    self._RECORD_REFS_COUNT_KEY: count,
                    self._RECORD_REFS_TRUNCATED_KEY: bool(value.get(self._RECORD_REFS_TRUNCATED_KEY)),
                }

            normalized = {}
            for key, item in value.items():
                normalized[key] = self._normalize_output_value(item, depth + 1)
            return normalized

        if isinstance(value, (list, tuple, set)):
            return [self._normalize_output_value(item, depth + 1) for item in value]

        return str(value)

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

    # Node types that cannot use pinned data (triggers, structural nodes).
    _PIN_DATA_DENY_TYPES = {
        'manual_trigger', 'schedule_trigger', 'webhook_trigger',
        'record_event_trigger', 'loop',
    }

    def _get_pin_reference(self, node_id):
        """Return pinned node-run reference for a node, or None."""
        metadata = self.snapshot.get('metadata') or {}
        pin_store = metadata.get('pin_data')
        if not isinstance(pin_store, dict):
            pin_store = metadata.get('pinData') or {}
        return pin_store.get(node_id)

    def _should_apply_pin_data(self):
        if not self.run:
            return True
        return self.run.execution_mode == 'manual'

    def _build_pinned_result(self, node, node_run):
        """Convert a persisted workflow.run.node to a NodeOutput payload."""
        if node_run.error_message:
            return {
                'outputs': [],
                'json': None,
                'error': node_run.error_message,
                'meta': {'pinned_node_run_id': node_run.id},
            }

        output_value = self._normalize_output_value(node_run.output_data)
        output_socket = node_run.output_socket or 'output'
        output_index = self._socket_to_index(node or {}, output_socket)
        if output_index < 0:
            output_index = 0

        outputs = [[] for _ in range(max(output_index + 1, 1))]
        if output_value is None:
            outputs[output_index] = []
            json_value = None
        elif isinstance(output_value, list):
            outputs[output_index] = output_value
            json_value = output_value[0] if len(output_value) == 1 else output_value
        else:
            outputs[output_index] = [output_value]
            json_value = output_value

        return {
            'outputs': outputs,
            'json': json_value,
            'meta': {'pinned_node_run_id': node_run.id},
        }

    def _build_inline_pin_result(self, node_id, pin_data):
        """Convert an inline pin data dict to a NodeOutput payload."""
        output_value = self._normalize_output_value(pin_data.get('output_data'))
        output_socket = pin_data.get('output_socket') or 'output'
        node = self.nodes.get(node_id) or {}
        output_index = self._socket_to_index(node, output_socket)
        if output_index < 0:
            output_index = 0

        outputs = [[] for _ in range(max(output_index + 1, 1))]
        if output_value is None:
            outputs[output_index] = []
            json_value = None
        elif isinstance(output_value, list):
            outputs[output_index] = output_value
            json_value = output_value[0] if len(output_value) == 1 else output_value
        else:
            outputs[output_index] = [output_value]
            json_value = output_value

        return {
            'outputs': outputs,
            'json': json_value,
            'meta': {'pinned_inline': True},
        }

    def _get_pin_data(self, node_id):
        """Resolve pinned output data for a node, or None if not pinned.

        Pin metadata stores either:
        - ``node_id -> workflow.run.node.id`` integer references, or
        - ``node_id -> {output_data: ...}`` inline data objects
        in ``snapshot.metadata.pin_data``.

        Integer references are resolved from the database at execution time.
        Inline objects are converted directly into NodeOutput payloads.
        """
        pin_ref = self._get_pin_reference(node_id)
        if not pin_ref:
            return None

        # Inline data pin (object with output_data)
        if isinstance(pin_ref, dict):
            return self._build_inline_pin_result(node_id, pin_ref)

        try:
            pin_ref = int(pin_ref)
        except Exception:
            _logger.warning("Invalid pin_data reference for node %s: %r", node_id, pin_ref)
            return None

        node_run = self.env['workflow.run.node'].browse(pin_ref)
        if not node_run.exists():
            _logger.warning("Pinned node run %s not found for node %s", pin_ref, node_id)
            return None

        if node_run.node_id != node_id:
            _logger.warning(
                "Pinned node run %s belongs to node %s, expected %s",
                pin_ref,
                node_run.node_id,
                node_id,
            )
            return None

        workflow = self._get_execution_workflow()
        if workflow and node_run.run_id and node_run.run_id.workflow_id != workflow:
            _logger.warning(
                "Pinned node run %s belongs to workflow %s, expected workflow %s",
                pin_ref,
                node_run.run_id.workflow_id.id,
                workflow.id,
            )
            return None

        node = self.nodes.get(node_id) or {}
        return self._build_pinned_result(node, node_run)

    def _execute_node(self, node_id, input_data, persist=None):
        """Execute a single node.

        When ``persist`` is True, node run data is collected in-memory
        (``_node_run_buffer``) instead of writing to DB per-node.
        ``_persist_all_node_runs()`` batch-creates all records after the
        execution loop finishes.

        Pin data check: if the node has a pinned node-run reference in
        ``snapshot.metadata.pin_data`` and the node type is not in the
        deny list, return the pinned data directly (skip execution).

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

        if self.run:
            self._emit_run_event(
                'node_started',
                node=node,
                node_id=node_id,
                input_data=input_data,
            )

        # --- Pin data gate ---------------------------------------------------
        # Honour pinned data for all executor invocations *except* production
        # triggers (those create their own run with execution_mode != manual).
        node_type = node.get('type', '')
        if self._should_apply_pin_data() and node_type not in self._PIN_DATA_DENY_TYPES:
            pin_data = self._get_pin_data(node_id)
            if pin_data is not None:
                result = dict(pin_data)  # shallow copy to avoid mutating snapshot
                if persist:
                    self._node_run_buffer.append({
                        'node_id': node_id,
                        'node_type': node_type,
                        'node_label': node.get('label', ''),
                        'status': 'pinned',
                        'started_at': datetime.now(),
                        'duration_ms': 0,
                        'output_socket': self._get_primary_output_socket(node, result),
                        'sequence': len(self.executed_order),
                        '_raw_json': result.get('json'),
                        '_input_data': input_data,
                    })
                if self.run:
                    self._emit_run_event(
                        'node_completed',
                        node=node,
                        node_id=node_id,
                        input_data=input_data,
                        result=result,
                    )
                return result

        if not persist:
            result = self._execute_node_core(node_id, input_data, node=node)
            if self.run:
                self._emit_run_event(
                    'node_completed',
                    node=node,
                    node_id=node_id,
                    input_data=input_data,
                    result=result,
                )
            return result

        started_at = datetime.now()
        t0 = time.monotonic()

        try:
            result = self._execute_node_core(node_id, input_data, node=node)

            # Some runners (e.g. loop back-edge) signal a preferred log input
            # so the persisted input_data reflects the *original* data rather
            # than whatever the back-edge child returned.
            log_input = result.pop('_log_input', None)

            duration_ms = (time.monotonic() - t0) * 1000
            output_socket = self._get_primary_output_socket(node, result)

            self._node_run_buffer.append({
                'node_id': node_id,
                'node_type': node_type,
                'node_label': node.get('label', ''),
                'status': 'completed',
                'started_at': started_at,
                'duration_ms': duration_ms,
                'output_socket': output_socket,
                'sequence': len(self.executed_order),
                '_raw_json': result.get('json'),
                '_input_data': log_input if log_input is not None else input_data,
            })
            if self.run:
                self._emit_run_event(
                    'node_completed',
                    node=node,
                    node_id=node_id,
                    input_data=input_data,
                    result=result,
                )

            return result

        except Exception as e:
            duration_ms = (time.monotonic() - t0) * 1000
            self._node_run_buffer.append({
                'node_id': node_id,
                'node_type': node_type,
                'node_label': node.get('label', ''),
                'status': 'failed',
                'started_at': started_at,
                'duration_ms': duration_ms,
                'output_socket': None,
                'error_message': str(e),
                'sequence': len(self.executed_order),
                '_input_data': input_data,
            })
            if self.run:
                self._emit_run_event(
                    'node_failed',
                    node=node,
                    node_id=node_id,
                    input_data=input_data,
                    error=str(e),
                )
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
        self._invalidate_context_cache()
        self.exec_context.update_runtime(
            execution=self._get_execution_context(),
            workflow=self._get_workflow_context(),
        )
        return self.exec_context.build_snapshot(target_node_id, target_result)
