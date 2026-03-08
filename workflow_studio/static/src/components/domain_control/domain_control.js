/** @odoo-module **/

import { Component, onMounted, onWillUpdateProps, useState } from "@odoo/owl";
import { DomainSelector } from "@web/core/domain_selector/domain_selector";
import { useService } from "@web/core/utils/hooks";
import { useOdooModels } from "@workflow_studio/utils/use_odoo_models";

/**
 * DomainControl — wraps Odoo's DomainSelector as a workflow config control.
 *
 * DomainSelector is standalone-compatible: it only needs resModel + domain string
 * and injects fieldService itself via useService("field"). No form record required.
 *
 * When resModel changes, the domain is reset to "[]" so stale field references
 * from the previous model are cleared.
 */
export class DomainControl extends Component {
    static template = "workflow_studio.domain_control";
    static components = { DomainSelector };

    static props = {
        resModel: { type: String, optional: true },
        value: { type: String, optional: true },
        onChange: Function,
        readonly: { type: Boolean, optional: true },
    };

    setup() {
        this.orm = useService("orm");
        this._odooModels = useOdooModels();

        this.state = useState({
            validatedModel: "",
            isValidModel: false,
        });

        this._modelValidityCache = new Map();
        this._validationSeq = 0;
        this._prevResModel = this.props.resModel || "";

        onMounted(() => {
            this._validateModelName(this._prevResModel);
        });

        onWillUpdateProps((nextProps) => {
            const next = nextProps.resModel || "";
            const prev = this._prevResModel;
            this._prevResModel = next;

            this._validateModelName(next);

            // Reset domain when model changes to avoid stale field references
            if (prev && next !== prev) {
                this.props.onChange("[]");
            }
        });
    }

    _setValidation(modelName, isValid) {
        this.state.validatedModel = modelName;
        this.state.isValidModel = Boolean(isValid);
    }

    async _validateModelName(rawModelName) {
        const modelName = typeof rawModelName === "string" ? rawModelName.trim() : "";
        const seq = ++this._validationSeq;

        if (!modelName || !modelName.includes(".")) {
            this._setValidation(modelName, false);
            return;
        }

        if (this._modelValidityCache.has(modelName)) {
            this._setValidation(modelName, this._modelValidityCache.get(modelName));
            return;
        }

        if (this._odooModels.getModelMetaByName(modelName)) {
            this._modelValidityCache.set(modelName, true);
            this._setValidation(modelName, true);
            return;
        }

        try {
            const count = await this.orm.searchCount("ir.model", [["model", "=", modelName]]);
            if (seq !== this._validationSeq) {
                return;
            }
            const exists = count > 0;
            this._modelValidityCache.set(modelName, exists);
            this._setValidation(modelName, exists);
        } catch {
            if (seq !== this._validationSeq) {
                return;
            }
            this._modelValidityCache.set(modelName, false);
            this._setValidation(modelName, false);
        }
    }

    /**
     * Only render DomainSelector when resModel looks like a complete Odoo model name.
     * All valid Odoo model names contain a dot (e.g., "res.partner", "sale.order").
     * This prevents 404 errors when the user is still typing the model name.
     */
    get isValidModel() {
        const m = this.props.resModel;
        const current = typeof m === "string" ? m.trim() : "";
        return this.state.isValidModel && this.state.validatedModel === current;
    }

    get domain() {
        const v = this.props.value;
        if (!v || typeof v !== "string") return "[]";
        return v;
    }

    onDomainUpdate(domainStr) {
        this.props.onChange(domainStr);
    }
}
