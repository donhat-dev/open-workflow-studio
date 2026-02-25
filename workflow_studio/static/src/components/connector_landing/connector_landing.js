/** @odoo-module **/

import { Component, useState, onMounted, useRef, onWillUnmount } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { LucideIcon } from "@workflow_studio/components/common/lucide_icon";

// ─── Story mock data ──────────────────────────────────────────────────────────
const STORY = {
    company: {
        name: "Bảo Linh Commerce",
        alias: "BLC",
        industry: "Thương mại điện tử",
        size: "12 nhân sự",
        location: "Hà Nội",
        founded: 2021,
        logo: "BL",
    },
    crisis: {
        date: "02.01.2025",
        weekday: "Thứ Năm",
        orders: 15234,
        staff: 3,
        hoursPerDay: 8.5,
        errorsPerWeek: 47,
        painPoints: [
            { icon: "Clock", label: "8.5 giờ/ngày", sub: "chỉ để copy-paste đơn hàng" },
            { icon: "AlertTriangle", label: "47 lỗi/tuần", sub: "đơn thiếu, đơn sai địa chỉ" },
            { icon: "Users", label: "3 nhân sự", sub: "bị khoá vào công việc thủ công" },
            { icon: "Frown", label: "2:12 sáng", sub: "giờ kết thúc trung bình mỗi ngày" },
        ],
        workerQuote: {
            text: "Hôm nay TikTok lại đổi API. Tôi muốn khóc.",
            author: "Lan — Nhân viên vận hành",
        },
    },
    discovery: {
        date: "08.01.2025",
        channel: "Nhóm Shopee Seller Vietnam",
        postTitle: "Ai dùng Workflow Studio chưa? Setup xong trong 1 buổi chiều",
        impression: "Nhìn demo 5 phút là biết đây rồi.",
    },
    setup: {
        date: "09.01.2025",
        weekday: "Thứ Tư",
        startTime: "14:12",
        endTime: "14:59",
        totalMinutes: 47,
        steps: [
            {
                time: "14:12",
                label: "Kết nối Shopee API",
                icon: "Link",
                note: "OAuth 2.0 · auto-detect shop ID",
                color: "#EE4D2D",
            },
            {
                time: "14:21",
                label: "Kết nối TikTok Shop",
                icon: "Link",
                note: "TikTok Shop Partner API v2",
                color: "#010101",
            },
            {
                time: "14:33",
                label: "Kết nối Shopify (website)",
                icon: "Globe",
                note: "Webhook + REST sync",
                color: "#96BF48",
            },
            {
                time: "14:41",
                label: "Cấu hình rule tồn kho",
                icon: "Layers",
                note: "Threshold alert + auto-lock SKU",
                color: "#7C3AED",
            },
            {
                time: "14:47",
                label: "Test on live data",
                icon: "FlaskConical",
                note: "12/12 assertions passed ✓",
                color: "#10B981",
            },
            {
                time: "14:59",
                label: "Deploy production",
                icon: "Rocket",
                note: "Go live · 0 errors",
                color: "#00D8FF",
            },
        ],
    },
    results: {
        ordersPerDay: 15234,
        automationRate: 99.8,
        latencyMs: 87,
        staffFreed: 3,
        errorRate: 0.02,
        moneySavedMonth: 42000000,
        firstMorningQuote: {
            text: "Sáng ra tôi không tin vào mắt mình. Không có email lỗi, không có đơn thiếu, không có gì cả. Máy chạy hết rồi.",
            author: "Nguyễn Văn Bảo — CFO",
        },
    },
    connectors: [
        {
            name: "Shopee",
            category: "Marketplace",
            emoji: "🛍️",
            color: "#EE4D2D",
            bg: "#2b1008",
            active: true,
            ordersPerDay: 8421,
            stat: "8.421 đơn/ngày",
        },
        {
            name: "TikTok Shop",
            category: "Social Commerce",
            emoji: "🎵",
            color: "#69C9D0",
            bg: "#081b1c",
            active: true,
            ordersPerDay: 4823,
            stat: "4.823 đơn/ngày",
        },
        {
            name: "Shopify",
            category: "Website",
            emoji: "🌐",
            color: "#96BF48",
            bg: "#131d08",
            active: true,
            ordersPerDay: 1990,
            stat: "1.990 đơn/ngày",
        },
        {
            name: "GHN",
            category: "Giao hàng nội địa",
            emoji: "📦",
            color: "#F44336",
            bg: "#200a08",
            active: true,
            stat: "42ms phản hồi",
        },
        {
            name: "GHTK",
            category: "Giao hàng nội địa",
            emoji: "🚚",
            color: "#FF6B35",
            bg: "#1e1008",
            active: true,
            stat: "67ms phản hồi",
        },
        {
            name: "Lazada",
            category: "Marketplace",
            emoji: "🏪",
            color: "#0F146D",
            bg: "#08080f",
            active: false,
            note: "Q2 2025",
        },
        {
            name: "Tiki",
            category: "Marketplace",
            emoji: "🔵",
            color: "#0B74E5",
            bg: "#080e14",
            active: false,
            note: "Q3 2025",
        },
        {
            name: "Viettelpost",
            category: "Giao hàng",
            emoji: "📫",
            color: "#E30A17",
            bg: "#200809",
            active: false,
            note: "Q3 2025",
        },
    ],
    features: [
        {
            icon: "Zap",
            title: "Real-time sync",
            desc: "Latency < 100ms. Webhook-first, polling fallback. Đơn hàng từ mọi kênh cập nhật tức thì.",
        },
        {
            icon: "ShieldCheck",
            title: "Idempotent by default",
            desc: "Mỗi sự kiện được xử lý đúng một lần. Hệ thống retry thông minh với exponential backoff.",
        },
        {
            icon: "Activity",
            title: "Observability tích hợp",
            desc: "Timeline từng đơn, log từng bước, cảnh báo khi throughput giảm hay error rate tăng.",
        },
        {
            icon: "GitBranch",
            title: "Logic phân nhánh",
            desc: "If/else, routing theo điều kiện, transform payload trước khi gửi đến bất kỳ connector nào.",
        },
        {
            icon: "RefreshCw",
            title: "Rate-limit & backpressure",
            desc: "Tự động throttle theo giới hạn của từng API. Queue buffer khi traffic đột biến.",
        },
        {
            icon: "Package",
            title: "No-code connector builder",
            desc: "Drag-drop node, không cần deploy code. Thay đổi workflow trong 5 phút, live ngay lập tức.",
        },
    ],
    testimonial: {
        quote:
            "Trước đây 3 người ngồi làm suốt 8 tiếng mỗi ngày. Bây giờ cái máy làm hết trong chưa đến 100ms. Mấy bạn đó tôi giao việc khác — việc có ý nghĩa hơn nhiều.",
        author: "Nguyễn Văn Bảo",
        title: "CFO, Bảo Linh Commerce",
        avatar: "NV",
        metric: "42 triệu VND",
        metricLabel: "tiết kiệm mỗi tháng",
    },
};

// ─── Ticker messages ──────────────────────────────────────────────────────────
const TICKER_MESSAGES = [
    "Xử lý đơn #WFR/059821 từ Shopee · Hà Nội → GHN ✓",
    "Đồng bộ tồn kho SKU-4821 Shopee ↔ TikTok Shop ↔ Website ✓",
    "Đơn #WFR/059822 từ TikTok Shop · Hồ Chí Minh → GHTK ✓",
    "Rate-limit Shopee API: throttled 3s · resume ✓",
    "Webhook TikTok Shop received: order.created · processed in 64ms ✓",
    "Retry #2 GHN create-shipment → success after 1.2s ✓",
    "Đơn #WFR/059823 từ Shopify Website · Đà Nẵng → GHN ✓",
    "Dead-letter queue: 0 messages · tất cả đã được xử lý ✓",
];

export class ConnectorLanding extends Component {
    static template = "workflow_studio.connector_landing";
    static components = { LucideIcon };
    static props = {};

    setup() {
        this.story = STORY;

        this.counters = useState({
            ordersPerDay: 0,
            automationRate: 0.0,
            latencyMs: 0,
            staffFreed: 0,
        });

        this.ui = useState({
            activeStep: -1,
            tickerIndex: 0,
            tickerFading: false,
        });

        this.rootRef = useRef("root");
        this._observers = [];
        this._timers = [];

        onMounted(() => {
            this._setupRevealAnimations();
            this._playSetupTimeline();
            this._startTicker();
        });

        onWillUnmount(() => {
            this._observers.forEach((o) => o.disconnect());
            this._timers.forEach((t) => clearTimeout(t));
        });
    }

    // ─── Intersection-triggered reveals ──────────────────────────────────────

    _setupRevealAnimations() {
        const root = this.rootRef.el;
        if (!root) return;

        const observer = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    if (!entry.isIntersecting) continue;
                    entry.target.classList.add("cl-revealed");
                    if (entry.target.dataset.reveal === "counters") {
                        this._runCounters();
                    }
                    observer.unobserve(entry.target);
                }
            },
            { threshold: 0.18 }
        );

        root.querySelectorAll("[data-reveal]").forEach((el) => observer.observe(el));
        this._observers.push(observer);
    }

    // ─── Counter animation ────────────────────────────────────────────────────

    _runCounters() {
        const DURATION = 2200;
        const start = performance.now();
        const targets = {
            ordersPerDay: STORY.results.ordersPerDay,
            automationRate: STORY.results.automationRate,
            latencyMs: STORY.results.latencyMs,
            staffFreed: STORY.results.staffFreed,
        };

        const tick = (now) => {
            const t = Math.min((now - start) / DURATION, 1);
            const ease = 1 - (1 - t) ** 3; // cubic ease-out

            this.counters.ordersPerDay = Math.round(targets.ordersPerDay * ease);
            this.counters.automationRate = +(targets.automationRate * ease).toFixed(1);
            this.counters.latencyMs = Math.round(targets.latencyMs * ease);
            this.counters.staffFreed = Math.round(targets.staffFreed * ease);

            if (t < 1) requestAnimationFrame(tick);
        };

        requestAnimationFrame(tick);
    }

    // ─── Setup timeline sequential reveal ────────────────────────────────────

    _playSetupTimeline() {
        let step = 0;
        const advance = () => {
            if (step >= STORY.setup.steps.length) return;
            this.ui.activeStep = step;
            step++;
            const t = setTimeout(advance, 750);
            this._timers.push(t);
        };
        const initial = setTimeout(advance, 3200);
        this._timers.push(initial);
    }

    // ─── Ticker rotation ──────────────────────────────────────────────────────

    _startTicker() {
        const rotate = () => {
            this.ui.tickerFading = true;
            const fadeTimer = setTimeout(() => {
                this.ui.tickerIndex = (this.ui.tickerIndex + 1) % TICKER_MESSAGES.length;
                this.ui.tickerFading = false;
            }, 400);
            this._timers.push(fadeTimer);

            const nextTimer = setTimeout(rotate, 2800);
            this._timers.push(nextTimer);
        };

        const start = setTimeout(rotate, 2800);
        this._timers.push(start);
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    get currentTickerMsg() {
        return TICKER_MESSAGES[this.ui.tickerIndex];
    }

    formatNum(n) {
        if (typeof n !== "number") return n;
        return n.toLocaleString("vi-VN");
    }

    isStepVisible(idx) {
        return idx <= this.ui.activeStep;
    }

    get activeConnectors() {
        return this.story.connectors.filter((c) => c.active);
    }

    get comingConnectors() {
        return this.story.connectors.filter((c) => !c.active);
    }
}

registry.category("actions").add("workflow_studio.connector_landing", ConnectorLanding);
