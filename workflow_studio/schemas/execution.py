# -*- coding: utf-8 -*-
"""
Execution Result Schemas

Lightweight schema classes for workflow execution responses.
Uses dataclasses with Pydantic-compatible API (no external dependencies).

Usage:
    from workflow_studio.schemas import ExecutionResultSchema
    
    result = ExecutionResultSchema(
        status='completed',
        run_id=123,
        node_results=[...],
    )
    return result.model_dump()
"""

from dataclasses import dataclass, field, asdict
from datetime import datetime
from typing import Any, Dict, List, Optional


def _normalize_false(value):
    """Convert Odoo False to None."""
    return None if value is False else value


@dataclass
class NodeResultSchema:
    """Individual node execution result."""
    
    node_id: str
    node_run_id: Optional[int] = None
    node_type: Optional[str] = None
    node_label: Optional[str] = None
    sequence: Optional[int] = None
    iteration: Optional[int] = None
    status: str = "completed"
    duration_ms: Optional[float] = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    input_data: Any = None
    output_data: Any = None
    output_socket: Optional[str] = None
    error_message: Optional[str] = None
    title: Optional[str] = None
    meta: Optional[Dict[str, Any]] = None
    
    def __post_init__(self):
        self.error_message = _normalize_false(self.error_message)
        self.input_data = _normalize_false(self.input_data)
        self.output_data = _normalize_false(self.output_data)
        self.started_at = _normalize_false(self.started_at)
        self.completed_at = _normalize_false(self.completed_at)
    
    def model_dump(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class ContextSnapshotSchema:
    """Execution context snapshot at target node."""
    
    json: Any = None
    node: Dict[str, Any] = field(default_factory=dict)
    vars: Dict[str, Any] = field(default_factory=dict)
    node_context: Dict[str, Any] = field(default_factory=dict)
    execution: Optional[Dict[str, Any]] = None
    workflow: Optional[Dict[str, Any]] = None
    now: Optional[str] = None
    today: Optional[str] = None
    
    def model_dump(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class ExecutionResultSchema:
    """Unified execution result for /execute and /execute_until."""
    
    # Status
    status: str = "pending"
    error: Optional[str] = None
    error_node_id: Optional[str] = None
    
    # Identification
    run_id: Optional[int] = None
    run_name: Optional[str] = None
    
    # Execution metadata
    execution_mode: Optional[str] = None
    queue_job_uuid: Optional[str] = None
    queue_job_state: Optional[str] = None
    queue_can_cancel: Optional[bool] = None
    target_node_id: Optional[str] = None
    execution_count: Optional[int] = None
    node_count_executed: Optional[int] = None
    duration_seconds: Optional[float] = None
    executed_order: List[str] = field(default_factory=list)
    executed_connection_ids: List[str] = field(default_factory=list)
    executed_connections: List[Dict[str, Any]] = field(default_factory=list)
    
    # Data
    input_data: Dict[str, Any] = field(default_factory=dict)
    output_data: Any = None
    
    # Node results
    node_results: List[NodeResultSchema] = field(default_factory=list)
    execution_events: List[NodeResultSchema] = field(default_factory=list)
    node_outputs: Optional[Dict[str, Any]] = None
    
    # Context snapshot
    context_snapshot: Optional[ContextSnapshotSchema] = None
    
    # Executed snapshot (workflow graph at execution time)
    executed_snapshot: Optional[Dict[str, Any]] = None
    
    # Timestamp
    updated_at: Optional[str] = None
    
    def __post_init__(self):
        self.error = _normalize_false(self.error)
    
    def model_dump(self) -> Dict[str, Any]:
        data = {
            'status': self.status,
            'error': self.error,
            'error_node_id': self.error_node_id,
            'run_id': self.run_id,
            'run_name': self.run_name,
            'target_node_id': self.target_node_id,
            'execution_mode': self.execution_mode,
            'queue_job_uuid': self.queue_job_uuid,
            'queue_job_state': self.queue_job_state,
            'queue_can_cancel': self.queue_can_cancel,
            'execution_count': self.execution_count,
            'node_count_executed': self.node_count_executed,
            'duration_seconds': self.duration_seconds,
            'executed_order': self.executed_order,
            'executed_connection_ids': self.executed_connection_ids,
            'executed_connections': self.executed_connections,
            'input_data': self.input_data,
            'output_data': self.output_data,
            'node_results': [
                nr.model_dump() if hasattr(nr, 'model_dump') else nr
                for nr in self.node_results
            ],
            'execution_events': [
                nr.model_dump() if hasattr(nr, 'model_dump') else nr
                for nr in self.execution_events
            ],
            'node_outputs': self.node_outputs,
            'context_snapshot': (
                self.context_snapshot.model_dump() 
                if self.context_snapshot and hasattr(self.context_snapshot, 'model_dump')
                else self.context_snapshot
            ),
            'executed_snapshot': self.executed_snapshot,
            'updated_at': self.updated_at or datetime.now().isoformat(),
        }
        return data


@dataclass
class ExecutionErrorSchema:
    """Error response schema."""
    
    error: str
    status: str = "failed"
    error_node_id: Optional[str] = None
    run_id: Optional[int] = None
    
    def model_dump(self) -> Dict[str, Any]:
        return asdict(self)
