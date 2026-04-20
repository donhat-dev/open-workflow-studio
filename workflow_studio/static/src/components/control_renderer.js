/** @odoo-module **/

import { Component } from "@odoo/owl";
import { ExpressionInput } from "./expression/ExpressionInput";
import { CodeEditor } from "./code_editor";
import { AuthControl } from "./controls/auth_control";
import { BodyTypeControl } from "./controls/body_type_control";
import { KeyValueTable } from "./controls/key_value_table";
import { getSuggestionsByKey } from "@workflow_studio/utils/input_suggestion_utils";
import { DomainControl } from "./domain_control/domain_control";
import { FieldValuesControl } from "./field_values_control/field_values_control";
import { TriggerFieldsControl } from "./controls/trigger_fields_control";

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
    static components = { ExpressionInput, CodeEditor, AuthControl, BodyTypeControl, KeyValueTable, DomainControl, FieldValuesControl, TriggerFieldsControl };

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
        // No internal keyvalue state — delegated to KeyValueTable component
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

    /**
     * Handle KeyValueTable change — wraps pairs array with control key
     */
    onKeyValueChange = (pairs) => {
        this.props.onChange(this.props.control.key, pairs);
    };

    onKeyValuePairModeChange = (pairId, field, mode) => {
        if (this.props.onPairModeChange) {
            this.props.onPairModeChange(this.props.control.key, pairId, field, mode);
        }
    };

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


}
