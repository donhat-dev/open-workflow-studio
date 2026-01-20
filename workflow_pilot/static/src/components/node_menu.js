/** @odoo-module **/

/**
 * NodeMenu Component
 * 
 * A floating context menu for adding nodes to the workflow canvas.
 * Uses workflowNode service for dynamic node categories.
 * 
 * Features:
 * - Search bar with auto-focus
 * - Dynamic categorized node list from registry
 * - Keyboard navigation (Escape to close)
 * - Click outside to close
 * - Absolute positioning at spawn location
 * 
 * @odoo-dependency - Uses useService for workflowNode service
 */

import { Component, xml, useState, useRef, onMounted, onWillUnmount, useEnv } from "@odoo/owl";
// @odoo-dependency - useService hook
import { useService } from "@web/core/utils/hooks";
import { MotionHelpers } from "../utils/motion_helpers";
import { LucideIcon } from "./common/lucide_icon";

export class NodeMenu extends Component {
    static template = xml`
        <div class="node-menu" 
             t-att-style="menuStyle"
             t-att-class="{ 'node-menu--large': props.variant === 'large' }"
             t-ref="menuRoot"
             t-on-keydown="onKeyDown"
             t-on-wheel.stop="">
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
                            <LucideIcon t-if="category.icon" name="category.icon" size="14" class="'node-menu__category-icon'"/>
                            <t t-esc="category.name"/>
                        </div>
                        <t t-foreach="category.items" t-as="item" t-key="item.key">
                            <div class="node-menu__item" 
                                 t-att-data-node-type="item.key"
                                 t-on-click="onItemClick">
                                <div class="node-menu__item-icon">
                                    <LucideIcon name="item.icon" size="18"/>
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

    static components = { LucideIcon };

    static props = {
        position: { type: Object },  // { x, y } - screen coordinates
        // Callbacks removed in favor of bus/service actions
        variant: { type: String, optional: true }, // 'default' or 'large'
        // Optional: for inserting node into a connection (can be null)
        connectionContext: { type: [Object, { value: null }], optional: true },
    };

    setup() {
        this.menuRef = useRef("menuRoot");
        this.searchInputRef = useRef("searchInput");
        this.nodeService = useService("workflowNode");
        this.env = useEnv();
        this.editor = this.env.workflowEditor;

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
            document.addEventListener("mousedown", this._onClickOutside);

            // Animation DISABLED
            // if (this.props.variant === 'large' && this.menuRef.el) {
            //     MotionHelpers.animateDropdownIn(this.menuRef.el);
            // }
        });

        onWillUnmount(() => {
            document.removeEventListener("mousedown", this._onClickOutside);
        });
    }

    /**
     * Get categories with nodes from service
     * Replaces hardcoded categories getter
     */
    get categories() {
        // Get grouped nodes from service
        const grouped = this.nodeService.searchNodes("");

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
        const searchResults = this.nodeService.searchNodes(query);

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
        this.nodeService.trackUsage(nodeType);

        // Trigger bus event for EditorCanvas to handle
        this.editor.bus.trigger("MENU:NODE_SELECTED", {
            nodeType,
            connectionContext: this.props.connectionContext
        });

        // Close request via bus
        this.editor.bus.trigger("MENU:CLOSE");
    }

    /**
     * Handle keyboard events
     */
    onKeyDown(ev) {
        if (ev.key === "Escape") {
            ev.preventDefault();
            this.editor.bus.trigger("MENU:CLOSE");
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
            this.editor.bus.trigger("MENU:CLOSE");
        }
    }
}
