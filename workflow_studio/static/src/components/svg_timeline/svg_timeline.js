/** @odoo-module **/

import { Component, onMounted, onWillUnmount, useRef, useState } from "@odoo/owl";

/**
 * SvgTimeline — reusable SVG-based horizontal timeline bar chart.
 *
 * Props-driven, zero service coupling; designed for execution profiling use.
 *
 * @example
 * <SvgTimeline
 *   items="ganttItems"
 *   totalDurationMs="ganttDurationMs"
 *   ticks="ganttTicks"
 *   onItemClick.bind="onStepClick"
 *   selectedIds="selectedIds"
 * />
 */
export class SvgTimeline extends Component {
    static template = "workflow_studio.SvgTimeline";

    static defaultProps = {
        rowHeight: 32,
        barPadding: 5,
        labelColumnWidth: 220,
        tickHeight: 24,
        minBarWidth: 6,
        showLabels: true,
        selectedIds: [],
        ticks: [],
    };

    static props = {
        /** Array of timeline items */
        items: {
            type: Array,
            element: {
                type: Object,
                shape: {
                    id: String,
                    label: String,
                    offsetMs: Number,
                    durationMs: Number,
                    /** "success" | "error" | "running" | "pending" */
                    status: { type: String, optional: true },
                    meta: { type: Object, optional: true },
                },
            },
        },
        /** Full timeline span; bars are positioned relative to this */
        totalDurationMs: Number,
        /** Tick marks: [{ key, ratio 0..1, label }] */
        ticks: { type: Array, optional: true },
        /** Pixel width of the left label column */
        labelColumnWidth: { type: Number, optional: true },
        /** Row height per item (px) */
        rowHeight: { type: Number, optional: true },
        /** Vertical padding inside each row for the bar  */
        barPadding: { type: Number, optional: true },
        /** Axis tick row height (px) */
        tickHeight: { type: Number, optional: true },
        /** Minimum bar width (px) regardless of duration ratio */
        minBarWidth: { type: Number, optional: true },
        /** Whether to render the left label column */
        showLabels: { type: Boolean, optional: true },
        /** Item IDs that should be rendered as selected */
        selectedIds: { type: Array, optional: true },
        /** Called with (itemId) when an item is clicked */
        onItemClick: { type: Function, optional: true },
        /** Optional text shown in the axis row (e.g. "Absolute timing") */
        modeLabel: { type: String, optional: true },
    };

    setup() {
        this.trackRef = useRef("track");
        this.state = useState({ trackWidth: 0 });

        this._resizeObserver = null;

        onMounted(() => {
            this._resizeObserver = new ResizeObserver((entries) => {
                for (const entry of entries) {
                    const width = Math.floor(entry.contentRect.width);
                    if (width !== this.state.trackWidth) {
                        this.state.trackWidth = width;
                    }
                }
            });
            if (this.trackRef.el) {
                this._resizeObserver.observe(this.trackRef.el);
                this.state.trackWidth = Math.floor(this.trackRef.el.getBoundingClientRect().width);
            }
        });

        onWillUnmount(() => {
            if (this._resizeObserver) {
                this._resizeObserver.disconnect();
                this._resizeObserver = null;
            }
        });
    }

    // --- Computed properties ---

    get trackWidth() {
        return Math.max(this.state.trackWidth, 1);
    }

    get totalHeight() {
        return this.props.tickHeight + this.props.items.length * this.props.rowHeight;
    }

    get selectedSet() {
        return new Set(this.props.selectedIds);
    }

    /** Resolved bar color for each status */
    _statusFill(status) {
        switch (status) {
            case "error":
            case "failed":
                return "var(--svg-timeline-bar-error, #dc3545)";
            case "running":
                return "var(--svg-timeline-bar-running, #17a2b8)";
            case "pending":
                return "var(--svg-timeline-bar-pending, #adb5bd)";
            default:
                return "var(--svg-timeline-bar-success, #20c997)";
        }
    }

    _statusFillHover(status) {
        switch (status) {
            case "error":
            case "failed":
                return "var(--svg-timeline-bar-error-hover, #c82333)";
            case "running":
                return "var(--svg-timeline-bar-running-hover, #138496)";
            case "pending":
                return "var(--svg-timeline-bar-pending-hover, #868e96)";
            default:
                return "var(--svg-timeline-bar-success-hover, #17a589)";
        }
    }

    /** Returns computed bar geometry for each item */
    get svgBars() {
        const {
            items,
            totalDurationMs,
            rowHeight,
            barPadding,
            tickHeight,
            minBarWidth,
        } = this.props;
        const trackWidth = this.trackWidth;
        const total = Math.max(totalDurationMs, 1);
        const selected = this.selectedSet;

        return items.map((item, index) => {
            const rawLeft = (item.offsetMs / total) * trackWidth;
            const rawWidth = (item.durationMs / total) * trackWidth;
            const x = Math.round(Math.min(rawLeft, trackWidth - minBarWidth));
            const w = Math.round(Math.max(rawWidth, minBarWidth));
            const y = tickHeight + index * rowHeight + barPadding;
            const h = rowHeight - 2 * barPadding;
            const isSelected = selected.has(item.id);
            const fill = this._statusFill(item.status);

            return {
                id: item.id,
                label: item.label,
                status: item.status || "success",
                x,
                y,
                width: w,
                height: h,
                rx: 4,
                fill,
                isSelected,
                // Duration label inside bar (only shown if bar is wide enough)
                showDurationLabel: w >= 40,
                durationLabel: this._formatDurationMs(item.durationMs),
                // Tooltip text
                tooltip: item.meta
                    ? `${item.label}\n${this._formatDurationMs(item.durationMs)}`
                    : `${item.label}\n${this._formatDurationMs(item.durationMs)}`,
            };
        });
    }

    /** Returns tick lines spanning full SVG height */
    get svgTicks() {
        const { ticks, tickHeight } = this.props;
        const trackWidth = this.trackWidth;
        const h = this.totalHeight;

        return (ticks || []).map((tick) => {
            const x = Math.round(tick.ratio * trackWidth);
            return {
                key: tick.key,
                x1: x,
                y1: tickHeight,
                x2: x,
                y2: h,
                label: tick.label,
                labelX: tick.ratio >= 0.98 ? x - 2 : x + 2,
                labelAnchor: tick.ratio >= 0.98 ? "end" : "start",
            };
        });
    }

    _formatDurationMs(durationMs) {
        if (durationMs === null || durationMs === undefined) {
            return "—";
        }
        if (durationMs < 1000) {
            return `${Math.round(durationMs)}ms`;
        }
        const s = durationMs / 1000;
        if (s < 10) {
            return `${s.toFixed(2)}s`;
        }
        return `${s.toFixed(1)}s`;
    }

    // --- Event handlers ---

    onBarClick(ev, itemId) {
        ev.stopPropagation();
        if (this.props.onItemClick) {
            this.props.onItemClick(itemId);
        }
    }
}
