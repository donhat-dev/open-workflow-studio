# -*- coding: utf-8 -*-

"""
Loop Node Runner

Iterates over arrays following n8n SplitInBatches pattern (ADR-003).
Maintains state across iterations via nodeContext.
"""

import logging

from ..context_objects import build_eval_context
from .base import BaseNodeRunner

_logger = logging.getLogger(__name__)


class LoopNodeRunner(BaseNodeRunner):
    """Loop node - iterates over arrays.
    
    Follows n8n SplitInBatches pattern:
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
        payload = input_data or {}
        eval_context = build_eval_context(payload, context, include_input_item=True)
        
        # Get items to iterate
        items_expr = node_config.get('inputItems', '={{ _json }}')
        if items_expr:
            try:
                items = self.resolver.resolve(items_expr, eval_context)
            except Exception as e:
                raise ValueError(f"Loop items expression failed when evaluating '{items_expr}': {e}")
        else:
            items = input_data
        
        if not isinstance(items, (list, tuple)):
            if items is None:
                items = []
            else:
                items = [items]
        
        items = list(items)
        batch_size = node_config.get('batchSize', 1) or 1
        
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
        """Continue loop with result from previous iteration.

        Appends the *original* batch item (from the input buffer) to
        processedItems rather than the child-node output so that:
          - processedItems reflects batches extracted from the original input
          - input_data logged for the loop node is the original batch, not
            whatever the back-edge child returned
        The result includes '_log_input' so the executor can override the
        persisted input_data for this iteration.
        """
        batch_size = loop_state['batchSize'] or 1

        # Capture the original batch that was just processed (before advancing)
        prev_index = loop_state['currentIndex']
        prev_batch = loop_state['items'][prev_index:prev_index + batch_size]
        prev_batch_data = prev_batch[0] if len(prev_batch) == 1 else list(prev_batch)

        # Accumulate original batch (not child output) into processedItems
        loop_state['processedItems'].append(prev_batch_data)

        # Advance index
        loop_state['currentIndex'] += batch_size

        # Check if done
        if loop_state['currentIndex'] >= len(loop_state['items']):
            # Loop complete - output accumulated original batches
            results = loop_state['processedItems']
            return {
                'outputs': [[results], []],  # Done socket gets results
                'json': results,
                # Executor replaces persisted input_data with the original batch
                '_log_input': prev_batch_data,
            }

        # Continue iteration
        result = self._emit_batch(loop_state)
        result['_log_input'] = prev_batch_data
        return result
    
    def _emit_batch(self, loop_state):
        """Emit next batch to loop output."""
        start = loop_state['currentIndex']
        end = start + (loop_state['batchSize'] or 1)
        batch = loop_state['items'][start:end]
        
        # Single item if batch size is 1
        output_data = batch[0] if len(batch) == 1 else batch
        
        return {
            'outputs': [[], [output_data]],  # Loop socket gets current batch
            'json': output_data,
        }
