/** @odoo-module **/

import { Component, useEffect, useState, onWillUpdateProps, useRef } from "@odoo/owl";
import { Dropdown } from "@web/core/dropdown/dropdown";
import { DropdownItem } from "@web/core/dropdown/dropdown_item";
import { useDropdownState } from "@web/core/dropdown/dropdown_hooks";
import { useChildRef } from "@web/core/utils/hooks";
import {
    wrapExpression,
    evaluateExpression,
    hasExpressions,
    extractExpressions,
    ensureExpressionPrefix,
    inferExpressionModeFromValue,
    stripExpressionPrefix,
    isExpressionValue,
} from "@workflow_studio/utils/expression_utils";
import {
    buildContextExpressionSuggestions,
    filterSuggestions,
    mergeUniqueSuggestions,
} from "@workflow_studio/utils/input_suggestion_utils";

let nextSuggestionMenuId = 1;

/**
 * ExpressionInput Component
 *
 * Input field that supports both static values and n8n-style expressions.
 * Mode is controlled by parent; no auto-switching based on value.
 */
export class ExpressionInput extends Component {
    static template = "workflow_studio.expression_input";
    static components = { Dropdown, DropdownItem };

    static props = {
        value: { type: String, optional: true },
        placeholder: { type: String, optional: true },
        label: { type: String, optional: true },
        // Expression evaluation context for preview, e.g. { _vars, _node, _json, _loop, _input }
        context: { type: Object, optional: true },
        multiline: { type: Boolean, optional: true }, // Use textarea
        // Controlled mode: 'fixed' | 'expression'
        mode: { type: String, optional: true },
        // Toggle UI placement: 'top' | 'side' | 'none'
        toggleMode: { type: String, optional: true },
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
        const initialStoredValue = typeof this.props.value === "string" ? this.props.value : "";
        const initialMode = this._normalizeMode(this.props.mode)
            || this._inferModeFromValue(initialStoredValue);
        const initialValue = this._toDisplayValue(initialStoredValue, initialMode);

        this.fieldRef = useRef("fieldRef");
        this.dropdownMenuRef = useChildRef();
        this.suggestionsDropdownState = useDropdownState();
        this.suggestionIdPrefix = `expression-input-suggestion-${nextSuggestionMenuId++}`;
        this._dragEnterCount = 0;
        this._ignoreBlur = false;

        this.state = useState({
            isFocused: false,
            isDragOver: false,
            showSuggestions: false,
            activeSuggestionIndex: -1,
            scrollTop: 0,
            scrollLeft: 0,
            // Local value for reactivity - syncs with props
            localValue: initialValue,
            // Fallback mode when parent does not control mode explicitly
            localMode: initialMode,
            mode: initialMode, // "fixed" | "expression"
        });

        // Option 2: sync localValue when parent updates props (avoid stale state if component is reused)
        onWillUpdateProps((nextProps) => {
            const nextValue = nextProps && typeof nextProps.value === "string" ? nextProps.value : "";
            const nextMode = this._normalizeMode(nextProps && nextProps.mode);
            const inferredNextMode = nextMode || this._inferModeFromValue(nextValue);
            const nextDisplayValue = this._toDisplayValue(nextValue, inferredNextMode);
            const valueChanged = nextDisplayValue !== this.state.localValue;
            const modeChanged = inferredNextMode !== this.mode;

            // While focused, keep typing responsive, but still sync when mode flips
            // (e.g. user adds leading '=' in fixed mode and parent promotes to expression).
            if (this.state.isFocused && !modeChanged) return;

            if (valueChanged || modeChanged) {
                this.state.localValue = nextDisplayValue;
            }

            // If mode is controlled by parent, keep local mode synchronized.
            if (nextMode) {
                this.state.localMode = nextMode;
                return;
            }

            // For uncontrolled mode, infer initial mode from incoming value.
            if (valueChanged || modeChanged) {
                this.state.localMode = inferredNextMode;
            }
        });

        useEffect(
            (shouldShowSuggestions) => {
                if (shouldShowSuggestions) {
                    this.suggestionsDropdownState.open();
                } else {
                    this.suggestionsDropdownState.close();
                }
            },
            () => [this.shouldShowSuggestions]
        );
    }

    _normalizeMode(mode) {
        if (mode === "fixed" || mode === "expression") {
            return mode;
        }
        return "";
    }

    _normalizeToggleMode(mode) {
        if (mode === "top" || mode === "side" || mode === "none") {
            return mode;
        }
        return "top";
    }

    _inferModeFromValue(value) {
        if (inferExpressionModeFromValue(value)) {
            return "expression";
        }
        return "fixed";
    }

    _toDisplayValue(value, mode = this.mode) {
        const text = typeof value === "string" ? value : "";
        return mode === "expression" ? stripExpressionPrefix(text) : text;
    }

    _serializeValue(value, mode = this.mode) {
        const text = typeof value === "string" ? value : value == null ? "" : String(value);
        if (mode === "expression") {
            return ensureExpressionPrefix(text);
        }
        return text;
    }

    get hasControlledMode() {
        return this._normalizeMode(this.props.mode) !== "";
    }

    get toggleMode() {
        return this._normalizeToggleMode(this.props.toggleMode);
    }

    get showTopToggle() {
        return !this.props.readonly && this.toggleMode === "top";
    }

    get showSideToggle() {
        return !this.props.readonly && this.toggleMode === "side";
    }

    get showHeader() {
        return Boolean(this.props.label) || this.showTopToggle;
    }

    get currentValue() {
        // Use local state value for reactivity
        return this.state.localValue;
    }

    get hasExpressionHighlights() {
        return this.isExpression && extractExpressions(this.currentValue).length > 0;
    }

    get highlightSegments() {
        const value = this.currentValue || "";
        const expressions = extractExpressions(value);

        if (!expressions.length) {
            return [{ id: 0, text: value, isExpression: false }];
        }

        const segments = [];
        let cursor = 0;

        for (let index = 0; index < expressions.length; index++) {
            const match = expressions[index];
            if (match.start > cursor) {
                segments.push({
                    id: `${index}-plain-${cursor}`,
                    text: value.slice(cursor, match.start),
                    isExpression: false,
                });
            }

            segments.push({
                id: `${index}-expr-${match.start}`,
                text: match.full,
                isExpression: true,
            });
            cursor = match.end;
        }

        if (cursor < value.length) {
            segments.push({
                id: `tail-${cursor}`,
                text: value.slice(cursor),
                isExpression: false,
            });
        }

        if (!segments.length) {
            segments.push({ id: 0, text: value, isExpression: false });
        }

        return segments;
    }

    get highlightContentStyle() {
        const { scrollLeft, scrollTop } = this.state;
        if (!scrollLeft && !scrollTop) {
            return "";
        }
        return `transform: translate(${-scrollLeft}px, ${-scrollTop}px);`;
    }

    get mode() {
        const controlledMode = this._normalizeMode(this.props.mode);
        if (controlledMode) {
            return controlledMode;
        }
        return this.state.localMode || "fixed";
    }

    get isExpression() {
        return this.mode === "expression";
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

        const result = evaluateExpression(this._serializeValue(this.currentValue, "expression"), this.props.context);
        return result;
    }

    get previewDisplay() {
        const result = this.previewResult;
        if (!result) return "";

        if (result.error) {
            return `Error: ${result.error}`;
        }

        if (result.value === undefined) {
            return "undefined";
        }

        if (typeof result.value === "object") {
            return this._safeStringify(result.value);
        }

        return String(result.value);
    }

    get previewType() {
        const result = this.previewResult;
        if (!result || result.error || result.type === null) return "";
        return result.type || "";
    }

    _safeStringify(value) {
        try {
            return JSON.stringify(value, null, 2);
        } catch {
            return "[Unserializable value]";
        }
    }

    // ============================================
    // EVENT HANDLERS
    // ============================================

    onInput(ev) {
        const value = ev.target.value;

        // Auto-switch to expression mode when user types '=' as the sole character
        // in a fixed-mode input that has an expression toggle available.
        if (
            !this.isExpression &&
            value === "=" &&
            (this.showSideToggle || this.showTopToggle)
        ) {
            // For uncontrolled mode, flip local state immediately.
            // For controlled mode, the parent will re-render with mode="expression"
            // once onModeChange propagates — so we only touch localMode when safe.
            if (!this.hasControlledMode) {
                this.state.localMode = "expression";
            }
            this.state.localValue = "";
            this.state.showSuggestions = true;
            this.state.activeSuggestionIndex = -1;
            this.props.onChange("="); // expression prefix with empty body
            if (this.props.onModeChange) {
                this.props.onModeChange("expression");
            }
            // Reset cursor to start of the now-empty input
            requestAnimationFrame(() => {
                const inputEl = this.getInputElement();
                if (inputEl) {
                    inputEl.setSelectionRange(0, 0);
                }
            });
            return;
        }

        // Update local state for reactivity
        this.state.localValue = value;
        this.state.showSuggestions = true;
        this.state.activeSuggestionIndex = -1;

        this.props.onChange(this._serializeValue(value));
    }

    onFocus() {
        this.state.isFocused = true;
        this.state.showSuggestions = true;
    }

    onBlur() {
        if (this._ignoreBlur) {
            this._ignoreBlur = false;
            return;
        }
        this.state.isFocused = false;
        this.state.showSuggestions = false;
        this.state.activeSuggestionIndex = -1;
    }

    onScroll(ev) {
        this.state.scrollTop = ev.target.scrollTop || 0;
        this.state.scrollLeft = ev.target.scrollLeft || 0;
    }

    setMode(mode) {
        const normalized = this._normalizeMode(mode);
        if (!normalized) {
            return;
        }

        const currentMode = this.mode;
        const currentDisplayValue = this.currentValue;
        const previousSerialized = this._serializeValue(currentDisplayValue, currentMode);
        const nextSerialized = this._serializeValue(currentDisplayValue, normalized);

        if (!this.hasControlledMode) {
            this.state.localMode = normalized;
        }

        this.state.localValue = this._toDisplayValue(nextSerialized, normalized);

        if (nextSerialized !== previousSerialized) {
            this.props.onChange(nextSerialized);
        }

        if (this.props.onModeChange) {
            this.props.onModeChange(normalized);
        }
        this.state.showSuggestions = false;
        this.state.activeSuggestionIndex = -1;
    }

    onClickFixed() {
        this.setMode("fixed");
    }

    onClickExpression() {
        this.setMode("expression");
    }

    onClickSideToggle() {
        const nextMode = this.isExpression ? "fixed" : "expression";
        this.setMode(nextMode);
    }

    // ============================================
    // DRAG-DROP HANDLERS
    // ============================================

    onDragEnter(ev) {
        ev.preventDefault();
        this._dragEnterCount++;
        this.state.isDragOver = true;
    }

    onDragLeave(ev) {
        ev.preventDefault();
        this._dragEnterCount--;
        if (this._dragEnterCount <= 0) {
            this._dragEnterCount = 0;
            this.state.isDragOver = false;
        }
    }

    onDragOver(ev) {
        ev.preventDefault();
        // Allow drop
        ev.dataTransfer.dropEffect = "copy";
    }

    _getDropPayload(ev) {
        const expression = ev.dataTransfer.getData('application/x-expression');
        const path = ev.dataTransfer.getData('text/plain');
        const keyName = ev.dataTransfer.getData('application/x-expression-key');
        const rawMeta = ev.dataTransfer.getData('application/x-expression-meta');
        let meta = null;

        if (rawMeta) {
            try {
                meta = JSON.parse(rawMeta);
            } catch {
                meta = null;
            }
        }

        return {
            expression,
            path,
            keyName: keyName || (meta && typeof meta.keyName === "string" ? meta.keyName : ""),
            meta,
        };
    }

    onDrop(ev) {
        ev.preventDefault();
        this._dragEnterCount = 0;
        this.state.isDragOver = false;

        const dropPayload = this._getDropPayload(ev);
        const expression = dropPayload.expression;
        const path = dropPayload.path;

        const currentMode = this.mode;
        const currentDisplayValue = this.currentValue;
        const previousSerialized = this._serializeValue(currentDisplayValue, currentMode);

        if (this.props.onDrop) {
            const override = this.props.onDrop(dropPayload);
            if (override && override.handled) {
                const nextMode = this._normalizeMode(override.mode) || currentMode;
                const nextSerialized = override.serializedValue !== undefined
                    ? String(override.serializedValue ?? "")
                    : this._serializeValue(override.value ?? "", nextMode);

                if (!this.hasControlledMode) {
                    this.state.localMode = nextMode;
                }
                this.state.localValue = this._toDisplayValue(nextSerialized, nextMode);

                if (nextSerialized !== previousSerialized) {
                    this.props.onChange(nextSerialized);
                }
                if (this.props.onModeChange && nextMode !== currentMode) {
                    this.props.onModeChange(nextMode);
                }

                this.state.showSuggestions = false;
                this.state.activeSuggestionIndex = -1;
                return;
            }
        }

        const insertText = expression || (path ? wrapExpression(path) : "");
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

        this.props.onChange(this._serializeValue(newValue));
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
            this._scrollActiveSuggestionIntoView();
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
            this._scrollActiveSuggestionIntoView();
            return;
        }

        if (ev.key === "ArrowUp") {
            ev.preventDefault();
            this.state.activeSuggestionIndex = Math.max(-1, this.state.activeSuggestionIndex - 1);
            this._scrollActiveSuggestionIntoView();
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

    onSuggestionsPointerDown() {
        this._ignoreBlur = true;
    }

    onSuggestionSelected(item) {
        this._applySuggestion(item);
        requestAnimationFrame(() => {
            const inputEl = this.getInputElement();
            if (inputEl) {
                inputEl.focus();
            }
        });
    }

    getSuggestionItemAttrs(index) {
        const attrs = {
            id: this.getSuggestionDomId(index),
        };
        if (index === this.state.activeSuggestionIndex) {
            attrs["aria-selected"] = "true";
        }
        return attrs;
    }

    getSuggestionDomId(index) {
        return `${this.suggestionIdPrefix}-${index}`;
    }

    getInputElement() {
        const root = this.fieldRef.el;
        if (!root) {
            return null;
        }
        return root.querySelector("input, textarea");
    }

    _scrollActiveSuggestionIntoView() {
        if (this.state.activeSuggestionIndex < 0) {
            return;
        }
        requestAnimationFrame(() => {
            const activeEl = document.getElementById(
                this.getSuggestionDomId(this.state.activeSuggestionIndex)
            );
            if (activeEl && typeof activeEl.scrollIntoView === "function") {
                activeEl.scrollIntoView({ block: "nearest" });
            }
        });
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
        this.props.onChange(this._serializeValue(nextValue));
    }
}
