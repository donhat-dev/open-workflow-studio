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
from datetime import datetime

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
        self.vars = {}  # Workflow variables
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
            output_data = self._collect_final_output()
            if self.persist:
                self.run.write({
                    'status': 'completed',
                    'completed_at': fields.Datetime.now(),
                    'output_data': output_data,
                    'node_count_executed': len(self.node_outputs),
                    'execution_count': iteration,
                })
            
            return output_data
            
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
        while self.stack and iteration < max_iterations:
            iteration += 1
            entry = self.stack.pop()
            node_id = entry['nodeId']
            node_input = entry['inputData']

            # Execute node
            result = self._execute_node(node_id, node_input, persist=False)

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

        if not target_reached:
            raise UserError(_("Target node %s was not reached") % target_node_id)

        return {
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

        # Get runner for node type
        runner = self.runners.get(node_type)
        if not runner:
            return {
                'outputs': [[input_data]],
                'json': input_data,
            }
        result = runner.execute(config, input_data, context)
        vars_payload = result.get('vars') if isinstance(result, dict) else None
        if isinstance(vars_payload, dict) and vars_payload is not self.vars:
            self.vars = vars_payload
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
                'output_data': result.get('json'),
                'output_socket': output_socket,
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

    def _build_context_snapshot(self, target_node_id, target_result):
        """Build context snapshot at target node execution."""
        target_json = None
        if target_result:
            target_json = target_result.get('json')

        node_json_snapshot = {
            node_id: output.get('json')
            for node_id, output in self.node_outputs.items()
        }

        return {
            'json': target_json,
            'node': node_json_snapshot,
            'vars': deepcopy(self.vars),
            'node_context': deepcopy(self.node_context),
            'execution': self._get_execution_context(),
            'workflow': self._get_workflow_context(),
        }
