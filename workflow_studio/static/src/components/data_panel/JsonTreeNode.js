/** @odoo-module **/

import { Component, useState } from "@odoo/owl";
import { generateExpressionPath, generateNodeSelectorExpressionPath, wrapExpression } from "@workflow_studio/utils/expression_utils";
import { RecordBadge } from "@workflow_studio/components/data_panel/RecordBadge";

/**
 * JsonTreeNode Component
 * 
 * Recursive component for rendering JSON tree nodes.
 * Each node is draggable and generates the appropriate expression path.
 */
export class JsonTreeNode extends Component {
    static template = "workflow_studio.json_tree_node";
    static components = { JsonTreeNode, RecordBadge };  // Self-reference for recursion

    static RECORD_REFS_KEY = '__wf_record_refs__';
    static RECORD_REFS_COUNT_KEY = '__wf_record_refs_count__';
    static RECORD_REFS_TRUNCATED_KEY = '__wf_record_refs_truncated__';

    static props = {
        data: { type: [Object, Array, String, Number, Boolean, { value: null }] },
        path: { type: Array },  // Array of path segments
        keyName: { type: String, optional: true },  // Key name for display
        onItemClick: { type: Function, optional: true },
        // Current depth level in the JSON tree (root = 0)
        level: { type: Number, optional: true },
        // Initial expansion depth. Nodes deeper than this depth start collapsed.
        // Example: 1 => root expanded, children collapsed.
        initialExpandDepth: { type: Number, optional: true },
        // Auto-collapse large containers when their direct child count is above this threshold.
        autoCollapseChildrenThreshold: { type: Number, optional: true },
        // Force require: if provided, expression paths will be node-scoped: _node["nodeId"].json...
        // Can be null for _input nodes
        sourceNodeId: { type: [String, { value: null }], optional: true },
        // When true, expression paths use _input.json... prefix instead of node selector
        isInputNode: { type: Boolean, optional: true },
        // When false, disables drag entirely (readonly tree)
        draggable: { type: Boolean, optional: true },
        // When true, allows dragging context variables (e.g., _execution, _workflow)
        isContextRoot: { type: Boolean, optional: true },
        // Optional lazy resolver for record refs.
        resolveRecordRefs: { type: Function, optional: true },
        // Shared cache for resolved record refs.
        recordRefCache: { type: Object, optional: true },
        // Callback to patch shared cache from parent component.
        onRecordRefCachePatch: { type: Function, optional: true },
    };

    setup() {
        this.state = useState({
            isExpanded: this.initialExpandState,
            recordRefsExpanded: false,
            recordRefsLoading: false,
        });
    }

    get initialExpandState() {
        if (!this.hasChildren) {
            return false;
        }
        if (this.currentLevel >= this.normalizedInitialExpandDepth) {
            return false;
        }
        return this.estimatedChildCount <= this.normalizedAutoCollapseChildrenThreshold;
    }

    get currentLevel() {
        const value = this.props.level;
        if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
            return Math.floor(value);
        }
        return 0;
    }

    get normalizedInitialExpandDepth() {
        const value = this.props.initialExpandDepth;
        if (typeof value === "number" && Number.isFinite(value)) {
            return Math.max(0, Math.floor(value));
        }
        return Number.POSITIVE_INFINITY;
    }

    get normalizedAutoCollapseChildrenThreshold() {
        const value = this.props.autoCollapseChildrenThreshold;
        if (typeof value === "number" && Number.isFinite(value)) {
            return Math.max(0, Math.floor(value));
        }
        return Number.POSITIVE_INFINITY;
    }

    get estimatedChildCount() {
        if (this.isArray) {
            return this.props.data.length;
        }
        if (this.isObject) {
            return Object.keys(this.props.data).length;
        }
        return 0;
    }

    get childLevel() {
        return this.currentLevel + 1;
    }

    get isObject() {
        return this.props.data !== null &&
            typeof this.props.data === 'object' &&
            !Array.isArray(this.props.data);
    }

    get isArray() {
        return Array.isArray(this.props.data);
    }

    get isPrimitive() {
        return !this.isObject && !this.isArray;
    }

    get hasChildren() {
        if (this.isRecordRefMarker) {
            return false;
        }
        return this.isObject || this.isArray;
    }

    get children() {
        if (this.isRecordRefMarker) {
            return [];
        }
        if (this.isArray) {
            return this.props.data.map((value, index) => ({
                key: String(index),
                value,
                path: [...this.props.path, String(index)],
            }));
        }

        if (this.isObject) {
            return Object.entries(this.props.data).map(([key, value]) => ({
                key,
                value,
                path: [...this.props.path, key],
            }));
        }

        return [];
    }

    get displayValue() {
        if (this.props.data === null) return 'null';
        if (this.props.data === undefined) return 'undefined';

        if (this.isRecordRefMarker) {
            const count = this.recordRefsCount;
            const suffix = this.recordRefsTruncated ? '+' : '';
            return `Records(${count}${suffix})`;
        }

        if (this.isArray) return `Array(${this.props.data.length})`;
        if (this.isObject) return `Object`;

        if (typeof this.props.data === 'string') {
            return `"${this.props.data}"`;
        }

        return String(this.props.data);
    }

    get valueClass() {
        if (this.props.data === null || this.props.data === undefined) return 'json-value--null';
        if (typeof this.props.data === 'string') return 'json-value--string';
        if (typeof this.props.data === 'number') return 'json-value--number';
        if (typeof this.props.data === 'boolean') return 'json-value--boolean';
        if (this.isRecordRefMarker) return 'json-value--recordrefs';
        if (this.isArray) return 'json-value--array';
        if (this.isObject) return 'json-value--object';
        return '';
    }

    /**
     * Type icon for n8n-style display
     */
    get typeIcon() {
        if (this.isArray) return '[]';
        if (this.isObject) return '{}';
        if (typeof this.props.data === 'string') return 'T';
        if (typeof this.props.data === 'number') return '#';
        if (typeof this.props.data === 'boolean') return '◉';
        return '·';
    }

    get expressionPath() {
        // If isInputNode, use _input.json prefix — the canonical data accessor.
        // _input has metadata keys (json, item, items); raw payload keys are
        // merged for convenience but _input.json.field is the explicit/safe path.
        if (this.props.isInputNode) {
            return generateExpressionPath(this.props.path, '_input.json');
        }

        if (this.props.path && this.props.path[0] === '_vars') {
            return generateExpressionPath(this.props.path.slice(1), '_vars');
        }

        if (this.props.isContextRoot && this.props.path && this.props.path[0]) {
            const rootKey = this.props.path[0];
            if (rootKey.startsWith('_')) {
                return generateExpressionPath(this.props.path.slice(1), rootKey);
            }
        }

        // If sourceNodeId is provided, use node-scoped selector
        if (this.props.sourceNodeId) {
            return generateNodeSelectorExpressionPath(this.props.sourceNodeId, this.props.path);
        }

        // Fallback for legacy/preview contexts (typically readonly).
        return generateExpressionPath(this.props.path, '_json');
    }

    get expressionTemplate() {
        return wrapExpression(this.expressionPath);
    }

    get isRecordRefMarker() {
        if (!this.isObject) {
            return false;
        }
        const refs = this.props.data[JsonTreeNode.RECORD_REFS_KEY];
        return Array.isArray(refs);
    }

    get recordRefs() {
        if (!this.isRecordRefMarker) {
            return [];
        }
        const refs = this.props.data[JsonTreeNode.RECORD_REFS_KEY] || [];
        const normalized = [];
        for (const ref of refs) {
            if (!ref || typeof ref !== 'object') {
                continue;
            }
            const modelName = ref.model;
            const recordId = Number(ref.id);
            if (!modelName || !Number.isFinite(recordId) || recordId <= 0) {
                continue;
            }
            normalized.push({ model: modelName, id: recordId });
        }
        return normalized;
    }

    get recordRefsCount() {
        if (!this.isRecordRefMarker) {
            return 0;
        }
        const count = this.props.data[JsonTreeNode.RECORD_REFS_COUNT_KEY];
        if (typeof count === 'number' && Number.isFinite(count) && count >= 0) {
            return Math.floor(count);
        }
        return this.recordRefs.length;
    }

    get recordRefsTruncated() {
        if (!this.isRecordRefMarker) {
            return false;
        }
        return !!this.props.data[JsonTreeNode.RECORD_REFS_TRUNCATED_KEY];
    }

    get canExpandRecordRefs() {
        return this.recordRefs.length > 0 && typeof this.props.resolveRecordRefs === 'function';
    }

    get title() {
        return (this.isDraggable ? ('Drag to map this field: ' + this.expressionPath) : 'Preview (read-only)') + '.\nClick to collapse/expand.';
    }

    _recordRefKey(ref) {
        return `${ref.model}:${ref.id}`;
    }

    _recordBadgeLabel(ref) {
        return `${ref.model},${ref.id}`;
    }

    /** Pre-computed label array passed to RecordBadge */
    get recordRefLabels() {
        return this.recordRefs.map(ref => this._recordBadgeLabel(ref));
    }

    /** Identity helper for RecordBadge getLabel prop (items are already strings) */
    identity(item) {
        return item;
    }

    get unresolvedRecordRefs() {
        const cache = this.props.recordRefCache || {};
        const unresolved = [];
        for (const ref of this.recordRefs) {
            const key = this._recordRefKey(ref);
            if (!cache[key]) {
                unresolved.push(ref);
            }
        }
        return unresolved;
    }

    get resolvedRecordItems() {
        const cache = this.props.recordRefCache || {};
        return this.recordRefs.map((ref, index) => {
            const key = this._recordRefKey(ref);
            const cached = cache[key] || null;
            return {
                key: `${key}:${index}`,
                label: this._recordBadgeLabel(ref),
                model: ref.model,
                id: ref.id,
                status: cached && cached.status ? cached.status : 'unresolved',
                error: cached && cached.error ? cached.error : null,
                data: cached ? cached.data : null,
                path: [...this.props.path, JsonTreeNode.RECORD_REFS_KEY, String(index), 'data'],
            };
        });
    }

    async onToggleRecordRefs(ev) {
        if (ev) {
            ev.stopPropagation();
        }

        if (this.state.recordRefsExpanded) {
            this.state.recordRefsExpanded = false;
            return;
        }

        this.state.recordRefsExpanded = true;
        if (!this.canExpandRecordRefs || this.state.recordRefsLoading) {
            return;
        }

        const unresolved = this.unresolvedRecordRefs;
        if (!unresolved.length) {
            return;
        }

        this.state.recordRefsLoading = true;
        try {
            const resolver = this.props.resolveRecordRefs;
            const response = await resolver(unresolved);
            const items = response && Array.isArray(response.items) ? response.items : [];
            const patch = {};

            for (const item of items) {
                if (!item || typeof item !== 'object') {
                    continue;
                }
                const modelName = item.model;
                const recordId = Number(item.id);
                if (!modelName || !Number.isFinite(recordId) || recordId <= 0) {
                    continue;
                }
                const key = `${modelName}:${recordId}`;
                patch[key] = {
                    status: item.status || 'unresolved',
                    error: item.error || null,
                    data: item.data || null,
                };
            }

            for (const ref of unresolved) {
                const key = this._recordRefKey(ref);
                if (!patch[key]) {
                    patch[key] = {
                        status: 'unresolved',
                        error: 'Unable to resolve record',
                        data: null,
                    };
                }
            }

            if (this.props.onRecordRefCachePatch) {
                this.props.onRecordRefCachePatch(patch);
            }
        } catch (err) {
            const patch = {};
            const message = err && err.message ? err.message : 'Unable to resolve record';
            for (const ref of unresolved) {
                const key = this._recordRefKey(ref);
                patch[key] = {
                    status: 'error',
                    error: message,
                    data: null,
                };
            }
            if (this.props.onRecordRefCachePatch) {
                this.props.onRecordRefCachePatch(patch);
            }
        } finally {
            this.state.recordRefsLoading = false;
        }
    }

    toggleExpand() {
        if (this.hasChildren) {
            this.state.isExpanded = !this.state.isExpanded;
        }
    }

    onClick(ev) {
        ev.stopPropagation();
        this.props.onItemClick?.(this.expressionPath);
    }

    // ============================================
    // DRAG HANDLERS
    // ============================================

    get isDraggable() {
        // Explicitly disabled by parent
        if (this.props.draggable === false) return false;
        // Allow drag for _input nodes or node-scoped data
        if (this.props.isInputNode || Boolean(this.props.sourceNodeId)) {
            return true;
        }
        if (this.props.isContextRoot && this.props.path && this.props.path[0]) {
            return this.props.path[0].startsWith('_');
        }
        return this.props.path && this.props.path[0] === '_vars';
    }

    onDragStart(ev) {
        if (!this.isDraggable) {
            ev.preventDefault?.();
            return;
        }

        ev.stopPropagation();

        // Set data transfer
        ev.dataTransfer.setData('text/plain', this.expressionPath);
        ev.dataTransfer.setData('application/x-expression', this.expressionTemplate);
        ev.dataTransfer.effectAllowed = 'copy';

        // Visual feedback
        ev.target.classList.add('dragging');
    }

    onDragEnd(ev) {
        ev.target.classList.remove('dragging');
    }
}
