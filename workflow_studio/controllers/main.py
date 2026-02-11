# -*- coding: utf-8 -*-

"""
Workflow Studio Controllers

Provides HTTP endpoints for workflow execution.
Uses Pydantic schemas for consistent response structure.
"""

import logging
from datetime import datetime

from odoo import http
from odoo.http import request

from ..models.context_objects import to_plain
from ..schemas import (
    ExecutionResultSchema,
    ExecutionErrorSchema,
    NodeResultSchema,
    ContextSnapshotSchema,
)

_logger = logging.getLogger(__name__)


class WorkflowPilotController(http.Controller):
    """Controller for workflow execution endpoints."""
    
    @http.route('/workflow_studio/execute', type='json', auth='user', methods=['POST'])
    def execute_workflow(self, workflow_id=None, input_data=None, **kwargs):
        """Execute a published workflow.
        
        Args:
            workflow_id: Database ID of workflow to execute
            input_data: Optional input data for workflow
            
        Returns:
            ExecutionResultSchema dict
        """
        payload = request.httprequest.json or {}
        if workflow_id is None:
            workflow_id = payload.get('workflow_id')
        if input_data is None:
            input_data = payload.get('input_data', {})

        if workflow_id is None:
            return ExecutionErrorSchema(error='Workflow ID is required').model_dump()

        workflow_id = int(workflow_id)
        workflow = request.env['ir.workflow'].browse(workflow_id)
        if not workflow.exists():
            return ExecutionErrorSchema(error='Workflow not found').model_dump()
        
        try:
            result = workflow.execute_workflow(input_data or {}, notify_user=True)
            run_id = result.get('run_id')
            
            # Fetch node results from run record (single iteration for performance)
            node_results = []
            node_outputs_map = {}
            executed_order = []
            executed_connections = []
            context_snapshot = result.get('context_snapshot') if isinstance(result, dict) else None
            if run_id:
                run = request.env['workflow.run'].browse(run_id)
                if run.exists():
                    executed_connections = run.executed_connections or []
                    # Single pass: build node_results, node_outputs_map, and executed_order
                    # Sort by sequence to maintain execution order
                    seen_nodes = set()
                    for node_run in run.node_run_ids.sorted('sequence'):
                        nid = node_run.node_id
                        node_outputs_map[nid] = node_run.output_data
                        if nid in seen_nodes:
                            # Loop iteration: overwrite last entry
                            for i in range(len(node_results) - 1, -1, -1):
                                if node_results[i].node_id == nid:
                                    node_results[i] = NodeResultSchema(
                                        node_id=nid,
                                        node_type=node_run.node_type,
                                        node_label=node_run.node_label,
                                        status=node_run.status,
                                        duration_ms=node_run.duration_ms,
                                        output_data=node_run.output_data,
                                        output_socket=node_run.output_socket,
                                        error_message=node_run.error_message,
                                    )
                                    break
                        else:
                            seen_nodes.add(nid)
                            node_results.append(NodeResultSchema(
                                node_id=nid,
                                node_type=node_run.node_type,
                                node_label=node_run.node_label,
                                status=node_run.status,
                                duration_ms=node_run.duration_ms,
                                output_data=node_run.output_data,
                                output_socket=node_run.output_socket,
                                error_message=node_run.error_message,
                            ))
                            executed_order.append(nid)
                    
                    if not context_snapshot:
                        # Build context snapshot using pre-built map (fallback)
                        context_snapshot = ContextSnapshotSchema(
                            json=run.output_data,
                            node=node_outputs_map,
                            execution={
                                'id': run.id,
                                'name': run.name,
                                'status': run.status,
                            },
                            workflow={
                                'id': workflow.id,
                                'name': workflow.name,
                                'active': workflow.active,
                            },
                            now=datetime.now().isoformat(),
                            today=datetime.now().date().isoformat(),
                        )
            
            return ExecutionResultSchema(
                run_id=run_id,
                run_name=result.get('run_name'),
                status=result.get('status', 'completed'),
                error=result.get('error'),
                execution_count=result.get('execution_count'),
                node_count_executed=result.get('node_count_executed'),
                duration_seconds=result.get('duration_seconds'),
                executed_order=executed_order,
                executed_connection_ids=[
                    entry.get('connection_id')
                    for entry in executed_connections
                    if isinstance(entry, dict) and entry.get('connection_id')
                ],
                executed_connections=executed_connections,
                input_data=input_data or {},
                output_data=result.get('output_data'),
                node_results=node_results,
                context_snapshot=context_snapshot,
            ).model_dump()
            
        except Exception as e:
            _logger.exception(f"Workflow execution failed: {workflow_id}")
            return ExecutionErrorSchema(error=str(e)).model_dump()

    @http.route('/workflow_studio/run/<int:run_id>', type='json', auth='user', methods=['GET', 'POST'])
    def get_run(self, run_id):
        """Get workflow run details.
        
        Args:
            run_id: Database ID of workflow run
            
        Returns:
            ExecutionResultSchema dict
        """
        run = request.env['workflow.run'].browse(run_id)
        if not run.exists():
            return ExecutionErrorSchema(error='Run not found').model_dump()
        
        node_results = []
        executed_order = []
        executed_connections = run.executed_connections or []
        seen_nodes = set()
        for node_run in run.node_run_ids.sorted('sequence'):
            nid = node_run.node_id
            if nid in seen_nodes:
                for i in range(len(node_results) - 1, -1, -1):
                    if node_results[i].node_id == nid:
                        node_results[i] = NodeResultSchema(
                            node_id=nid,
                            node_type=node_run.node_type,
                            node_label=node_run.node_label,
                            status=node_run.status,
                            duration_ms=node_run.duration_ms,
                            output_data=node_run.output_data,
                            output_socket=node_run.output_socket,
                            error_message=node_run.error_message,
                        )
                        break
            else:
                seen_nodes.add(nid)
                node_results.append(NodeResultSchema(
                    node_id=nid,
                    node_type=node_run.node_type,
                    node_label=node_run.node_label,
                    status=node_run.status,
                    duration_ms=node_run.duration_ms,
                    output_data=node_run.output_data,
                    output_socket=node_run.output_socket,
                    error_message=node_run.error_message,
                ))
                executed_order.append(nid)
        
        workflow = run.workflow_id
        context_snapshot = ContextSnapshotSchema(
            json=run.output_data,
            node={nr.node_id: nr.output_data for nr in run.node_run_ids},
            execution={
                'id': run.id,
                'name': run.name,
                'status': run.status,
                'started_at': run.started_at.isoformat() if run.started_at else None,
                'completed_at': run.completed_at.isoformat() if run.completed_at else None,
            },
            workflow={
                'id': workflow.id if workflow else None,
                'name': workflow.name if workflow else None,
                'active': workflow.active if workflow else False,
            },
        )
        
        return ExecutionResultSchema(
            run_id=run.id,
            run_name=run.name,
            status=run.status,
            error=run.error_message,
            error_node_id=run.error_node_id,
            execution_count=run.execution_count,
            node_count_executed=run.node_count_executed,
            duration_seconds=run.duration_seconds,
            executed_order=executed_order,
            executed_connection_ids=[
                entry.get('connection_id')
                for entry in executed_connections
                if isinstance(entry, dict) and entry.get('connection_id')
            ],
            executed_connections=executed_connections,
            input_data=run.input_data or {},
            output_data=run.output_data,
            node_results=node_results,
            context_snapshot=context_snapshot,
        ).model_dump()

    @http.route('/workflow_studio/execute_until', type='json', auth='user', methods=['POST'])
    def execute_until(self, workflow_id=None, target_node_id=None, input_data=None, snapshot=None, config_overrides=None, **kwargs):
        """Execute workflow until target node is reached (preview mode).

        Args:
            workflow_id: Database ID of workflow to execute
            target_node_id: Node ID to stop after execution
            input_data: Optional input data for workflow
            snapshot: Optional snapshot to execute (defaults to draft)
            config_overrides: Optional node config overrides

        Returns:
            ExecutionResultSchema dict
        """
        payload = request.httprequest.json or {}
        if workflow_id is None:
            workflow_id = payload.get('workflow_id')
        if target_node_id is None:
            target_node_id = payload.get('target_node_id')
        if input_data is None:
            input_data = payload.get('input_data', {})
        if snapshot is None:
            snapshot = payload.get('snapshot')
        if config_overrides is None:
            config_overrides = payload.get('config_overrides')

        if workflow_id is None:
            return ExecutionErrorSchema(error='Workflow ID is required').model_dump()
        if not target_node_id:
            return ExecutionErrorSchema(error='Target node ID is required').model_dump()

        workflow_id = int(workflow_id)
        workflow = request.env['ir.workflow'].browse(workflow_id)
        if not workflow.exists():
            return ExecutionErrorSchema(error='Workflow not found').model_dump()

        try:
            result = workflow.execute_preview(
                target_node_id=target_node_id,
                input_data=input_data or {},
                config_overrides=config_overrides,
                snapshot=snapshot,
            )

            # Convert node_outputs to plain dicts (strip DotDict wrappers)
            node_outputs = to_plain(result.get('node_outputs') or {})
            executed_order = result.get('executed_order') or []
            status = result.get('status', 'completed')
            error_message = result.get('error')
            error_node_id = result.get('error_node_id')
            
            # Deduplicate executed_order: keep last occurrence only.
            # Loop nodes execute many times but node_outputs already
            # overwrites so only the final result matters.
            seen = set()
            unique_order = []
            for nid in reversed(executed_order):
                if nid not in seen:
                    seen.add(nid)
                    unique_order.append(nid)
            unique_order.reverse()
            executed_order = unique_order

            node_results = []
            for node_id in executed_order:
                output = node_outputs.get(node_id, {})
                node_results.append(NodeResultSchema(
                    node_id=node_id,
                    node_type=output.get('node_type'),
                    node_label=output.get('title'),
                    status='completed' if not output.get('error') else 'failed',
                    output_data=output.get('json'),
                    error_message=output.get('error'),
                    title=output.get('title'),
                    meta=output.get('meta'),
                ))
            
            # Build context snapshot (strip DotDict wrappers)
            raw_snapshot = to_plain(result.get('context_snapshot') or {})
            context_snapshot = ContextSnapshotSchema(
                json=raw_snapshot.get('json'),
                node=raw_snapshot.get('node', {}),
                vars=raw_snapshot.get('vars', {}),
                node_context=raw_snapshot.get('node_context', {}),
                execution=raw_snapshot.get('execution'),
                workflow=raw_snapshot.get('workflow'),
                now=raw_snapshot.get('now'),
                today=raw_snapshot.get('today'),
            )

            return ExecutionResultSchema(
                status=status,
                error=error_message,
                error_node_id=error_node_id,
                target_node_id=result.get('target_node_id'),
                execution_count=result.get('execution_count', 0),
                node_count_executed=len(executed_order),
                executed_order=executed_order,
                executed_connection_ids=result.get('executed_connection_ids') or [],
                executed_connections=result.get('executed_connections') or [],
                input_data=input_data or {},
                node_results=node_results,
                node_outputs=node_outputs,  # Keep for backward compatibility
                context_snapshot=context_snapshot,
            ).model_dump()
            
        except Exception as e:
            _logger.exception("Workflow preview execution failed")
            return ExecutionErrorSchema(error=str(e)).model_dump()