# ADR-006: Workflow Version History with Parent-Object Patch Storage

> Version history system for workflow snapshots with milestone support

---

## Status

**Accepted ✅**

---

## Context

### Problem Statement

Hiện tại `ir.workflow` chỉ có 2 trạng thái snapshot:
- `draft_snapshot`: Cập nhật mỗi lần save
- `published_snapshot`: Cập nhật khi publish

**Hạn chế:**
- Không có audit trail - không biết ai thay đổi gì, khi nào
- Không thể rollback về version cũ
- Không thể so sánh sự khác biệt giữa các version
- Mất dữ liệu nếu save nhầm

### Requirements

1. Lưu trữ tối đa **50 versions** per workflow (FIFO removal khi vượt limit)
2. Hỗ trợ **rollback** về bất kỳ version nào
3. Hỗ trợ **comparison** giữa current và historical version
4. Hỗ trợ **milestone** (version quan trọng được bảo vệ khỏi FIFO prune)
5. Tái sử dụng UI pattern từ Odoo (HistoryDialog)

### Research: Odoo's Existing Patterns

#### 1. Project Module - Task History

`project.task` sử dụng 2 cơ chế:

| Cơ chế | Storage | Restore Capability |
|--------|---------|-------------------|
| `mail.thread` + `tracking=True` | `mail.tracking.value` | ❌ Audit only |
| `html.field.history.mixin` | `html_field_history` Json | ✅ Full restore |

Task description sử dụng `html.field.history.mixin` với **patch-based storage**.

#### 2. html.field.history.mixin Analysis

```python
# Key characteristics:
- _html_field_history_size_limit = 300
- Line-level patches (split by "<" for HTML)
- Undo patch: current → previous
- Restore: Apply patches backward from current
- FIFO prune: history_revs[field][:limit]
```

**Storage Structure:**
```json
{
  "field_name": [
    {"revision_id": 5, "patch": "...", "create_date": "...", ...},
    {"revision_id": 4, "patch": "...", ...}
  ]
}
```

**Concern với patch chain:**
```
Current ──p1──► R3 ──p2──► R2 ──p3──► R1
                                      ↑
                              Prune R1? Breaks chain!
```

---

## Decision

### Chosen Approach: Parent-Object Patch Storage with Milestone Support

Tạo `workflow.field.history.mixin` inspired by `html.field.history.mixin` nhưng với key differences:

#### 1. Parent-Object Level Patches (không phải line-level)

```python
# Thay vì line-level diff:
patch = "+@4:<p>ab</p>"

# Sử dụng parent-object level:
patch = {
    "nodes": [...],       # Full nodes array at that revision
    "connections": [...], # Full connections array
    "metadata": {...}     # Full metadata object
}
```

**Rationale**: Workflow snapshots là JSON với cấu trúc rõ ràng (nodes/connections/metadata). Parent-object patch:
- Dễ hiểu và debug
- Không có chain dependency - mỗi patch độc lập
- Safe FIFO pruning

#### 2. Milestone Support

```python
revision = {
    "revision_id": 5,
    "type": "patch",        # "patch" | "snapshot"
    "patch": {...},         # if type == "patch"
    "snapshot": None,       # if type == "snapshot" (milestone)
    "is_milestone": False,
    "note": "Auto-save",
    ...
}
```

- Normal revisions: Store parent-object patches
- Milestones: Store full snapshot + protected from FIFO

#### 3. Storage Location

Sử dụng **mixin field** trên `ir.workflow` (không tạo model riêng cho revisions):

```python
class Workflow(models.Model):
    _inherit = ['...', 'workflow.field.history.mixin']

    # Mixin adds:
    # - workflow_field_history: Json
    # - workflow_field_history_metadata: computed
```

Chỉ tạo `ir.workflow.milestone` model nhẹ để **reference** milestones (cho quick queries).

---

## Architecture

### Storage Design

```
┌─ ir.workflow ────────────────────────────────────────────────────┐
│                                                                  │
│  workflow_field_history: Json                                    │
│  {                                                               │
│    "draft_snapshot": [                                           │
│      {                                                           │
│        "revision_id": 5,                                         │
│        "type": "patch",                                          │
│        "patch": {                                                │
│          "nodes": [full nodes array at R5],                      │
│          "connections": [full connections at R5],                │
│          "metadata": {full metadata at R5}                       │
│        },                                                        │
│        "snapshot": null,                                         │
│        "hash": "abc123...",                                      │
│        "create_date": "2026-02-04T...",                          │
│        "create_uid": 2,                                          │
│        "create_user_name": "Admin",                              │
│        "note": "Auto-save",                                      │
│        "is_milestone": false                                     │
│      },                                                          │
│      {                                                           │
│        "revision_id": 4,                                         │
│        "type": "snapshot",   ← Milestone                         │
│        "patch": null,                                            │
│        "snapshot": {nodes, connections, metadata},               │
│        "is_milestone": true,                                     │
│        "note": "Release v1.0"                                    │
│      },                                                          │
│      ...                                                         │
│    ]                                                             │
│  }                                                               │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### Prune Safety Comparison

```
┌─ Traditional Patch Chain (Odoo HTML) ────────────────┐
│                                                      │
│  Current ──p1──► R3 ──p2──► R2 ──p3──► R1           │
│                                                      │
│  Prune R1? ❌ Breaks chain to restore R2             │
│  Must apply: p1 → p2 → p3 sequentially               │
└──────────────────────────────────────────────────────┘

┌─ Parent-Object Patch (This ADR) ─────────────────────┐
│                                                      │
│  Current    R3           R2           R1             │
│    ↓         ↓            ↓            ↓             │
│  {nodes}   {nodes@R3}  {nodes@R2}  {nodes@R1}       │
│                                                      │
│  Prune R1? ✅ No dependency                          │
│  Each revision stores FULL parent objects            │
└──────────────────────────────────────────────────────┘
```

### Component Architecture

```
┌─ Backend ─────────────────────────────────────────────────────────┐
│                                                                   │
│  workflow.field.history.mixin (Abstract)                          │
│  ├─ workflow_field_history: Json                                  │
│  ├─ workflow_field_history_metadata: computed                     │
│  ├─ write() → create revision on change                           │
│  ├─ _prune_revisions() → FIFO with milestone protection           │
│  ├─ workflow_field_history_get_content_at_revision()              │
│  ├─ workflow_field_history_get_comparison()                       │
│  ├─ workflow_field_history_restore()                              │
│  └─ workflow_field_history_create_milestone()                     │
│                                                                   │
│  ir.workflow (inherits mixin)                                     │
│  ├─ _get_versioned_fields() → ['draft_snapshot']                  │
│  └─ RPC: get_version_history, restore_version, create_milestone   │
│                                                                   │
│  ir.workflow.milestone (reference only)                           │
│  └─ workflow_id, revision_id, name (no snapshot stored)           │
│                                                                   │
│  workflow_diff_utils.py                                           │
│  └─ generate_workflow_comparison() → structured diff + HTML       │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘

┌─ Frontend ────────────────────────────────────────────────────────┐
│                                                                   │
│  WorkflowHistoryDialog (extends HistoryDialog pattern)            │
│  ├─ Left: Revision list (date, author, milestone badge)           │
│  ├─ Right: Notebook tabs                                          │
│  │   ├─ Comparison: Structured diff with +/-/~ markers            │
│  │   └─ Content: JSON preview of snapshot                         │
│  └─ Actions: Restore, Mark as Milestone                           │
│                                                                   │
│  Toolbar integration                                              │
│  ├─ History button → opens dialog                                 │
│  └─ Star button → create milestone from current                   │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
```

---

## Consequences

### Positive

- **Safe FIFO pruning**: Không có chain dependency, prune bất kỳ revision nào (trừ milestone)
- **Guaranteed restore**: Milestones luôn restorable với full snapshot
- **Reuse Odoo patterns**: Mixin approach, HistoryDialog UX
- **Audit trail**: Biết ai thay đổi gì, khi nào
- **Rollback capability**: Restore bất kỳ version nào
- **Comparison UI**: Visual diff giữa versions

### Negative

- **Storage overhead**: Parent-object patches lớn hơn line-level patches (~30-50% of full snapshot mỗi revision)
- **50 versions limit**: Cố định, có thể không đủ cho một số use cases
- **No branching**: Không hỗ trợ parallel versions/branches

### Neutral

- **Separate milestone model**: Reference only, không duplicate snapshot
- **Auto-save creates revision**: Có thể tạo nhiều revisions, nhưng hash check prevent duplicates

---

## Alternatives Considered

### Option A: Separate Model (ir.workflow.version)

Tạo model riêng lưu full snapshot mỗi version.

```python
class WorkflowVersion(models.Model):
    _name = 'ir.workflow.version'
    workflow_id = fields.Many2one('ir.workflow')
    snapshot = fields.Json()  # Full snapshot
    ...
```

**Pros:**
- Simple implementation
- Each version fully independent
- Easy to query/filter

**Cons:**
- Storage overhead: 50 × full_size per workflow
- Không theo Odoo mixin pattern
- Separate table = more joins

### Option B: Delegation Inheritance (_inherits)

Sử dụng `_inherits` từ `ir.workflow`.

**Pros:**
- Access parent fields directly

**Cons:**
- **Semantic mismatch**: `_inherits` là composition, không phải history
- **Shared fields issue**: Delegated fields shared giữa versions
- **SQL constraint conflicts**: `UNIQUE(name, company_id)`
- High risk of data corruption

### Option C: Pure Patch-based (like html.field.history.mixin)

Copy exact Odoo HTML mixin với line-level patches.

**Pros:**
- Most storage efficient
- Proven pattern

**Cons:**
- **Chain dependency**: Prune oldest breaks restore chain
- **JSON tokenization**: `"<"` separator không phù hợp cho JSON
- **Complex restore**: Apply patches sequentially

### Decision Matrix

| Criteria | Separate Model | _inherits | Pure Patch | **Parent-Object (Chosen)** |
|----------|---------------|-----------|------------|---------------------------|
| Storage efficiency | ❌ Worst | ❌ | ✅ Best | ⚠️ Good |
| Prune safety | ✅ | ❌ | ❌ | ✅ |
| Restore reliability | ✅ | ❌ | ⚠️ | ✅ |
| Implementation effort | ✅ Low | ❌ High | ⚠️ Medium | ⚠️ Medium |
| Odoo pattern reuse | ❌ | ❌ | ✅ | ✅ |
| Milestone support | ✅ | ❌ | ❌ | ✅ |

---

## Implementation Summary

### Files Created

| File | Purpose |
|------|---------|
| `models/workflow_field_history_mixin.py` | Abstract mixin for version history |
| `models/workflow_diff_utils.py` | Diff utilities for workflow comparison |
| `models/workflow_milestone.py` | Lightweight milestone reference model |
| `components/workflow_history_dialog/` | Frontend dialog (js, xml, scss) |

### Files Modified

| File | Changes |
|------|---------|
| `models/__init__.py` | Import new models |
| `models/ir_workflow.py` | Inherit mixin, add RPC methods |
| `security/ir.model.access.csv` | Milestone model access |
| `app/workflow_editor_app.js` | History/Milestone methods |
| `app/workflow_editor_app.xml` | Toolbar buttons |

### RPC Endpoints

| Method | Description |
|--------|-------------|
| `get_version_history(field_name)` | List revision metadata |
| `get_version_content(revision_id)` | Reconstruct snapshot at revision |
| `get_version_comparison(revision_id)` | Diff current vs revision |
| `restore_version(revision_id)` | Restore and create new revision |
| `create_milestone(name)` | Snapshot current as milestone |
| `mark_milestone(revision_id, name)` | Convert revision to milestone |

---

## References

- [html.field.history.mixin](https://github.com/odoo/odoo/blob/18.0/addons/web_editor/models/html_field_history_mixin.py) - Odoo's HTML versioning
- [diff_utils.py](https://github.com/odoo/odoo/blob/18.0/addons/web_editor/models/diff_utils.py) - Odoo's diff utilities
- [HistoryDialog](https://github.com/odoo/odoo/blob/18.0/addons/html_editor/static/src/components/history_dialog/) - Odoo's history UI
- [project_task_form_controller.js](https://github.com/odoo/odoo/blob/18.0/addons/project/static/src/views/project_task_form/project_task_form_controller.js) - Project's history integration

---

## Metadata

| Field | Value |
|-------|-------|
| **Date** | 2026-02-04 |
| **Author** | Workflow Pilot Team |
| **Reviewers** | - |
| **Related ADRs** | - |
| **Related Tasks** | Version History Feature |
