/** @odoo-module **/

import { Component, useState } from "@odoo/owl";
import { generateExpressionPath, generateNodeSelectorExpressionPath, wrapExpression } from "@workflow_pilot/utils/expression_utils";

/**
 * JsonTreeNode Component
 * 
 * Recursive component for rendering JSON tree nodes.
 * Each node is draggable and generates the appropriate expression path.
 */
export class JsonTreeNode extends Component {
    static template = "workflow_pilot.json_tree_node";
    static components = { JsonTreeNode };  // Self-reference for recursion

    static props = {
        data: { type: [Object, Array, String, Number, Boolean, { value: null }] },
        path: { type: Array },  // Array of path segments
        keyName: { type: String, optional: true },  // Key name for display
        onItemClick: { type: Function, optional: true },
        // Force require: if provided, expression paths will be node-scoped: $("nodeId").json...
        // Can be null for $input nodes
        sourceNodeId: { type: [String, { value: null }], optional: true },
        // When true, expression paths use $input.json... prefix instead of node selector
        isInputNode: { type: Boolean, optional: true },
        // When false, disables drag entirely (readonly tree)
        draggable: { type: Boolean, optional: true },
    };

    setup() {
        this.state = useState({
            isExpanded: true,
        });
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
        return this.isObject || this.isArray;
    }

    get children() {
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

        if (this.isArray) return `Array(${this.props.data.length})`;
        if (this.isObject) return `Object`;

        if (typeof this.props.data === 'string') {
            const truncated = this.props.data.length > 50
                ? this.props.data.substring(0, 47) + '...'
                : this.props.data;
            return `"${truncated}"`;
        }

        return String(this.props.data);
    }

    get valueClass() {
        if (this.props.data === null || this.props.data === undefined) return 'json-value--null';
        if (typeof this.props.data === 'string') return 'json-value--string';
        if (typeof this.props.data === 'number') return 'json-value--number';
        if (typeof this.props.data === 'boolean') return 'json-value--boolean';
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
        // If isInputNode, use $input prefix (matches CodeNode runtime)
        if (this.props.isInputNode) {
            return generateExpressionPath(this.props.path, '$input');
        }

        // If sourceNodeId is provided, use node-scoped selector
        if (this.props.sourceNodeId) {
            return generateNodeSelectorExpressionPath(this.props.sourceNodeId, this.props.path);
        }

        // Fallback for legacy/preview contexts (typically readonly).
        return generateExpressionPath(this.props.path);
    }

    get expressionTemplate() {
        return wrapExpression(this.expressionPath);
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
        // Allow drag for $input nodes or node-scoped data
        return this.props.isInputNode || Boolean(this.props.sourceNodeId);
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
