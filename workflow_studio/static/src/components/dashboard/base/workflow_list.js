/** @odoo-module **/

/**
 * WorkflowList — Embedded list/kanban view inside a dashboard block.
 *
 * Minimal clone of knowledge's ReadonlyEmbeddedViewComponent.
 * Keeps:   onWillStart → loadAction → makeEmbeddedContext → prepareStaticEmbeddedViewProps → openView
 * Strips:  editor host, favorite filters, knowledge bus events, article-specific logic,
 *          renderToElement integration, collaborative editing, WithLazyLoading
 *
 * Runtime shell path: mount <WorkflowList/> directly inside a DashboardBlock.
 * Optional helper path (future): renderWorkflowListBlueprint() for imperative insertion.
 */

import { makeContext } from "@web/core/context";
import { useService } from "@web/core/utils/hooks";
import { CallbackRecorder } from "@web/search/action_hook";
import { getDefaultConfig } from "@web/views/view";
import { View } from "@web/views/view";

import {
    Component,
    onError,
    onWillStart,
    useState,
    useSubEnv,
} from "@odoo/owl";

const VIEW_RECORDS_LIMITS = {
    kanban: 20,
    list: 40,
};

export class WorkflowList extends Component {
    static components = { View };
    static template = "workflow_studio.WorkflowList";
    static props = {
        /** XML ID of the action to load (e.g. "workflow_studio.action_workflow_run_errors") */
        actionXmlId: { type: String },
        /** View type to render: "list" | "kanban" */
        viewType: { type: String, optional: true },
        /** Extra context merged into the action context */
        context: { type: Object, optional: true },
        /** Record limit override */
        limit: { type: Number, optional: true },
        /** Display name override */
        displayName: { type: String, optional: true },
    };
    static defaultProps = {
        viewType: "list",
        context: {},
    };

    setup() {
        this.actionService = useService("action");
        this.state = useState({
            error: false,
            isLoaded: false,
        });
        window.list = this; // for debugging
        useSubEnv({
            config: {
                ...getDefaultConfig(),
                disableSearchBarAutofocus: true,
            },
            isEmbeddedView: true,
            isEmbeddedReadonly: true,
        });

        onWillStart(async () => {
            await this._loadEmbeddedView();
        });

        onError((error) => {
            console.error(error);
            this.state.error = true;
        });
    }

    // -------------------------------------------------------------------------
    // Getters
    // -------------------------------------------------------------------------

    get embeddedViewProps() {
        return this._staticViewProps;
    }

    // -------------------------------------------------------------------------
    // Core lifecycle (cloned from ReadonlyEmbeddedViewComponent)
    // -------------------------------------------------------------------------

    async _loadEmbeddedView() {
        this.__getGlobalState__ = new CallbackRecorder();
        const context = this._makeContext();
        this._action = await this._loadAction(context);
        this.env.config.views = this._action.views;
        this.env.config.setDisplayName(
            this.props.displayName || this._action.name
        );
        this._staticViewProps = this._prepareStaticViewProps(context);
        this.state.isLoaded = true;
    }

    async _loadAction(context) {
        const action = await this.actionService.loadAction(
            this.props.actionXmlId,
            context
        );
        if (action.type !== "ir.actions.act_window") {
            throw new Error(
                `Invalid action type "${action.type}". Expected "ir.actions.act_window"`
            );
        }
        if (this.props.displayName) {
            action.name = this.props.displayName;
            action.display_name = this.props.displayName;
        }
        return action;
    }

    _makeContext() {
        return makeContext([this.props.context]);
    }

    _prepareStaticViewProps(context) {
        return {
            context,
            createRecord: this._createRecord.bind(this),
            domain: this._action.domain || [],
            __getGlobalState__: this.__getGlobalState__,
            globalState: {},
            limit:
                this.props.limit ||
                VIEW_RECORDS_LIMITS[this.props.viewType] ||
                40,
            loadActionMenus: false,
            loadIrFilters: false,
            noContentHelp: this._action.help,
            resModel: this._action.res_model,
            searchViewId: this._action.searchViewId
                ? this._action.searchViewId[0]
                : false,
            selectRecord: this._selectRecord.bind(this),
            type: this.props.viewType,
        };
    }

    // -------------------------------------------------------------------------
    // Actions
    // -------------------------------------------------------------------------

    openView() {
        this.actionService.doAction(this._action, {
            viewType: this.props.viewType,
        });
    }

    _createRecord() {
        this.actionService.doAction({
            res_model: this._action.res_model,
            type: "ir.actions.act_window",
            views: [
                this._action.views.find(([_, type]) => type === "form") || [
                    false,
                    "form",
                ],
            ],
        });
    }

    _selectRecord(resId) {
        this.actionService.doAction({
            res_id: resId,
            res_model: this._action.res_model,
            type: "ir.actions.act_window",
            views: [
                this._action.views.find(([_, type]) => type === "form") || [
                    false,
                    "form",
                ],
            ],
        });
    }
}
