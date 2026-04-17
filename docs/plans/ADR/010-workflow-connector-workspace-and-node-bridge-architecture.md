# ADR-010: Workflow Connector Workspace and Node-Bridge Architecture

> Proposed foundation for external-system connector nodes in `workflow_studio`

---

## Status

**Proposed 🟡**

---

## Context

`workflow_studio` already supports three important architectural ideas that are
worth preserving:

1. **Snapshot-first workflow state** — `ir.workflow.draft_snapshot` and
   `published_snapshot` remain the source of truth for graph structure and node
   configuration. Persisted relational records such as `workflow.node` and
   `workflow.connection` are mirrors for querying, validation, and audit, not
   the primary runtime source.
2. **Bridge records for graph-backed infrastructure** — `workflow.trigger`
   maps a graph node (`workflow_id + node_id`) to backend infrastructure such as
   `ir.cron`, `base.automation`, and webhook UUID routes.
3. **Security-first execution context** — the executor already injects a
   `SecretBroker` (`secret.get(key)`) and applies output masking / audit rules.

The research target is a standard connector-node architecture that can support
real external-system integrations — starting with shipping connectors such as
Viettel Post and Lalamove, but extensible to marketplaces, CRM, finance, or any
REST-backed provider.

The `tangerine-shipping-methods` repository demonstrates a production-shaped
pattern that `workflow_studio` currently lacks:

- a provider-scoped configuration boundary (`delivery.carrier` extension)
- endpoint registry records (`delivery.route.api`)
- status registries and status mappings
- operational transaction records (`carrier.ref.order`)
- webhook audit logs (`delivery.webhook.log`)
- service catalogs, regional presets, and reconciliation extensions

The current `workflow_studio` HTTP node is intentionally generic and useful for
ad-hoc calls, but it is not enough for a reusable connector framework because it
does not provide:

- a shared configuration scope for related workflows
- backend-manageable endpoint presets and auth profiles
- relational records for node-specific metadata, health, and admin-side config
- a clean boundary between generic connector infrastructure and provider-specific
  runtime rules

### Requirements gathered from research

The standard connector architecture must support:

- grouping related workflows under a shared connector scope
- storing shared endpoint presets, credentials, and environment choices once
- preserving snapshot-first execution rather than moving workflow truth into DB
- treating connector-aware nodes like trigger nodes: graph node in snapshot,
  backend bridge record for management and metadata
- supporting both outbound requests and inbound webhook-driven updates
- leaving room for provider-specific extensions such as token dances, catalog
  sync, reconciliation, label printing, and custom signature logic

### Constraints from existing ADRs and implementation

- ADR-004 favors the editor service as the single frontend source of truth.
- ADR-005 requires zero-trust execution, masked outputs, and brokered secret
  access.
- ADR-008 establishes the bridge-record pattern via `workflow.trigger`.
- ADR-009 reinforces snapshot/runtime separation and avoids inflating stored
  workflow structures with heavy duplicated payloads.

---

## Decision

Adopt a **workspace-centered connector architecture** for `workflow_studio`.

This ADR defines the core configuration scope and bridge-record pattern. More
specialized mapping and transaction/logging decisions are split into ADR-011 and
ADR-012.

### 1. Introduce `workflow.workspace` as the connector configuration boundary

`workflow.workspace` becomes the shared scope for connector-oriented workflows.
Conceptually, it plays the same role that the delivery-carrier record plays in
`tangerine`: a mutable configuration boundary for one integration profile.

#### Responsibilities

- group related workflows
- scope connector presets and overrides by company / environment
- own shared endpoint presets, auth profiles, mapping presets, and operational
  records
- provide a stable anchor for backend configuration outside the canvas

#### Proposed shape

| Field | Purpose |
| --- | --- |
| `name` | Human-facing identity |
| `code` | Technical identity, auto-generated from name if blank |
| `company_id` | Company scope |
| `provider_key` / `connector_type` | `viettelpost`, `lalamove`, `shopee`, `generic_rest`, etc. |
| `environment` | `sandbox`, `production`, `custom` |
| `base_url` | Default API host |
| `active` | Archive support |
| `default_auth_profile_id` | Shared auth default |
| `notes` | Admin documentation |

#### Constraints

- **Unique naming**: `(company_id, provider_key, code)` must be unique to prevent
  naming collisions when the same provider is used with different configurations
- **Code generation**: If `code` is not provided on create, auto-generate from
  `name` using slugify with collision suffix (e.g., `viettelpost-hcm`,
  `viettelpost-hcm-2`)
- **Provider key vocabulary**: `provider_key` values should follow a registry
  pattern (similar to `workflow.type`) to enable provider-specific dispatching

#### Relationships

- `ir.workflow.workspace_id -> workflow.workspace` (optional Many2one)
- `workflow.workspace.endpoint_ids -> workflow.endpoint`
- `workflow.workspace.auth_profile_ids -> workflow.auth.profile`
- `workflow.workspace.mapping_ids -> workflow.data.mapping`
- `workflow.workspace.transaction_ids -> workflow.connector.transaction`

#### Workflow-to-Workspace cardinality

`ir.workflow.workspace_id` is **optional**:

- workflows not using connector features leave it blank
- one workflow may belong to exactly one workspace
- multiple workflows may share the same workspace
- changing workspace does not affect snapshot content, only backend-side defaults
  and preset resolution

### 2. Keep snapshots as the source of truth for node configuration

The new connector architecture must **not** move canonical node config into
relational models.

Instead, the repo should continue using the same contract as `workflow.trigger`:

- graph node config lives in `draft_snapshot` / `published_snapshot`
- relational bridge records cache derived metadata, extra backend config, search
  fields, and admin-facing state
- runtime resolves effective config by merging snapshot config + backend-side
  managed fields when allowed

This keeps execution aligned with the current architecture and avoids split
brain between graph JSON and backend records.

### 3. Introduce `workflow.endpoint` as the reusable endpoint registry

The endpoint registry generalizes the `delivery.route.api` pattern from
`tangerine`.

#### Responsibilities

- define named API operations as records
- allow endpoint presets to be seeded by data files and adjusted in backend UI
- centralize route, method, timeout, and auth requirements
- let multiple workflows reference the same logical operation without repeating
  low-level HTTP details

#### Proposed shape

| Field | Purpose |
| --- | --- |
| `workspace_id` (nullable) | Scoped preset or global preset |
| `name`, `code` | Human + technical endpoint key |
| `category` | `auth`, `quote`, `create`, `cancel`, `status_sync`, `webhook_register`, etc. |
| `method` | HTTP verb |
| `path` | Relative path |
| `headers_template` | Default headers |
| `query_template` | Default query params |
| `body_template` | Default request body skeleton |
| `requires_auth` | Whether an auth profile is expected |
| `timeout_seconds` | Timeout override |
| `retry_policy_json` | Per-endpoint retry hints |
| `active` | Archive support |

Presets may be seeded globally, then copied or overridden per workspace.

### 4. Introduce `workflow.auth.profile` as the reusable auth strategy record

Connector nodes should not hardcode auth mechanics inside every workflow.

`workflow.auth.profile` becomes the reusable record for auth behavior and token
metadata, while raw secrets remain brokered through the existing
`SecretBroker`.

#### Proposed shape

| Field | Purpose |
| --- | --- |
| `workspace_id` | Scope |
| `name` | Admin-facing profile name |
| `auth_type` | `api_key`, `bearer`, `basic`, `oauth2_client_credentials`, `oauth2_refresh_token`, `hmac`, `jwt_assertion`, `custom` |
| `token_endpoint_id` | Optional endpoint used for token acquisition |
| `secret_refs_json` | References to `secret.get(key)` keys |
| `header_template_json` | Header-level auth template |
| `query_template_json` | Query-param auth template |
| `signature_template` | Optional signature recipe |
| `scope`, `audience` | Auth metadata |
| `token_expires_at`, `last_refresh_at` | Cached lifecycle metadata |
| `active` | Archive support |

#### Secret handling rule

Raw credentials must not become the default storage path for connector models.
The preferred pattern is:

- backend records store metadata and broker references
- runtime resolves secrets via `secret.get(key)`
- masked values are shown in display flows using the same security rules already
  present in the executor

### 5. Introduce `workflow.http.request` as the connector-aware bridge record

The repo should add a relational bridge model for connector-aware outbound HTTP
nodes, using `workflow.trigger` as the direct design precedent.

#### Naming decision

Use `workflow.http.request`, not `ir.workflow.http.request`, to stay aligned
with the model naming style already used by:

- `workflow.trigger`
- `workflow.node`
- `workflow.connection`
- `workflow.run`

#### Responsibilities

- bind a graph node to backend-managed connector metadata
- store endpoint binding, health summary, hashes, and optional admin overrides
- support backend search/filter/reporting for connector nodes
- provide a stable home for panel state and future operational links

#### Proposed shape

| Field | Purpose |
| --- | --- |
| `workflow_id` | Parent workflow |
| `node_id` | Graph node ID |
| `workspace_id` | Effective workspace |
| `endpoint_id` | Selected endpoint preset |
| `operation_code` | Stable logical action key |
| `active` | Enable / disable backend-side behavior |
| `config_hash` | Change detection |
| `snapshot_config_json` | Cached node config view |
| `backend_config_json` | Backend-managed additive config |
| `resolved_url_preview` | UI preview |
| `last_status_code` | Last execution summary |
| `last_duration_ms` | Performance summary |
| `last_error` | Last known failure summary |
| `last_run_at` | Last execution timestamp |

#### Constraints

- unique `(workflow_id, node_id)`
- source-of-truth remains the graph snapshot
- backend config can augment, but must not silently replace, the snapshot schema

### 6. Distinguish two outbound request modes at the node layer

The current `http` node remains supported as the **ad-hoc / low-ceremony** HTTP
node.

Add a new connector-oriented node category for **managed connector calls**.

#### Proposed split

| Node | Role |
| --- | --- |
| `http` | Ad-hoc raw request builder |
| `connector_request` | Managed request bound to workspace + endpoint + auth profile |

This avoids overloading the existing `http` node with connector-specific admin
behavior while keeping it available for quick integrations and experiments.

### 7. Provider-specific logic stays behind a capability/plugin boundary

Some behaviors must remain provider-specific:

- Viettel Post's multi-step token exchange
- Lalamove's HMAC signature + nonce + request ID generation
- catalog synchronization shapes (`service` vs `service_extend` vs `specialRequests`)
- label-printing mechanics
- reconciliation parsers and settlement logic

Therefore, the connector core should expose provider-specific extension points
instead of trying to flatten everything into generic JSON fields on day one.

#### Allowed extension mechanisms

- registered Python callables (similar to decorated workflow nodes)
- provider-key-dispatched helpers
- vertical addon models layered on top of the connector core

### 8. Phase the rollout instead of building the entire connector universe at once

#### Phase A — foundation

- `workflow.workspace`
- `workflow.endpoint`
- `workflow.auth.profile`
- `workflow.http.request`
- `connector_request` node type and config panel
- snapshot/runtime merge rules

#### Phase B — semantic translation

- mapping presets and the data-mapping node (see ADR-011)
- workspace-scoped preset loading and override rules

#### Phase C — runtime lifecycle and observability

- transaction correlation, exchange logs, webhook subscriptions (see ADR-012)

#### Phase D — vertical connector packs

- shipping connectors (Viettel Post, Lalamove)
- service catalogs, regional presets, settlement/reconciliation
- marketplace / ERP / finance verticals with provider-specific plugins

---

## Consequences

### Positive

- introduces a real configuration scope for connector-oriented workflows
- preserves the repo's existing snapshot-first architecture
- reuses the proven bridge-record pattern already established by
  `workflow.trigger`
- separates ad-hoc HTTP usage from managed connector usage
- aligns secrets/auth with the existing zero-trust execution model
- creates a clean place to seed presets and manage them outside the editor

### Negative

- adds several new relational models and admin UIs
- creates a second integration path (`http` vs `connector_request`) that must be
  explained clearly to users
- requires disciplined runtime merge rules to avoid hidden divergence between
  snapshots and bridge records

### Neutral

- provider-specific integrations will still need vertical add-ons or callables
- current workflows can continue using the generic HTTP node without migration
- the new architecture does not immediately solve mapping or transaction
  correlation; those are addressed in companion ADRs

---

## Alternatives Considered

### Option A: Keep only the generic `http` node

Use the existing `http` node for all integrations and store everything directly
inside snapshot config.

**Pros**:

- no new backend models
- lowest initial implementation cost
- preserves maximum node simplicity

**Cons**:

- no shared workspace/grouping scope
- no reusable endpoint/auth presets
- poor backend discoverability and admin management
- no clean place for connector-specific metadata, health, or lifecycle

### Option B: Hardcode provider-specific models directly into `workflow_studio`

Model each provider the way `tangerine` does and bind workflows to those models
directly.

**Pros**:

- closer to the reference implementation
- straightforward for the first shipping connector

**Cons**:

- too narrow for a standard connector framework
- quickly creates a collection of unrelated provider implementations
- weak reuse for non-shipping domains

### Option C: Store all connector state exclusively in relational tables

Turn connector nodes into DB-first records and use snapshots only for layout.

**Pros**:

- easy relational querying
- admin-side edits are straightforward

**Cons**:

- violates the repo's established snapshot-first architecture
- increases risk of graph/DB divergence
- makes publishing/versioning harder to reason about

---

## References

- `workflow_studio/models/ir_workflow.py`
- `workflow_studio/models/workflow_trigger.py`
- `workflow_studio/models/workflow_type.py`
- `workflow_studio/models/security/secret_broker.py`
- `workflow_studio/models/workflow_executor.py`
- `tangerine_delivery_base/models/delivery_base.py`
- `tangerine_delivery_base/models/carrier_ref_order.py`
- `tangerine_delivery_base/models/delivery_webhook_log.py`
- `tangerine_delivery_viettelpost/data/viettelpost_route_api_data.xml`
- `tangerine_delivery_lalamove/data/lalamove_route_api_data.xml`
- [ADR-004](./004-editor-state-architecture.md)
- [ADR-005](./005-zero-trust-polp.md)
- [ADR-008](./008-hybrid-trigger-architecture.md)
- [ADR-011](./011-workflow-connector-mapping-presets-and-canonical-translation.md)
- [ADR-012](./012-workflow-connector-transaction-and-exchange-lifecycle.md)

---

## Metadata

| Field | Value |
| --- | --- |
| **Date** | 2026-04-15 |
| **Author** | GitHub Copilot |
| **Reviewers** | - |
| **Related ADRs** | ADR-004, ADR-005, ADR-008, ADR-011, ADR-012 |
| **Related Tasks** | Connector architecture research, external integration foundation |