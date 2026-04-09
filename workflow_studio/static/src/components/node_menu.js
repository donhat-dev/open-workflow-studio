/** @odoo-module **/

import { Component, xml, useState, useRef, onMounted, onWillUnmount, useExternalListener } from "@odoo/owl";
import { useEditor } from "@workflow_studio/store/hooks";

export class NodeMenu extends Component {
    static template = xml`
        <div class="node-menu"
             t-att-style="menuStyle"
             t-ref="menuRoot"
             t-on-keydown="onKeyDown"
             t-on-wheel.stop=""
             t-on-contextmenu.stop.prevent="">

            <!-- Search bar (always visible) -->
            <div class="node-menu__search">
                <i class="fa fa-search node-menu__search-icon"/>
                <input type="text"
                       class="node-menu__search-input"
                       t-ref="searchInput"
                       t-model="state.searchQuery"
                       placeholder="Search nodes..."
                       t-on-input="onSearchInput"/>
                <button t-if="state.searchQuery" class="node-menu__search-clear" t-on-click="clearSearch" type="button">
                    <i class="fa fa-times"/>
                </button>
            </div>

            <!-- Flat search results (active when query is set) -->
            <t t-if="state.searchQuery.trim()">
                <div class="node-menu__results">
                    <t t-foreach="filteredCategories" t-as="category" t-key="category.key">
                        <div class="node-menu__result-group-label" t-esc="category.name"/>
                        <t t-foreach="category.items" t-as="item" t-key="item.key">
                            <div class="node-menu__item"
                                 t-att-data-node-type="item.key"
                                 t-on-click="onItemClick">
                                <div class="node-menu__item-icon">
                                    <i t-if="isFontAwesome(item.icon)" t-att-class="'fa ' + item.icon"/>
                                    <i t-else="" t-att-class="item.icon" style="font-size: 16px;"/>
                                </div>
                                <div class="node-menu__item-info">
                                    <div class="node-menu__item-title" t-esc="item.name"/>
                                    <div t-if="item.description" class="node-menu__item-description" t-esc="item.description"/>
                                </div>
                            </div>
                        </t>
                    </t>
                    <div class="node-menu__empty" t-if="filteredCategories.length === 0">No nodes found</div>
                </div>
            </t>

            <!-- Category sidebar + Submenu (when no search) -->
            <t t-else="">
                <div class="node-menu__body">
                    <!-- Left: categories -->
                    <div class="node-menu__cats" t-ref="catsPanel" t-on-mousemove="onCatsPanelMouseMove">
                        <t t-foreach="categories" t-as="cat" t-key="cat.key">
                            <div class="node-menu__cat-item"
                                 t-att-class="{ 'is-active': cat.key === activeCategoryKey }"
                                 t-on-mouseenter="(ev) => this.onCategoryEnter(cat.key, ev)">
                                <div class="node-menu__cat-icon">
                                    <i t-if="isFontAwesome(cat.icon)" t-att-class="'fa ' + cat.icon"/>
                                    <i t-else="" t-att-class="cat.icon" style="font-size: 13px;"/>
                                </div>
                                <span class="node-menu__cat-name" t-esc="cat.name"/>
                                <i class="icon-chevron-right node-menu__cat-arrow"/>
                            </div>
                        </t>
                    </div>
                    <!-- Divider -->
                    <div class="node-menu__split-divider"/>
                    <!-- Right: submenu nodes for active category -->
                    <div class="node-menu__submenu">
                        <t t-foreach="activeItems" t-as="item" t-key="item.key">
                            <div class="node-menu__item"
                                 t-att-data-node-type="item.key"
                                 t-on-click="onItemClick">
                                <div class="node-menu__item-icon">
                                    <i t-if="isFontAwesome(item.icon)" t-att-class="'fa ' + item.icon"/>
                                    <i t-else="" t-att-class="item.icon" style="font-size: 16px;"/>
                                </div>
                                <div class="node-menu__item-info">
                                    <div class="node-menu__item-title" t-esc="item.name"/>
                                    <div t-if="item.description" class="node-menu__item-description" t-esc="item.description"/>
                                </div>
                            </div>
                        </t>
                    </div>
                </div>
            </t>
        </div>
    `;

    static components = {};

    static props = {
        position: { type: Object },
        variant: { type: String, optional: true },
        connectionContext: { type: [Object, { value: null }], optional: true },
        onNodeSelected: { type: Function },
        onClose: { type: Function },
    };

    setup() {
        this.menuRef = useRef("menuRoot");
        this.searchInputRef = useRef("searchInput");
        this.editor = useEditor();

        this.state = useState({
            searchQuery: "",
            activeCategoryKey: null,
        });

        // Safe triangle: track last mouse position inside the categories panel
        this._prevMouseX = 0;
        this._prevMouseY = 0;
        this._categoryHoverTimer = null;

        onMounted(() => {
            const inputEl = this.searchInputRef.el;
            if (!inputEl) {
                throw new Error("[NodeMenu] Missing search input ref element");
            }
            inputEl.focus();
            const cats = this.categories;
            if (cats.length > 0) {
                this.state.activeCategoryKey = cats[0].key;
            }
        });

        onWillUnmount(() => {
            clearTimeout(this._categoryHoverTimer);
        });

        useExternalListener(document, "mousedown", this._onClickOutside.bind(this));
    }

    isFontAwesome(icon) {
        return typeof icon === "string" && icon.startsWith("fa-");
    }

    get categories() {
        return this.editor.nodes.searchNodes("").map(group => ({
            key: group.key,
            name: group.name,
            icon: group.icon,
            items: group.nodes.map(node => ({
                key: node.key,
                name: node.name,
                icon: node.icon,
                description: node.description,
            })),
        }));
    }

    get filteredCategories() {
        const query = this.state.searchQuery.toLowerCase().trim();
        if (!query) return this.categories;
        return this.editor.nodes.searchNodes(query).map(group => ({
            key: group.key,
            name: group.name,
            icon: group.icon,
            items: group.nodes.map(node => ({
                key: node.key,
                name: node.name,
                icon: node.icon,
                description: node.description,
            })),
        })).filter(cat => cat.items.length > 0);
    }

    get activeCategoryKey() {
        const key = this.state.activeCategoryKey;
        if (key && this.categories.some(c => c.key === key)) return key;
        return this.categories[0] ? this.categories[0].key : null;
    }

    get activeItems() {
        const cat = this.categories.find(c => c.key === this.activeCategoryKey);
        return cat ? cat.items : [];
    }

    get menuStyle() {
        const { x, y } = this.props.position || { x: 0, y: 0 };
        return `left: ${x}px; top: ${y}px;`;
    }

    /**
     * Safe triangle — track mouse position on the categories panel.
     * Called continuously as the cursor moves within .node-menu__cats.
     */
    onCatsPanelMouseMove(ev) {
        this._prevMouseX = ev.clientX;
        this._prevMouseY = ev.clientY;
    }

    /**
     * Safe triangle technique: defer category switch when cursor is moving
     * rightward (toward the submenu panel) to prevent accidental submenu flicker.
     * Switch immediately when cursor moves left/up/down.
     */
    onCategoryEnter(categoryKey, ev) {
        if (categoryKey === this.state.activeCategoryKey) return;
        const dx = ev.clientX - this._prevMouseX;
        if (dx > 4) {
            // Probably heading toward the submenu — defer to let cursor settle
            clearTimeout(this._categoryHoverTimer);
            this._categoryHoverTimer = setTimeout(() => {
                this.state.activeCategoryKey = categoryKey;
            }, 120);
        } else {
            // Not moving toward submenu — switch immediately
            clearTimeout(this._categoryHoverTimer);
            this.state.activeCategoryKey = categoryKey;
        }
    }

    onItemClick(ev) {
        const nodeType = ev.currentTarget.dataset.nodeType;
        this.editor.nodes.trackUsage(nodeType);
        this.props.onNodeSelected(nodeType, this.props.connectionContext);
        this.props.onClose();
    }

    clearSearch() {
        this.state.searchQuery = "";
        this.searchInputRef.el.focus();
    }

    onSearchInput(ev) {
        this.state.searchQuery = ev.target.value;
    }

    onKeyDown(ev) {
        if (ev.key === "Escape") {
            ev.preventDefault();
            if (this.state.searchQuery) {
                this.state.searchQuery = "";
            } else {
                this.props.onClose();
            }
        }
    }

    _onClickOutside(ev) {
        if (this.menuRef.el && !this.menuRef.el.contains(ev.target)) {
            this.props.onClose();
        }
    }
}
