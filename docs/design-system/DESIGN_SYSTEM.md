# Workflow Studio — Design System Specification

**Codename:** Editorial Carbon  
**Date:** 2026-03-23  
**Aesthetic:** Swiss editorial hierarchy × Carbon system utility

---

## Table of Contents

1. [Design Principles](#1-design-principles)
2. [Design Tokens](#2-design-tokens)
   - 2.1 Color System
   - 2.2 Typography
   - 2.3 Spacing
   - 2.4 Radius
   - 2.5 Depth (Shadows)
   - 2.6 Layout Primitives
3. [Component Library](#3-component-library)
   - 3.1 Button
   - 3.2 Tag / Label
   - 3.3 Input / Control
   - 3.4 Tab Nav
   - 3.5 Card / Tile
   - 3.6 Badge / Status
   - 3.7 Banner / Inline Feedback
   - 3.8 Nav Card (Footer Navigation)
   - 3.9 URL Box
   - 3.10 Pill / Chip
   - 3.11 Socket
   - 3.12 Connection Path
3. [Composition Patterns](#4-composition-patterns)
   - 4.1 Shell + Section Rhythm
   - 4.2 Bento Grid
   - 4.3 Detail Grid (Asymmetric 2-col)
   - 4.4 Panel Stack
   - 4.5 Canvas Stage
   - 4.6 Token / Spec Grid
   - 4.7 Form Field Row
   - 4.8 Config Dialog Layout

---

## 1. Design Principles

| # | Principle | Rule |
|---|-----------|------|
| 1 | **Reading-first** | Layout must scan and read before it decorates. |
| 2 | **One calm accent** | Single primary hue; semantics use muted tints, never loud secondaries. |
| 3 | **Hairline structure** | Organize with borders + spacing, not box-spam. |
| 4 | **Dense where useful, spacious where strategic** | Data surfaces = tight; navigation/titles = generous whitespace. |
| 5 | **Motion confirms, never performs** | Transitions acknowledge state; no choreography. |

**Zone rule — where each aesthetic leads:**

| Zone | Leads | Examples |
|------|-------|---------|
| Macro shell / page rhythm / titles | Swiss editorial | Hero, section intros, page framing, shell spacing |
| Controls / forms / data rows | Carbon system | Inputs, selects, config panels, data trees, key-value rows |
| Canvas / graph | Hybrid | Editorial alignment + system state feedback |
| Dashboard / landing / narrative | Editorial dominant | Bento tiles, metrics, storytelling blocks |

---

## 2. Design Tokens

### 2.1 Color System

#### Surfaces

| Token | Value | Role |
|-------|-------|------|
| `--wf-surface-base` | `hsl(0 0% 100%)` · maps to `$o-view-background-color` | Primary canvas / card / panel background |
| `--wf-surface-subtle` | `hsl(220 14% 96%)` · maps to `$o-gray-100` | Secondary fills, alternate rows, muted containers |
| `--wf-surface-emphasis` | `hsl(220 14% 93%)` · maps to `$o-gray-200` | Pressed / active surface, hover swell |
| `--wf-surface-app` | `$o-webclient-background-color` | Outermost app chrome behind panels |
| `--wf-surface-elevated` | `hsl(0 0% 100%)` with `--wf-shadow-soft` | Popovers, dropdowns, floating layers |

#### Foreground / Text

| Token | Value | Role |
|-------|-------|------|
| `--wf-text-base` | `hsl(222 47% 11%)` · `$o-main-text-color` | Primary body & heading text |
| `--wf-text-muted` | `hsl(220 9% 46%)` · `$o-gray-600` | Secondary descriptions, supporting copy |
| `--wf-text-muted-strong` | `$o-gray-700` | Emphasized secondary (labels, kickers) |
| `--wf-text-faint` | `$o-gray-500` | Tertiary text, placeholders, disabled |

#### Accent — Primary

| Token | Value | Role |
|-------|-------|------|
| `--wf-action-color` | `hsl(225 100% 50%)` · `$o-action` | Primary accent, CTA fills, active indicators |
| `--wf-action-soft-bg` | `hsla(225 100% 50% / 0.08)` | Light tint fills (selected rows, badges) |
| `--wf-action-soft-bg-strong` | `hsla(225 100% 50% / 0.12)` | Hover state on soft-bg surfaces |

#### Accent — Semantic

| Token | Value | Role |
|-------|-------|------|
| `--wf-success-color` | `$o-success` | Positive status, live indicators |
| `--wf-success-soft-bg` | `rgba($o-success, 0.12)` | Success tint fill |
| `--wf-danger-color` | `$o-danger` | Error, destructive actions |
| `--wf-danger-soft-bg` | `rgba($o-danger, 0.12)` | Error tint fill |
| `--wf-warning-color` | `$o-warning` | Caution, pending states |
| `--wf-warning-soft-bg` | `rgba($o-warning, 0.15)` | Warning tint fill |
| `--wf-info-color` | `$o-info` | Informational badges/banners |
| `--wf-info-soft-bg` | `rgba($o-info, 0.12)` | Info tint fill |

#### Borders

| Token | Value | Role |
|-------|-------|------|
| `--wf-border-base` | `hsl(220 13% 91%)` · `$o-gray-300` | Default hairline separators |
| `--wf-border-strong` | `$o-gray-400` | Emphasized borders (node cards, focused controls) |
| `--wf-border-line` | `hsla(222 47% 11% / 0.18)` | Construction lines, grid, socket outlines |

#### Special

| Token | Value | Role |
|-------|-------|------|
| `--wf-canvas-grid-dot` | `rgba($o-gray-500, 0.3)` | Canvas dot-grid pattern |
| `--wf-panel-backdrop` | `rgba($o-black, 0.2)` | Overlay/dialog backdrop |

---

### 2.2 Typography

#### Font Stacks

| Token | Value | Usage |
|-------|-------|-------|
| `--wf-font-display` | `"Space Grotesk", system-ui, sans-serif` | Hero titles, section headings, editorial display |
| `--wf-font-ui` | Odoo default sans-serif stack | Controls, labels, body copy, form elements |
| `--wf-font-mono` | `"JetBrains Mono", "SF Mono", Consolas, monospace` | Code, expressions, metadata, payload values |

#### Type Scale

| Role | Size | Weight | Tracking | Line-height | Font |
|------|------|--------|----------|-------------|------|
| **Display XL** | `clamp(3rem, 8vw, 6.1rem)` | 700 | `-0.055em` | 0.98 | display |
| **Display L** | `clamp(2rem, 4vw, 3.4rem)` | 700 | `-0.05em` | 1.04 | display |
| **Heading L** | `clamp(2.7rem, 5vw, 5rem)` | 700 | `-0.05em` | 1.0 | display |
| **Heading M** | `1.6rem` | 700 | `-0.04em` | 1.1 | display |
| **Heading S** | `1.32rem` | 700 | `-0.03em` | 1.12 | display |
| **Body L** | `clamp(1.18rem, 2vw, 1.5rem)` | 400 | normal | 1.65 | ui |
| **Body M** | `1rem` | 400 | normal | 1.58 | ui |
| **Body S** | `0.875rem` | 400 | normal | 1.5 | ui |
| **Caption** | `0.8125rem` | 400 | normal | 1.4 | ui |
| **Eyebrow** | `0.95rem` | 500 | `0.38em` | 1.2 | ui, uppercase |
| **Kicker** | `0.84rem` | 500 | `0.22em` | 1.2 | ui, uppercase |
| **Micro** | `0.76rem` | 500 | `0.16em` | 1.2 | ui, uppercase |
| **Mono body** | `0.84rem` | 400 | `0.02em` | 1.5 | mono |

---

### 2.3 Spacing

Based on a **4px base unit**. Use multiplication, not arbitrary values.

| Token | Value | Usage |
|-------|-------|-------|
| `--wf-space-1` | `4px` | Hairline gaps, icon offsets |
| `--wf-space-2` | `8px` | Inline gaps, compact padding |
| `--wf-space-3` | `12px` | Standard inner padding, control gaps |
| `--wf-space-4` | `16px` | Card padding, section gaps (tight) |
| `--wf-space-5` | `20px` | Panel padding |
| `--wf-space-6` | `24px` | Section padding (compact) |
| `--wf-space-8` | `32px` | Section padding (generous) |
| `--wf-space-10` | `40px` | Major section breaks |
| `--wf-space-12` | `48px` | Page-level section rhythm |
| `--wf-space-16` | `64px` | Hero / narrative breathing room |

---

### 2.4 Radius

The system defaults to **sharp** (0px) for editorial surfaces and uses small radii only for interactive controls.

| Token | Current | Target | Usage |
|-------|---------|--------|-------|
| `--wf-radius-none` | — | `0px` | Cards, tiles, panels, modals, sockets (editorial sharp) |
| `--wf-radius-sm` | `4px` | `4px` | Badges, chips, small interactive elements |
| `--wf-radius-md` | `6px` | `4px` | Controls (inputs, selects, buttons) |
| `--wf-radius-lg` | `8px` | `6px` | Popovers, dropdowns, code blocks |
| `--wf-radius-pill` | — | `999px` | Pill-shaped badges, toggles |

**Direction:** migrate most card/panel surfaces toward 0 or 2px. Controls stay at 4px for Carbon-like tactile clarity.

---

### 2.5 Depth (Shadows)

| Token | Value | Usage |
|-------|-------|-------|
| `--wf-shadow-none` | `none` | Flat surfaces (default) |
| `--wf-shadow-soft` | `0 18px 40px rgba(17,24,39, 0.04)` | Cards, tiles — barely-there lift |
| `--wf-shadow-sm` | `0 2px 8px rgba(0,0,0, 0.08)` | Node cards, chips — subtle grounding |
| `--wf-shadow-md` | `0 4px 16px rgba(0,0,0, 0.12)` | Floating popovers, dropdowns |
| `--wf-shadow-panel` | `-6px 0 18px rgba(0,0,0, 0.12)` | Side panels (asymmetric) |
| `--wf-shadow-drag` | `0 6px 16px rgba(0,0,0, 0.2)` | Drag state (temporary) |
| `--wf-shadow-focus` | `0 0 0 2px rgba($action, 0.15)` | Focus ring (keyboard nav) |
| `--wf-shadow-focus-strong` | `0 0 0 2px rgba($action, 0.2)` | Focus ring (strong emphasis) |

**Rule:** shadows are environmental, not decorative. If a surface doesn't float above another, `--wf-shadow-none`.

---

### 2.6 Layout Primitives

| Token | Value | Usage |
|-------|-------|-------|
| `--wf-container` | `min(1180px, calc(100vw - 48px))` | Page-level content shell |
| `--wf-grid-size` | `124px` | Background lattice cell (editorial pages) |
| `--wf-canvas-grid` | `72px` | Canvas stage background grid |
| `--wf-bento-gap` | `18px` | Gap between bento tiles |
| `--wf-panel-gap` | `18px` | Gap between stacked panels |

---

## 3. Component Library

### Class Naming Convention

```
.wf-{component}                    → base
.wf-{component}--{variant}         → variant
.wf-{component}--{size}            → size
.wf-{component}.is-{state}         → JS-driven state
.wf-{component}__{element}         → child element (BEM)
```

---

### 3.1 Button `.wf-btn`

#### Variants

| Class | Fill | Border | Text | Use case |
|-------|------|--------|------|----------|
| `.wf-btn--primary` | `--wf-action-color` | transparent | white | Primary CTA, commit actions |
| `.wf-btn--secondary` | `--wf-surface-base` | `--wf-border-base` | `--wf-text-base` | Secondary actions, cancel |
| `.wf-btn--ghost` | transparent | transparent | `--wf-text-muted` | Toolbar/inline actions |
| `.wf-btn--danger` | `--wf-danger-color` | transparent | white | Destructive actions |
| `.wf-btn--danger-ghost` | transparent | transparent | `--wf-danger-color` | Soft destructive (remove row) |

#### States

| State | Treatment |
|-------|-----------|
| Default | As variant table above |
| Hover | `translateY(-1px)` + lighten fill 4% or border darken |
| Focus | `--wf-shadow-focus` ring, no outline |
| Active/Pressed | Surface darkens 8%, no lift |
| Disabled | `opacity: 0.45`, `pointer-events: none` |
| Loading | Content replaced with spinner, dims text |

#### Sizes

| Class | Min-height | Padding-x | Font-size |
|-------|------------|-----------|-----------|
| `.wf-btn--sm` | `32px` | `12px` | `0.8125rem` |
| `.wf-btn--md` | `40px` | `20px` | `0.875rem` (default) |
| `.wf-btn--lg` | `52px` | `28px` | `1rem` |
| `.wf-btn--xl` | `62px` | `34px` | `1rem` |

#### Structure

```html
<button class="wf-btn wf-btn--primary wf-btn--md">
  <i class="wf-btn__icon fa fa-play"></i>
  <span class="wf-btn__label">Execute</span>
</button>
```

---

### 3.2 Tag / Label `.wf-tag`

Metadata markers — categories, keywords, status qualifiers.

#### Variants

| Class | Background | Border | Text |
|-------|------------|--------|------|
| `.wf-tag--default` | `rgba(255,255,255,0.75)` | `--wf-border-base` | `--wf-text-muted` |
| `.wf-tag--featured` | `rgba($action, 0.05)` | `rgba($action, 0.32)` | `--wf-action-color` |
| `.wf-tag--success` | `--wf-success-soft-bg` | `rgba($success, 0.3)` | `$success` darken 10% |
| `.wf-tag--danger` | `--wf-danger-soft-bg` | `rgba($danger, 0.3)` | `$danger` darken 10% |
| `.wf-tag--warning` | `--wf-warning-soft-bg` | `rgba($warning, 0.3)` | `$warning` darken 10% |

#### Sizes

| Class | Min-height | Padding-x | Font-size | Tracking |
|-------|------------|-----------|-----------|----------|
| `.wf-tag--sm` | `28px` | `10px` | `0.76rem` | `0.16em` |
| `.wf-tag--md` | `34px` | `14px` | `0.84rem` | `0.18em` (default) |
| `.wf-tag--lg` | `44px` | `18px` | `0.92rem` | `0.24em` |

#### States

| State | Treatment |
|-------|-----------|
| Default | As variant table |
| Hover | Border darkens 12% (interactive tags only) |
| Focus | `--wf-shadow-focus` ring |
| Disabled | `opacity: 0.45` |

#### Structure

```html
<span class="wf-tag wf-tag--featured wf-tag--md">
  <span class="wf-tag__icon">★</span>
  <span class="wf-tag__label">Featured</span>
</span>
```

---

### 3.3 Input / Control `.wf-control`

All interactive form controls share a common treatment for consistency.

#### Base Tokens

| Property | Value |
|----------|-------|
| Border radius | `--wf-radius-md` (4px) |
| Border | `1px solid --wf-border-base` |
| Background | `--wf-surface-base` |
| Font size | `0.875rem` (Body S) |
| Min-height | Follows size tier |

#### Variants

| Class | Description |
|-------|-------------|
| `.wf-control--text` | Standard text input |
| `.wf-control--select` | Dropdown select |
| `.wf-control--textarea` | Multi-line input |
| `.wf-control--expression` | Expression-mode input (purple border/bg theme) |

#### States

| State | Border | Background | Ring |
|-------|--------|------------|------|
| Default | `--wf-border-base` | `--wf-surface-base` | none |
| Hover | `--wf-border-strong` | `--wf-surface-base` | none |
| Focus | `--wf-action-color` | `--wf-surface-base` | `--wf-shadow-focus` |
| Expression focus | `--expression-border` | `--expression-bg` | expression ring |
| Error | `--wf-danger-color` | `--wf-surface-base` | `0 0 0 2px rgba($danger, 0.15)` |
| Disabled | `--wf-border-base` | `--wf-surface-subtle` | none, `opacity: 0.6` |
| Readonly | `--wf-border-base` | `--wf-surface-subtle` | none |

#### Sizes

| Class | Min-height | Padding | Font-size |
|-------|------------|---------|-----------|
| `.wf-control--sm` | `32px` | `6px 10px` | `0.8125rem` |
| `.wf-control--md` | `38px` | `8px 12px` | `0.875rem` (default) |
| `.wf-control--lg` | `44px` | `10px 14px` | `1rem` |

---

### 3.4 Tab Nav `.wf-tab-nav`

Peer navigation between related views.

#### Structure

```html
<nav class="wf-tab-nav d-flex">
  <button class="wf-tab-btn active">
    <i class="fa fa-cog"></i>
    <span>Parameters</span>
  </button>
  <button class="wf-tab-btn">
    <i class="fa fa-sliders"></i>
    <span>Settings</span>
  </button>
</nav>
```

#### Tokens (from `shared_primitives.scss`)

| Token | Value |
|-------|-------|
| `$wf-tab-border` | `--wf-border-base` |
| `$wf-tab-bg` | `--wf-surface-base` |
| `$wf-tab-text` | `--wf-text-muted` |
| `$wf-tab-text-hover` | `--wf-text-base` |
| `$wf-tab-text-active` | `--wf-action-color` |
| `$wf-tab-indicator-color` | `--wf-action-color` |

#### States

| State | Treatment |
|-------|-----------|
| Default | Muted text, transparent bottom border |
| Hover | Text → `--wf-text-base` |
| Active | Text → `--wf-action-color`, `font-weight: 600`, 2px accent bottom-border |
| Disabled | `opacity: 0.4`, `pointer-events: none` |

---

### 3.5 Card / Tile `.wf-tile`

Content modules for bento grids, legend explanations, and informational blocks.

#### Variants

| Class | Usage |
|-------|-------|
| `.wf-tile` | Standard 4-col tile |
| `.wf-tile--tall` | 5-col, extra vertical space for metrics |
| `.wf-tile--wide` | 7-col, for wide narrative content |
| `.wf-tile--full` | 12-col, full-width statement tile |

#### Base Treatment

| Property | Value |
|----------|-------|
| Border | `1px solid --wf-border-base` |
| Background | `rgba(--wf-surface-base, 0.88)` |
| Shadow | `--wf-shadow-soft` |
| Radius | `0px` (sharp editorial) |
| Padding | `24px` |

#### Child Elements

| Element | Class | Role |
|---------|-------|------|
| Kicker | `.wf-tile__kicker` | Uppercase micro-label (accent color) |
| Title | `.wf-tile__title` | Heading M, tight leading |
| Copy | `.wf-tile__copy` | Body M, muted color |
| Metric | `.wf-tile__metric` | Display number, accent color |
| Footer | `.wf-tile__footer` | Tag row or action links |

#### States

| State | Treatment |
|-------|-----------|
| Default | As base |
| Hover | `translateY(-3px)`, border color → `rgba($action, 0.28)` |
| Selected | Border → `--wf-action-color`, soft bg tint |

---

### 3.6 Badge / Status `.wf-badge`

Compact state labels for inline status indication.

#### Variants

| Class | Dot | Text color | Background |
|-------|-----|------------|------------|
| `.wf-badge--neutral` | `--wf-text-faint` | `--wf-text-muted` | `--wf-surface-subtle` |
| `.wf-badge--success` | `$success` | darken($success, 10%) | `--wf-success-soft-bg` |
| `.wf-badge--danger` | `$danger` | darken($danger, 10%) | `--wf-danger-soft-bg` |
| `.wf-badge--warning` | `$warning` | darken($warning, 10%) | `--wf-warning-soft-bg` |
| `.wf-badge--info` | `$info` | darken($info, 10%) | `--wf-info-soft-bg` |
| `.wf-badge--active` | `$action` | `--wf-action-color` | `--wf-action-soft-bg` |

#### Sizes

| Class | Height | Font-size | Padding-x |
|-------|--------|-----------|-----------|
| `.wf-badge--sm` | `20px` | `0.6875rem` | `6px` |
| `.wf-badge--md` | `24px` | `0.75rem` | `8px` (default) |

#### Structure

```html
<span class="wf-badge wf-badge--success wf-badge--md">
  <span class="wf-badge__dot"></span>
  <span class="wf-badge__label">Active</span>
</span>
```

---

### 3.7 Banner / Inline Feedback `.wf-banner`

Contextual feedback bars for panels and sections.

#### Variants

| Class | Left border | Background | Icon | Text |
|-------|-------------|------------|------|------|
| `.wf-banner--info` | `--wf-info-color` | `--wf-info-soft-bg` | `fa-info-circle` | `--wf-text-base` |
| `.wf-banner--success` | `--wf-success-color` | `--wf-success-soft-bg` | `fa-check-circle` | `--wf-text-base` |
| `.wf-banner--warning` | `--wf-warning-color` | `--wf-warning-soft-bg` | `fa-exclamation-triangle` | `--wf-text-base` |
| `.wf-banner--danger` | `--wf-danger-color` | `--wf-danger-soft-bg` | `fa-times-circle` | `--wf-text-base` |
| `.wf-banner--neutral` | `--wf-border-strong` | `--wf-surface-subtle` | `fa-lightbulb-o` | `--wf-text-muted` |

#### Structure

```html
<div class="wf-banner wf-banner--info">
  <i class="wf-banner__icon fa fa-info-circle"></i>
  <div class="wf-banner__content">
    <strong class="wf-banner__title">Note</strong>
    <p class="wf-banner__text">This webhook URL will change when you republish.</p>
  </div>
  <button class="wf-banner__dismiss wf-btn wf-btn--ghost wf-btn--sm">×</button>
</div>
```

#### Base Treatment

| Property | Value |
|----------|-------|
| Min-height | `40px` |
| Padding | `10px 14px` |
| Border-left | `3px solid {variant-color}` |
| Radius | `0px` |
| Font-size | `0.875rem` |

---

### 3.8 Nav Card (Footer Navigation) `.wf-config-nav-button`

Previous / Next node navigation in the config panel footer.

#### Variants

| Direction | Alignment | Icon position |
|-----------|-----------|---------------|
| `.wf-config-nav-button--previous` | `text-align: left` | chevron-left before label |
| `.wf-config-nav-button--next` | `text-align: right` | chevron-right after label |

#### Base Treatment

| Property | Value |
|----------|-------|
| Background | `--wf-surface-base` |
| Border | `1px solid --wf-border-base` |
| Radius | `0px` |
| Padding | `10px 14px` |
| Font-size | `0.8125rem` kicker + `0.875rem` title |

#### States

| State | Treatment |
|-------|-----------|
| Default | As base |
| Hover | Background → `--wf-surface-subtle`, border darkens slightly |
| Disabled | `opacity: 0.35`, `pointer-events: none` |

#### Child Elements

| Element | Class | Content |
|---------|-------|---------|
| Direction label | `.wf-config-nav-button__direction` | "Previous" / "Next" (kicker style) |
| Node name | `.wf-config-nav-button__name` | Truncated node label |

---

### 3.9 URL Box `.wf-url-box`

Displays a webhook or endpoint URL with copy action.

#### Variants

| Class | Border | Background |
|-------|--------|------------|
| `.wf-url-box` | `--wf-border-base` | `--wf-surface-subtle` |
| `.wf-url-box--success` | `rgba($success, 0.4)` | `rgba($success, 0.05)` |

#### States

| State | Treatment |
|-------|-----------|
| Default | Muted display |
| Live/Active | Green variant — `.wf-url-box--success` |
| Focus (copy button) | Standard focus ring on button child |

---

### 3.10 Pill / Chip `.wf-chip`

Compact inline metadata — connection labels, code fragments.

#### Variants

| Class | Background | Border | Font |
|-------|------------|--------|------|
| `.wf-chip--default` | `rgba(255,255,255,0.84)` | `--wf-border-base` | ui |
| `.wf-chip--code` | `rgba(255,255,255,0.84)` | `--wf-border-base` | mono |
| `.wf-chip--accent` | `--wf-action-soft-bg` | `rgba($action, 0.2)` | ui |

#### Size

| Property | Value |
|----------|-------|
| Min-height | `34px` |
| Padding-x | `12px` |
| Font-size | `0.84rem` |
| Radius | `0px` |

---

### 3.11 Socket `.wf-socket`

Connection points on canvas nodes.

#### Base Treatment

| Property | Value |
|----------|-------|
| Size | `16×16px` |
| Border | `2px solid --wf-border-line` |
| Background | `--wf-surface-base` |
| Inner border | `1px solid rgba(17,24,39,0.12)` inset at 3px |
| Shape | Square (0 radius — echoes framed-corner motif) |

#### States

| State | Treatment |
|-------|-----------|
| Default | As base |
| Hover | Border → `--wf-action-color` |
| Connected | Fill center with `--wf-action-color` dot |
| Drawing | Pulsing border animation |
| Error | Border → `--wf-danger-color` |

---

### 3.12 Connection Path `.wf-connection`

Orthogonal paths between sockets.

#### Elements

| Element | Treatment |
|---------|-----------|
| `.wf-connection__segment` | 2px solid line, `rgba(17,24,39, 0.22)` |
| `.wf-connection__segment--accent` | 2px solid, `rgba($action, 0.42)` — final delivery edge |
| `.wf-connection__label` | Chip-like inline label at midpoint |
| `.wf-connection__arrow` | 12×12px rotated border (chevron) in accent color |

#### States

| State | Treatment |
|-------|-----------|
| Default | Muted gray segments |
| Active / data flowing | Accent color on final segment + arrow |
| Selected | Full path → accent color |
| Error | Segments → `--wf-danger-color` |

---

## 4. Composition Patterns

### 4.1 Shell + Section Rhythm

Every page organizes content through a centered shell with consistent vertical rhythm.

```
┌─────────────────────────────────────────────┐
│ .page                                        │
│  ┌──────────── .shell ────────────────┐     │
│  │  width: min(1180px, 100vw - 48px)  │     │
│  │                                     │     │
│  │  .section        padding: 48px 0    │     │
│  │  .section + .section  top: 24px     │     │
│  └─────────────────────────────────────┘     │
└──────────────────────────────────────────────┘
```

**Eyebrow → Title → Copy** establishes every section intro:

```html
<section class="section">
  <div class="shell">
    <div class="eyebrow">Section Category</div>
    <h2 class="section-title">Concise Headline</h2>
    <p class="section-copy">Supporting paragraph...</p>
    <!-- content blocks here -->
  </div>
</section>
```

---

### 4.2 Bento Grid

12-column grid of mixed-size tiles for storytelling.

```
┌────────────┬───────────────────────┐
│  .tile.tall│     .tile.wide        │
│  span 5    │     span 7            │
│            │                       │
├────┬────┬──┴──────────────────────-┤
│ 4  │ 4  │ 4                        │
├────┴────┴──────────────────────────┤
│          .tile.full  span 12       │
└────────────────────────────────────┘
```

```css
.bento-grid {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: var(--wf-bento-gap);  /* 18px */
}
```

---

### 4.3 Detail Grid (Asymmetric 2-col)

Main content + stacked side panels.

```
┌─────────────────────────┬──────────────┐
│  Main column (1.1fr)    │ Panel stack  │
│                         │  (.8fr)      │
│  .detail-kicker         │ ┌──────────┐ │
│  .detail-title          │ │ panel    │ │
│  .lead                  │ └──────────┘ │
│  .detail-copy           │ ┌──────────┐ │
│  .tag-row               │ │ panel    │ │
│                         │ └──────────┘ │
└─────────────────────────┴──────────────┘
```

```css
.detail-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(260px, 0.8fr);
  gap: 48px;
  align-items: start;
}
```

---

### 4.4 Panel Stack

Vertically stacked information cards.

```html
<aside class="panel-stack">
  <section class="panel">
    <h3>Panel Title</h3>
    <ul><li>Item</li></ul>
  </section>
  <section class="panel">
    <h3>Panel Title</h3>
    <p>Content</p>
  </section>
</aside>
```

**Shared treatment:** `1px solid --wf-border-base`, `--wf-surface-base` bg, `--wf-shadow-soft`, `gap: 18px`.

---

### 4.5 Canvas Stage

Workflow editor canvas with grid background, node cards, and connection paths.

```
┌─ .canvas-shell ──────────────────────────────┐
│ ┌─ .canvas-toolbar ────────────────────────┐ │
│ │  [chip] [chip] [chip]                     │ │
│ └───────────────────────────────────────────┘ │
│ ┌─ .canvas-stage ──────────────────────────┐ │
│ │  .canvas-caption                          │ │
│ │                                           │ │
│ │  ┌─ node ─┐    ┌─ node ──┐              │ │
│ │  │ icon   │────│ icon    │              │ │
│ │  │ kicker │    │ kicker  │              │ │
│ │  │ title  │    │ title   │              │ │
│ │  └────────┘    └─────────┘              │ │
│ └───────────────────────────────────────────┘ │
│ ┌─ .canvas-legend (3-col) ─────────────────┐ │
│ │  [card]  [card]  [card]                   │ │
│ └───────────────────────────────────────────┘ │
└───────────────────────────────────────────────┘
```

Canvas grid: two 1px linear gradients at `--wf-canvas-grid` interval.

---

### 4.6 Token / Spec Grid

Documentation grid for displaying design tokens or component specs inline.

```css
.token-grid, .spec-grid {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: 18px;
}
.token-card, .spec-card {
  grid-column: span 4;  /* 3 per row on desktop */
}
```

Responsive: collapses to `span 12` below 980px.

---

### 4.7 Form Field Row `.kv-row`

Config panel control rows for key-value property editing.

```
┌────────────────────────────────────────┐
│ .kv-row                                │
│  ┌─ label ──────────┐ ┌─ control ──┐  │
│  │ Field name       │ │ [input]    │  │
│  │ .kv-row__label   │ │            │  │
│  └──────────────────┘ └────────────┘  │
├────────────────────────────────────────┤  ← hairline border
│ .kv-row--stack (stacked variant)       │
│  ┌─ label ─────────────────────────┐  │
│  │ Field name                      │  │
│  ├─ control ───────────────────────┤  │
│  │ [textarea / expression input]   │  │
│  └─────────────────────────────────┘  │
└────────────────────────────────────────┘
```

**Tokens used:**

| Property | Value |
|----------|-------|
| Background | `$wf-field-row-bg` |
| Border | `$wf-field-row-border` |
| Label font | Body S, `--wf-text-muted-strong` |
| Gap | `--wf-space-3` |

---

### 4.8 Config Dialog Layout

Full-screen config panel for node editing.

```
┌─ .wf-config-panel-dialog ──────────────────────────┐
│ ┌─ modal-header ─────────────────────────────────┐  │
│ │  Node icon + title          [close ×]          │  │
│ └────────────────────────────────────────────────┘  │
│ ┌─ .wf-config-panel-dialog__body (flex: 1 1 0) ──┐ │
│ │  ┌─ .wf-tab-nav ─────────────────────────────┐ │ │
│ │  │  [Parameters] [Settings]                    │ │ │
│ │  └─────────────────────────────────────────────┘ │ │
│ │  ┌─ scrollable content ───────────────────────┐ │ │
│ │  │  Control groups / trigger config / fields   │ │ │
│ │  └─────────────────────────────────────────────┘ │ │
│ └──────────────────────────────────────────────────┘ │
│ ┌─ modal-footer ─────────────────────────────────┐  │
│ │  [◀ Previous: Node N]    [Next: Node N ▶]    │  │
│ └────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

**Critical CSS:**

```scss
.wf-config-panel-dialog__body {
  flex: 1 1 0;
  min-height: 0;
  overflow-y: auto;
}
```

---

## Quick Reference Matrix

### All Components × States

| Component | Default | Hover | Focus | Active | Disabled | Error | Loading | Selected |
|-----------|---------|-------|-------|--------|----------|-------|---------|----------|
| **Button** | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | — |
| **Tag** | ✅ | ✅* | ✅ | — | ✅ | — | — | — |
| **Control** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | — |
| **Tab** | ✅ | ✅ | — | ✅ | ✅ | — | — | — |
| **Tile** | ✅ | ✅ | — | — | — | — | — | ✅ |
| **Badge** | ✅ | — | — | — | — | — | — | — |
| **Banner** | ✅ | — | — | — | — | — | — | — |
| **Nav Card** | ✅ | ✅ | ✅ | — | ✅ | — | — | — |
| **URL Box** | ✅ | — | — | — | — | — | — | — |
| **Chip** | ✅ | ✅* | — | — | — | — | — | — |
| **Socket** | ✅ | ✅ | — | — | — | ✅ | — | ✅ |
| **Connection** | ✅ | — | — | ✅ | — | ✅ | — | ✅ |

\* = only when interactive

### All Components × Sizes

| Component | sm | md | lg | xl |
|-----------|----|----|----|----|
| **Button** | ✅ | ✅ (default) | ✅ | ✅ |
| **Tag** | ✅ | ✅ (default) | ✅ | — |
| **Control** | ✅ | ✅ (default) | ✅ | — |
| **Badge** | ✅ | ✅ (default) | — | — |

---

## Migration from Current Token Layer

| Current (`$wf-*` Sass var) | → Target (also expose as CSS custom prop) | Change needed |
|----------------------------|-------------------------------------------|---------------|
| `$wf-radius-sm: 4px` | Keep 4px | none |
| `$wf-radius-md: 6px` | → `4px` | tighten |
| `$wf-radius-lg: 8px` | → `6px` | tighten |
| `$wf-shadow-sm` | Keep | none |
| `$wf-shadow-md` | Keep | none |
| No `--wf-font-display` | Add Space Grotesk | **new** |
| No spacing scale | Add `--wf-space-*` | **new** |
| No `--wf-radius-none` | Add `0px` | **new** |
| No density tokens | Add via spacing scale | **new** |
| No type-scale tokens | Add role-based sizes | **new** |
| Hardcoded `border-radius` values scattered across component SCSS | Migrate to `$wf-radius-*` tokens | **cleanup** |
| `$wf-white` alias | Deprecate in favor of `$wf-surface-base` | **deprecation** |
