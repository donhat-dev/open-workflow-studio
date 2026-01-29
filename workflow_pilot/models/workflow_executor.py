# -*- coding: utf-8 -*-

"""
Workflow Executor - Backend Execution Engine

Stack-based execution following ADR-001 pattern.
Implements synchronous execution with partial result persistence.

Node Runners:
    - HttpNodeRunner: HTTP requests via requests library
    - IfNodeRunner: Conditional branching
    - LoopNodeRunner: Array iteration with back-edge pattern

Expression Evaluation:
    Translates n8n-style $json.field to Python json['field'] for safe_eval.
"""

import re
import json
import logging
import requests
from datetime import datetime

from odoo import api, fields, models, _
from odoo.exceptions import UserError, ValidationError
from odoo.tools.safe_eval import safe_eval, test_python_expr

_logger = logging.getLogger(__name__)


# =============================================================================
# EXPRESSION EVALUATOR
# =============================================================================

class ExpressionEvaluator:
    """Evaluates n8n-style expressions using safe_eval.
    
    Translates:
        $json.field → json['field']
        $json.items[0].name → json['items'][0]['name']
        $node.Http.data → node['Http']['data']
        $vars.count → vars['count']
        json.field → json['field'] (bare namespace, no $)
        json.items[0].name → json['items'][0]['name'] (bare namespace)
    """
    
    # Pattern to match $namespace.path expressions (with $ prefix)
    NAMESPACE_PATTERN = re.compile(r'\$(\w+)((?:\.\w+|\[\d+\])*)')
    
    # Pattern to match bare namespace.path expressions (without $ prefix)
    # Matches: json.field, node.Http, vars.count, etc.
    BARE_NAMESPACE_PATTERN = re.compile(r'\b(json|node|vars)((?:\.\w+|\[\d+\])+)')
    
    @classmethod
    def translate_expression(cls, expr):
        """Translate n8n expression to Python expression.
        
        Supports both:
        - $json.items[0].name → json['items'][0]['name']
        - json.items[0].name → json['items'][0]['name']
        
        Args:
            expr: Expression string, e.g., "$json.items[0].name" or "json.items[0].name"
            
        Returns:
            Python expression string, e.g., "json['items'][0]['name']"
        """
        if not isinstance(expr, str):
            return expr
            
        def replace_namespace(match):
            """Helper to convert namespace.path to namespace['path']."""
            namespace = match.group(1)  # json, node, vars, etc.
            path = match.group(2)       # .field.subfield[0]
            
            # Build Python path
            result = namespace
            if path:
                # Split by dots and brackets
                parts = re.split(r'\.(?![^\[]*\])', path.lstrip('.'))
                for part in parts:
                    if not part:
                        continue
                    # Handle array access like items[0]
                    bracket_match = re.match(r'(\w+)(\[\d+\])?', part)
                    if bracket_match:
                        field = bracket_match.group(1)
                        index = bracket_match.group(2) or ''
                        result += f"['{field}']{index}"
            
            return result
        
        # First translate $namespace.path (with $ prefix)
        result = cls.NAMESPACE_PATTERN.sub(replace_namespace, expr)
        
        # Then translate bare namespace.path (without $ prefix)
        # This handles json.field, node.Http, vars.count, etc.
        result = cls.BARE_NAMESPACE_PATTERN.sub(replace_namespace, result)
        
        return result
    
    @classmethod
    def evaluate(cls, expr, context):
        """Evaluate expression with given context.
        
        Supports both syntaxes:
        - $json.field (n8n-style with $ prefix)
        - json.field (bare namespace without $ prefix)
        
        Args:
            expr: Expression string (n8n or Python style)
            context: Dict with json, node, vars, etc.
            
        Returns:
            Evaluated result
            
        Raises:
            ValueError: If expression evaluation fails
        """
        if not isinstance(expr, str):
            return expr
            
        # Check for template syntax {{ ... }}
        template_pattern = re.compile(r'\{\{(.+?)\}\}')
        if template_pattern.search(expr):
            # String interpolation mode
            def replace_template(match):
                inner_expr = match.group(1).strip()
                translated = cls.translate_expression(inner_expr)
                try:
                    result = safe_eval(translated, context, mode='eval')
                    return str(result) if result is not None else ''
                except Exception as e:
                    _logger.warning(f"Expression evaluation failed: {inner_expr} -> {e}")
                    return ''
            
            return template_pattern.sub(replace_template, expr)
        
        # Return as-is if not an explicit template expression
        return expr


# =============================================================================
# NODE RUNNERS
# =============================================================================

class BaseNodeRunner:
    """Base class for node execution."""
    
    node_type = None
    
    def __init__(self, executor):
        self.executor = executor
        
    def execute(self, node_config, input_data, context):
        """Execute node and return outputs.
        
        Args:
            node_config: Node configuration dict
            input_data: Input data from previous node
            context: Execution context with json, node, vars
            
        Returns:
            dict with 'outputs' (2D array) and 'json' (first output item)
        """
        raise NotImplementedError


class HttpNodeRunner(BaseNodeRunner):
    """HTTP Request node runner.
    
    Config:
        url: Request URL (supports expressions)
        method: HTTP method (GET, POST, PUT, DELETE, PATCH)
        headers: Dict of headers
        body: Request body (for POST/PUT/PATCH)
        timeout: Request timeout in seconds (default 30)
    """
    
    node_type = 'http'
    DEFAULT_TIMEOUT = 30
    MAX_RESPONSE_SIZE = 1024 * 1024  # 1MB
    
    def execute(self, node_config, input_data, context):
        # Build context for expression evaluation
        eval_context = {
            'json': input_data or {},
            'node': context.get('node', {}),
            'vars': context.get('vars', {}),
        }
        
        # Evaluate URL
        url = node_config.get('url', '')
        url = ExpressionEvaluator.evaluate(url, eval_context)
        
        if not url:
            raise ValueError("HTTP node requires a URL")
        
        # Get method
        method = node_config.get('method', 'GET').upper()
        
        # Evaluate headers
        headers = node_config.get('headers', [])
        headers_dict = {}
        for h in headers:
            key = h.get('key')
            value = h.get('value', '')
            headers_dict[key] = value
        evaluated_headers = {}
        for key, value in headers_dict.items():
            if not key:
                continue
            evaluated_headers[key] = ExpressionEvaluator.evaluate(value, eval_context)
        
        # Evaluate body for methods that support it
        body = None
        if method in ('POST', 'PUT', 'PATCH'):
            body_config = node_config.get('body', {})
            if isinstance(body_config, str):
                body = ExpressionEvaluator.evaluate(body_config, eval_context)
            elif isinstance(body_config, dict):
                # Evaluate each field
                body = {}
                for key, value in body_config.items():
                    body[key] = ExpressionEvaluator.evaluate(value, eval_context)
        
        # Get timeout
        timeout = node_config.get('timeout', self.DEFAULT_TIMEOUT)
        
        # Make request
        try:
            response = requests.request(
                method=method,
                url=url,
                headers=evaluated_headers,
                json=body if isinstance(body, dict) else None,
                data=body if isinstance(body, str) else None,
                timeout=timeout,
            )
            
            # Parse response
            try:
                response_data = response.json()
            except ValueError:
                # Non-JSON response
                content = response.text
                if len(content) > self.MAX_RESPONSE_SIZE:
                    content = content[:self.MAX_RESPONSE_SIZE]
                    _logger.warning(f"HTTP response truncated to {self.MAX_RESPONSE_SIZE} bytes")
                response_data = {'body': content, 'text': True}
            
            result = {
                'data': response_data,
                'status': response.status_code,
                'headers': dict(response.headers),
            }
            
            # Check for error status codes
            if not response.ok:
                raise ValueError(f"HTTP {response.status_code}: {response.reason}")
            
            return {
                'outputs': [[result]],
                'json': result,
            }
            
        except requests.RequestException as e:
            raise ValueError(f"HTTP request failed: {str(e)}")


class IfNodeRunner(BaseNodeRunner):
    """IF conditional branching node.
    
    Config:
        condition: Expression that evaluates to truthy/falsy
        
    Outputs:
        [0]: True branch - receives input if condition is truthy
        [1]: False branch - receives input if condition is falsy
    """
    
    node_type = 'if'
    
    def execute(self, node_config, input_data, context):
        # Build context for expression evaluation
        eval_context = {
            'json': input_data or {},
            'node': context.get('node', {}),
            'vars': context.get('vars', {}),
        }
        
        # Evaluate condition
        condition_expr = node_config.get('condition', 'false')
        
        try:
            condition_result = ExpressionEvaluator.evaluate(condition_expr, eval_context)
        except Exception as e:
            _logger.warning(f"IF condition evaluation failed: {e}, treating as false")
            condition_result = False
        
        # Route to appropriate branch
        if condition_result:
            return {
                'outputs': [[input_data], []],  # True branch gets data, false empty
                'json': input_data,
                'branch': 'true',
            }
        else:
            return {
                'outputs': [[], [input_data]],  # False branch gets data, true empty
                'json': input_data,
                'branch': 'false',
            }


class LoopNodeRunner(BaseNodeRunner):
    """Loop node - iterates over arrays.
    
    Follows n8n SplitInBatches pattern (ADR-003):
    - Maintains state in nodeContext (currentIndex, items, processedItems)
    - Each iteration outputs to "loop" socket (index 1)
    - On completion outputs to "done" socket (index 0)
    
    Config:
        items: Expression that evaluates to array to iterate
        batchSize: Number of items per iteration (default 1)
        
    Outputs:
        [0]: Done - receives accumulated results when loop completes
        [1]: Loop - receives current batch item(s) for processing
    """
    
    node_type = 'loop'
    
    def execute(self, node_config, input_data, context):
        node_id = context.get('current_node_id')
        node_context = context.get('node_context', {})
        loop_state = node_context.get(node_id, {})
        
        # Check if this is continuation of existing loop
        if loop_state.get('initialized'):
            # Continue loop - called from back-edge
            return self._continue_loop(loop_state, input_data, context)
        else:
            # Initialize new loop
            return self._init_loop(node_config, input_data, context, node_id)
    
    def _init_loop(self, node_config, input_data, context, node_id):
        """Initialize a new loop iteration."""
        # Build context for expression evaluation
        eval_context = {
            'json': input_data or {},
            'node': context.get('node', {}),
            'vars': context.get('vars', {}),
        }
        
        # Get items to iterate
        items_expr = node_config.get('items', '$json')
        try:
            items = ExpressionEvaluator.evaluate(items_expr, eval_context)
        except Exception as e:
            raise ValueError(f"Loop items expression failed: {e}")
        
        if not isinstance(items, (list, tuple)):
            if items is None:
                items = []
            else:
                items = [items]
        
        items = list(items)
        batch_size = node_config.get('batchSize', 1)
        
        # Initialize loop state
        loop_state = {
            'initialized': True,
            'items': items,
            'currentIndex': 0,
            'batchSize': batch_size,
            'processedItems': [],
        }
        
        # Store in context
        context.setdefault('node_context', {})[node_id] = loop_state
        
        # Check if empty loop
        if not items:
            return {
                'outputs': [[], []],  # Both empty - no iteration needed
                'json': [],
            }
        
        # First iteration
        return self._emit_batch(loop_state)
    
    def _continue_loop(self, loop_state, input_data, context):
        """Continue loop with result from previous iteration."""
        # Store processed result
        if input_data is not None:
            loop_state['processedItems'].append(input_data)
        
        # Advance index
        loop_state['currentIndex'] += loop_state['batchSize']
        
        # Check if done
        if loop_state['currentIndex'] >= len(loop_state['items']):
            # Loop complete - output accumulated results
            results = loop_state['processedItems']
            return {
                'outputs': [[results], []],  # Done socket gets results
                'json': results,
            }
        
        # Continue iteration
        return self._emit_batch(loop_state)
    
    def _emit_batch(self, loop_state):
        """Emit next batch to loop output."""
        start = loop_state['currentIndex']
        end = start + loop_state['batchSize']
        batch = loop_state['items'][start:end]
        
        # Single item if batch size is 1
        output_data = batch[0] if len(batch) == 1 else batch
        
        return {
            'outputs': [[], [output_data]],  # Loop socket gets current batch
            'json': output_data,
        }


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
                break

            # Route outputs to connected nodes
            self._route_outputs(node_id, result)

        if iteration >= max_iterations:
            raise UserError(_("Workflow exceeded maximum iterations (possible infinite loop)"))

        return {
            'node_outputs': self.node_outputs,
            'executed_order': self.executed_order,
            'execution_count': iteration,
            'target_node_id': target_node_id,
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
        }

        # Get runner for node type
        runner = self.runners.get(node_type)
        if not runner:
            return {
                'outputs': [[input_data]],
                'json': input_data,
            }
        return runner.execute(config, input_data, context)

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
