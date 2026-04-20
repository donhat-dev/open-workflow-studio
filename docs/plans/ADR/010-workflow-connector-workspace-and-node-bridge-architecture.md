# ADR-010: Connector Boundary and Workspace Separation for Managed Connector Nodes

> Accepted foundation for reusable external-system connectors in `workflow_studio`

---

## Status

**Accepted ✅**

---

## Context

`workflow_studio` already has two architectural rules worth preserving:

1. **Snapshot-first workflow state** — `draft_snapshot` and `published_snapshot`
   remain the source of truth for graph structure and node configuration.
2. **Bridge records for graph-backed infrastructure** — `workflow.trigger`
   proved that graph nodes can stay in snapshots while backend bridge records
   store management metadata, health, and linked Odoo infrastructure.

The initial ADR-010 implementation used `workflow.workspace` for two unrelated
concerns at the same time:

- organizing workflows for humans (`ir.workflow.workspace_id`)
- storing provider/integration configuration such as `base_url`, auth defaults,
  endpoint presets, and managed connector node bindings

That coupling created three long-term problems:

1. **Provider configuration leaked into workflow organization** — a workspace
   record was forced to mean both “folder/group” and “integration profile”.
2. **The model blocked future organization improvements** — adding folders,
   collections, or richer workspace governance would still leave provider config
   tangled into the same table.
3. **Connector reuse stayed awkward** — multiple workflows can share the same
   provider configuration, but provider configuration should not define the
   primary workflow hierarchy.

We considered three directions for the refactor:

1. Add `workflow.connector` and decouple provider integration from workflow
   organization.
2. Keep the current connector model and only add `workflow.collection` /
   `workflow.folder` for workflow grouping.
3. Keep the backend model as-is and improve only frontend preset UX.

---

## Decision

Adopt a **connector-first boundary with a separate workflow workspace model**.

### 1. `workflow.workspace` is the organizational boundary for workflows

`workflow.workspace` is now the primary management level for `ir.workflow`.

Its responsibility is intentionally narrow:

- group related workflows
- provide a human-friendly organizational label/code
- support workspace-level filtering, ownership, and future hierarchy features

`workflow.workspace` no longer owns endpoint presets, auth profiles, or managed
connector runtime configuration.

### 2. `workflow.connector` is the provider/integration boundary

Add `workflow.connector` as the reusable integration profile model.

Its responsibility is to hold provider-scoped configuration that should be
shared across workflows and managed outside the canvas:

- `provider_key`
- `connector_type`
- `environment`
- `base_url`
- `default_auth_profile_id`
- connector-scoped notes and operational metadata

This is the model that conceptually matches `delivery.carrier`-style integration
configuration from the Tangerine shipping codebase.

### 3. Connector-owned presets and bindings hang off `workflow.connector`

The following models now belong to the connector boundary:

- `workflow.endpoint.connector_id`
- `workflow.auth.profile.connector_id`
- `workflow.http.request.connector_id`

`workflow.http.request.workspace_id` remains useful only as a related field from
the parent workflow for reporting and filtering. It is **not** the provider
configuration source anymore.

### 4. Keep snapshot-first execution and bridge-record semantics

This ADR does **not** move canonical node configuration into relational models.

The contract remains:

- graph node config lives in workflow snapshots
- bridge records cache derived metadata, health, and additive admin-managed
  configuration
- runtime merges snapshot config + connector preset + backend bridge overrides

This keeps connector support aligned with ADR-008 and ADR-009 instead of
creating a DB-first exception.

### 5. Keep `connector_request` as a distinct managed node type

The repo keeps two outbound request modes:

| Node | Role |
| --- | --- |
| `http` | Ad-hoc raw request builder |
| `connector_request` | Managed request bound to connector presets and bridge metadata |

We explicitly do **not** collapse `connector_request` into the generic `http`
node in this refactor. The managed node still earns its own type because it has
different runtime semantics:

- backend bridge lifecycle
- connector-owned endpoint/auth resolution
- runtime health tracking
- backend record inspection from the editor

Palette categories remain backend-driven through `workflow.type.category`.
Connector preset binding stays panel/backend-driven for now; dynamic
connector-specific palette categories can be layered later without re-coupling
the data model.

### 6. Migration rule for the Phase-A workspace-centered implementation

When upgrading from the earlier Phase-A implementation:

- legacy connector-style `workflow.workspace` rows are duplicated into
  `workflow.connector`
- legacy `workspace_id` bindings on endpoint/auth/request tables are copied into
  `connector_id` where possible
- legacy snapshot configs that still contain `workspace_id` are tolerated as a
  temporary binding alias during bridge resolution

This keeps upgrades practical without preserving the old architecture as the
future design.

---

## Consequences

### Positive

- removes the root coupling between workflow organization and provider config
- makes `workflow.workspace` safe to evolve into richer workflow management
  features later
- gives connectors a clean, reusable provider boundary
- preserves snapshot-first execution and bridge-record architecture
- keeps `connector_request` focused on managed connector behavior instead of
  polluting the generic `http` node

### Negative

- adds a new top-level model and admin surface (`workflow.connector`)
- requires migration logic for existing Phase-A data
- keeps two outbound request concepts (`http` and `connector_request`) that must
  be explained clearly in UX copy and docs

### Neutral

- provider-specific shipping/marketplace quirks still belong in vertical
  extensions or provider-dispatched helpers
- folder/collection hierarchy is not solved here; it can now be added later on
  top of a clean organizational workspace model
- ADR-011 and ADR-012 still own mapping translation and transaction/exchange
  lifecycle concerns

---

## Alternatives Considered

### Option A — Add `workflow.connector` and decouple provider integration from workflow organization

**Chosen.**

Why it wins:

- fixes the real coupling instead of renaming around it
- supports multiple workflows reusing the same provider config cleanly
- leaves room for future workspace/folder/collection features without dragging
  provider state through them
- matches production-shaped integration architecture more closely

### Option B — Keep the current connector model and add `workflow.collection` / `workflow.folder`

Why rejected:

- improves workflow organization but leaves the provider/workspace coupling intact
- creates one more abstraction layer while the wrong boundary still owns
  endpoint/auth/runtime state
- makes future cleanup harder because organization models would grow around the
  old coupling instead of replacing it

### Option C — Keep the backend model and improve frontend preset UX only

Why rejected:

- treats a data-model problem as a presentation problem
- still leaves `workflow.workspace` overloaded with provider concerns
- makes the UI nicer while preserving the architecture that caused the problem

---

## References

- `workflow_studio/models/ir_workflow.py`
- `workflow_studio/models/workflow_workspace.py`
- `workflow_studio/models/workflow_connector.py`
- `workflow_studio/models/workflow_endpoint.py`
- `workflow_studio/models/workflow_auth_profile.py`
- `workflow_studio/models/workflow_http_request.py`
- `workflow_studio/models/runners/connector_runner.py`
- `workflow_studio/views/workflow_connector_views.xml`
- `tangerine_delivery_base/models/delivery_base.py`
- `tangerine_delivery_base/models/carrier_ref_order.py`
- [ADR-004](./004-editor-state-architecture.md)
- [ADR-005](./005-zero-trust-polp.md)
- [ADR-008](./008-hybrid-trigger-architecture.md)
- [ADR-011](./011-workflow-connector-mapping-presets-and-canonical-translation.md)
- [ADR-012](./012-workflow-connector-transaction-and-exchange-lifecycle.md)

---

## Metadata

| Field | Value |
| --- | --- |
| **Date** | 2026-04-20 |
| **Author** | GitHub Copilot |
| **Reviewers** | - |
| **Related ADRs** | ADR-004, ADR-005, ADR-008, ADR-011, ADR-012 |
| **Related Tasks** | ADR-010 architectural comparison, connector/workspace refactor |