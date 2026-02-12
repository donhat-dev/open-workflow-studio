/** @odoo-module **/

import { Component, useState } from "@odoo/owl";
import { AutoComplete } from "@web/core/autocomplete/autocomplete";

export class InputAutoComplete extends Component {
    static template = "workflow_studio.InputAutoComplete";
    static components = { AutoComplete };
    static props = {
        value: { type: String, optional: true },
        placeholder: { type: String, optional: true },
        getSuggestions: { type: Function }, // (request) => Promise<Array<{ label, value }>>
        onSelect: { type: Function },
        onInput: { type: Function, optional: true },
        class: { type: String, optional: true },
        autofocus: { type: Boolean, optional: true },
    };
    static defaultProps = {
        value: "",
        placeholder: "",
        onInput: () => {},
        class: "",
        autofocus: false,
    };

    setup() {
        this.state = useState({
            value: this.props.value || "",
        });
    }

    get sources() {
        return [
            {
                options: async (request) => {
                    const suggestions = await this.props.getSuggestions(request);
                    return suggestions.map((s) => ({
                        label: s.label || s.value,
                        value: s.value,
                    }));
                },
            },
        ];
    }

    onSelect(option) {
        this.state.value = option.value;
        this.props.onSelect(option.value);
    }

    onInput(ev) {
        const val = typeof ev === "object" ? ev.inputValue : ev;
        this.state.value = val;
        this.props.onInput(val);
    }
}
