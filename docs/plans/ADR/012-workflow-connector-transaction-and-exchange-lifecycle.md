# ADR-012: Workflow Connector Transaction and Exchange Lifecycle

> Proposed runtime correlation, technical logging, and vertical-extension boundary for connector workflows

---

## Status

**Proposed 🟡**

---

## Context

The research exposed a critical distinction that a connector architecture must
respect:

- **technical exchanges** (HTTP calls, webhooks, retries, responses)
- **business transactions** (the long-lived external object being created,
  updated, tracked, cancelled, settled, or reconciled)

The `tangerine` design separates these concerns clearly:

- `carrier.ref.order` is a business correlation record
- `delivery.webhook.log` is an audit/technical record
- `cod.reconciliation` is a settlement extension layered on top of those records

By contrast, `workflow_studio` currently tracks execution at the workflow and
node-run level, but it does not yet have a connector-native concept for:

- correlating a remote object across multiple runs and webhook events
- storing external references and mapped lifecycle status separately from raw
  HTTP logs
- tracking remote webhook subscriptions or registration state

Execution logs alone are not enough. A connector may:

- create an external order in one run
- receive multiple webhook callbacks later
- update costs or states after the original run has finished
- require later cancellation, re-sync, or settlement reconciliation

That lifecycle needs records beyond `workflow.run` and beyond a generic HTTP log.

---

## Decision

Adopt a **dual-record runtime architecture**:

1. `workflow.connector.transaction` for long-lived business correlation
2. `workflow.http.exchange` for technical request/response logging

Keep vertical concerns such as service catalogs, label printing, and financial
reconciliation outside the connector core unless the pattern stabilizes across
multiple domains.

### 1. Add `workflow.connector.transaction` as the business correlation record

This model is the connector-core equivalent of `carrier.ref.order`.

#### Responsibilities

- bind internal business records to external system references
- preserve the lifecycle of a remote object across multiple workflow runs
- hold normalized state and key operational metadata
- act as the lookup anchor for inbound webhooks and later follow-up actions

#### Proposed shape

| Field | Purpose |
| --- | --- |
| `workspace_id` | Connector scope |
| `workflow_id` | Origin workflow |
| `node_id` / `request_id` | Origin connector node / bridge record |
| `company_id` | Company scope |
| `internal_model`, `internal_res_id` | Linked Odoo business record |
| `external_ref` | Provider-side ID / tracking ref / order ref |
| `external_parent_ref` | Optional parent or grouping ref |
| `transaction_type` | `order`, `shipment`, `invoice`, `customer`, `sync_job`, etc. |
| `remote_status` | Latest provider-native status |
| `mapped_status` | Normalized canonical status |
| `request_payload_summary` | Summary of originating payload |
| `response_payload_summary` | Summary of latest response |
| `amount_total`, `shipping_fee`, `cod_amount`, `currency_id` | Operational amounts |
| `meta_json` | Provider-specific metadata |
| `last_inbound_at`, `last_outbound_at` | Lifecycle timing |
| `active` | Archive support |

#### Transaction creation lifecycle

Transactions are **not auto-created** for every connector call. Creation triggers:

1. **Explicit node configuration**: `connector_request` node with
   `create_transaction=True` flag in config
2. **Response-based creation**: when `external_ref` is first obtained from a
   `create`-category endpoint response
3. **Webhook correlation**: when an inbound webhook references an unknown
   `external_ref`, optionally create a stub transaction for later enrichment
4. **Manual/API creation**: via backend UI or programmatic call

**When NOT to create**:

- idempotent status checks (use exchange log only)
- quote/rate requests that don't result in a remote object
- auth token refreshes

#### Transaction state transitions

```
[created] -> [confirmed] -> [in_progress] -> [completed]
                 |                |               |
                 v                v               v
             [cancelled]     [failed]        [settled]
```

State transitions are driven by:
- mapped status updates from response payloads
- inbound webhook events
- manual intervention

#### Usage examples

- shipping order / tracking ref lifecycle
- marketplace order sync lifecycle
- CRM lead sync correlation
- payment intent or invoice sync state

### 2. Add `workflow.http.exchange` as the technical exchange log

This model captures individual request/response events and webhook events.

It is intentionally not the business source of truth.

#### Responsibilities

- store masked request/response material for diagnosis
- capture success/failure/duration/correlation IDs
- link technical events to both runs and transactions
- support observability, support workflows, and replay tooling later

#### Proposed shape

| Field | Purpose |
| --- | --- |
| `workspace_id` | Connector scope |
| `transaction_id` | Optional business transaction link |
| `http_request_id` | Optional node bridge link |
| `workflow_run_id`, `workflow_run_node_id` | Execution linkage |
| `direction` | `outbound`, `inbound` |
| `request_url` | Effective URL |
| `method` | HTTP verb |
| `request_headers_display` | Masked headers |
| `request_body_display` | Masked request body |
| `response_status_code` | HTTP response code |
| `response_headers_display` | Masked headers |
| `response_body_display` | Masked response body |
| `duration_ms` | Timing |
| `success` | Summary flag |
| `error_message` | Failure summary |
| `correlation_id` | Cross-event correlation key |
| `remote_id` | Remote request/event ID if known |
| `created_at` | Event timestamp |

#### Exchange volume management and retention policy

Exchanges can accumulate rapidly in high-volume connector scenarios. The design
must address retention:

**Phase A — soft limits**:

- exchanges older than `N` days (configurable, default 90) eligible for archival
- background cron job marks old exchanges as `archived=True`
- archived exchanges excluded from default list views, still queryable

**Phase B — hard limits**:

- optional auto-delete for exchanges older than `M` days (configurable, default 365)
- compressed export to external storage before deletion (optional)
- transaction records retained longer than raw exchanges

**Index strategy**:

- composite index on `(workspace_id, created_at)` for time-range queries
- partial index on `success=False` for failure diagnostics
- index on `transaction_id` for correlation lookups

#### Run linkage field naming

Use consistent naming with existing `workflow.run` patterns:

- `run_id` → Many2one to `workflow.run` (not `workflow_run_id`)
- `run_node_id` → char field storing graph node ID within that run

### 3. Technical logs must mask secrets and align with existing security rules

Connector logging must not create a new raw-secret leak path.

Therefore:

- request/response display fields must store masked data by default
- secret resolution continues through `SecretBroker`
- if raw payload retention is ever introduced, it must follow the same
  privilege boundary style already used by `workflow.node.output`
- access to sensitive exchange data should be auditable via
  `ir.workflow.logging`

### 4. Webhook registration may be promoted to `workflow.webhook.subscription`

Some connectors need a durable backend record for remote subscription state:

- local callback URL
- auth token / registration token metadata
- remote subscription ID
- registered events
- last verification / refresh timestamps

This is optional in Phase A, but the core architecture should leave room for a
future `workflow.webhook.subscription` model rather than forcing webhook
registration state into ad-hoc JSON blobs.

### 5. Core connector architecture stops short of service catalogs and settlement

The research found reusable ideas in service catalogs and reconciliation, but
those concerns remain too provider- and domain-specific to force into the core
connector abstraction immediately.

#### Keep outside core for now

- shipping service catalogs (`viettelpost.service`, `lalamove.service`,
  `lalamove.special.service`)
- regional presets (`lalamove.regional`)
- label printing workflows
- COD / settlement reconciliation parsers and line imports

These should be implemented as **vertical modules** on top of the connector
foundation when at least two domains justify the same abstraction.

### 6. Connector lifecycle should be phased

#### Phase A — minimum runtime observability

- `workflow.connector.transaction`
- `workflow.http.exchange`
- run/node linkage from outbound connector calls
- inbound webhook correlation helpers

#### Phase B — subscription management

- optional `workflow.webhook.subscription`
- remote registration state and health tracking

#### Phase C — replay / support tooling

- filtered exchange views
- transaction timeline UI
- safe replay / resend actions for idempotent operations

#### Phase D — vertical extensions

- service catalogs
- settlement / reconciliation
- label/document plugins
- provider-specific dashboards

---

## Consequences

### Positive

- clean separation between business lifecycle records and technical logs
- enables inbound webhook correlation after the originating workflow run is long
  finished
- gives support/debugging a dedicated technical event trail
- provides a stable home for future reconciliation and settlement extensions

### Negative

- more models, indexes, and retention policies to maintain
- duplicated-looking data across runs, transactions, and exchanges must be kept
  intentionally scoped
- replay/resend tooling will require careful idempotency design later

### Neutral

- not every connector needs all lifecycle records immediately
- some providers may use only exchanges at first and add transactions once
  business correlation becomes necessary

---

## Alternatives Considered

### Option A: Rely only on `workflow.run` and `workflow.run.node`

Use existing execution history as the only audit and lifecycle record.

**Pros**:

- no new models
- execution history already exists

**Cons**:

- weak fit for webhook callbacks arriving long after original runs
- poor business correlation for remote objects
- mixes workflow execution history with connector lifecycle state

### Option B: Store only technical exchange logs

Log all HTTP/webhook traffic but skip a transaction model.

**Pros**:

- simpler than introducing two record classes
- sufficient for low-value debugging cases

**Cons**:

- no durable business correlation object
- harder to map remote lifecycle into Odoo state
- weak foundation for reconciliation and support dashboards

### Option C: Genericize service catalogs and reconciliation immediately

Build a large connector core that already includes catalog sync and settlement.

**Pros**:

- ambitious all-in-one abstraction
- may reduce later model churn if the abstraction is correct

**Cons**:

- high risk of overfitting Phase A to shipping-specific patterns
- much larger implementation scope before first connector is useful
- weaker clarity around what belongs to the connector core

---

## References

- `tangerine_delivery_base/models/carrier_ref_order.py`
- `tangerine_delivery_base/models/delivery_webhook_log.py`
- `tangerine_delivery_base/models/cod_reconciliation.py`
- `tangerine_delivery_viettelpost/controllers/tracking_webhook.py`
- `tangerine_delivery_lalamove/controllers/tracking_webhook.py`
- `workflow_studio/models/workflow_run.py`
- `workflow_studio/models/workflow_node_output.py`
- `workflow_studio/models/ir_logging_workflow.py`
- [ADR-005](./005-zero-trust-polp.md)
- [ADR-008](./008-hybrid-trigger-architecture.md)
- [ADR-010](./010-workflow-connector-workspace-and-node-bridge-architecture.md)
- [ADR-011](./011-workflow-connector-mapping-presets-and-canonical-translation.md)

---

## Metadata

| Field | Value |
| --- | --- |
| **Date** | 2026-04-15 |
| **Author** | GitHub Copilot |
| **Reviewers** | - |
| **Related ADRs** | ADR-005, ADR-008, ADR-010, ADR-011 |
| **Related Tasks** | Connector runtime correlation, exchange logging, webhook lifecycle |