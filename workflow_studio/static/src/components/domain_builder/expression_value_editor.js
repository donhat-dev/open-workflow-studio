/** @odoo-module **/

import { Component, onWillUpdateProps, useState } from "@odoo/owl";
import { ExpressionInput } from "@workflow_studio/components/expression/ExpressionInput";
import { Expression } from "@web/core/tree_editor/condition_tree";
import { isExpressionValue } from "./domain_builder_utils";
import {
    ensureExpressionPrefix,
    inferExpressionModeFromValue,
    isExpressionMode,
    stripExpressionPrefix,
} from "@workflow_studio/utils/expression_utils";

function normalizeLiteralCandidate(value) {
    if (value && typeof value === "object") {
        if (typeof value._expr === "string" && value._expr.trim()) {
            return value._expr.trim();
        }
        if (typeof value.value === "string") {
            return value.value;
        }
    }
    return value;
}

function shouldWrapAsRawExpression(value) {
    if (typeof value !== "string") {
        return false;
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return false;
    }
    return /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*|\[\d+\])*$/.test(trimmed);
}

function toExpressionSeed(value) {
    const normalized = normalizeLiteralCandidate(value);
    if (typeof normalized === "string") {
        if (isExpressionMode(normalized)) {
            return normalized;
        }
        if (isExpressionValue(normalized)) {
            return ensureExpressionPrefix(normalized);
        }
        if (shouldWrapAsRawExpression(normalized)) {
            return ensureExpressionPrefix(`{{ ${normalized.trim()} }}`);
        }
        return ensureExpressionPrefix(`{{ ${JSON.stringify(normalized)} }}`);
    }
    return ensureExpressionPrefix(`{{ ${JSON.stringify(normalized)} }}`);
}

function unwrapExpressionBody(value) {
    if (value instanceof Expression) {
        return value.toString();
    }
    if (typeof value !== "string") {
        return null;
    }
    const match = stripExpressionPrefix(value).trim().match(/^\{\{([\s\S]*)\}\}$/);
    if (!match) {
        return null;
    }
    return match[1].trim();
}

/**
 * Check whether a value represents an expression.
 */
function isExpressionLike(value) {
    return value instanceof Expression || isExpressionValue(value) || isExpressionMode(value);
}

function shouldUseExpressionMode(value) {
    if (value instanceof Expression) {
        return true;
    }
    return inferExpressionModeFromValue(value);
}

function isExpressionContentValid(value) {
    if (value instanceof Expression) {
        return true;
    }
    if (typeof value !== "string") {
        return false;
    }

    return isExpressionMode(value) || isExpressionValue(value);
}

function toLiteralSeed(expressionValue, fallbackValue) {
    const inner = unwrapExpressionBody(expressionValue);
    if (inner === null) {
        if (typeof expressionValue === "string") {
            return stripExpressionPrefix(expressionValue);
        }
        return normalizeLiteralCandidate(fallbackValue);
    }

    if (inner.startsWith('"') && inner.endsWith('"')) {
        try {
            return JSON.parse(inner);
        } catch {
            return inner.slice(1, -1);
        }
    }

    if (inner.startsWith("'") && inner.endsWith("'")) {
        return inner.slice(1, -1);
    }

    if (/^-?\d+(\.\d+)?$/.test(inner)) {
        return Number(inner);
    }

    if (inner === "True") {
        return true;
    }

    if (inner === "False") {
        return false;
    }

    if (inner === "None") {
        return null;
    }

    return inner;
}

/**
 * ExpressionValueEditor — wraps any native Odoo value editor with
 * a literal↔expression toggle.
 *
 * Literal mode  → delegates to nativeEditorInfo.component  (DateTimeInput, Select, …)
 * Expression mode → shows ExpressionInput with {{ … }} syntax.
 *
 * The toggle button (ƒx) lets the user switch between modes.
 * Mode is auto-inferred from the current value on mount.
 *
 * Props passed by getWorkflowValueEditorInfo:
 *   nativeEditorInfo  – full editorInfo object from Odoo's getValueEditorInfo
 *   value             – current leaf value
 *   update            – callback(newValue)
 *   expressionContext  – (optional) expression eval context, injected via env
 *   expressionSuggestions – (optional) suggestion list, injected via env
 */
export class ExpressionValueEditor extends Component {
    static template = "workflow_studio.ExpressionValueEditor";
    static components = { ExpressionInput };

    static props = {
        nativeEditorInfo: Object,
        value: { optional: true },
        update: Function,
        inputContext: { type: Object, optional: true },
    };

    setup() {
        const initialValue = this.props.value;
        this.state = useState({
            mode: shouldUseExpressionMode(initialValue) ? "expression" : "literal",
            expressionValid: isExpressionContentValid(initialValue),
            hasExplicitModeSelection: false,
            dragOver: false,
        });
        /** @type {boolean} true when drag-enter auto-toggled to expression mode */
        this._dragAutoToggled = false;
        /** @type {number} nested enter/leave counter (child elements fire extra events) */
        this._dragEnterCount = 0;

        onWillUpdateProps((nextProps) => {
            const nextValue = nextProps ? nextProps.value : undefined;
            if (!this.state.hasExplicitModeSelection) {
                this.state.mode = shouldUseExpressionMode(nextValue) ? "expression" : "literal";
            }
            this.state.expressionValid = isExpressionContentValid(nextValue);
        });
    }

    get expressionContext() {
        return this.props.inputContext || this.env.workflowExpressionContext || {};
    }

    get expressionSuggestions() {
        return this.env.workflowExpressionSuggestions || [];
    }

    get nativeProps() {
        const { nativeEditorInfo, value, update } = this.props;
        return nativeEditorInfo.extractProps({ value, update });
    }

    get nativeComponent() {
        return this.props.nativeEditorInfo.component;
    }

    get isExpression() {
        return this.state.mode === "expression";
    }

    get expressionValue() {
        const v = this.props.value;
        if (v instanceof Expression) {
            return ensureExpressionPrefix(`{{ ${v.toString()} }}`);
        }
        if (typeof v === "string") {
            return shouldUseExpressionMode(v) && !isExpressionMode(v)
                ? ensureExpressionPrefix(v)
                : v;
        }
        return "";
    }

    toggleMode() {
        this.state.hasExplicitModeSelection = true;
        if (this.state.mode === "literal") {
            // Switch to expression: wrap current value as Expression instance
            this.state.mode = "expression";
            const current = normalizeLiteralCandidate(this.props.value);
            if (current !== undefined && current !== false && current !== "" && !isExpressionLike(current)) {
                const seed = toExpressionSeed(current);
                this.props.update(seed);
            }
        } else {
            // Switch to literal: try to preserve the expression payload as literal.
            // Example: Expression("_input.item.records[0].id") => _input.item.records[0].id
            //          {{ _input.item.records[0].id }} => _input.item.records[0].id
            this.state.mode = "literal";
            this.props.update(toLiteralSeed(this.props.value, this.props.nativeEditorInfo.defaultValue()));
        }
    }

    /**
     * Returns true when the drag payload contains an expression path
     * (i.e. comes from JsonTreeNode in the input panel).
     */
    _isExpressionDrag(ev) {
        return ev.dataTransfer.types.includes("application/x-expression");
    }

    onDragEnter(ev) {
        if (!this._isExpressionDrag(ev)) {
            return;
        }
        ev.preventDefault();
        this._dragEnterCount++;
        this.state.dragOver = true;
        // Auto-toggle to expression mode so the ExpressionInput is ready
        if (this.state.mode === "literal") {
            this._dragAutoToggled = true;
            this.state.mode = "expression";
        }
    }

    onDragOver(ev) {
        if (!this._isExpressionDrag(ev)) {
            return;
        }
        ev.preventDefault();
        ev.dataTransfer.dropEffect = "copy";
    }

    onDragLeave(ev) {
        if (!this._isExpressionDrag(ev)) {
            return;
        }
        this._dragEnterCount--;
        if (this._dragEnterCount > 0) {
            return; // still inside nested children
        }
        this.state.dragOver = false;
        // Revert auto-toggle when drag leaves without drop
        if (this._dragAutoToggled) {
            this._dragAutoToggled = false;
            this.state.mode = "literal";
        }
    }

    onDrop(ev) {
        ev.preventDefault();
        this._dragEnterCount = 0;
        this.state.dragOver = false;

        const expr = ev.dataTransfer.getData("application/x-expression")
            || ev.dataTransfer.getData("text/plain");
        if (expr) {
            // Commit: lock into expression mode (no longer "auto")
            this._dragAutoToggled = false;
            this.state.hasExplicitModeSelection = true;
            if (this.state.mode !== "expression") {
                this.state.mode = "expression";
            }
            this.props.update(ensureExpressionPrefix(expr));
        } else if (this._dragAutoToggled) {
            // No useful data — revert
            this._dragAutoToggled = false;
            this.state.mode = "literal";
        }
    }

    onExpressionModeChange(mode) {
        if (mode === "fixed" && this.state.mode === "expression") {
            this.toggleMode();
        }
    }

    onExpressionChange(newVal) {
        this.state.expressionValid = isExpressionContentValid(newVal);
        this.props.update(newVal);
    }
}
