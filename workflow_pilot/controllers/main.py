# -*- coding: utf-8 -*-

"""
Workflow Pilot Controllers

Provides HTTP endpoints for workflow execution.
"""

import logging

from odoo import http
from odoo.http import request

_logger = logging.getLogger(__name__)


class WorkflowPilotController(http.Controller):
    """Controller for workflow execution endpoints."""
    
    @http.route('/workflow_pilot/execute', type='json', auth='user', methods=['POST'])
    def execute_workflow(self, workflow_id=None, input_data=None, **kwargs):
        """Execute a published workflow.
        
        Args:
            workflow_id: Database ID of workflow to execute
            input_data: Optional input data for workflow
            
        Returns:
            dict with run_id, status, output_data
            
        Raises:
            UserError if workflow not found or not published
        """
        payload = request.jsonrequest or {}
        if workflow_id is None:
            workflow_id = payload.get('workflow_id')
        if input_data is None:
            input_data = payload.get('input_data', {})

        if workflow_id is None:
            return {'error': 'Workflow ID is required'}

        workflow_id = int(workflow_id)
        workflow = request.env['ir.workflow'].browse(workflow_id)
        if not workflow.exists():
            return {'error': 'Workflow not found'}
        
        try:
            result = workflow.execute_workflow(input_data or {})
            return result
        except Exception as e:
            _logger.exception(f"Workflow execution failed: {workflow_id}")
            return {
                'error': str(e),
                'status': 'failed',
            }
    
    @http.route('/workflow_pilot/run/<int:run_id>', type='json', auth='user', methods=['GET'])
    def get_run(self, run_id):
        """Get workflow run details.
        
        Args:
            run_id: Database ID of workflow run
            
        Returns:
            dict with run details including node results
        """
        run = request.env['workflow.run'].browse(run_id)
        if not run.exists():
            return {'error': 'Run not found'}
        
        node_results = []
        for node_run in run.node_run_ids:
            node_results.append({
                'node_id': node_run.node_id,
                'node_type': node_run.node_type,
                'node_label': node_run.node_label,
                'status': node_run.status,
                'duration_ms': node_run.duration_ms,
                'output_data': node_run.output_data,
                'error_message': node_run.error_message,
            })
        
        return {
            'id': run.id,
            'name': run.name,
            'workflow_id': run.workflow_id.id,
            'status': run.status,
            'started_at': run.started_at.isoformat() if run.started_at else None,
            'completed_at': run.completed_at.isoformat() if run.completed_at else None,
            'duration_seconds': run.duration_seconds,
            'input_data': run.input_data,
            'output_data': run.output_data,
            'error_message': run.error_message,
            'error_node_id': run.error_node_id,
            'node_count_executed': run.node_count_executed,
            'node_results': node_results,
        }
