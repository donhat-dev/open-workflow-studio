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
from copy import deepcopy
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
from .context_objects import to_plain, wrap_mutable, wrap_readonly
from .security.safe_env_proxy import SafeEnvProxy
from .security.secret_broker import SecretBrokerFactory

_logger = logging.getLogger(__name__)


class NodeOutputsProxy:
    """Lazy proxy for _node access to avoid O(n²) dict rebuild.
    
    Instead of rebuilding {nid: out.get('json') for ...} each node,
    this proxy provides O(1) access to node outputs on demand.
    """
    __slots__ = ('_outputs', '_cache')
    
    def __init__(self, node_outputs):
        self._outputs = node_outputs
        self._cache = {}

    def _build_view(self, output):
        if not isinstance(output, dict):
            json_value = output
            meta_value = None
            error_value = None
        else:
            json_value = output.get('json')
            meta_value = output.get('meta')
            error_value = output.get('error')

        items_value = None
        if isinstance(output, dict):
            items_value = output.get('items')

        if items_value is None:
            if isinstance(json_value, list):
                items_value = json_value
            elif json_value is None:
                items_value = []
            else:
                items_value = [json_value]

        item_value = None
        if isinstance(output, dict):
            item_value = output.get('item')
        if item_value is None:
            if isinstance(items_value, list) and items_value:
                item_value = items_value[0]
            else:
                item_value = json_value

        view = {
            'json': json_value,
            'item': item_value,
            'items': items_value,
            'meta': meta_value,
            'error': error_value,
        }
        return wrap_readonly(view)

    def _get_view(self, key):
        output = self._outputs.get(key)
        if output is None:
            return None
        cached = self._cache.get(key)
        if cached and cached[0] is output:
            return cached[1]
        view = self._build_view(output)
        self._cache[key] = (output, view)
        return view
    
    def __getitem__(self, key):
        view = self._get_view(key)
        if view is None:
            raise KeyError(key)
        return view
    
    def __contains__(self, key):
        return key in self._outputs
    
    def get(self, key, default=None):
        view = self._get_view(key)
        if view is None:
            return default
        return view
    
    def keys(self):
        return self._outputs.keys()
    
    def values(self):
        return (self._build_view(out) for out in self._outputs.values())
    
    def items(self):
        return ((nid, self._build_view(out)) for nid, out in self._outputs.items())
    
    def __iter__(self):
        return iter(self._outputs)
    
    def __len__(self):
        return len(self._outputs)


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
    
    def __init__(self, env, workflow_run=None, snapshot=None, persist=True):
        """Initialize executor.

        Args:
            env: Odoo environment
            workflow_run: workflow.run record being executed
            snapshot: Workflow snapshot dict (used when persist=False)
            persist: Whether to persist run/node records
        """
        self.env = env
        self.run = workflow_run
        self.persist = bool(persist)

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
        
        # Build lookup structures
        self._build_graph()
        
        # Initialize runners
        self.runners = {
            node_type: runner_class(self)
            for node_type, runner_class in self.NODE_RUNNERS.items()
        }
    
    def _build_graph(self):
        """Build node and connection lookup structures."""
        self.nodes = {}
        self.connections = []
        self.connections_by_source = {}
        
        for node in self.snapshot.get('nodes', []):
            self.nodes[node['id']] = node
        
        for conn in self.snapshot.get('connections', []):
            self.connections.append(conn)
            source = conn.get('source')
            if source:
                self.connections_by_source.setdefault(source, []).append(conn)
    
    def execute(self, input_data=None):
        """Execute workflow from start to completion.
        
        Args:
            input_data: Initial input data
            
        Returns:
            Final output data
            
        Raises:
            UserError: On execution failure
        """
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
            
            # Execute until stack empty
            iteration = 0
            max_iterations = 1000
            
            while self.stack and iteration < max_iterations:
                iteration += 1
                entry = self.stack.pop()
                node_id = entry['nodeId']
                input_data = entry['inputData']
                
                # Execute node
                result = self._execute_node(node_id, input_data)

                # Store output
                self.node_outputs[node_id] = result
                self.executed_order.append(node_id)
                
                # Route outputs to connected nodes
                self._route_outputs(node_id, result)
            
            if iteration >= max_iterations:
                raise UserError(_("Workflow exceeded maximum iterations (possible infinite loop)"))
            
            # Complete run
            output_data_raw = self._collect_final_output()
            output_data_display = self._mask_sensitive_data(output_data_raw)
            if self.persist:
                self.run.write({
                    'status': 'completed',
                    'completed_at': fields.Datetime.now(),
                    'output_data': output_data_display,
                    'node_count_executed': len(self.node_outputs),
                    'execution_count': iteration,
                })

            return output_data_display
            
        except Exception as e:
            # Mark run as failed
            if self.persist:
                self.run.write({
                    'status': 'failed',
                    'completed_at': fields.Datetime.now(),
                    'error_message': str(e),
                })
                self.env.cr.commit()
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

            # Execute node
            try:
                result = self._execute_node(node_id, node_input, persist=False)
            except Exception as exc:
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
            raise UserError(_("Workflow exceeded maximum iterations (possible infinite loop)"))

        if error_message:
            return {
                'status': 'failed',
                'error': error_message,
                'error_node_id': error_node_id,
                'node_outputs': self.node_outputs,
                'executed_order': self.executed_order,
                'execution_count': iteration,
                'target_node_id': target_node_id,
                'context_snapshot': self._build_context_snapshot(error_node_id, target_result),
            }

        if not target_reached:
            raise UserError(_("Target node %s was not reached") % target_node_id)

        return {
            'status': 'completed',
            'node_outputs': self.node_outputs,
            'executed_order': self.executed_order,
            'execution_count': iteration,
            'target_node_id': target_node_id,
            'context_snapshot': self._build_context_snapshot(target_node_id, target_result),
        }
    
    def _find_start_nodes(self):
        """Find nodes with no incoming connections."""
        nodes_with_incoming = set()
        for conn in self.connections:
            target = conn.get('target')
            if target:
                nodes_with_incoming.add(target)
        
        start_nodes = []
        for node_id in self.nodes:
            if node_id not in nodes_with_incoming:
                start_nodes.append(node_id)
        
        return start_nodes

    def _find_start_nodes_for_target(self, target_node_id):
        """Find start nodes that lead to target node (preview flow)."""
        start_nodes = self._find_start_nodes()
        if not target_node_id:
            return start_nodes

        ancestors = self._get_node_ancestors(target_node_id)
        ancestors.add(target_node_id)

        filtered = [
            node_id for node_id in start_nodes
            if node_id in ancestors or self._has_path_to_node(node_id, target_node_id)
        ]

        if not filtered:
            if target_node_id in start_nodes:
                return [target_node_id]
            return start_nodes

        return filtered

    def _get_node_ancestors(self, target_node_id):
        """Get all ancestor node IDs of a target node (BFS backwards)."""
        ancestors = set()
        visited = set()
        queue = [target_node_id]

        reverse_adj = {}
        for conn in self.connections:
            target = conn.get('target')
            source = conn.get('source')
            if not target or not source:
                continue
            reverse_adj.setdefault(target, []).append(source)

        while queue:
            current = queue.pop(0)
            parents = reverse_adj.get(current, [])
            for parent in parents:
                if parent in visited:
                    continue
                visited.add(parent)
                ancestors.add(parent)
                queue.append(parent)

        return ancestors

    def _has_path_to_node(self, source_node_id, target_node_id):
        """Check if there's a path from source node to target node."""
        visited = set()
        queue = [source_node_id]

        forward_adj = {}
        for conn in self.connections:
            source = conn.get('source')
            target = conn.get('target')
            if not source or not target:
                continue
            forward_adj.setdefault(source, []).append(target)

        while queue:
            current = queue.pop(0)
            if current == target_node_id:
                return True
            if current in visited:
                continue
            visited.add(current)
            for child in forward_adj.get(current, []):
                if child not in visited:
                    queue.append(child)

        return False
    
    def _execute_node_core(self, node_id, input_data):
        """Execute a single node (no persistence)."""
        node = self.nodes.get(node_id)
        if not node:
            raise UserError(_("Node not found: %s") % node_id)

        node_type = node.get('type')
        config = node.get('config', {})

        # Build execution context
        context = {
            'current_node_id': node_id,
            'node': self.node_outputs,
            'vars': self.vars,
            'node_context': self.node_context,
            'execution': self._get_execution_context(),
            'workflow': self._get_workflow_context(),
        }

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
        with_user = getattr(self.env, 'with_user', None)
        if callable(with_user):
            return with_user(user)
        try:
            return self.env(user=user)
        except TypeError as exc:
            raise UserError(
                _("Environment does not support with_user or env(user=...) for run_as_user")
            ) from exc

    def _get_node_record(self, node_id):
        if not self.run or not self.run.workflow_id:
            return None
        return self.env['workflow.node'].search([
            ('workflow_id', '=', self.run.workflow_id.id),
            ('node_id', '=', node_id),
        ], limit=1)

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

        input_payload = input_data or {}
        if isinstance(input_payload, list):
            input_items = input_payload
            input_item = input_payload[0] if input_payload else None
        else:
            input_items = [] if input_payload is None else [input_payload]
            input_item = input_payload
        input_context = {
            'json': input_payload,
            'item': input_item,
            'items': input_items,
        }

        eval_context = {
            # Standard namespaces
            '_json': wrap_readonly(input_payload),
            '_input': wrap_readonly(input_context),
            '_vars': self.vars,
            '_node': NodeOutputsProxy(self.node_outputs),  # Lazy proxy - O(1) instead of O(n)
            '_loop': wrap_readonly(self.node_context.get(node_id, {}).get('loop', {})),
            
            # Time
            '_now': datetime.now(),
            '_today': date.today(),
            
            # Execution metadata
            '_execution': wrap_readonly(self._get_execution_context() or {}),
            '_workflow': wrap_readonly(self._get_workflow_context() or {}),
            
            # Secure proxies
            'env': safe_env,
            'secret': secret,
            'setvar': setvar,
            'getvar': getvar,
            
            # Output variable
            'result': None,
        }

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
        """
        Mask sensitive patterns in text.

        Patterns masked:
        - API keys (sk-..., key-..., etc.)
        - Passwords
        - Tokens
        - Email addresses
        """
        import re

        patterns = [
            (r'(sk-[a-zA-Z0-9]{20,})', '********'),  # OpenAI-style keys
            (r'(key-[a-zA-Z0-9]{20,})', '********'),  # Generic API keys
            (r'(password["\s:=]+)[^\s,"]+', r'\1********'),  # Passwords
            (r'(token["\s:=]+)[^\s,"]+', r'\1********'),  # Tokens
            (r'(secret["\s:=]+)[^\s,"]+', r'\1********'),  # Secrets
            (r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b', '***@***.***'),  # Emails
        ]

        value = to_plain(value)

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
        for pattern, replacement in patterns:
            result = re.sub(pattern, replacement, result, flags=re.IGNORECASE)

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
            return self._execute_node_core(node_id, input_data)

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
            'sequence': len(self.node_outputs),
        })

        try:
            result = self._execute_node_core(node_id, input_data)

            redacted = self._redact_output(result.get('json'), node_id)

            # Update node run record
            completed_at = datetime.now()
            duration_ms = (completed_at - started_at).total_seconds() * 1000

            # Determine output socket used
            output_socket = None
            if result.get('outputs'):
                for i, output in enumerate(result['outputs']):
                    if output:
                        output_socket = str(i)
                        break

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
        """
        outputs = result.get('outputs', [[result.get('json')]])
        connections = self.connections_by_source.get(node_id, [])
        
        # Get node to determine socket names
        node = self.nodes.get(node_id, {})
        
        for conn in connections:
            source_handle = conn.get('sourceHandle', 'output')
            target_id = conn.get('target')
            
            if not target_id:
                continue
            
            # Map socket name to output index
            output_index = self._socket_to_index(node, source_handle)
            
            if output_index < len(outputs):
                output_data = outputs[output_index]
                
                # Only push if output has data (data-driven routing)
                if output_data:
                    # Get first item for single input
                    input_data = output_data[0] if len(output_data) == 1 else output_data
                    
                    self.stack.append({
                        'nodeId': target_id,
                        'inputData': input_data,
                    })
    
    def _socket_to_index(self, node, socket_name):
        """Map socket name to output index.
        
        Conventions:
            - 'output', 'result', 'data' -> 0
            - 'true', 'done' -> 0
            - 'false', 'loop' -> 1
        """
        if socket_name:
            match = re.match(r'case_?(\d+)$', socket_name)
            if match:
                index = int(match.group(1)) - 1
                return max(index, 0)
            if socket_name == 'default':
                return 3

        socket_map = {
            'output': 0,
            'result': 0,
            'data': 0,
            'true': 0,
            'done': 0,
            'false': 1,
            'loop': 1,
        }
        return socket_map.get(socket_name, 0)
    
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
        """Build context snapshot at target node execution.
        
        Includes all context variables matching _get_secure_eval_context:
        _now, _today, _vars, _execution, _workflow, _node, etc.
        
        Performance notes:
        - node: shallow dict copy (json values are immutable after execution)
        - vars: deepcopy required (mutable, user can modify)
        - node_context: shallow copy (loop state is read-only after node completes)
        """
        target_json = None
        if target_result:
            target_json = target_result.get('json')

        # Shallow copy - json values are already serialized/immutable
        node_json_snapshot = {
            node_id: output.get('json')
            for node_id, output in self.node_outputs.items()
        }

        # Shallow copy node_context - only deepcopy if loops have mutable state
        node_context_snapshot = {
            nid: dict(ctx) for nid, ctx in self.node_context.items()
        }

        return {
            'json': target_json,
            'node': node_json_snapshot,
            'vars': deepcopy(to_plain(self.vars)),  # Convert proxy to plain dict first
            'node_context': node_context_snapshot,
            'execution': self._get_execution_context(),
            'workflow': self._get_workflow_context(),
            'now': datetime.now().isoformat(),
            'today': date.today().isoformat(),
        }
