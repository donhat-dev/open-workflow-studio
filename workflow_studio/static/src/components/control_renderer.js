/** @odoo-module **/

import { Component, useState, onWillUpdateProps } from "@odoo/owl";
import { ExpressionInput } from "./expression/ExpressionInput";
import { CodeEditor } from "./code_editor";
import { AuthControl } from "./controls/auth_control";
import { BodyTypeControl } from "./controls/body_type_control";
import { QueryParamsControl } from "./controls/query_params_control";
import { getSuggestionsByKey } from "@workflow_studio/utils/input_suggestion_utils";
import { DomainControl } from "./domain_control/domain_control";
import { FieldValuesControl } from "./field_values_control/field_values_control";
import { TriggerFieldsControl } from "./controls/trigger_fields_control";
import { inferExpressionModeFromValue } from "@workflow_studio/utils/expression_utils";

/**
 * ControlRenderer Component
 *
 * Phase 3 Architecture:
 * - Receives plain control metadata objects (NOT Control instances)
 * - No more getValue()/setValue() method calls
 * - Uses onChange callback to notify parent of value changes
 *
 * Control object shape:
 * {
 *   key: string,
 *   type: 'text' | 'select' | 'checkbox' | 'number' | 'keyvalue' | 'code',
 *   label: string,
 *   value: any,
 *   placeholder?: string,
 *   multiline?: boolean,
 *   options?: Array<{value, label}>,
 *   keyPlaceholder?: string,
 *   valuePlaceholder?: string,
 *   suggestions?: Array,
 *   valueSuggestions?: Array,
 *   expressionSuggestions?: Array,
 *   suggestionsByKey?: Object,
 *   height?: number,       // For code control
 *   language?: string,     // For code control
 * }
 */
export class ControlRenderer extends Component {
    static template = "workflow_studio.control_renderer";
    static components = { ExpressionInput, CodeEditor, AuthControl, BodyTypeControl, QueryParamsControl, DomainControl, FieldValuesControl, TriggerFieldsControl };

    static props = {
        control: Object,  // Plain object, not Control instance
        onChange: { type: Function },
        inputContext: { type: Object, optional: true },  // { _json: {...} } for expression preview
        // Controlled expression mode
        mode: { type: String, optional: true }, // 'fixed' | 'expression'
        onModeChange: { type: Function, optional: true },
        // For keyvalue controls: modes per pair id
        pairModes: { type: Object, optional: true },
        onPairModeChange: { type: Function, optional: true },
        // Readonly mode (execution view)
        readonly: { type: Boolean, optional: true },
        // Sibling control values — needed by domain/field_values controls to read model
        controlValues: { type: Object, optional: true },
    };

    setup() {
        // For keyvalue controls, maintain reactive state
        this._nextPairId = 1;

        const initialPairs = this.props.control?.type === 'keyvalue'
            ? this._normalizePairs(this.props.control.value || [])
            : [];

        this.state = useState({ pairs: initialPairs });

        // Option 2: sync internal state when props update (avoid stale state if panel/control is reused)
        onWillUpdateProps((nextProps) => {
            const nextControl = nextProps?.control;
            const prevControl = this.props?.control;

            const nextType = nextControl?.type;
            const prevType = prevControl?.type;

            // Only keyvalue uses internal state
            if (nextType !== 'keyvalue') {
                if (prevType === 'keyvalue' && this.state.pairs.length) {
                    this.state.pairs = [];
                }
                return;
            }

            const nextPairsRaw = nextControl?.value || [];
            const nextPairs = this._normalizePairs(nextPairsRaw);

            // Avoid clobbering local edits when parent re-renders with same data.
            const nextSig = this._pairsSignature(nextPairs);
            const currentSig = this._pairsSignature(this.state.pairs);

            if (nextSig !== currentSig) {
                this.state.pairs = nextPairs;
            }
        });
    }

    _normalizePairs(pairs) {
        const safePairs = Array.isArray(pairs) ? pairs : [];
        const maxId = safePairs.reduce((max, p) => Math.max(max, p?.id || 0), 0);
        this._nextPairId = Math.max(1, maxId + 1);

        return safePairs.map((p) => {
            const id = p?.id || this._nextPairId++;
            return {
                id,
                key: p?.key || '',
                value: p?.value || '',
            };
        });
    }

    _pairsSignature(pairs) {
    const safe = Array.isArray(pairs) ? pairs : [];
        return safe
            .map((p) => `${p?.id || ''}:${p?.key || ''}=${p?.value || ''}`)
            .join('|');
    }

    get controlType() {
        return this.props.control?.type || 'text';
    }

    // Phase 3: Read value directly from plain object
    get value() {
        const rawValue = this.props.control?.value ?? '';
        return rawValue;
    }

    get label() {
        return this.props.control?.label || '';
    }

    get placeholder() {
        return this.props.control?.placeholder || '';
    }

    get isMultiline() {
        return this.props.control?.multiline || false;
    }

    get options() {
        return this.props.control?.options || [];
    }

    get suggestions() {
        return this.props.control?.suggestions || [];
    }

    get valueSuggestions() {
        return this.props.control?.valueSuggestions || [];
    }

    get expressionSuggestions() {
        return this.props.control?.expressionSuggestions || [];
    }

    get suggestionsByKey() {
        const map = this.props.control?.suggestionsByKey;
        if (map && typeof map === "object" && !Array.isArray(map)) {
            return map;
        }
        return {};
    }

    /**
     * Current selected model name — read from sibling controlValues.
     * Used by domain and field_values controls to pass resModel prop.
     */
    get resModel() {
        const vals = this.props.controlValues;
        if (!vals || typeof vals !== "object") return "";
        const model = vals.model;
        return typeof model === "string" ? model.trim() : "";
    }

    /**
     * Current selected operation — read from sibling controlValues.
     * Used by field_values control to filter field suggestions (create vs write).
     */
    get operation() {
        const vals = this.props.controlValues;
        if (!vals || typeof vals !== "object") return "";
        const op = vals.operation;
        return typeof op === "string" ? op : "";
    }

    getPairValueSuggestions(pair) {
        const pairKey = pair && typeof pair.key === "string" ? pair.key : "";
        const byKey = getSuggestionsByKey(this.suggestionsByKey, pairKey);
        return byKey;
    }

    get pairs() {
        // Return reactive state for keyvalue controls
        return this.state.pairs;
    }

    /**
     * Handle text/number input change
     * Phase 3: Only call onChange, no setValue()
     */
    onInput(ev) {
        const value = ev.target.value;
        this.props.onChange(this.props.control.key, value);
    }

    /**
     * Handle ExpressionInput change (supports expressions + drag-drop)
     */
    onExpressionChange(value) {
        this.props.onChange(this.props.control.key, value);
    }

    onExpressionModeChange(mode) {
        if (this.props.onModeChange) {
            this.props.onModeChange(this.props.control.key, mode);
        }
    }

    getPairMode(pairId) {
        const modes = this.props.pairModes || {};
        return modes[pairId] || 'fixed';
    }

    onPairValueModeChange(pairId, mode) {
        if (this.props.onPairModeChange) {
            this.props.onPairModeChange(this.props.control.key, pairId, 'value', mode);
        }
    }

    onPairKeyModeChange(pairId, mode) {
        if (this.props.onPairModeChange) {
            this.props.onPairModeChange(this.props.control.key, pairId, 'key', mode);
        }
    }

    getPairKeyMode(pairId) {
        const pair = this.state.pairs.find((item) => item.id === pairId);
        const currentValue = pair && typeof pair.key === "string" ? pair.key : "";
        if (inferExpressionModeFromValue(currentValue)) {
            return "expression";
        }

        const modes = this.props.pairModes || {};
        const pairMode = modes[pairId];
        if (!currentValue && typeof pairMode === "string") return "fixed"; // Legacy normalization
        if (!currentValue && pairMode && typeof pairMode === 'object') return pairMode.key || 'fixed';
        if (typeof pairMode === "string") return "fixed"; // Legacy normalization
        if (!pairMode || typeof pairMode !== 'object') return 'fixed';
        return pairMode.key || 'fixed';
    }

    getPairValueMode(pairId) {
        const pair = this.state.pairs.find((item) => item.id === pairId);
        const currentValue = pair && typeof pair.value === "string" ? pair.value : "";
        if (inferExpressionModeFromValue(currentValue)) {
            return "expression";
        }

        const modes = this.props.pairModes || {};
        const pairMode = modes[pairId];
        if (!currentValue && typeof pairMode === "string") return pairMode;
        if (!currentValue && pairMode && typeof pairMode === 'object') return pairMode.value || 'fixed';
        if (typeof pairMode === "string") return pairMode; // Legacy support
        if (!pairMode || typeof pairMode !== 'object') return 'fixed';
        return pairMode.value || 'fixed';
    }

    /**
     * Handle select change
     */
    onSelectChange(ev) {
        const value = ev.target.value;
        this.props.onChange(this.props.control.key, value);
    }

    /**
     * Handle checkbox toggle
     */
    onCheckboxChange(ev) {
        const value = ev.target.checked;
        this.props.onChange(this.props.control.key, value);
    }

    /**
     * Handle code editor change
     */
    onCodeChange(value) {
        this.props.onChange(this.props.control.key, value);
    }

    /**
     * Handle auth control change (composite value)
     */
    onAuthChange = (value) => {
        this.props.onChange(this.props.control.key, value);
    };

    /**
     * Handle body type control change (composite value)
     */
    onBodyTypeChange = (value) => {
        this.props.onChange(this.props.control.key, value);
    };

    /**
     * Handle trigger fields control change (array value)
     */
    onTriggerFieldsChange = (value) => {
        this.props.onChange(this.props.control.key, value);
    };

    /**
     * Handle query params control change (array value)
     */
    onQueryParamsChange = (value) => {
        this.props.onChange(this.props.control.key, value);
    };

    // ============================================
    // KEY-VALUE CONTROL HANDLERS
    // ============================================

    onKeyChange(index, value) {
        const control = this.props.control;
        if (!this.state.pairs[index]) {
            throw new Error(`[ControlRenderer] Pair at index ${index} not found for key change`);
        }
        this.state.pairs[index].key = value;
        // Notify parent with updated pairs
        this.props.onChange(control.key, [...this.state.pairs]);
    }

    onValueChange(index, ev) {
        const control = this.props.control;
        if (!this.state.pairs[index]) {
            throw new Error(`[ControlRenderer] Pair at index ${index} not found for value change`);
        }
        this.state.pairs[index].value = ev.target.value;
        // Notify parent with updated pairs
        this.props.onChange(control.key, [...this.state.pairs]);
    }

    /**
     * Handle ExpressionInput change for keyvalue value cell
     * @param {number} index
     * @param {string} value
     */
    onValueExpressionChange(index, value) {
        const control = this.props.control;
        if (!this.state.pairs[index]) {
            throw new Error(`[ControlRenderer] Pair at index ${index} not found for value expression change`);
        }
        this.state.pairs[index].value = value;
        this.props.onChange(control.key, [...this.state.pairs]);
    }

    addPair() {
        const control = this.props.control;
        // Add new pair to reactive state
        this.state.pairs.push({ id: this._nextPairId++, key: '', value: '' });
        // Notify parent with updated pairs
        this.props.onChange(control.key, [...this.state.pairs]);
    }

    removePair(index) {
        const control = this.props.control;
        if (this.state.pairs.length <= 1) return;
        // Remove pair from reactive state
        this.state.pairs.splice(index, 1);
        // Notify parent with updated pairs
        this.props.onChange(control.key, [...this.state.pairs]);
    }
}
