/** @odoo-module **/

import { Component, onMounted, useRef } from "@odoo/owl";

/**
 * LucideIcon Component
 * 
 * Renders icons from Lucide icon library with backward compatibility for FontAwesome.
 * 
 * Usage:
 *   <LucideIcon name="Globe"/>           // Lucide icon
 *   <LucideIcon name="fa-globe"/>        // FontAwesome fallback
 *   <LucideIcon name="Globe" size="24"/> // Custom size
 */
export class LucideIcon extends Component {
    static template = "workflow_pilot.lucide_icon";

    static props = {
        name: { type: String },
        size: { type: Number, optional: true },
        strokeWidth: { type: Number, optional: true },
        class: { type: String, optional: true },
    };

    static defaultProps = {
        size: 16,
        strokeWidth: 2,
        class: "",
    };

    setup() {
        this.iconRef = useRef("iconContainer");

        onMounted(() => {
            // Always try to render Lucide first
            this.renderLucideIcon();
        });
    }

    /**
     * Check if we should fall back to FontAwesome
     * Only true if: starts with fa- AND Lucide library not available
     */
    get shouldUseFontAwesome() {
        const isFaFormat = this.props.name?.startsWith('fa-');
        const lucideAvailable = !!(window.lucide && window.lucide.icons);

        // If Lucide not available and name is FA format, use FA
        if (!lucideAvailable && isFaFormat) {
            return true;
        }

        // If Lucide available, check if we have this icon
        if (lucideAvailable) {
            const pascalName = this.toPascalCase(this.lucideIconName);
            const hasLucideIcon = !!window.lucide.icons[pascalName];
            // Fall back to FA only if Lucide doesn't have this icon
            return !hasLucideIcon && isFaFormat;
        }

        return false;
    }

    /**
     * Get the Lucide icon name, converting from FA if needed
     */
    get lucideIconName() {
        const isFaFormat = this.props.name?.startsWith('fa-');
        if (!isFaFormat) {
            return this.props.name;
        }

        // Mapping from FontAwesome to Lucide (PascalCase)
        const faToLucide = {
            'fa-globe': 'Globe',
            'fa-code': 'Code',
            'fa-repeat': 'Repeat',
            'fa-code-branch': 'GitBranch',
            'fa-exchange': 'ArrowRightLeft',
            'fa-check-circle': 'CheckCircle',
            'fa-cube': 'Box',
            'fa-circle-o': 'Circle',
            'fa-tag': 'Tag',
            'fa-bolt': 'Zap',
            'fa-database': 'Database',
            'fa-play': 'Play',
            'fa-trash': 'Trash2',
            'fa-ban': 'Ban',
            'fa-cog': 'Settings',
            'fa-plus': 'Plus',
            'fa-minus': 'Minus',
            'fa-search-plus': 'ZoomIn',
            'fa-search-minus': 'ZoomOut',
            'fa-arrows-alt': 'Maximize',
            'fa-sitemap': 'GitFork',
            'fa-undo': 'Undo',
            'fa-redo': 'Redo',
        };

        return faToLucide[this.props.name] || this.props.name.replace('fa-', '');
    }

    /**
     * Render Lucide icon into the container
     */
    renderLucideIcon() {
        const container = this.iconRef.el;
        if (!container || !window.lucide) {
            console.warn('[LucideIcon] Container or lucide library not available');
            return;
        }

        const iconName = this.lucideIconName;
        const icons = window.lucide.icons;

        // Lucide UMD uses PascalCase keys (e.g., "Globe", "ArrowDown")
        const pascalName = this.toPascalCase(iconName);

        if (!icons[pascalName]) {
            console.warn(`[LucideIcon] Icon not found: ${pascalName}`);
            // Fallback to a default box icon
            container.innerHTML = `<svg width="${this.props.size}" height="${this.props.size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${this.props.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>`;
            return;
        }

        const iconDef = icons[pascalName];

        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");

        svg.setAttribute("width", this.props.size);
        svg.setAttribute("height", this.props.size);
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("fill", "none");
        svg.setAttribute("stroke", "currentColor");
        svg.setAttribute("stroke-width", this.props.strokeWidth);
        svg.setAttribute("stroke-linecap", "round");
        svg.setAttribute("stroke-linejoin", "round");

        // iconDef is an array of [tag, attributes] pairs
        for (const [tag, attrs] of iconDef) {
            const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
            for (const [key, value] of Object.entries(attrs)) {
                el.setAttribute(key, value);
            }
            svg.appendChild(el);
        }

        container.innerHTML = '';
        container.appendChild(svg);
    }

    /**
     * Convert kebab-case or snake_case to PascalCase
     * e.g., "arrow-right-left" -> "ArrowRightLeft", "git_branch" -> "GitBranch"
     * Preserves existing PascalCase: "GitBranch" -> "GitBranch"
     */
    toPascalCase(str) {
        // If already PascalCase (no separators and starts with uppercase), return as-is
        if (/^[A-Z][a-zA-Z0-9]*$/.test(str) && !str.includes('-') && !str.includes('_')) {
            return str;
        }
        return str
            .split(/[-_\s]+/)
            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join('');
    }
}
