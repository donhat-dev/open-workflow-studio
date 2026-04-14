# Design System: Workflow Studio

> Agent-facing design contract for Workflow Studio.
>
> Canonical deep spec: [`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md)
> Component snippets: [`USAGE_EXAMPLES.md`](./USAGE_EXAMPLES.md)
> Visual catalog: [`design-preview.html`](./design-preview.html)

Workflow Studio is an Odoo-native workflow builder for technical operators. The interface should feel precise, editorial, and system-led rather than soft SaaS. Favor readability, hard structure, and restrained motion. This file is the concise design brief AI agents should follow when generating new UI for the project.

## 1. Visual Theme & Atmosphere

- **Aesthetic direction:** Swiss editorial hierarchy × Carbon-style utility × hard-edged cobalt refinement.
- **Emotional tone:** calm, technical, trustworthy, operational, slightly futuristic.
- **Density model:** dense where the user configures data; spacious where the user orients, reads, or compares.
- **Surface philosophy:** use borders, spacing, and alignment before shadows.
- **Accent philosophy:** one calm primary accent does the main interaction work; semantic states remain muted and purposeful.
- **Canvas grammar:** framed corners, square sockets, orthogonal lines, dot or lattice backgrounds used sparingly.
- **Motion:** confirm state changes; never decorate for its own sake.

## 2. Color Palette & Roles

### Surfaces

| Token | Value | Role |
|---|---|---|
| `surface-base` | `#ffffff` | Main panel, tile, card, dialog, node background |
| `surface-subtle` | `#f6f8fc` | Alternate rows, muted containers, secondary fills |
| `surface-emphasis` | `#edf2fa` | Hovered or pressed neutral surfaces |

### Text

| Token | Value | Role |
|---|---|---|
| `text-base` | `#0f172a` | Primary body and heading text |
| `text-muted` | `#526071` | Supporting copy and secondary labels |
| `text-muted-strong` | `#253244` | Strong metadata and emphasized secondary text |
| `text-faint` | `#8a98ab` | Placeholders, tertiary metadata, disabled text |

### Accent

| Token | Value | Role |
|---|---|---|
| `action` | `#0040ff` | Primary CTA, active tab, focus accent, selected state |
| `action-soft` | `rgba(0, 64, 255, 0.08)` | Soft active background, selected chips, info fills |
| `support-accent` | `#ff6600` | Editorial kicker or small highlight only; never compete with primary CTA |
| `odoo-context` | `#714b67` | Odoo-specific contextual emphasis only |

### Semantic States

| Token | Value | Role |
|---|---|---|
| `success` | `#0f8f62` | Positive state, healthy runs, live success indicators |
| `success-soft` | `rgba(15, 143, 98, 0.10)` | Success background tint |
| `danger` | `#d92d20` | Error, destructive action, failure state |
| `danger-soft` | `rgba(217, 45, 32, 0.10)` | Error background tint |
| `warning` | `#f08c00` | Pending, caution, partial readiness |
| `warning-soft` | `rgba(240, 140, 0, 0.14)` | Warning background tint |
| `info` | `#0059ff` | Informational banners and informational status |
| `info-soft` | `rgba(0, 89, 255, 0.08)` | Informational background tint |

### Borders & Structural Lines

| Token | Value | Role |
|---|---|---|
| `border-base` | `#d6dfeb` | Default separators and control outlines |
| `border-strong` | `#a9b7cc` | Stronger card and control emphasis |
| `frame-line` | `rgba(15, 23, 42, 0.18)` | Construction lines, sockets, frame motifs |

## 3. Typography Rules

### Font Families

- **Display + UI:** `"Space Grotesk", system-ui, sans-serif`
- **Mono / technical metadata:** `"JetBrains Mono", "SF Mono", Consolas, monospace`

### Hierarchy

| Role | Size | Weight | Tracking | Line-height | Use |
|---|---:|---:|---:|---:|---|
| Display XL | `clamp(3rem, 8vw, 6.1rem)` | 700 | `-0.055em` | 0.98 | Hero moments, major landing statements |
| Display L | `clamp(2rem, 4vw, 3.4rem)` | 700 | `-0.05em` | 1.04 | Page hero titles |
| Heading L | `clamp(2.7rem, 5vw, 5rem)` | 700 | `-0.05em` | 1.0 | Large section statements |
| Heading M | `1.6rem` | 700 | `-0.04em` | 1.1 | Panel or tile headline |
| Heading S | `1.32rem` | 700 | `-0.03em` | 1.12 | Card and module titles |
| Body L | `clamp(1.18rem, 2vw, 1.5rem)` | 400 | normal | 1.65 | Lead copy |
| Body M | `1rem` | 400 | normal | 1.58 | Default paragraph text |
| Body S | `0.875rem` | 400 | normal | 1.5 | Dense UI copy |
| Caption | `0.8125rem` | 400 | normal | 1.4 | Helper text |
| Eyebrow | `0.95rem` | 500 | `0.38em` | 1.2 | Section labels, uppercase |
| Kicker | `0.84rem` | 500 | `0.22em` | 1.2 | Tile kickers, nav metadata |
| Micro | `0.76rem` | 500 | `0.16em` | 1.2 | Compact labels |
| Mono Body | `0.84rem` | 400 | `0.02em` | 1.5 | Expressions, payloads, URLs |

### Typography Rules

- Use **Space Grotesk** broadly across interface and editorial shell.
- Use **JetBrains Mono** only for payload values, expressions, URLs, token labels, and technical metadata.
- Keep headlines tight and slightly condensed through tracking, not through compressed layouts.
- Uppercase metadata should feel deliberate and sparse, not noisy.

## 4. Component Stylings

### Buttons

- Primary buttons use `action` fill, white text, minimal softness, and slight lift on hover.
- Secondary buttons stay border-led on white.
- Ghost buttons are transparent and muted.
- Danger buttons use `danger` fill or text depending on severity.
- Default shape is **tight**: use `0px` to `4px` radii depending on control scale; avoid plush rounded CTAs.

### Tags, Badges, and Chips

- **Tags** are taxonomy and metadata markers; border-led and editorial.
- **Badges** are semantic status only; compact and color-coded.
- **Chips** are inline technical payloads and may switch to mono.
- Do not use status badges for generic categorization.

### Controls

- Inputs, selects, and textareas share the same neutral white surface with strong border behavior.
- Focus state is driven by `action` border + ring.
- Expression inputs may use a cool blue-tinted background and border to distinguish computed values.

### Navigation

- Tab navigation is crisp and utility-first.
- Active tab uses `action` text and a bottom indicator rather than pill-heavy fills.
- Toolbar actions should stay subtle until hovered.

### Tiles, Panels, and Cards

- Main tiles are sharp-edged and slightly editorial.
- Prefer a border + restrained top accent rail over a soft card shadow.
- Use gradient tint only as a light atmospheric wash, never as a loud hero gradient.

### Feedback Surfaces

- Inline banners use a 3px left rail and muted tinted background.
- URL boxes and technical surfaces should feel operational, mono-led, and copy-friendly.

### Canvas Elements

- Node cards are compact, crisp, and structural.
- Sockets are square, framed, and small.
- Connections are orthogonal and diagrammatic.
- Use accent only on the most meaningful segment or state change.

## 5. Layout Principles

### Shell & Rhythm

- Use a centered shell: `min(1180px, calc(100vw - 48px))`.
- Build each section with **Eyebrow → Title → Copy** before content modules.
- Major section rhythm is generous; internal control rhythm is tighter.

### Spacing Scale

Base unit is **4px**. Prefer tokenized spacing instead of arbitrary values.

| Token | Value |
|---|---:|
| `space-1` | `4px` |
| `space-2` | `8px` |
| `space-3` | `12px` |
| `space-4` | `16px` |
| `space-5` | `20px` |
| `space-6` | `24px` |
| `space-8` | `32px` |
| `space-10` | `40px` |
| `space-12` | `48px` |
| `space-16` | `64px` |

### Structural Patterns

- **Bento grid:** 12-column narrative grid with mixed-width tiles.
- **Detail grid:** asymmetric 2-column layout for main narrative + stacked side panels.
- **Panel stack:** bordered vertical information stack with 18px rhythm.
- **Canvas stage:** toolbars and legends frame the workflow canvas, not the other way around.
- **Spec grid:** token/spec cards should collapse cleanly into fewer columns on smaller screens.

## 6. Depth & Elevation

Depth is restrained and structural.

| Token | Value | Use |
|---|---|---|
| `shadow-none` | `none` | Flat default surfaces |
| `shadow-soft` | `0 1px 0 rgba(15, 23, 42, 0.08)` | Structural grounding |
| `shadow-md` | `0 10px 24px rgba(15, 23, 42, 0.08)` | Floating popovers, dropdowns |
| `shadow-focus` | `0 0 0 2px rgba(0, 64, 255, 0.18)` | Keyboard and focus indication |

Rules:

- Borders should do most of the separation work.
- Use medium shadow only when a surface truly floats.
- Focus rings must stay crisp and accessible.
- Avoid dreamy multi-layer shadows and glassmorphism.

## 7. Do's & Don'ts

### Do

- Use one dominant interaction blue and keep semantics muted.
- Let typography and alignment create hierarchy before decoration does.
- Prefer sharp corners on tiles, panels, sockets, and canvas surfaces.
- Keep data-heavy regions efficient and compact.
- Use mono for technical payloads, never for all body copy.
- Preserve whitespace around section intros and key storytelling moments.

### Don't

- Do not use plush SaaS gradients, soft shadows, or oversized rounded cards.
- Do not introduce a second CTA color that competes with `action` blue.
- Do not turn every status into a bright badge wall.
- Do not make the canvas playful or organic; it should read like a technical instrument.
- Do not use decorative motion, bounce, or heavy animation choreography.
- Do not mix unrelated visual languages inside the same screen.

## 8. Responsive Behavior

- Collapse multi-column token and card grids into fewer columns below tablet widths.
- Stack asymmetrical detail layouts into one column on smaller screens.
- Keep tap targets at or above `44px` where interaction density allows.
- Preserve section hierarchy even when content stacks vertically.
- On mobile, prioritize the reading order: title, status, controls, metadata, then dense technical details.
- Canvas-adjacent previews may simplify legends and supporting panels before reducing core node clarity.

## 9. Agent Prompt Guide

When generating UI for Workflow Studio, prefer prompts such as:

- “Use Workflow Studio’s editorial-carbon design system from `docs/design-system/DESIGN.md`.”
- “Keep the interface border-led, sharp-edged, and cobalt-accented; avoid soft SaaS styling.”
- “Use Space Grotesk for UI/display and JetBrains Mono only for technical payloads and expressions.”
- “For cards and panels, favor hard structure, hairline borders, and restrained shadows.”
- “For workflow canvas elements, keep sockets square, connections orthogonal, and visual noise low.”

If a task conflicts with this file and `DESIGN_SYSTEM.md`, treat `DESIGN_SYSTEM.md` as the deeper source of truth and use this file as the concise implementation brief.
