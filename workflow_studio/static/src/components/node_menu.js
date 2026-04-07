/** @odoo-module **/

/**
 * NodeMenu Component
 *
 * A floating context menu for adding nodes to the workflow canvas.
 * Uses workflowEditor.nodes for dynamic node categories.
 *
 * Features:
 * - Search bar with auto-focus
 * - Dynamic categorized node list from registry
 * - Keyboard navigation (Escape to close)
 * - Click outside to close
 * - Absolute positioning at spawn location
 *
 * @odoo-dependency - Uses useEditor hook for workflowEditor service
 */

import { Component, xml, useState, useRef, onMounted, useExternalListener } from "@odoo/owl";
import { useEditor } from "@workflow_studio/store/hooks";
import { MotionHelpers } from "@workflow_studio/utils/motion_helpers";

export class NodeMenu extends Component {
    static template = xml`
        <div class="node-menu"
             t-att-style="menuStyle"
             t-att-class="{ 'node-menu--large': props.variant === 'large' }"
             t-ref="menuRoot"
             t-on-keydown="onKeyDown"
             t-on-wheel.stop=""
             t-on-contextmenu.stop.prevent="">
            <!-- Search Bar -->
            <div class="node-menu__search">
                <input type="text"
                       class="node-menu__search-input"
                       t-ref="searchInput"
                       t-model="state.searchQuery"
                       placeholder="Search for blocks or requests"
                       t-on-input="onSearchInput"/>
            </div>

            <!-- Node Categories -->
            <div class="node-menu__content">
                <t t-foreach="filteredCategories" t-as="category" t-key="category.key">
                    <div class="node-menu__category">
                        <div class="node-menu__category-title">
                            <t t-if="category.icon">
                                <i t-if="isFontAwesome(category.icon)" t-att-class="getFaClass(category.icon, 'node-menu__category-icon')"/>
                                <i t-else="" t-att-class="category.icon + ' node-menu__category-icon'" style="font-size: 14px;"/>
                            </t>
                            <t t-esc="category.name"/>
                        </div>
                        <t t-foreach="category.items" t-as="item" t-key="item.key">
                            <div class="node-menu__item"
                                 t-att-data-node-type="item.key"
                                 t-on-click="onItemClick">
                                <div class="node-menu__item-icon">
                                    <i t-if="isFontAwesome(item.icon)" t-att-class="getFaClass(item.icon, 'node-menu__item-fa')"/>
                                    <i t-else="" t-att-class="item.icon" style="font-size: 18px;"/>
                                </div>
                                <div class="node-menu__item-info">
                                    <div class="node-menu__item-title">
                                        <t t-esc="item.name"/>
                                    </div>
                                    <div class="node-menu__item-description" t-if="item.description">
                                        <t t-esc="item.description"/>
                                    </div>
                                </div>
                            </div>
                        </t>
                    </div>
                </t>

                <!-- Empty State -->
                <div class="node-menu__empty" t-if="filteredCategories.length === 0">
                    No nodes found
                </div>
            </div>
        </div>
    `;

    static components = {};

    static props = {
        position: { type: Object },  // { x, y } - screen coordinates
        variant: { type: String, optional: true }, // 'default' or 'large'
        connectionContext: { type: [Object, { value: null }], optional: true },
        onNodeSelected: { type: Function },  // (nodeType, connectionContext) => void
        onClose: { type: Function },         // () => void
    };

    setup() {
        this.menuRef = useRef("menuRoot");
        this.searchInputRef = useRef("searchInput");
        this.editor = useEditor();

        this._onClickOutside = this._onClickOutside.bind(this);

        this.state = useState({
            searchQuery: "",
        });

        // Auto-focus search input on mount
        onMounted(() => {
            const inputEl = this.searchInputRef.el;
            if (!inputEl) {
                throw new Error("[NodeMenu] Missing search input ref element");
            }
            inputEl.focus();
        });
        useExternalListener(document, "mousedown", this._onClickOutside);
    }

    isFontAwesome(icon) {
        return typeof icon === 'string' && icon.startsWith('fa-');
    }

    getFaClass(icon, extraClass) {
        const base = `fa ${icon}`;
        if (extraClass) {
            return `${base} ${extraClass}`;
        }
        return base;
    }

    /**
     * Get categories with nodes from service
     * Replaces hardcoded categories getter
     */
    get categories() {
        // Get grouped nodes from service
        const grouped = this.editor.nodes.searchNodes("");

        // Transform to menu format
        return grouped.map(group => ({
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

    /**
     * Filter categories based on search query
     */
    get filteredCategories() {
        const query = this.state.searchQuery.toLowerCase().trim();

        if (!query) {
            return this.categories;
        }

        // Use service search for fuzzy matching
        const searchResults = this.editor.nodes.searchNodes(query);

        return searchResults.map(group => ({
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

    /**
     * Menu positioning style
     */
    get menuStyle() {
        const { x, y } = this.props.position || { x: 0, y: 0 };
        if (this.props.variant === 'large') {
            // Dropdown style: align left with button, no centering
            return `left: ${x}px; top: ${y}px;`;
        }
        return `left: ${x}px; top: ${y}px;`;
    }

    /**
     * Handle item click - extract nodeType from data attribute
     */
    onItemClick(ev) {
        const nodeType = ev.currentTarget.dataset.nodeType;
        this.onSelectNode(nodeType);
    }

    /**
     * Handle node selection
     */
    onSelectNode(nodeType) {
        // Track usage for "recent" feature
        this.editor.nodes.trackUsage(nodeType);
        this.props.onNodeSelected(nodeType, this.props.connectionContext);
        this.props.onClose();
    }

    /**
     * Handle keyboard events
     */
    onKeyDown(ev) {
        if (ev.key === "Escape") {
            ev.preventDefault();
            this.props.onClose();
        }
    }

    /**
     * Handle search input
     */
    onSearchInput(ev) {
        this.state.searchQuery = ev.target.value;
    }

    /**
     * Close menu when clicking outside
     */
    _onClickOutside(ev) {
        if (this.menuRef.el && !this.menuRef.el.contains(ev.target)) {
            this.props.onClose();
        }
    }
}
