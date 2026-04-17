# ADR-011: Workflow Connector Mapping Presets and Canonical Translation

> Proposed mapping layer for status, master data, metadata, and payload translation

---

## Status

**Proposed 🟡**

---

## Context

Real connector workflows rarely move data from system A to system B without
translation.

The research uncovered three repeated mapping classes:

1. **State / status mapping**
   - example: external status `PROCESSED` must map to internal status `done`
   - shipping example: carrier-native statuses map into a normalized lifecycle
2. **Master-data mapping**
   - example: external location code `0020-HCM` must resolve to an Odoo record
     such as `res.country.state`
3. **Metadata / payload mapping**
   - example: a webhook payload must be normalized into a canonical object that
     downstream nodes understand consistently

The `tangerine` reference uses a clean delivery-domain split:

- `delivery.status` — carrier-native status records
- `delivery.standard.status` — normalized lifecycle vocabulary
- `delivery.status.mapping` — translation layer between the two

The same principle appears in `tangerine_address_base`, where external-facing
codes such as `external_code` on Vietnamese administrative divisions provide a
stable lookup key for mapping, rather than requiring hardcoded internal IDs.

`workflow_studio` already has building blocks that will consume normalized
payloads effectively:

- the generic `http` runner
- the trigger system
- `record_operation`
- expression resolution and structured context objects

What it does not yet have is a first-class place to store reusable mapping
presets and expose them to nodes.

Without a mapping layer, users will end up encoding business translation rules
inside:

- code nodes
- ad-hoc expressions
- duplicated if/switch trees
- brittle hardcoded record IDs

That would make integrations harder to reuse, review, test, and evolve.

---

## Decision

Introduce a **workspace-scoped mapping preset layer** centered on
`workflow.data.mapping` and `workflow.data.mapping.line`.

### 1. Add `workflow.data.mapping` as the preset header model

This model stores the identity and operating mode of a reusable mapping preset.

#### Proposed shape

| Field | Purpose |
| --- | --- |
| `name`, `code` | Human + technical identity |
| `workspace_id` (nullable) | Workspace scope or global preset |
| `mapping_kind` | `status`, `master_data`, `metadata`, `payload`, `enum` |
| `source_system` | External system identifier |
| `target_system` | Internal / external target identifier |
| `source_model` | Optional semantic source model/type |
| `target_model` | Optional semantic target model/type |
| `direction` | `inbound`, `outbound`, `bidirectional` |
| `resolver_backend` | `table`, `expression`, `python_callable` |
| `default_behavior` | `first_match`, `strict`, `fallback` |
| `sample_input_json` | Example input payload |
| `sample_output_json` | Example output payload |
| `active` | Archive support |

### 2. Add `workflow.data.mapping.line` as the rule-detail model

Mapping lines express how one or more source values are translated.

#### Proposed shape

| Field | Purpose |
| --- | --- |
| `mapping_id` | Parent preset |
| `sequence` | Priority (lower = higher priority) |
| `match_mode` | `exact`, `casefold`, `regex`, `contains`, `expression` |
| `source_path` | JMESPath selector for nested value extraction |
| `source_value` | Value to match |
| `target_kind` | `literal`, `record_ref`, `field_assignment`, `expression` |
| `target_value` | Final literal / expression |
| `target_model` | Model used for dynamic resolution |
| `target_res_id` | Optional explicit record |
| `target_domain_expr` | Sandboxed domain expression for stable lookup |
| `transformer` | `trim`, `lower`, `no_accent`, `phone_e164`, `unit_convert`, etc. |
| `stop_on_match` | Stop evaluation after this rule |
| `is_default` | Fallback rule |
| `notes` | Documentation |

#### Expression language choice: JMESPath

The mapping system standardizes on **JMESPath** (RFC-like, Python `jmespath` library)
for all path expressions:

- **Why not JSONPath**: JSONPath has multiple incompatible implementations (Goessner vs
  IETF draft), weaker tooling for transformations, and no formal spec
- **Why JMESPath**: single authoritative spec (jmespath.org), Python library is mature
  (`jmespath`), supports projections and filters, already familiar from AWS CLI/IAM
- **Consistency**: all path references across mapping lines, expression nodes, and
  variable access will use JMESPath syntax (`data.items[0].name`, `orders[?status=='done']`)

#### Domain expression sandboxing

`target_domain_expr` is evaluated with **safe_eval** and restricted context:

- allowed: `value` (current source value), `record` (if in record context),
  `datetime`, `time`, `relativedelta`
- disallowed: `__import__`, file access, network calls, arbitrary Python
- example: `[('external_code', '=', value)]` where `value` is the matched source

This aligns with Odoo's existing `safe_eval` patterns for computed domains.

#### Sequence collision handling

- lines are evaluated in ascending `sequence` order
- if multiple lines share the same sequence, they are evaluated in creation order (ID)
- `is_default=True` lines are always evaluated last regardless of sequence
- recommendation: use sequence steps of 10 (10, 20, 30) to allow insertions

### 3. Prefer stable lookups over hardcoded internal IDs

For master-data mappings, the preferred resolution order is:

1. stable external key / code lookup
2. dynamic domain resolution
3. explicit record reference only when unavoidable

This avoids fragile presets like `res.country.state,1`, which are easy to break
across databases and demo environments.

#### Preferred examples

**Good**:

- `target_model = res.country.state`
- `target_domain_expr = [('external_code', '=', value)]`

**Avoid by default**:

- `target_model = res.country.state`
- `target_res_id = 1`

### 4. Do not build a universal mega-registry for every canonical value in Phase A

The research shows that some domains benefit from explicit standardized value
registries, such as `delivery.standard.status`. However, forcing every mapping
problem into a single universal canonical registry would over-generalize too
early.

Therefore:

- the core mapping layer stores translation rules and targets
- when a domain truly needs a shared normalized vocabulary, a dedicated model may
  be added in a vertical module later
- the generic core does not introduce a one-model-fits-all canonical registry in
  Phase A

### 5. Add a dedicated `data_mapping` node type that consumes presets

The connector architecture should expose a reusable node that:

- selects a `workflow.data.mapping` preset
- applies ordered rules to input payloads
- emits normalized output for downstream nodes
- can optionally resolve record references for later `record_operation` nodes

#### Typical output shapes

| Use case | Output |
| --- | --- |
| Status mapping | `{ "mapped_status": "done" }` |
| Metadata mapping | `{ "external_order_id": "...", "shipping_fee": 12000 }` |
| Master-data mapping | `{ "state": {"model": "res.country.state", "id": 42} }` |
| Whole-payload normalization | canonical JSON object consumed by downstream nodes |

### 6. Support both inbound normalization and outbound translation

Mappings are not only for inbound webhook payloads.

The same preset mechanism should support:

- inbound normalization: provider → canonical workflow payload
- outbound translation: Odoo / canonical → provider API format
- bidirectional state translation: external lifecycle ↔ internal lifecycle

### 7. Seed connector presets via data files, then allow workspace overrides

Following the `tangerine` pattern, the repo should support XML/data-file seeded
mapping presets for common connectors.

#### Layering rule

1. global preset seeded by addon data
2. optional workspace clone / override
3. workflow node references the effective workspace preset

This keeps default mappings maintainable while allowing per-customer deviation.

### 8. Phase the mapping system

#### Phase A — core tables and node

- `workflow.data.mapping`
- `workflow.data.mapping.line`
- `data_mapping` node type
- literal + record-ref outputs

#### Phase B — richer resolution and transforms

- path selectors
- transformer functions
- stable lookup helpers (`external_code`, normalized phone, no-accent text)

#### Phase C — advanced resolvers

- expression-based rules
- callable-based resolvers
- mapping test preview / sample execution UI

#### Phase D — vertical presets

- shipping status packs
- marketplace order-state packs
- address/master-data packs

---

## Consequences

### Positive

- removes business mapping logic from scattered code nodes and if/switch chains
- makes translation rules inspectable and seedable via data files
- supports both state mapping and master-data mapping with the same core pattern
- aligns with the `tangerine` status-mapping architecture without hardwiring the
  workflow engine to delivery-specific concepts

### Negative

- adds another layer users must understand when building connectors
- path-expression and dynamic-domain evaluation must be designed carefully to
  avoid security or debugging problems
- mapping rules can become hard to manage if presets grow without testing tools

### Neutral

- some connectors may still choose code/callable resolvers for special cases
- domain-specific canonical registries may still be added later in vertical
  modules

---

## Alternatives Considered

### Option A: Encode mappings inside code nodes

Write all translation logic in Python/expressions.

**Pros**:

- maximum flexibility
- no new mapping models required

**Cons**:

- poor reuse
- weak discoverability for non-developers
- harder review, testing, and seeding

### Option B: Use only `if` / `switch` nodes for translation

Model mapping as graph structure.

**Pros**:

- no new backend models
- easy to visualize for very small rule sets

**Cons**:

- explodes in size for real-world status and master-data mappings
- duplicates logic across workflows
- poor fit for seeded connector presets

### Option C: Build one universal canonical registry model for everything

Force all mappings to target one generic canonical-value table.

**Pros**:

- single target vocabulary pattern
- highly uniform relational design

**Cons**:

- over-generalized too early
- weak fit for master-data resolution and record binding
- pushes unrelated domains into one abstraction

---

## References

- `tangerine_delivery_base/models/delivery_base.py`
- `tangerine_delivery_viettelpost/data/viettelpost_status_mapping_data.xml`
- `tangerine_delivery_base/data/delivery_standard_status_data.xml`
- `tangerine_address_base/models/res_country_state.py`
- `workflow_studio/models/runners/http_runner.py`
- `workflow_studio/models/runners/record_operation_runner.py`
- [ADR-010](./010-workflow-connector-workspace-and-node-bridge-architecture.md)
- [ADR-012](./012-workflow-connector-transaction-and-exchange-lifecycle.md)

---

## Metadata

| Field | Value |
| --- | --- |
| **Date** | 2026-04-15 |
| **Author** | GitHub Copilot |
| **Reviewers** | - |
| **Related ADRs** | ADR-010, ADR-012 |
| **Related Tasks** | Connector mapping research, canonical payload translation |