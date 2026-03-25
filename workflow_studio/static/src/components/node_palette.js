/** @odoo-module **/
import { _t } from "@web/core/l10n/translation";

import { Component, xml } from "@odoo/owl";
import { useEditor } from "@workflow_studio/store/hooks";

export class NodePaletteItem extends Component {
    static template = xml`
        <div class="node-palette__item"
            t-att-class="props.className"
            t-on-click="onClick"
            t-on-dragstart="onDragStart"
            draggable="true">
            <div class="node-palette__icon">
                <img t-if="isImageIcon(props.icon)" t-att-src="props.icon" class="node-palette__icon-image" alt=""/>
                <i t-elif="isFontAwesome(props.icon)" t-att-class="getFaClass(props.icon)"/>
                <i t-else="" t-att-class="props.icon" style="font-size: 18px;"/>
            </div>
            <div class="node-palette__label"><t t-esc="props.title || ('Node')"/></div>
        </div>
    `;

    static components = {};

    static props = {
        name: String,
        title: { type: String, optional: true },
        icon: { type: String, optional: true },
        className: { type: String, optional: true },
        onAddNode: { type: Function },
    };

    setup() {
        this._t = _t;
    }

    isFontAwesome(icon) {
        return typeof icon === "string" && icon.startsWith("fa-");
    }

    isImageIcon(icon) {
        if (typeof icon !== "string") {
            return false;
        }
        return icon.startsWith("/") || icon.startsWith("http://") || icon.startsWith("https://") || icon.startsWith("data:image/");
    }

    getFaClass(icon) {
        return `fa ${icon}`;
    }

    onClick() {
        this.props.onAddNode(this.props.name);
    }

    onDragStart(ev) {
        ev.dataTransfer.effectAllowed = "copy";
        ev.dataTransfer.setData("application/x-workflow-node", this.props.name);
    }
}

class NodePalette extends Component {
    static template = xml`
        <div class="sidebar">
            <h3 class="sidebar__title"><t t-esc="('Nodes')"/></h3>
            <div class="node-palette">
                <t t-foreach="items" t-as="item" t-key="item.name">
                    <NodePaletteItem
                        name="item.name"
                        title="item.title"
                        icon="item.icon"
                        className="item.className"
                        onAddNode="props.onAddNode"/>
                </t>
            </div>
        </div>
    `;

    static components = { NodePaletteItem };
    static props = { onAddNode: { type: Function } };

    setup() {
        this._t = _t;
        this.editor = useEditor();
    }

    get items() {
        const nodes = this.editor.nodes.getAllNodeTypes();
        const items = nodes.map((node) => ({
            name: node.key,
            title: node.name || node.key,
            icon: node.icon,
            className: `node-palette__item--${node.key}`,
            category: node.category || "",
        }));
        items.sort((a, b) => {
            if (a.category === b.category) {
                return a.title.localeCompare(b.title);
            }
            return a.category.localeCompare(b.category);
        });
        return items;
    }
}

export { NodePalette };
