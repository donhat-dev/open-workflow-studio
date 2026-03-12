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

    _RECORD_REFS_KEY = '__wf_record_refs__'
    _MAX_RECORD_REF_RESOLVE = 200
    _MINIMAL_FIELD_CANDIDATES = [
        'display_name',
        'name',
        'state',
        'status',
        'code',
        'email',
        'phone',
        'mobile',
        'active',
        'create_date',
        'write_date',
    ]

    def _build_node_result_schema(self, node_run):
        return NodeResultSchema(
            node_id=node_run.node_id,
            node_type=node_run.node_type,
            node_label=node_run.node_label,
            sequence=node_run.sequence,
            iteration=node_run.iteration,
            status=node_run.status,
            duration_ms=node_run.duration_ms,
            started_at=node_run.started_at.isoformat() if node_run.started_at else None,
            completed_at=node_run.completed_at.isoformat() if node_run.completed_at else None,
            input_data=node_run.input_data,
            output_data=node_run.output_data,
            output_socket=node_run.output_socket,
            error_message=node_run.error_message,
        )

    def _collect_run_node_results(self, run):
        node_results = []
        execution_events = []
        executed_order = []
        node_outputs_map = {}
        node_index_by_id = {}

        for node_run in run.node_run_ids.sorted('sequence'):
            node_result = self._build_node_result_schema(node_run)
            execution_events.append(node_result)

            nid = node_run.node_id
            node_outputs_map[nid] = node_run.output_data
            if nid in node_index_by_id:
                node_results[node_index_by_id[nid]] = node_result
                continue

            node_index_by_id[nid] = len(node_results)
            node_results.append(node_result)
            executed_order.append(nid)

        return {
            'node_results': node_results,
            'execution_events': execution_events,
            'executed_order': executed_order,
            'node_outputs_map': node_outputs_map,
        }

    def _get_minimal_read_fields(self, model):
        """Pick a bounded, lightweight field set for live expansion."""
        field_names = ['display_name']
        fields_map = model.fields_get()
        for candidate in self._MINIMAL_FIELD_CANDIDATES:
            if candidate == 'display_name':
                continue
            if candidate not in fields_map:
                continue
            field_type = fields_map[candidate].get('type')
            if field_type in ('binary', 'one2many', 'many2many'):
                continue
            field_names.append(candidate)
        # Keep payload minimal and deterministic.
        return field_names[:12]

    def _normalize_record_refs(self, refs):
        normalized = []
        if not isinstance(refs, list):
            return normalized

        for ref in refs[:self._MAX_RECORD_REF_RESOLVE]:
            if not isinstance(ref, dict):
                continue
            model_name = ref.get('model')
            record_id = ref.get('id')
            if not isinstance(model_name, str) or not model_name:
                continue
            try:
                record_id = int(record_id)
            except Exception:
                continue
            if record_id <= 0:
                continue
            normalized.append({
                'model': model_name,
                'id': record_id,
            })
        return normalized

    @http.route('/workflow_studio/resolve_record_refs', type='json', auth='user', methods=['POST'])
    def resolve_record_refs(self, refs=None, **kwargs):
        """Resolve record references to minimal live data (ACL-aware)."""
        payload = request.httprequest.json or {}
        if refs is None:
            refs = payload.get('refs')

        normalized_refs = self._normalize_record_refs(refs)
        if not normalized_refs:
            return {'items': []}

        grouped_ids = {}
        for ref in normalized_refs:
            model_name = ref['model']
            if model_name not in grouped_ids:
                grouped_ids[model_name] = set()
            grouped_ids[model_name].add(ref['id'])

        resolved_map = {}

        for model_name, id_set in grouped_ids.items():
            try:
                model = request.env[model_name]
            except Exception:
                for rid in id_set:
                    resolved_map[(model_name, rid)] = {
                        'status': 'model_not_found',
                        'error': 'Model not found',
                        'data': None,
                    }
                continue

            if not model.check_access_rights('read', raise_exception=False):
                for rid in id_set:
                    resolved_map[(model_name, rid)] = {
                        'status': 'access_denied',
                        'error': 'Read access denied',
                        'data': None,
                    }
                continue

            ids_list = list(id_set)
            accessible_ids = model.search([('id', 'in', ids_list)]).ids
            accessible_set = set(accessible_ids)
            missing_or_denied = set(ids_list) - accessible_set

            fields_to_read = self._get_minimal_read_fields(model)
            rows_by_id = {}
            if accessible_ids:
                rows = model.browse(accessible_ids).read(fields_to_read)
                for row in rows:
                    row_id = row.get('id')
                    if row_id:
                        rows_by_id[row_id] = row

            for rid in ids_list:
                key = (model_name, rid)
                if rid in rows_by_id:
                    resolved_map[key] = {
                        'status': 'ok',
                        'error': None,
                        'data': rows_by_id[rid],
                    }
                    continue
                if rid in missing_or_denied:
                    resolved_map[key] = {
                        'status': 'missing_or_denied',
                        'error': 'Record not found or no access',
                        'data': None,
                    }
                    continue
                resolved_map[key] = {
                    'status': 'unresolved',
                    'error': 'Unable to resolve record',
                    'data': None,
                }

        items = []
        for ref in normalized_refs:
            model_name = ref['model']
            rid = ref['id']
            resolved = resolved_map.get((model_name, rid), {
                'status': 'unresolved',
                'error': 'Unable to resolve record',
                'data': None,
            })
            items.append({
                'model': model_name,
                'id': rid,
                'status': resolved['status'],
                'error': resolved['error'],
                'data': resolved['data'],
            })

        return {'items': items}
    
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
            execution_events = []
            node_outputs_map = {}
            executed_order = []
            executed_connections = []
            context_snapshot = result.get('context_snapshot') if isinstance(result, dict) else None
            if run_id:
                run = request.env['workflow.run'].browse(run_id)
                if run.exists():
                    executed_connections = run.executed_connections or []
                    run_result_data = self._collect_run_node_results(run)
                    node_results = run_result_data['node_results']
                    execution_events = run_result_data['execution_events']
                    node_outputs_map = run_result_data['node_outputs_map']
                    executed_order = run_result_data['executed_order']
                    
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
                execution_events=execution_events,
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
        
        run_result_data = self._collect_run_node_results(run)
        node_results = run_result_data['node_results']
        execution_events = run_result_data['execution_events']
        executed_order = run_result_data['executed_order']
        node_outputs_map = run_result_data['node_outputs_map']
        executed_connections = run.executed_connections or []
        
        workflow = run.workflow_id
        context_snapshot = ContextSnapshotSchema(
            json=run.output_data,
            node=node_outputs_map,
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
            execution_events=execution_events,
            context_snapshot=context_snapshot,
            executed_snapshot=run.executed_snapshot or {},
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