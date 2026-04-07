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

from dataclasses import asdict, dataclass, field
from datetime import datetime
from typing import Any


def _normalize_false(value):
    """Convert Odoo False to None."""
    return None if value is False else value


@dataclass
class NodeResultSchema:
    """Individual node execution result."""

    node_id: str
    node_run_id: int | None = None
    node_type: str | None = None
    node_label: str | None = None
    sequence: int | None = None
    iteration: int | None = None
    status: str = "completed"
    duration_ms: float | None = None
    started_at: str | None = None
    completed_at: str | None = None
    input_data: Any = None
    output_data: Any = None
    output_socket: str | None = None
    error_message: str | None = None
    title: str | None = None
    meta: dict[str, Any] | None = None

    def __post_init__(self):
        self.error_message = _normalize_false(self.error_message)
        self.input_data = _normalize_false(self.input_data)
        self.output_data = _normalize_false(self.output_data)
        self.started_at = _normalize_false(self.started_at)
        self.completed_at = _normalize_false(self.completed_at)

    def model_dump(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class ContextSnapshotSchema:
    """Execution context snapshot at target node."""

    json: Any = None
    node: dict[str, Any] = field(default_factory=dict)
    vars: dict[str, Any] = field(default_factory=dict)
    node_context: dict[str, Any] = field(default_factory=dict)
    execution: dict[str, Any] | None = None
    workflow: dict[str, Any] | None = None
    now: str | None = None
    today: str | None = None

    def model_dump(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class ExecutionResultSchema:
    """Unified execution result for /execute and /execute_until."""

    # Status
    status: str = "pending"
    error: str | None = None
    error_node_id: str | None = None

    # Identification
    run_id: int | None = None
    run_name: str | None = None

    # Execution metadata
    execution_mode: str | None = None
    queue_job_uuid: str | None = None
    queue_job_state: str | None = None
    queue_can_cancel: bool | None = None
    target_node_id: str | None = None
    execution_count: int | None = None
    node_count_executed: int | None = None
    duration_seconds: float | None = None
    executed_order: list[str] = field(default_factory=list)
    executed_connection_ids: list[str] = field(default_factory=list)
    executed_connections: list[dict[str, Any]] = field(default_factory=list)

    # Data
    input_data: dict[str, Any] = field(default_factory=dict)
    output_data: Any = None

    # Node results
    node_results: list[NodeResultSchema] = field(default_factory=list)
    execution_events: list[NodeResultSchema] = field(default_factory=list)
    node_outputs: dict[str, Any] | None = None

    # Context snapshot
    context_snapshot: ContextSnapshotSchema | None = None

    # Executed snapshot (workflow graph at execution time)
    executed_snapshot: dict[str, Any] | None = None

    # Timestamp
    updated_at: str | None = None

    def __post_init__(self):
        self.error = _normalize_false(self.error)

    def model_dump(self) -> dict[str, Any]:
        data = {
            "status": self.status,
            "error": self.error,
            "error_node_id": self.error_node_id,
            "run_id": self.run_id,
            "run_name": self.run_name,
            "target_node_id": self.target_node_id,
            "execution_mode": self.execution_mode,
            "queue_job_uuid": self.queue_job_uuid,
            "queue_job_state": self.queue_job_state,
            "queue_can_cancel": self.queue_can_cancel,
            "execution_count": self.execution_count,
            "node_count_executed": self.node_count_executed,
            "duration_seconds": self.duration_seconds,
            "executed_order": self.executed_order,
            "executed_connection_ids": self.executed_connection_ids,
            "executed_connections": self.executed_connections,
            "input_data": self.input_data,
            "output_data": self.output_data,
            "node_results": [
                nr.model_dump() if hasattr(nr, "model_dump") else nr
                for nr in self.node_results
            ],
            "execution_events": [
                nr.model_dump() if hasattr(nr, "model_dump") else nr
                for nr in self.execution_events
            ],
            "node_outputs": self.node_outputs,
            "context_snapshot": (
                self.context_snapshot.model_dump()
                if self.context_snapshot
                and hasattr(self.context_snapshot, "model_dump")
                else self.context_snapshot
            ),
            "executed_snapshot": self.executed_snapshot,
            "updated_at": self.updated_at or datetime.now().isoformat(),
        }
        return data


@dataclass
class ExecutionErrorSchema:
    """Error response schema."""

    error: str
    status: str = "failed"
    error_node_id: str | None = None
    run_id: int | None = None

    def model_dump(self) -> dict[str, Any]:
        return asdict(self)
