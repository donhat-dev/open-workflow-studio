"""
Workflow Diff Utilities

Provides comparison and diff generation for workflow snapshots.
Operates at parent-object level (nodes, connections, metadata) rather than
line-level like Odoo's HTML diff.
"""

import json


def generate_workflow_comparison(new_content, old_content):
    """Generate structured comparison for workflow snapshots.

    Args:
        new_content: Current workflow snapshot dict
        old_content: Historical workflow snapshot dict

    Returns:
        dict with:
        - nodes: {added: [], removed: [], modified: []}
        - connections: {added: [], removed: [], modified: []}
        - metadata: {changed: [...]}
        - summary: {nodes_added, nodes_removed, ...}
        - html: rendered HTML for HistoryDialog
    """
    if not new_content:
        new_content = {}
    if not old_content:
        old_content = {}

    result = {
        "nodes": _compare_items(
            new_content.get("nodes", []),
            old_content.get("nodes", []),
            key="id",
            label_key="label",
        ),
        "connections": _compare_items(
            new_content.get("connections", []),
            old_content.get("connections", []),
            key="id",
        ),
        "metadata": _compare_dicts(
            new_content.get("metadata", {}), old_content.get("metadata", {})
        ),
    }

    result["summary"] = {
        "nodes_added": len(result["nodes"]["added"]),
        "nodes_removed": len(result["nodes"]["removed"]),
        "nodes_modified": len(result["nodes"]["modified"]),
        "connections_added": len(result["connections"]["added"]),
        "connections_removed": len(result["connections"]["removed"]),
        "connections_modified": len(result["connections"]["modified"]),
        "metadata_changed": len(result["metadata"]["changed"]),
    }

    result["html"] = _render_comparison_html(result)
    return result


def _compare_items(new_items, old_items, key="id", label_key=None):
    """Compare lists of items by key.

    Args:
        new_items: List of new items
        old_items: List of old items
        key: Key to identify items (default: 'id')
        label_key: Optional key for display label

    Returns:
        dict with added, removed, modified lists
    """
    new_items = new_items or []
    old_items = old_items or []

    new_map = {item.get(key): item for item in new_items if item.get(key)}
    old_map = {item.get(key): item for item in old_items if item.get(key)}

    added = []
    for k in new_map:
        if k not in old_map:
            item = new_map[k]
            added.append(
                {
                    "id": k,
                    "label": item.get(label_key) or item.get("type") or k,
                    "data": item,
                }
            )

    removed = []
    for k in old_map:
        if k not in new_map:
            item = old_map[k]
            removed.append(
                {
                    "id": k,
                    "label": item.get(label_key) or item.get("type") or k,
                    "data": item,
                }
            )

    modified = []
    for k in new_map:
        if k in old_map and new_map[k] != old_map[k]:
            changes = _diff_objects(new_map[k], old_map[k])
            if changes:
                modified.append(
                    {
                        "id": k,
                        "label": new_map[k].get(label_key)
                        or new_map[k].get("type")
                        or k,
                        "new": new_map[k],
                        "old": old_map[k],
                        "changes": changes,
                    }
                )

    return {"added": added, "removed": removed, "modified": modified}


def _compare_dicts(new_dict, old_dict):
    """Compare two dictionaries.

    Args:
        new_dict: New dictionary
        old_dict: Old dictionary

    Returns:
        dict with changed list
    """
    new_dict = new_dict or {}
    old_dict = old_dict or {}

    all_keys = set(new_dict.keys()) | set(old_dict.keys())
    changed = []

    for key in sorted(all_keys):
        new_val = new_dict.get(key)
        old_val = old_dict.get(key)
        if new_val != old_val:
            changed.append({"key": key, "new": new_val, "old": old_val})

    return {"changed": changed}


def _diff_objects(new_obj, old_obj):
    """Get changed keys between two objects.

    Args:
        new_obj: New object dict
        old_obj: Old object dict

    Returns:
        List of changed key names
    """
    new_obj = new_obj or {}
    old_obj = old_obj or {}

    changes = []
    all_keys = set(new_obj.keys()) | set(old_obj.keys())

    # Skip position changes for cleaner diff (x, y are frequent but minor)
    skip_keys = {"x", "y"}

    for key in sorted(all_keys):
        if key in skip_keys:
            continue
        if new_obj.get(key) != old_obj.get(key):
            changes.append(key)

    return changes


def _render_comparison_html(comparison):
    """Render comparison as HTML for HistoryDialog.

    Args:
        comparison: Comparison result dict

    Returns:
        HTML string
    """
    html_parts = ['<div class="wf-history-comparison">']

    nodes = comparison["nodes"]
    conns = comparison["connections"]
    meta = comparison["metadata"]

    has_changes = (
        nodes["added"]
        or nodes["removed"]
        or nodes["modified"]
        or conns["added"]
        or conns["removed"]
        or conns["modified"]
        or meta["changed"]
    )

    if not has_changes:
        html_parts.append('<div class="wf-diff-empty text-muted">No changes</div>')
        html_parts.append("</div>")
        return "".join(html_parts)

    # Nodes section
    if nodes["added"] or nodes["removed"] or nodes["modified"]:
        html_parts.append('<div class="wf-diff-section mb-3">')
        html_parts.append('<h5 class="mb-2">Nodes</h5>')

        for item in nodes["added"]:
            html_parts.append(
                f'<div class="wf-diff-added text-success">'
                f'<i class="fa fa-plus me-1"></i> {_escape(item["label"])}'
                f'</div>'
            )

        for item in nodes["removed"]:
            html_parts.append(
                f'<div class="wf-diff-removed text-danger">'
                f'<i class="fa fa-minus me-1"></i> {_escape(item["label"])}'
                f'</div>'
            )

        for item in nodes["modified"]:
            changes_str = ", ".join(item["changes"][:5])
            if len(item["changes"]) > 5:
                changes_str += f' (+{len(item["changes"]) - 5} more)'
            html_parts.append(
                f'<div class="wf-diff-modified text-warning">'
                f'<i class="fa fa-pencil me-1"></i> {_escape(item["label"])}: '
                f'<span class="text-muted small">{_escape(changes_str)}</span>'
                f'</div>'
            )

        html_parts.append("</div>")

    # Connections section
    if conns["added"] or conns["removed"] or conns["modified"]:
        html_parts.append('<div class="wf-diff-section mb-3">')
        html_parts.append('<h5 class="mb-2">Connections</h5>')

        if conns["added"]:
            html_parts.append(
                f'<div class="text-success">'
                f'<i class="fa fa-plus me-1"></i> {len(conns["added"])} added'
                f'</div>'
            )

        if conns["removed"]:
            html_parts.append(
                f'<div class="text-danger">'
                f'<i class="fa fa-minus me-1"></i> {len(conns["removed"])} removed'
                f'</div>'
            )

        if conns["modified"]:
            html_parts.append(
                f'<div class="text-warning">'
                f'<i class="fa fa-pencil me-1"></i> {len(conns["modified"])} modified'
                f'</div>'
            )

        html_parts.append("</div>")

    # Metadata section
    if meta["changed"]:
        html_parts.append('<div class="wf-diff-section mb-3">')
        html_parts.append('<h5 class="mb-2">Metadata</h5>')

        for item in meta["changed"]:
            html_parts.append(
                f'<div class="text-info">'
                f'<i class="fa fa-info-circle me-1"></i> {_escape(item["key"])} changed'
                f'</div>'
            )

        html_parts.append("</div>")

    html_parts.append("</div>")
    return "".join(html_parts)


def _escape(text):
    """Escape HTML special characters."""
    if not isinstance(text, str):
        text = str(text)
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&#x27;")
    )


def compute_snapshot_hash(snapshot):
    """Compute hash of a snapshot for deduplication.

    Args:
        snapshot: Workflow snapshot dict

    Returns:
        16-character hash string
    """
    import hashlib

    if not snapshot:
        return None

    snapshot_str = json.dumps(snapshot, sort_keys=True, ensure_ascii=False)
    return hashlib.md5(snapshot_str.encode()).hexdigest()[:16]
