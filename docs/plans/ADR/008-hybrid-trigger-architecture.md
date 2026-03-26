# ADR-008: Hybrid Trigger/Activation Architecture

---

## Status

**Accepted**

---

## Context

The workflow builder needs a trigger/execution model that supports multiple
activation modes (manual, scheduled, webhook, record events) while leveraging
Odoo's native infrastructure for reliability.

Three approaches were evaluated:

1. **Delegate-inherit `ir.actions.server`**: natural for Odoo server actions but
   creates impedance mismatch (per-record vs graph executor).
2. **Fully custom infrastructure**: reinvents well-tested Odoo subsystems
   (ir.cron, base.automation).
3. **Pure n8n clone**: ignores Odoo infrastructure, duplicates scheduling/events.

---

## Decision

**Hybrid approach**: Trigger nodes live in the workflow canvas for UX
consistency (n8n-style), while Odoo native infrastructure provides reliable
backend activation.

### New model: `workflow.trigger`

Bridge between a graph trigger-node and its backend activation record:

| Trigger Type    | Backend Record        | Activation Mechanism          |
|-----------------|-----------------------|-------------------------------|
| `manual`        | —                     | User clicks "Execute"         |
| `schedule`      | `ir.cron`             | `state='code'` calling `_execute_from_trigger()` |
| `webhook`       | UUID route            | Public HTTP endpoint at `/workflow_studio/webhook/<uuid>` |
| `record_event`  | `base.automation`     | ORM hook + `ir.actions.server` calling `_execute_from_trigger()` |

### Entry point: `_execute_from_trigger(node_id, trigger_type, trigger_data)`

All trigger types converge to a single entry point on `ir.workflow`. This
method builds `input_data` containing:

```python
{
    '_trigger': {
        'type': trigger_type,
        'node_id': node_id,
        'context': sanitized_env_context,  # from ir.cron / base.automation
        **trigger_data,  # type-specific payload
    }
}
```

### Key design decisions

1. **`env.context` as node input**: For cron and automation triggers, the
   sanitized `env.context` is passed through to the trigger runner output,
   making Odoo contextual information available to downstream nodes.

2. **`base_automation` is optional**: Not a hard dependency. The record event
   trigger raises `UserError` at activation time if the module isn't installed.

3. **Webhook response mode**: Configurable per-node:
   - `immediate` (default): Returns `200 OK` immediately, fire-and-forget.
   - `last_node`: Waits for execution and returns the last node's output.

4. **Changed fields only**: Record event triggers track only changed fields
   (via `trigger_field_ids` on `base.automation`), not full old/new value diff.

5. **Activation lifecycle**: `action_activate_triggers()` on `ir.workflow`
   creates/updates backend records; `action_deactivate_triggers()` pauses them.
   Stale triggers (nodes removed from snapshot) are auto-deactivated.

6. **Schedule cron uses `state='code'`**: Direct Python call to
   `env['ir.workflow'].browse(ID)._execute_from_trigger(...)` — avoids
   ir.actions.server intermediary for schedule triggers.

---

## Consequences

### Positive

- Trigger configuration stays in the visual canvas (consistent UX)
- Odoo infrastructure handles scheduling/ORM events reliably
- Single execution entry point simplifies debugging
- `env.context` is available to all downstream nodes
- `base_automation` dependency is optional

### Negative

- Bridge layer adds indirection (trigger node → workflow.trigger → backend record)
- Webhook endpoint is public (CSRF-off) — requires UUID-based security
- Record event trigger depends on `base_automation` module availability

### Files Changed

- **New**: `models/workflow_trigger.py` — bridge model
- **New**: `models/runners/schedule_trigger_runner.py`
- **New**: `models/runners/webhook_trigger_runner.py`
- **New**: `models/runners/record_event_trigger_runner.py`
- **Modified**: `models/ir_workflow.py` — `is_activated`, `trigger_ids`, activation methods
- **Modified**: `models/workflow_run.py` — `execution_mode` field
- **Modified**: `models/workflow_executor.py` — register 3 new runners
- **Modified**: `controllers/main.py` — webhook endpoint
- **Modified**: `data/workflow_type_data.xml` — 3 new trigger node types
- **Modified**: `security/ir.model.access.csv` — workflow.trigger ACL
