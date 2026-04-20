# ADR-013: Production-Safe and Business-Safe Execution on Python + PostgreSQL

> Pragmatic resilience architecture for `workflow_studio` that adopts the most
> useful operational patterns from n8n and Camunda 8 while explicitly accepting
> the limits of Odoo/Python/PostgreSQL.

---

## Status

**Proposed 🟡**

---

## Context

`workflow_studio` already has solid foundations:

- snapshot-first execution from `published_snapshot`
- a stack-based executor (`ADR-001`)
- trigger-to-backend bridge records (`ADR-008`)
- zero-trust execution and masked observability (`ADR-005`)
- optional `queue_job` routing for some automated runs

However, the current runtime is not yet safe enough for high-value production
flows such as batch order processing, shipment booking, payment follow-up, or
any workflow where duplicate side effects create real business damage.

The current gap is not only "retries are missing". It is a broader mismatch
between:

1. **What the business needs**
   - production runs should survive worker crashes
   - batch workloads should not restart blindly from item 1
   - mutating side effects should be deduplicated or explicitly incident-managed
   - operators need a safe recovery path after outage or dependency failure

2. **What the current engine does**
   - `workflow.run` is persisted early, but most execution state lives in memory
   - `workflow.run.node` records are batch-persisted after the run, not as
     durable checkpoints during the run
   - `queue_job` can recover dead jobs, but re-execution currently restarts the
     workflow rather than resuming from a durable checkpoint
   - mutating nodes (`http`, `record_operation`, `code`) do not yet have a
     first-class idempotency / business-safety contract

### Failure scenarios that must be addressed

- one Odoo worker crashes while processing a run
- all app nodes/workers crash and later restart while large batch runs are in
  progress
- PostgreSQL stays durable, but the Python process memory is lost
- a downstream API is slow, flaky, or temporarily unavailable
- a webhook source retries the same delivery multiple times
- an operator retries a failed run without realizing side effects were already
  partially applied

### Deliberate platform constraints

This ADR accepts the real limits of the current foundation instead of pretending
that Odoo/Python/PostgreSQL is a full Temporal-like durable execution engine.

#### Constraint 1 — Python/Odoo is not a deterministic replay runtime

Arbitrary Python code nodes, custom nodes, and ORM side effects cannot be
paused and resumed at instruction-level precision. We can checkpoint **between
node boundaries**, not inside arbitrary Python execution.

#### Constraint 2 — PostgreSQL is both the durable store and the queue backbone

The system should remain PostgreSQL-backed and `queue_job`-compatible. This is
pragmatic and deployment-friendly, but it also means:

- write amplification matters
- lease/heartbeat design matters
- queue depth and worker concurrency must be managed intentionally

#### Constraint 3 — External side effects cannot be made exactly-once by magic

For HTTP APIs, emails, payments, and other remote operations, the realistic
guarantee is **at-least-once orchestration with idempotent or incident-managed
workers**, not exactly-once delivery.

#### Constraint 4 — Manual/debug execution remains a separate class of runtime

Preview/manual sync execution is useful for editor UX and debugging, but it is
not the production resilience path and must not be presented as such.

### Inspirations adopted from other engines

#### From n8n

- separate admission/control concerns from worker execution concerns
- fast-ack production webhooks after durable admission
- queue-backed production execution path
- operational worker health / readiness mindset

#### From Camunda 8 / Zeebe

- explicit worker lease / timeout thinking
- retry + backoff + incident model
- clear acknowledgment that job execution is **at-least-once**
- explicit requirement that side-effecting workers be idempotent

### Inspirations deliberately not adopted

- full deterministic replay / event-history execution semantics like Temporal
- external broker or separate workflow engine cluster as a hard requirement
- transparent resume from arbitrary instruction pointer inside Python code

---

## Decision

Adopt a **PostgreSQL-backed, queue-first, checkpointed execution architecture**
with explicit safety modes:

1. **Debug** — current manual/preview style, optimized for UX and iteration
2. **Production Safe** — operationally resilient, resumable at checkpoint
   boundaries, queue-first
3. **Business Safe** — production-safe plus explicit idempotency and business
   correlation for mutating side effects

The system will remain on Odoo/Python/PostgreSQL and will improve resilience by
adding leases, checkpoints, incidents, side-effect intents, and business-safe
admission rules instead of introducing a separate workflow engine product.

### 1. Add explicit execution safety modes

Introduce `resilience_mode` (or equivalent) at workflow level:

| Mode | Intended use | Admission path | Guarantees |
| --- | --- | --- | --- |
| `debug` | preview, manual operator testing | sync/manual allowed | no crash-resume guarantee |
| `production_safe` | automated production execution | queued only | durable admission, leases, checkpoint resume at node boundaries |
| `business_safe` | high-value mutating workloads | queued only | everything in production_safe + side-effect contracts and duplicate protection |

#### Mode rules

- `manual` and `preview` flows remain `debug`
- `schedule`, production `webhook`, and `record_event` executions default to
  queued admission in `production_safe` and `business_safe`
- synchronous `webhook` response mode `last_node` is treated as **debug/test
  only**, not as the resilient production path
- `rollback_on_failure=True` is incompatible with checkpointed production-safe
  execution and becomes a debug-only behavior

### 2. Split control-plane admission from worker-plane execution

Production runs must follow a **durable admission** step before any expensive
or side-effecting work begins.

#### Control plane responsibilities

- receive webhook / schedule / record-event trigger
- validate snapshot and start node
- create `workflow.run`
- assign `resilience_mode`
- persist admission metadata and enqueue execution job
- return fast acknowledgment where applicable

#### Worker plane responsibilities

- claim queued runs
- maintain heartbeat / lease
- execute nodes
- persist checkpoints
- update incidents / retries / completion state

This preserves the current hybrid trigger architecture from `ADR-008`, but
makes production execution explicitly **queue-first**, closer in spirit to n8n's
worker mode and Camunda's job-worker model.

### 3. Add lease + heartbeat semantics to `workflow.run`

`workflow.run` becomes the durable control record for in-flight work.

#### Add fields on `workflow.run`

| Field | Purpose |
| --- | --- |
| `resilience_mode` | `debug`, `production_safe`, `business_safe` |
| `worker_id` | logical worker/process identifier |
| `lease_expires_at` | worker claim timeout |
| `heartbeat_at` | last observed progress heartbeat |
| `recovery_count` | number of automated recoveries |
| `checkpoint_id` | latest durable checkpoint |
| `incident_id` | active incident reference |
| `admitted_at` | durable admission timestamp |
| `run_path` | `sync`, `queue`, `webhook_fast_ack`, etc. |

#### Lease rules

- worker claims a run by setting `worker_id`, `heartbeat_at`, and
  `lease_expires_at`
- worker refreshes lease periodically
- sweeper process detects expired leases
- expired leased runs are either requeued from latest checkpoint or moved to
  incident state depending on policy

This is the pragmatic Odoo/PostgreSQL equivalent of Camunda's worker timeout /
reassignment logic.

### 4. Add durable checkpoints at node boundaries, not inside arbitrary code

Introduce `workflow.run.checkpoint` as the durable resume unit.

#### Responsibilities

- persist latest committed execution boundary
- capture enough state to resume from the next eligible node
- store batch cursor progress for looped workloads
- separate "progress durable" from "output display"

#### Proposed shape

| Field | Purpose |
| --- | --- |
| `run_id` | parent run |
| `sequence` | monotonic checkpoint sequence |
| `node_id` | last durable node boundary |
| `checkpoint_kind` | `node`, `batch_cursor`, `wait_state`, `incident_barrier` |
| `status` | `active`, `superseded`, `replayed` |
| `input_ref` / `input_json` | durable resume input |
| `output_ref` / `output_json` | durable output snapshot |
| `vars_ref` / `vars_json` | workflow vars snapshot |
| `node_context_ref` / `node_context_json` | loop / node state snapshot |
| `resume_token_json` | worker-specific resume token |
| `batch_cursor_json` | current item cursor / chunk metadata |
| `created_at` | checkpoint time |

`*_ref` fields align with `ADR-009` once content-addressed storage is extended
to execution checkpoints. JSON fallback is acceptable in Phase A.

#### Checkpoint policy

- checkpoints are written after eligible node boundaries, not after every
  expression or internal stack mutation
- pure control/data nodes may checkpoint cheaply
- side-effecting nodes checkpoint before dispatch intent and after durable
  acknowledgment/outcome
- looped batch processing checkpoints the **cursor position**, not just the fact
  that the loop node executed

### 5. Introduce node safety classes and admission rules

All node types are not equally resumable or equally safe.

#### Safety classes

| Class | Examples | Resume policy | Business-safe policy |
| --- | --- | --- | --- |
| `pure` | `if`, `switch`, `validation`, `variable`, mapping-like nodes | replayable from checkpoint | allowed |
| `read_only` | search/read/poll/GET-style HTTP | retryable with backoff | allowed |
| `side_effecting` | POST/PUT/PATCH/DELETE HTTP, create/write/delete ORM | only with intent + idempotency contract | allowed with strict contract |
| `unsafe_custom` | `code`, `x_*` custom runtime by default | best-effort only at node boundary | blocked by default in business-safe mode |

#### Admission consequences

- `business_safe` workflows may only include `side_effecting` nodes when the
  node provides an explicit business key / idempotency strategy
- `code` / custom runtime nodes are not considered business-safe by default
- a workflow with unsafe nodes may still run in `production_safe`, but recovery
  semantics fall back to replay from the last checkpoint **before** the unsafe
  node

### 6. Add side-effect intent ledger for duplicate protection

Introduce `workflow.operation.intent` for any mutating effect that must be safe
to retry or recover.

This is the core business-safe addition.

#### Responsibilities

- allocate a durable operation key before dispatching side effects
- detect duplicates across retries, restarts, webhook redelivery, and operator
  retry
- record whether a side effect is merely prepared, dispatched, acknowledged,
  skipped as duplicate, or requires operator action
- provide a replay barrier for safe resend tools later

#### Proposed shape

| Field | Purpose |
| --- | --- |
| `run_id` | originating run |
| `checkpoint_id` | checkpoint associated with dispatch |
| `node_id` | originating node |
| `operation_kind` | `http_request`, `record_create`, `record_write`, etc. |
| `business_key` | durable business correlation key |
| `idempotency_key` | outbound dedupe key |
| `intent_status` | `prepared`, `dispatched`, `acknowledged`, `duplicate_skipped`, `failed`, `incident` |
| `request_signature` | normalized hash of intended operation |
| `external_ref` | provider/business response reference |
| `transaction_id` | optional link to `workflow.connector.transaction` |
| `exchange_id` | optional link to `workflow.http.exchange` |
| `error_message` | failure summary |

#### Business-safe rule

Mutating nodes in `business_safe` mode must provide at least one of:

- deterministic `business_key`
- explicit `idempotency_key`
- provider-native external reference correlation strategy

If none exists, admission must fail or the run must be downgraded explicitly by
operator choice.

### 7. Add incident model instead of silent orphaning

Introduce `workflow.incident` inspired by Camunda's explicit incident handling.

#### Responsibilities

- represent stuck runs and unresolved business safety conflicts
- make operator action first-class rather than hidden in logs
- separate retryable infrastructure failures from business ambiguity

#### Typical incident types

- `lease_expired`
- `checkpoint_resume_failed`
- `idempotency_conflict`
- `external_dependency_down`
- `unsafe_node_in_business_safe_run`
- `manual_resolution_required`

#### Resolution actions

- retry from latest checkpoint
- mark duplicate and continue
- rebind business key / external ref
- cancel run
- convert to manual operator workflow

### 8. Add explicit retry + backoff policies at node/workflow level

Current queue-level retry is not enough. The runtime needs workflow-aware retry
policy.

#### Add retry policy concepts

- `max_attempts`
- `backoff_strategy`: `fixed`, `linear`, `exponential`
- `backoff_seconds`
- `incident_after_attempt`
- `retry_scope`: `node` or `run`

#### Policy rules

- pure/read-only nodes may auto-retry
- side-effecting nodes may auto-retry only when idempotency contract is present
- otherwise they raise incident after first ambiguous failure

### 9. Add backpressure and concurrency controls

To stay safe on PostgreSQL and Odoo workers, the system must control admission
rate instead of only hoping the workers keep up.

#### Control points

- `queue_job` channel strategy by workload class
- per-workflow concurrency limits
- optional per-workspace/per-provider concurrency gates
- production webhook fast-ack after durable admission, not after full execution
- operator-visible queue lag and stale-run metrics

This pulls the most practical ideas from n8n worker mode without introducing a
separate broker requirement.

### 10. Observability must separate technical truth from business truth

The architecture distinguishes:

- **run state** → `workflow.run`
- **execution checkpoints** → `workflow.run.checkpoint`
- **technical events** → `workflow.run.node`, `workflow.http.exchange`,
  `ir.workflow.logging`
- **business truth** → `workflow.operation.intent`,
  `workflow.connector.transaction`

This extends the distinction already proposed in `ADR-012`: technical exchanges
are not enough to answer whether a business action is safe to retry.

---

## Guarantees and Non-Guarantees

### Guarantees this ADR targets

1. **Durable admission** for queued production executions
2. **No silent forever-running orphan** beyond lease expiry window
3. **Resume from latest durable checkpoint** for eligible nodes/workloads
4. **At-least-once orchestration** for queued production runs
5. **Business-safe duplicate protection** for mutating nodes only when an
   explicit idempotency contract exists

### Explicit non-guarantees

1. **No deterministic replay of arbitrary Python code**
2. **No exactly-once external side effects** as a platform guarantee
3. **No instruction-level resume inside `code` or custom nodes**
4. **No claim that sync/manual execution is HA-safe**
5. **No assumption that PostgreSQL alone can support infinite unbounded queue
   scale** without operational limits

---

## Consequences

### Positive

- realistic safety model for Odoo/Python/PostgreSQL instead of fantasy replay
- much better operator story during crashes, retries, and dependency outages
- batch workloads can resume from durable cursor checkpoints rather than from
  item 1
- side-effecting nodes become explicitly contract-driven instead of implicitly
  dangerous
- aligns trigger/runtime direction with n8n/Camunda practices while preserving
  current repository architecture

### Negative

- adds several new runtime concepts and models
- recovery logic becomes more opinionated and therefore more complex
- some workflows/nodes will be rejected from `business_safe` mode until they
  declare stronger contracts
- checkpoint commits mean global rollback semantics can no longer be the main
  safety story for production runs

### Neutral

- `ADR-001` stack executor remains, but it gains a durable boundary layer
- `queue_job` remains useful, but no longer represents the whole resilience
  story on its own
- connector-specific transaction/exchange models remain relevant and integrate
  naturally with the business-safe layer

---

## Alternatives Considered

### Option A: Keep current engine + minimal queue hardening

Add only stale-run cleanup and a few retries.

**Pros**:

- lowest implementation cost
- minimal schema churn

**Cons**:

- still restarts large batch runs from the beginning
- still weak on duplicate business side effects
- still leaves operators without a first-class incident model

### Option B: Build full Temporal-like durable replay on Odoo

Persist full event history and replay the workflow deterministically.

**Pros**:

- theoretically strongest recovery model

**Cons**:

- poor fit for arbitrary Python/Odoo execution and side effects
- high complexity and high semantic mismatch with current stack executor
- likely to create a half-Temporal that is expensive and still incomplete

### Option C: Introduce an external workflow engine immediately

Move orchestration to Zeebe/Temporal/Celery-like external infrastructure.

**Pros**:

- stronger dedicated orchestration/runtime guarantees

**Cons**:

- much larger deployment and product surface change
- duplicates current Odoo-native workflow effort
- not aligned with the near-term repository direction

### Selected approach

Choose a pragmatic middle path:

- keep Odoo/Python/PostgreSQL
- adopt queue-first production admission
- add leases, checkpoints, incidents, and idempotency contracts
- explicitly stop short of full deterministic replay

---

## Micro Tasks

The architecture above is only useful if it decomposes into small delivery
units. The following micro tasks are the implementation map.

### A. Safety mode and admission control

| ID | Task | Output | Dependency |
| --- | --- | --- | --- |
| `MT-013-001` | Add `resilience_mode` field to `ir.workflow` and expose it in admin/API | Workflow safety mode contract | None |
| `MT-013-002` | Introduce `run_path` classification on `workflow.run` (`sync`, `queue`, `webhook_fast_ack`, etc.) | Run path visibility | `MT-013-001` |
| `MT-013-003` | Force automated production triggers to queue-first admission in `production_safe` and `business_safe` modes | No sync production trigger path | `MT-013-001` |
| `MT-013-004` | Restrict production `webhook` to immediate ack after durable admission; keep `last_node` as debug/test-only | Safe webhook contract | `MT-013-003` |
| `MT-013-005` | Make `rollback_on_failure` incompatible with checkpointed modes and surface explicit validation error | Prevent false safety assumptions | `MT-013-001` |
| `MT-013-006` | Add admission validator that blocks `business_safe` workflows with unsupported node classes | Business-safe gatekeeping | `MT-013-001` |

### B. Durable lease and checkpointing

| ID | Task | Output | Dependency |
| --- | --- | --- | --- |
| `MT-013-101` | Add lease/heartbeat/recovery fields to `workflow.run` | Durable worker claim state | `MT-013-002` |
| `MT-013-102` | Implement worker claim + heartbeat refresh hook in queued execution path | Lease lifecycle | `MT-013-101` |
| `MT-013-103` | Create `workflow.run.checkpoint` model and admin/search views | Durable checkpoint storage | `MT-013-101` |
| `MT-013-104` | Persist node-boundary checkpoints for pure/read-only nodes | Basic resumability | `MT-013-103` |
| `MT-013-105` | Persist loop/batch cursor checkpoints (`item_index`, chunk, node context) | Batch resume foundation | `MT-013-104` |
| `MT-013-106` | Resume queued execution from latest active checkpoint instead of restarting from start node | Resume semantics | `MT-013-104`,`MT-013-105` |
| `MT-013-107` | Add stale-run sweeper that converts expired leases into requeue or incident transitions | No silent orphaned runs | `MT-013-102` |
| `MT-013-108` | Integrate checkpoint payload storage with ADR-009 refs where available, JSON fallback otherwise | Storage compatibility | `MT-013-103` |

### C. Node safety classes and side-effect intent ledger

| ID | Task | Output | Dependency |
| --- | --- | --- | --- |
| `MT-013-201` | Add node safety classification metadata (`pure`, `read_only`, `side_effecting`, `unsafe_custom`) to runtime registry / `workflow.type` | Admission/runtime policy input | `MT-013-006` |
| `MT-013-202` | Create `workflow.operation.intent` model with unique business/idempotency keys | Side-effect ledger | `MT-013-201` |
| `MT-013-203` | Extend `http` runner to support explicit idempotency/business key config | Business-safe HTTP contract | `MT-013-202` |
| `MT-013-204` | Extend `record_operation` runner with idempotent mutation contract or explicit business-key policy | Business-safe ORM mutation contract | `MT-013-202` |
| `MT-013-205` | Persist "prepared → dispatched → acknowledged" lifecycle around mutating nodes | Safe retry boundary | `MT-013-203`,`MT-013-204` |
| `MT-013-206` | Skip or incident duplicate side effects based on existing intent state instead of re-dispatching blindly | Duplicate protection | `MT-013-205` |
| `MT-013-207` | Integrate connector-aware runs with `workflow.connector.transaction` and `workflow.http.exchange` from ADR-012 | Connector business safety | `MT-013-205` |
| `MT-013-208` | Block `code` / `x_*` unsafe nodes in `business_safe` mode unless an explicit waiver mechanism exists | Unsafe-node containment | `MT-013-201` |

### D. Retry, incident, and operator recovery

| ID | Task | Output | Dependency |
| --- | --- | --- | --- |
| `MT-013-301` | Create `workflow.incident` model and link it to `workflow.run` / checkpoints / intents | First-class incident tracking | `MT-013-107` |
| `MT-013-302` | Add retry policy schema (`max_attempts`, `backoff_strategy`, `backoff_seconds`) at workflow/node level | Workflow-aware retry policy | `MT-013-201` |
| `MT-013-303` | Implement auto-retry for pure/read-only nodes with backoff | Safe infra retry | `MT-013-302` |
| `MT-013-304` | Route ambiguous side-effect failures to incident instead of silent automatic replay | Business-safe failure handling | `MT-013-205`,`MT-013-301` |
| `MT-013-305` | Add operator actions: retry from checkpoint, mark duplicate and continue, cancel run | Human recovery workflow | `MT-013-301` |
| `MT-013-306` | Add incident timeline view combining run, checkpoint, intent, and exchange evidence | Operability | `MT-013-301`,`MT-013-207` |

### E. Queue, concurrency, and observability hardening

| ID | Task | Output | Dependency |
| --- | --- | --- | --- |
| `MT-013-401` | Add queue channel strategy for workload classes (lightweight, batch, connector, webhook) | Controlled worker isolation | `MT-013-003` |
| `MT-013-402` | Use `queue_job` identity keys for workflow launch dedupe where applicable | Admission duplicate reduction | `MT-013-003` |
| `MT-013-403` | Add per-workflow/per-workspace concurrency configuration and enforcement | Backpressure gate | `MT-013-401` |
| `MT-013-404` | Expose worker health, queue lag, stale-run count, and incident count in monitoring/dashboard | Runtime health visibility | `MT-013-107`,`MT-013-301` |
| `MT-013-405` | Add webhook admission metrics (received, admitted, deduped, incidented) | Webhook ops visibility | `MT-013-004`,`MT-013-402` |
| `MT-013-406` | Ensure all sensitive incident/intent/exchange payloads follow ADR-005 masking rules | Security parity | `MT-013-207`,`MT-013-301` |

### F. Validation and rollout

| ID | Task | Output | Dependency |
| --- | --- | --- | --- |
| `MT-013-501` | Add crash simulation tests for queued runs interrupted between checkpoints | Recovery regression coverage | `MT-013-106` |
| `MT-013-502` | Add duplicate side-effect tests for HTTP and ORM mutation nodes | Business-safe regression coverage | `MT-013-206` |
| `MT-013-503` | Add webhook redelivery tests for fast-ack queued production mode | Webhook safety validation | `MT-013-004`,`MT-013-402` |
| `MT-013-504` | Add incident resolution tests covering retry/continue/cancel operator paths | Operator safety validation | `MT-013-305` |
| `MT-013-505` | Document runtime limits and operator playbooks for outage recovery | Operational readiness | `MT-013-404`,`MT-013-305` |
| `MT-013-506` | Roll out in order: `production_safe` first, `business_safe` second, unsafe-node gating third | Controlled adoption | All above |

---

## References

- `workflow_studio/models/ir_workflow.py`
- `workflow_studio/models/workflow_executor.py`
- `workflow_studio/models/workflow_run.py`
- `workflow_studio/controllers/main.py`
- `workflow_studio_queue_job/models/ir_workflow.py`
- `workflow_studio_queue_job/models/workflow_run.py`
- `workflow_studio_queue_job/models/queue_job.py`
- `queue/queue_job/job.py`
- `queue/queue_job/jobrunner/runner.py`
- [ADR-001](./001-execution-engine.md)
- [ADR-005](./005-zero-trust-polp.md)
- [ADR-008](./008-hybrid-trigger-architecture.md)
- [ADR-009](./009-content-addressed-storage.md)
- [ADR-012](./012-workflow-connector-transaction-and-exchange-lifecycle.md)
- Temporal docs: Workflow Execution / Detecting Workflow Failures / Activity Execution
- Camunda 8 docs: Job Workers / Incidents / Service Tasks
- n8n docs: Queue Mode / Multi-Main / Webhook Processors

---

## Metadata

| Field | Value |
| --- | --- |
| **Date** | 2026-04-19 |
| **Reviewers** | - |
| **Related ADRs** | ADR-001, ADR-005, ADR-008, ADR-009, ADR-012 |
| **Related Tasks** | Resilience hardening, batch safety, queue hardening, incident management |