/** @odoo-module **/

import { Component, useState } from "@odoo/owl";
import { hasExpressions, wrapExpression, evaluateExpression } from "@workflow_pilot/utils/expression_utils";

/**
 * ExpressionInput Component
 * 
 * Input field that supports both static values and n8n-style expressions.
 * Automatically detects {{ }} syntax and switches to expression mode.
 */
export class ExpressionInput extends Component {
    static template = "workflow_pilot.expression_input";

    static props = {
        value: { type: String, optional: true },
        placeholder: { type: String, optional: true },
        label: { type: String, optional: true },
        // Expression evaluation context for preview, e.g. { $vars, $node, $json, $loop, $input }
        context: { type: Object, optional: true },
        multiline: { type: Boolean, optional: true },  // Use textarea
        onChange: { type: Function },
        onDrop: { type: Function, optional: true },
    };

    setup() {
        this.state = useState({
            isExpressionMode: hasExpressions(this.props.value || ''),
            isFocused: false,
            isDragOver: false,
            // Local value for reactivity - syncs with props
            localValue: this.props.value || '',
        });
    }

    get currentValue() {
        // Use local state value for reactivity
        return this.state.localValue;
    }

    get isExpression() {
        return this.state.isExpressionMode || hasExpressions(this.currentValue);
    }

    get previewResult() {
        if (!this.isExpression || !this.props.context) {
            return null;
        }

        const result = evaluateExpression(this.currentValue, this.props.context);
        return result;
    }

    get previewDisplay() {
        const result = this.previewResult;
        if (!result) return '';

        if (result.error) {
            return `Error: ${result.error}`;
        }

        if (result.value === undefined) {
            return 'undefined';
        }

        if (typeof result.value === 'object') {
            return JSON.stringify(result.value, null, 2);
        }

        return String(result.value);
    }

    // ============================================
    // EVENT HANDLERS
    // ============================================

    onInput(ev) {
        const value = ev.target.value;

        // Update local state for reactivity
        this.state.localValue = value;

        // Auto-detect expression mode
        if (hasExpressions(value)) {
            this.state.isExpressionMode = true;
        }

        this.props.onChange(value);
    }

    onFocus() {
        this.state.isFocused = true;
    }

    onBlur() {
        this.state.isFocused = false;
    }

    toggleExpressionMode() {
        this.state.isExpressionMode = !this.state.isExpressionMode;
    }

    /**
     * Set expression mode explicitly (for toggle buttons)
     */
    setMode(isExpression) {
        this.state.isExpressionMode = isExpression;

        // If entering expression mode and no templates, wrap existing value
        if (isExpression && !hasExpressions(this.currentValue)) {
            // Could optionally convert static value to expression
            // For now, just toggle mode
        }
    }

    // ============================================
    // DRAG-DROP HANDLERS
    // ============================================

    onDragEnter(ev) {
        ev.preventDefault();
        this.state.isDragOver = true;
    }

    onDragLeave(ev) {
        ev.preventDefault();
        this.state.isDragOver = false;
    }

    onDragOver(ev) {
        ev.preventDefault();
        // Allow drop
        ev.dataTransfer.dropEffect = 'copy';
    }

    onDrop(ev) {
        ev.preventDefault();
        this.state.isDragOver = false;

        // Get expression from dataTransfer
        const expression = ev.dataTransfer.getData('application/x-expression');
        const path = ev.dataTransfer.getData('text/plain');

        console.log('[ExpressionInput] onDrop:', { expression, path });

        let newValue = this.currentValue;

        if (expression) {
            // Insert expression at cursor or append
            newValue = newValue + expression;
        } else if (path) {
            // Wrap path in expression template
            const wrapped = wrapExpression(path);
            newValue = newValue + wrapped;
        }

        // Update local state for immediate UI update
        this.state.localValue = newValue;
        this.state.isExpressionMode = true;

        // Notify parent of change
        this.props.onChange(newValue);
        this.props.onDrop?.(expression || path);
    }
}
