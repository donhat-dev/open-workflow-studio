/** @odoo-module **/

import { Component, useState } from "@odoo/owl";
import { ExpressionInput } from "./expression/ExpressionInput";

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
 *   type: 'text' | 'select' | 'checkbox' | 'number' | 'keyvalue',
 *   label: string,
 *   value: any,
 *   placeholder?: string,
 *   multiline?: boolean,
 *   options?: Array<{value, label}>,
 *   keyPlaceholder?: string,
 *   valuePlaceholder?: string,
 * }
 */
export class ControlRenderer extends Component {
    static template = "workflow_pilot.control_renderer";
    static components = { ExpressionInput };

    static props = {
        control: Object,  // Plain object, not Control instance
        onChange: { type: Function },
        inputContext: { type: Object, optional: true },  // { $json: {...} } for expression preview
    };

    setup() {
        // For keyvalue controls, maintain reactive state
        this.state = useState({
            // Copy pairs from control to reactive state
            pairs: this.props.control?.type === 'keyvalue'
                ? [...(this.props.control.value || [])]
                : [],
        });
    }

    get controlType() {
        return this.props.control?.type || 'text';
    }

    // Phase 3: Read value directly from plain object
    get value() {
        return this.props.control?.value ?? '';
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

    // ============================================
    // KEY-VALUE CONTROL HANDLERS
    // ============================================

    onKeyChange(index, ev) {
        const control = this.props.control;
        if (!this.state.pairs[index]) {
            throw new Error(`[ControlRenderer] Pair at index ${index} not found for key change`);
        }
        this.state.pairs[index].key = ev.target.value;
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

    addPair() {
        const control = this.props.control;
        // Add new pair to reactive state
        this.state.pairs.push({ key: '', value: '' });
        // Notify parent with updated pairs
        this.props.onChange(control.key, [...this.state.pairs]);
    }

    removePair(index) {
        const control = this.props.control;
        // Remove pair from reactive state
        this.state.pairs.splice(index, 1);
        // Notify parent with updated pairs
        this.props.onChange(control.key, [...this.state.pairs]);
    }
}
