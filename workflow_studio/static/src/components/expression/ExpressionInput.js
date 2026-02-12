/** @odoo-module **/

import { Component, useState, onWillUpdateProps } from "@odoo/owl";
import { wrapExpression, evaluateExpression } from "@workflow_studio/utils/expression_utils";
import {
    buildContextExpressionSuggestions,
    filterSuggestions,
    mergeUniqueSuggestions,
} from "@workflow_studio/utils/input_suggestion_utils";

/**
 * ExpressionInput Component
 * 
 * Input field that supports both static values and n8n-style expressions.
 * Mode is controlled by parent; no auto-switching based on value.
 */
export class ExpressionInput extends Component {
    static template = "workflow_studio.expression_input";

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
        // Readonly mode (execution view)
        readonly: { type: Boolean, optional: true },
        // Fixed-list suggestions for fixed mode
        suggestions: { type: Array, optional: true },
        // Extra fixed value suggestions
        valueSuggestions: { type: Array, optional: true },
        // Extra expression-path suggestions
        expressionSuggestions: { type: Array, optional: true },
    };

    setup() {
        const initialValue = typeof this.props.value === "string" ? this.props.value : "";
        const initialMode = this._normalizeMode(this.props.mode)
            || this._inferModeFromValue(initialValue);

        this.state = useState({
            isFocused: false,
            isDragOver: false,
            showSuggestions: false,
            activeSuggestionIndex: -1,
            // Local value for reactivity - syncs with props
            localValue: initialValue,
            // Fallback mode when parent does not control mode explicitly
            localMode: initialMode,
        });

        // Option 2: sync localValue when parent updates props (avoid stale state if component is reused)
        onWillUpdateProps((nextProps) => {
            const nextValue = nextProps && typeof nextProps.value === "string" ? nextProps.value : "";
            const nextMode = this._normalizeMode(nextProps && nextProps.mode);
            const valueChanged = nextValue !== this.state.localValue;

            // Don't override while user is actively editing.
            if (this.state.isFocused) return;

            if (valueChanged) {
                this.state.localValue = nextValue;
            }

            // If mode is controlled by parent, keep local mode synchronized.
            if (nextMode) {
                this.state.localMode = nextMode;
                return;
            }

            // For uncontrolled mode, infer initial mode from incoming value.
            if (valueChanged) {
                this.state.localMode = this._inferModeFromValue(nextValue);
            }
        });
    }

    _normalizeMode(mode) {
        if (mode === "fixed" || mode === "expression") {
            return mode;
        }
        return "";
    }

    _inferModeFromValue(value) {
        const text = String(value || "").trim();
        if (text.startsWith("{{") && text.endsWith("}}")) {
            return "expression";
        }
        return "fixed";
    }

    get hasControlledMode() {
        return this._normalizeMode(this.props.mode) !== "";
    }

    get currentValue() {
        // Use local state value for reactivity
        return this.state.localValue;
    }

    get mode() {
        const controlledMode = this._normalizeMode(this.props.mode);
        if (controlledMode) {
            return controlledMode;
        }
        return this.state.localMode || "fixed";
    }

    get isExpression() {
        return this.mode === 'expression';
    }

    get textAreaRows() {
        return this.props.multiline ? 2 : 1;
    }

    get allSuggestions() {
        if (this.isExpression) {
            const contextSuggestions = buildContextExpressionSuggestions(this.props.context);
            return mergeUniqueSuggestions(contextSuggestions, this.props.expressionSuggestions);
        }
        return mergeUniqueSuggestions(this.props.suggestions, this.props.valueSuggestions);
    }

    get suggestionQuery() {
        const rawValue = this.currentValue || "";
        if (!this.isExpression) {
            return rawValue;
        }

        return rawValue
            .replace(/\{\{/g, "")
            .replace(/\}\}/g, "")
            .replace(/^=/, "")
            .trim();
    }

    get filteredSuggestions() {
        return filterSuggestions(this.allSuggestions, this.suggestionQuery, 12);
    }

    get shouldShowSuggestions() {
        if (this.props.readonly) {
            return false;
        }
        if (!this.state.isFocused) {
            return false;
        }
        if (!this.state.showSuggestions) {
            return false;
        }
        return this.filteredSuggestions.length > 0;
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
        this.state.showSuggestions = true;
        this.state.activeSuggestionIndex = -1;

        this.props.onChange(value);
    }

    onFocus() {
        this.state.isFocused = true;
        this.state.showSuggestions = true;
    }

    onBlur() {
        this.state.isFocused = false;
        this.state.showSuggestions = false;
        this.state.activeSuggestionIndex = -1;
    }

    setMode(mode) {
        const normalized = this._normalizeMode(mode);
        if (!normalized) {
            return;
        }

        if (!this.hasControlledMode) {
            this.state.localMode = normalized;
        }

        if (this.props.onModeChange) {
            this.props.onModeChange(normalized);
        }
        this.state.showSuggestions = false;
        this.state.activeSuggestionIndex = -1;
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
        if (this.props.onDrop) {
            this.props.onDrop(expression || path);
        }
        this.state.showSuggestions = false;

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

    onKeyDown(ev) {
        const suggestions = this.filteredSuggestions;

        if (!this.shouldShowSuggestions && ev.key === "ArrowDown" && suggestions.length > 0) {
            ev.preventDefault();
            this.state.showSuggestions = true;
            this.state.activeSuggestionIndex = 0;
            return;
        }

        if (!this.shouldShowSuggestions || suggestions.length === 0) {
            return;
        }

        if (ev.key === "ArrowDown") {
            ev.preventDefault();
            this.state.activeSuggestionIndex = Math.min(
                suggestions.length - 1,
                this.state.activeSuggestionIndex + 1
            );
            return;
        }

        if (ev.key === "ArrowUp") {
            ev.preventDefault();
            this.state.activeSuggestionIndex = Math.max(-1, this.state.activeSuggestionIndex - 1);
            return;
        }

        if (ev.key === "Enter" || ev.key === "Tab") {
            if (this.state.activeSuggestionIndex >= 0 && this.state.activeSuggestionIndex < suggestions.length) {
                ev.preventDefault();
                this._applySuggestion(suggestions[this.state.activeSuggestionIndex]);
            }
            return;
        }

        if (ev.key === "Escape") {
            ev.preventDefault();
            this.state.showSuggestions = false;
            this.state.activeSuggestionIndex = -1;
        }
    }

    onSuggestionMouseDown(ev, item) {
        ev.preventDefault();
        this._applySuggestion(item);
    }

    _applySuggestion(item) {
        if (!item || !item.value) {
            return;
        }

        const nextValue = this.isExpression
            ? wrapExpression(item.value)
            : item.value;

        this.state.localValue = nextValue;
        this.state.showSuggestions = false;
        this.state.activeSuggestionIndex = -1;
        this.props.onChange(nextValue);
    }
}
