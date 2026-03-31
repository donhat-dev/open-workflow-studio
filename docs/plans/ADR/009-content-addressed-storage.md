# ADR-009: Content-Addressed Storage for Workflow Data Deduplication

---

## Status

**Accepted**

---

## Context

Current workflow execution relies on passing deep copies of full JSON payload objects between nodes via the `WorkflowExecutor` stack and storing them directly in `WorkflowRunNode` (`input_data`, `output_data`). 

When a workflow runs at high scale (e.g., 15k orders/day, 5k peak/hour async via `queue_job`), passing a 100KB payload through 5 sequentially chained nodes creates 5 redundant copies in memory (~500KB RAM overhead per run), not including snapshot strings and database overhead. This causes:
1. **Severe Python Worker RAM Bloat**: High risk of OS Out-of-Memory (OOM) errors leading to worker restarts.
2. **Massive Disk Space / I/O Usage**: Writing deeply nested, redundant JSON string values multiple times to `workflow.run.node` and `workflow.node.output` rapidly consumes PostgreSQL storage.
3. **Execution Delay**: Serializing and deserializing mega-payloads (especially when rendering the graph or computing expressions) locks up CPU blocking I/O bound execution.

To support production-grade workloads, we need a mechanism to efficiently refer to identical payload instances without repeatedly moving, parsing, or persisting the entire data volume.

---

## Decision

We will implement a **Content-Addressed Storage (CAS)** architecture using SHA-256 hash dictionaries to deduplicate workflow data. To minimize immediate disruption and enable iterative delivery, this will be executed in a three-stage Evolution Path (A -> B -> C):

### Phase A: In-Memory Deduplication (Runtime/RAM Optimization)
- Intercept node outputs immediately during `_execute_node`.
- Store the payload exactly once in an in-memory `OutputStore` dictionary (e.g., `{ 'sha256-hash-xyz': {...} }`).
- Within the `WorkflowExecutor` stack, pass only string hash reference keys instead of deep copy objects.
- *Persistence remains unchanged*: When persisting via `_persist_all_node_runs`, hash keys are resolved back into full JSON strings to preserve DB compatibility temporarily.

### Phase B: Database-Level Deduplication (Disk/IO Optimization)
- Introduce a new central payload table: `workflow.run.data`.
- Change fields in `workflow.run.node` to act as logical pointers: remove `input_data` and `output_data` text fields, replace them with `input_ref` and `output_ref` (storing the SHA-256 keys).
- The `OutputStore` flushes directly to `workflow.run.data` precisely once at the end of the run.
- Employ Odoo computed fields (e.g., `_compute_input_data`) dynamically fetching records from `workflow.run.data` ensuring backward compatibility for the existing frontend views.

### Phase C: Lazy Context Resolution & Snapshot Compression (Full-stack Optimization)
- Enhance the `ExecutionContext` for expression engine evaluation (`safe_eval`) by using a Proxied Lazy Loader so `{{ _node.node_A.json }}` resolves from the DB (or in-memory cache) only when actually evaluated.
- Convert Graph Editor communication from a flat full-snapshot string to a normalized dictionary architecture: `{ "data_store": { "hash1": ... }, "nodes": {"NodeA": "hash1"} }`.
- Frontend performs map-resolving dynamically, reducing CPU/network starvation over websockets/HTTP.

---

## Consequences

### Positive
- **RAM footprint shrinks substantially (~80% reduction)** for multi-node tasks manipulating the same root object.
- **Disk I/O latency drops aggressively** during massive asynchronous throughput, enabling seamless DB scaling.
- Provides a clean separation between logical workflow state structure and raw business data storage points.
- Extensively improves Expression Engine evaluation time (lazy-loading implies untouched references aren't parsed).

### Negative
- **Traceability complexity:** Direct generic SQL querying `SELECT input_data FROM workflow_run_node` will no longer display human-readable JSON payloads automatically (unless using the computed field via ORM).
- **Migration overhead:** Implementation of Phase B might require converting historical redundant table data to the normalized format.

### Neutral
- Modifies how `WorkflowExecutor` handles object mutability; developers must strictly treat returned JSON hash data as read-only invariants.

---

## Alternatives Considered

### Option A: Retaining deep copies but using Python's GC optimizations
*Relying on Python `id()` and GC tricks instead of explicit explicit Hash map.*

**Pros**:
- Near zero development effort.

**Cons**:
- Doesn't persist to the DB. Fails to resolve Disk I/O bottlenecks and scale limitations. Still encounters string serialization duplication during context logging.

### Option B: M2M Relational Tables mapped by PostgreSQL
*Use standard One2Many / Many2Many properties between Nodes and Payload records rather than explicit SHA-256 mapping.*

**Pros**:
- Handled natively by standard Odoo ORM relations.

**Cons**:
- Odoo M2M insert/query penalties heavily reduce fast hot-path pipeline execution speed. Strict content-addressed hash strings provide direct O(1) deduplication explicitly at the application level before even hitting PostgreSQL.

---

## References

- [ADR-001: Execution Engine Architecture](./001-execution-engine.md)
- [ADR-002: Node Output Storage Format](./002-node-output-format.md)
- Memory reference: `/memories/repo/deduplication-roadmap.json`

---

## Metadata

| Field | Value |
|-------|-------|
| **Date** | 2026-03-30 |
| **Author** | Copilot (Architecture) |
| **Reviewers** | User |
| **Related ADRs** | ADR-001, ADR-002 |
| **Related Tasks** | N/A |
