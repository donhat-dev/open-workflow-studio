/** @odoo-module **/

import { Component, onWillUpdateProps, useState } from "@odoo/owl";
import { ExpressionInput } from "@workflow_studio/components/expression/ExpressionInput";
import { Expression } from "@web/core/tree_editor/condition_tree";
import { isExpressionValue } from "./domain_builder_utils";
import { hasExpressions } from "@workflow_studio/utils/expression_utils";

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
        if (isExpressionValue(normalized)) {
            return normalized;
        }
        if (shouldWrapAsRawExpression(normalized)) {
            return `{{ ${normalized.trim()} }}`;
        }
        return `{{ ${JSON.stringify(normalized)} }}`;
    }
    return `{{ ${JSON.stringify(normalized)} }}`;
}

function unwrapExpressionBody(value) {
    if (value instanceof Expression) {
        return value.toString();
    }
    if (typeof value !== "string") {
        return null;
    }
    const match = value.trim().match(/^\{\{([\s\S]*)\}\}$/);
    if (!match) {
        return null;
    }
    return match[1].trim();
}

/**
 * Try to convert a {{ expr }} string to an Expression instance.
 * Returns the Expression on success, or the original raw string on
 * parse failure (graceful degradation — avoids crash-while-typing).
 *
 * If the value is already an Expression or is not a {{ }}-wrapped
 * string, return it unchanged.
 */
function toExpressionInstance(value) {
    if (value instanceof Expression) {
        return value;
    }
    if (typeof value !== "string") {
        return value;
    }
    const body = unwrapExpressionBody(value);
    if (body === null) {
        return value;
    }
    try {
        return new Expression(body);
    } catch {
        // Parsing failed (incomplete/invalid Python syntax during typing).
        // Return the raw {{ expr }} string — it will be serialized as a
        // quoted string temporarily, but that's safe and non-crashing.
        return value;
    }
}

/**
 * Check whether a value represents an expression — either an Expression
 * instance or a {{ }}-wrapped string.
 */
function isExpressionLike(value) {
    return value instanceof Expression || isExpressionValue(value);
}

function shouldUseExpressionMode(value) {
    return isExpressionLike(value) || (typeof value === "string" && hasExpressions(value));
}

function toLiteralSeed(expressionValue, fallbackValue) {
    const inner = unwrapExpressionBody(expressionValue);
    if (inner === null) {
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
            expressionValid: shouldUseExpressionMode(initialValue),
        });

        onWillUpdateProps((nextProps) => {
            const nextValue = nextProps ? nextProps.value : undefined;
            this.state.mode = shouldUseExpressionMode(nextValue) ? "expression" : "literal";
            this.state.expressionValid = shouldUseExpressionMode(nextValue);
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
            return `{{ ${v.toString()} }}`;
        }
        return typeof v === "string" ? v : "";
    }

    toggleMode() {
        if (this.state.mode === "literal") {
            // Switch to expression: wrap current value as Expression instance
            this.state.mode = "expression";
            const current = normalizeLiteralCandidate(this.props.value);
            if (current !== undefined && current !== false && current !== "" && !isExpressionLike(current)) {
                const seed = toExpressionSeed(current);
                this.props.update(toExpressionInstance(seed));
            }
        } else {
            // Switch to literal: try to preserve the expression payload as literal.
            // Example: Expression("_input.item.records[0].id") => _input.item.records[0].id
            //          {{ _input.item.records[0].id }} => _input.item.records[0].id
            this.state.mode = "literal";
            this.props.update(toLiteralSeed(this.props.value, this.props.nativeEditorInfo.defaultValue()));
        }
    }

    onExpressionModeChange(mode) {
        if (mode === "fixed" && this.state.mode === "expression") {
            this.toggleMode();
        }
    }

    onExpressionChange(newVal) {
        // Convert {{ expr }} strings to Expression instances so that
        // domainFromTree's toAST() serializes them as unquoted code,
        // not as string literals.
        //
        // toExpressionInstance is safe: if the Python body can't be parsed
        // (e.g. user is mid-keystroke), it returns the raw string.
        const converted = toExpressionInstance(newVal);
        // Partial templates like "Name is {{ _input.field }}" are valid even though
        // they don't wrap to an Expression instance — backend renders them as template strings.
        this.state.expressionValid = shouldUseExpressionMode(converted) || (typeof newVal === "string" && hasExpressions(newVal));
        this.props.update(converted);
    }
}
