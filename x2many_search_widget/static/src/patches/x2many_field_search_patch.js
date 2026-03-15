/** @odoo-module **/

import { _t } from "@web/core/l10n/translation";
import { useBus, useService } from "@web/core/utils/hooks";
import { patch } from "@web/core/utils/patch";
import { X2ManyField } from "@web/views/fields/x2many/x2many_field";
import { X2MANY_SEARCH_WIDGET_EVENT } from "@x2many_search_widget/core/x2many_search_widget_bus";

function buildSearchDomain(baseIds, searchFields, query) {
    const conditions = searchFields.map((fieldName) => [fieldName, "ilike", query]);
    let orDomain = conditions[0];
    for (let index = 1; index < conditions.length; index++) {
        orDomain = ["|", orDomain, conditions[index]];
    }
    return [["id", "in", baseIds], orDomain];
}

patch(X2ManyField.prototype, {
    setup() {
        super.setup(...arguments);
        this.orm = useService("orm");
        this.notification = useService("notification");
        this._x2manySearchState = {
            requestToken: 0,
            snapshotIds: null,
            snapshotCount: 0,
            activeQuery: "",
        };

        useBus(this.props.record.model.bus, X2MANY_SEARCH_WIDGET_EVENT, (ev) => {
            this._onX2ManySearchWidgetUpdate(ev.detail);
        });
    },

    async _onX2ManySearchWidgetUpdate(payload) {
        if (!this._isX2ManySearchPayloadForCurrentField(payload)) {
            return;
        }
        const rawQuery = typeof payload.query === "string" ? payload.query : "";
        const query = rawQuery.trim();
        const minChars = Number.isInteger(payload.minChars) && payload.minChars > 0 ? payload.minChars : 1;

        if (!query || query.length < minChars) {
            await this._restoreX2ManySearch();
            return;
        }

        if (this.list.editedRecord) {
            this.notification.add(
                _t("Cannot search lines while an inline row is being edited. Save or discard it first."),
                { type: "warning" }
            );
            return;
        }

        const state = this._x2manySearchState;
        if (state.snapshotIds === null) {
            state.snapshotIds = [...this.list.currentIds];
            state.snapshotCount = this.list.count;
        }

        const searchFields =
            Array.isArray(payload.searchFields) && payload.searchFields.length
                ? payload.searchFields
                : ["name"];
        const baseIds = [...state.snapshotIds];
        const numericIds = baseIds.filter((id) => typeof id === "number");
        const requestToken = ++state.requestToken;

        let allowedNumericIds = new Set();
        if (numericIds.length) {
            const domain = buildSearchDomain(numericIds, searchFields, query);
            let records;
            try {
                records = await this.orm.searchRead(this.list.resModel, domain, ["id"], {
                    context: this.props.context || this.list.context,
                    limit: numericIds.length,
                });
            } catch {
                if (requestToken !== state.requestToken) {
                    return;
                }
                this.notification.add(
                    _t("Unable to apply search on this field list. Check search_fields configuration."),
                    { type: "danger" }
                );
                return;
            }
            if (requestToken !== state.requestToken) {
                return;
            }
            allowedNumericIds = new Set(records.map((record) => record.id));
        }

        const filteredIds = [];
        for (const id of baseIds) {
            if (typeof id === "number") {
                if (allowedNumericIds.has(id)) {
                    filteredIds.push(id);
                }
            } else {
                filteredIds.push(id);
            }
        }

        await this._applyX2ManySearchIds(filteredIds, query, requestToken);
    },

    _isX2ManySearchPayloadForCurrentField(payload) {
        if (!payload || typeof payload !== "object") {
            return false;
        }
        return payload.recordId === this.props.record.id && payload.targetField === this.props.name;
    },

    async _applyX2ManySearchIds(nextCurrentIds, query, requestToken) {
        const state = this._x2manySearchState;
        if (requestToken !== state.requestToken) {
            return;
        }
        const limit = this.list.limit;
        await this.list.model.mutex.exec(async () => {
            await this.list._load({
                limit,
                offset: 0,
                orderBy: this.list.orderBy,
                nextCurrentIds,
            });
        });
        this.list.count = nextCurrentIds.length;
        state.activeQuery = query;
        this.render();
    },

    async _restoreX2ManySearch() {
        const state = this._x2manySearchState;
        if (state.snapshotIds === null) {
            return;
        }
        state.requestToken++;
        const restoredIds = [...state.snapshotIds];
        const limit = this.list.limit;

        await this.list.model.mutex.exec(async () => {
            await this.list._load({
                limit,
                offset: 0,
                orderBy: this.list.orderBy,
                nextCurrentIds: restoredIds,
            });
        });

        this.list.count = state.snapshotCount;
        state.snapshotIds = null;
        state.snapshotCount = 0;
        state.activeQuery = "";
        this.render();
    },
});
