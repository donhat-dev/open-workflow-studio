/** @odoo-module **/

/**
 * WorkflowDomainBuilder — clone of Odoo's DomainSelector that uses
 * WorkflowTreeEditor instead of TreeEditor.
 *
 * The only functional difference: the value column in each condition
 * renders an ExpressionValueEditor (literal↔expression toggle) instead
 * of plain native editors. All other behaviour (domain↔tree, archived
 * checkbox, operator/path editors, debug textarea) is identical.
 *
 * CSS classes kept identical for Odoo styling parity.
 */

import { Component, onWillStart, onWillUpdateProps, useState } from "@odoo/owl";
import { Domain } from "@web/core/domain";
import {
    domainFromTree,
    treeFromDomain,
    formatValue,
    condition,
} from "@web/core/tree_editor/condition_tree";
import { useLoadFieldInfo } from "@web/core/model_field_selector/utils";
import { CheckBox } from "@web/core/checkbox/checkbox";
import { deepEqual } from "@web/core/utils/objects";
import { getDomainDisplayedOperators } from "@web/core/domain_selector/domain_selector_operator_editor";
import { getOperatorEditorInfo } from "@web/core/tree_editor/tree_editor_operator_editor";
import { _t } from "@web/core/l10n/translation";
import { ModelFieldSelector } from "@web/core/model_field_selector/model_field_selector";
import { useService } from "@web/core/utils/hooks";
import { useMakeGetFieldDef } from "@web/core/tree_editor/utils";
import { getDefaultCondition } from "@web/core/domain_selector/utils";

import { WorkflowTreeEditor } from "./workflow_tree_editor";
import { ExpressionInput } from "@workflow_studio/components/expression/ExpressionInput";
import { isExpressionValue } from "./domain_builder_utils";

const ARCHIVED_CONDITION = condition("active", "in", [true, false]);
const ARCHIVED_DOMAIN = `[("active", "in", [True, False])]`;

export class WorkflowDomainBuilder extends Component {
    static template = "workflow_studio.WorkflowDomainBuilder";
    static components = { WorkflowTreeEditor, CheckBox, ExpressionInput };
    static props = {
        domain: String,
        resModel: String,
        className: { type: String, optional: true },
        defaultConnector: { type: [{ value: "&" }, { value: "|" }], optional: true },
        isDebugMode: { type: Boolean, optional: true },
        allowExpressions: { type: Boolean, optional: true },
        readonly: { type: Boolean, optional: true },
        update: { type: Function, optional: true },
        debugUpdate: { type: Function, optional: true },
        inputContext: { type: Object, optional: true },
    };
    static defaultProps = {
        isDebugMode: false,
        allowExpressions: true,
        readonly: true,
        update: () => {},
    };

    setup() {
        this.fieldService = useService("field");
        this.loadFieldInfo = useLoadFieldInfo(this.fieldService);
        this.makeGetFieldDef = useMakeGetFieldDef(this.fieldService);

        this.tree = null;
        this.showArchivedCheckbox = false;
        this.includeArchived = false;

        this.exprState = useState({
            isExpression: isExpressionValue(this.props.domain),
        });

        onWillStart(() => this.onPropsUpdated(this.props));
        onWillUpdateProps((np) => {
            // Sync expression mode when domain prop changes from outside
            if (isExpressionValue(np.domain) && !this.exprState.isExpression) {
                this.exprState.isExpression = true;
            }
            return this.onPropsUpdated(np);
        });
    }

    get isExpression() {
        return this.exprState.isExpression;
    }

    /**
     * Value shown in the standalone Code editor textarea.
     * In expression mode: strips the {{ ... }} wrapper to show raw expression content.
     * In tree/builder mode: shows the literal domain string as-is.
     */
    get codeEditorDisplayValue() {
        const d = this.props.domain || "";
        if (this.isExpression) {
            const m = d.match(/^\{\{([\s\S]*)\}\}$/);
            return m ? m[1].trim() : d;
        }
        return d;
    }

    toggleExpression() {
        if (this.exprState.isExpression) {
            // Back to domain builder: try to recover a valid domain string
            this.exprState.isExpression = false;
            const current = this.props.domain || "";
            // Extract inner content if wrapped in {{ ... }}
            const m = current.match(/^\{\{([\s\S]*)\}\}$/);
            const inner = m ? m[1].trim() : current;
            // Try to parse inner as a valid domain; if it fails, reset to []
            let recovered = "[]";
            if (inner) {
                try {
                    // Strip surrounding quotes if the expression is a quoted domain string
                    const unquoted = inner.replace(/^["']([\s\S]*)["']$/, "$1");
                    new Domain(unquoted);
                    recovered = unquoted;
                } catch {
                    // Not a valid domain, fall back to empty
                }
            }
            this.props.update(recovered);
        } else {
            // Enter expression mode: seed with current domain string
            this.exprState.isExpression = true;
            const current = this.props.domain;
            if (!isExpressionValue(current)) {
                const seed = (typeof current === "string" && current.trim()) ? current : "[]";
                // Keep raw domain text in expression mode (no quote-wrapping / no escaping),
                // so users don't get noisy backslashes when switching from tree editor.
                this.props.update(`{{ ${seed} }}`);
            }
        }
    }

    switchToTree() {
        if (this.exprState.isExpression) {
            this.toggleExpression();
        }
    }

    switchToExpression() {
        if (!this.exprState.isExpression) {
            this.toggleExpression();
        }
    }

    onExpressionChange(val) {
        this.props.update(val);
    }

    onExpressionInputModeChange(mode) {
        if (mode === "fixed") {
            this.switchToTree();
            return;
        }
        if (mode === "expression") {
            this.switchToExpression();
        }
    }

    async onPropsUpdated(p) {
        let domain;
        let isSupported = true;
        try {
            domain = new Domain(p.domain);
        } catch {
            isSupported = false;
        }
        if (!isSupported) {
            this.tree = null;
            this.showArchivedCheckbox = false;
            this.includeArchived = false;
            return;
        }

        const tree = treeFromDomain(domain);

        const getFieldDef = await this.makeGetFieldDef(p.resModel, tree, ["active"]);

        this.tree = treeFromDomain(domain, {
            getFieldDef,
            distributeNot: !p.isDebugMode,
        });

        this.showArchivedCheckbox = this.getShowArchivedCheckBox(Boolean(getFieldDef("active")), p);
        this.includeArchived = false;
        if (this.showArchivedCheckbox) {
            if (this.tree.value === "&") {
                this.tree.children = this.tree.children.filter((child) => {
                    if (deepEqual(child, ARCHIVED_CONDITION)) {
                        this.includeArchived = true;
                        return false;
                    }
                    return true;
                });
                if (this.tree.children.length === 1) {
                    this.tree = this.tree.children[0];
                }
            } else if (deepEqual(this.tree, ARCHIVED_CONDITION)) {
                this.includeArchived = true;
                this.tree = treeFromDomain(`[]`);
            }
        }
    }

    getShowArchivedCheckBox(hasActiveField, props) {
        return hasActiveField;
    }

    getDefaultCondition(fieldDefs) {
        return getDefaultCondition(fieldDefs);
    }

    getDefaultOperator(fieldDef) {
        return getDomainDisplayedOperators(fieldDef, {
            allowExpressions: this.props.allowExpressions,
        })[0];
    }

    getOperatorEditorInfo(fieldDef) {
        const operators = getDomainDisplayedOperators(fieldDef, {
            allowExpressions: this.props.allowExpressions,
        });
        return getOperatorEditorInfo(operators, fieldDef);
    }

    getPathEditorInfo(resModel, defaultCondition) {
        const { isDebugMode } = this.props;
        return {
            component: ModelFieldSelector,
            extractProps: ({ update, value: path }) => {
                return {
                    path,
                    update,
                    resModel,
                    isDebugMode,
                    readonly: false,
                };
            },
            isSupported: (path) => [0, 1].includes(path) || typeof path === "string",
            defaultValue: () => defaultCondition.path,
            stringify: (path) => formatValue(path),
            message: _t("Invalid field chain"),
        };
    }

    toggleIncludeArchived() {
        this.includeArchived = !this.includeArchived;
        this.update(this.tree);
    }

    resetDomain() {
        this.props.update("[]");
    }

    onDomainInput(rawDomain) {
        if (this.props.debugUpdate) {
            // In expression mode the textarea shows raw content; re-wrap for debugUpdate
            const val = this.isExpression ? `{{ ${rawDomain} }}` : rawDomain;
            this.props.debugUpdate(val);
        }
    }

    onDomainChange(rawDomain) {
        if (this.isExpression) {
            // Textarea shows stripped expression content; re-wrap before storing
            this.props.update(`{{ ${rawDomain} }}`);
        } else {
            this.props.update(rawDomain, true);
        }
    }

    update(tree) {
        const archiveDomain = this.includeArchived ? ARCHIVED_DOMAIN : `[]`;
        const domain = tree
            ? Domain.and([domainFromTree(tree), archiveDomain]).toString()
            : archiveDomain;
        this.props.update(domain);
    }
}
