/** @odoo-module **/

/**
 * WorkflowDashboardStats — Chart block for workflow dashboard.
 *
 * Cloned from hr_payroll's PayrollDashboardStats with identical Chart.js
 * lifecycle: loadJS → useEffect → renderChart() → onWillUnmount destroy.
 *
 * Supports chart types: line, bar, stacked_bar.
 *
 * Data shape:
 *   { monthly: [{x, value, label?, type?}], yearly: [...] }
 */

import { loadJS } from "@web/core/assets";
import { useService } from "@web/core/utils/hooks";
import { getColor, getCustomColor, hexToRGBA } from "@web/core/colors/colors";
import { cookie } from "@web/core/browser/cookie";
import { Component, onWillUnmount, useEffect, useRef, useState, onWillStart } from "@odoo/owl";

const colorScheme = cookie.get("color_scheme");
const GRAPH_GRID_COLOR = getCustomColor(colorScheme, "#d8dadd", "#3C3E4B");
const GRAPH_LABEL_COLOR = getCustomColor(colorScheme, "#111827", "#E4E4E4");

export class WorkflowDashboardStats extends Component {
    static template = "workflow_studio.WorkflowDashboardStats";
    static props = {
        title: String,
        help: { type: String, optional: true },
        id: { type: String, optional: true },
        actions: { type: Array, optional: true },
        type: { type: String, optional: true },
        data: Object,
        isSample: { type: Boolean, optional: true },
        label: { type: String, optional: true },
        /** Generic toggle options: [{key, label}]. Replaces hardcoded Annually/Monthly. */
        toggleOptions: { type: Array, optional: true },
        /** Default active toggle key */
        defaultToggle: { type: String, optional: true },
        /** Custom dataset colors for stacked_bar: [color1, color2, ...] */
        colors: { type: Array, optional: true },
    };
    static defaultProps = {
        type: "line",
        actions: [],
        isSample: false,
        label: "",
        toggleOptions: [
            { key: "monthly", label: "Monthly" },
            { key: "yearly", label: "Annually" },
        ],
        defaultToggle: "monthly",
    };

    setup() {
        this.actionService = useService("action");
        this.canvasRef = useRef("canvas");
        this.state = useState({ activeToggle: this.props.defaultToggle });
        this.chart = null;

        onWillStart(() => loadJS("/web/static/lib/Chart/Chart.js"));
        useEffect(() => this.renderChart());
        onWillUnmount(() => {
            if (this.chart) {
                this.chart.destroy();
                this.chart = null;
            }
        });
    }

    get tooltipInfo() {
        return JSON.stringify({ help: this.props.help });
    }

    setToggle(key) {
        this.state.activeToggle = key;
    }

    get graphData() {
        return this.props.data[this.state.activeToggle];
    }

    renderChart() {
        if (this.chart) {
            this.chart.destroy();
        }
        const el = this.canvasRef.el;
        if (!el) {
            return;
        }
        const ctx = el.getContext("2d");
        this.chart = new Chart(ctx, this.getChartConfig());
    }

    getChartConfig() {
        const type = this.props.type;
        if (type === "line") {
            return this._getLineConfig();
        } else if (type === "bar") {
            return this._getBarConfig();
        } else if (type === "stacked_bar") {
            return this._getStackedBarConfig();
        }
        return {};
    }

    // -------------------------------------------------------------------------
    // Chart configs — cloned from PayrollDashboardStats
    // -------------------------------------------------------------------------

    _getLineConfig() {
        const data = this.graphData;
        const labels = data.map((pt) => pt.x);
        const color10 = getColor(3, cookie.get("color_scheme"), "odoo");
        const borderColor = hexToRGBA(color10, 0.1);
        const backgroundColor = hexToRGBA(color10, 0.05);
        return {
            type: "line",
            data: {
                labels,
                datasets: [
                    {
                        data,
                        fill: "start",
                        label: this.props.label,
                        backgroundColor,
                        borderColor,
                        borderWidth: 2,
                    },
                ],
            },
            options: {
                plugins: {
                    legend: { display: false },
                    tooltip: { intersect: false, position: "nearest", caretSize: 0 },
                },
                scales: {
                    y: { display: false, beginAtZero: true },
                    x: { display: false },
                },
                maintainAspectRatio: false,
                elements: { line: { tension: 0.000001 } },
            },
        };
    }

    _getBarConfig() {
        const data = [];
        const labels = [];
        const backgroundColors = [];
        const color19 = getColor(1, cookie.get("color_scheme"), "odoo");

        this.graphData.forEach((pt) => {
            data.push(pt.value);
            labels.push(pt.label);
            let color;
            if (this.props.isSample) {
                color = "#ebebeb";
            } else if (pt.type === "past") {
                color = "#ccbdc8";
            } else if (pt.type === "future") {
                color = "#a5d8d7";
            } else {
                color = color19;
            }
            backgroundColors.push(color);
        });

        return {
            type: "bar",
            data: {
                labels,
                datasets: [
                    {
                        data,
                        fill: "start",
                        label: this.props.label,
                        backgroundColor: backgroundColors,
                    },
                ],
            },
            options: {
                plugins: {
                    legend: { display: false },
                    tooltip: { intersect: false, position: "nearest", caretSize: 0 },
                },
                scales: {
                    y: {
                        grid: { color: GRAPH_GRID_COLOR },
                        ticks: { color: GRAPH_LABEL_COLOR },
                    },
                    x: {
                        grid: { color: GRAPH_GRID_COLOR },
                        ticks: { color: GRAPH_LABEL_COLOR },
                    },
                },
                maintainAspectRatio: false,
                elements: { line: { tension: 0.000001 } },
            },
        };
    }

    _getStackedBarConfig() {
        const labels = [];
        const datasets = [];
        const datasetsLabels = [];
        let colors;
        if (this.props.isSample) {
            colors = ["#e7e7e7", "#dddddd", "#f0f0f0", "#fafafa"];
        } else if (this.props.colors) {
            colors = this.props.colors;
        } else {
            colors = [
                getColor(14, cookie.get("color_scheme"), "odoo"),
                "#a5d8d7",
                "#ebebeb",
                "#ebebeb",
            ];
        }

        Object.entries(this.graphData).forEach(([code, graphData]) => {
            datasetsLabels.push(code);
            const datasetData = [];
            const formattedData = [];
            graphData.forEach((pt) => {
                if (!labels.includes(pt.label)) {
                    labels.push(pt.label);
                }
                formattedData.push(`${code}: ${pt.formatted_value || pt.value}`);
                datasetData.push(pt.value);
            });
            datasets.push({
                data: datasetData,
                label: code,
                backgroundColor: colors[datasetsLabels.length - 1],
                formatted_data: formattedData,
            });
        });

        return {
            type: "bar",
            data: { labels, datasets },
            options: {
                responsive: true,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        intersect: false,
                        position: "nearest",
                        caretSize: 0,
                        callbacks: {
                            label: (tooltipItem) => {
                                const { datasetIndex, index } = tooltipItem;
                                return datasets[datasetIndex].formatted_data[index];
                            },
                        },
                    },
                },
                scales: {
                    x: {
                        stacked: true,
                        grid: { color: GRAPH_GRID_COLOR },
                        ticks: { color: GRAPH_LABEL_COLOR },
                    },
                    y: {
                        stacked: true,
                        grid: { color: GRAPH_GRID_COLOR },
                        ticks: { color: GRAPH_LABEL_COLOR },
                    },
                },
                maintainAspectRatio: false,
            },
        };
    }
}
