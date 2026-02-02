/** @odoo-module **/

import { Component, useState, onWillUpdateProps } from "@odoo/owl";
import { wrapExpression, evaluateExpression } from "@workflow_pilot/utils/expression_utils";

/**
 * ExpressionInput Component
 * 
 * Input field that supports both static values and n8n-style expressions.
 * Mode is controlled by parent; no auto-switching based on value.
 */
export class ExpressionInput extends Component {
    static template = "workflow_pilot.expression_input";

    static props = {
        value: { type: String, optional: true },
        placeholder: { type: String, optional: true },
        label: { type: String, optional: true },
        // Expression evaluation context for preview, e.g. { _vars, _node, _json, _loop, _input }
        context: { type: Object, optional: true },
        multiline: { type: Boolean, optional: true },  // Use textarea
        // Controlled mode: 'fixed' | 'expression'
        mode: { type: String, optional: true },
        onModeChange: { type: Function, optional: true },
        onChange: { type: Function },
        onDrop: { type: Function, optional: true },
    };

    setup() {
        this.state = useState({
            isFocused: false,
            isDragOver: false,
            // Local value for reactivity - syncs with props
            localValue: this.props.value || '',
        });

        // Option 2: sync localValue when parent updates props (avoid stale state if component is reused)
        onWillUpdateProps((nextProps) => {
            const nextValue = nextProps?.value ?? '';

            // Don't override while user is actively editing.
            if (this.state.isFocused) return;

            if (nextValue !== this.state.localValue) {
                this.state.localValue = nextValue;
            }
        });
    }

    get currentValue() {
        // Use local state value for reactivity
        return this.state.localValue;
    }

    get mode() {
        return this.props.mode || 'fixed';
    }

    get isExpression() {
        return this.mode === 'expression';
    }

    get textAreaRows() {
        return this.props.multiline ? 2 : 1;
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
            return this._safeStringify(result.value);
        }

        return String(result.value);
    }

    _safeStringify(value) {
        try {
            return JSON.stringify(value, null, 2);
        } catch {
            return '[Unserializable value]';
        }
    }

    // ============================================
    // EVENT HANDLERS
    // ============================================

    onInput(ev) {
        const value = ev.target.value;

        // Update local state for reactivity
        this.state.localValue = value;

        this.props.onChange(value);
    }

    onFocus() {
        this.state.isFocused = true;
    }

    onBlur() {
        this.state.isFocused = false;
    }

    setMode(mode) {
        this.props.onModeChange?.(mode);
    }

    onClickFixed() {
        this.setMode('fixed');
    }

    onClickExpression() {
        this.setMode('expression');
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

        const insertText = expression || (path ? wrapExpression(path) : '');
        if (!insertText) {
            return;
        }

        // Insert at cursor when possible; otherwise append.
        const el = ev.target;
        const currentValue = this.currentValue;
        let newValue = currentValue + insertText;
        let newCursorPos = newValue.length;

        if (el && typeof el.selectionStart === 'number' && typeof el.selectionEnd === 'number') {
            const start = el.selectionStart;
            const end = el.selectionEnd;
            newValue = currentValue.slice(0, start) + insertText + currentValue.slice(end);
            newCursorPos = start + insertText.length;
        }

        // Update local state for immediate UI update
        this.state.localValue = newValue;

        // Notify parent of change (no mode switching)
        this.props.onChange(newValue);
        this.props.onDrop?.(expression || path);

        // Restore cursor after DOM updates
        if (el && typeof el.setSelectionRange === 'function') {
            requestAnimationFrame(() => {
                try {
                    el.focus();
                    el.setSelectionRange(newCursorPos, newCursorPos);
                } catch {
                    // ignore
                }
            });
        }
    }
}
