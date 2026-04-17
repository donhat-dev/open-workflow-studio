# Workflow Studio DESIGN.md

> Canonical concise design brief for Workflow Studio UI work.
>
> Deep spec: [`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md)
> Component snippets: [`USAGE_EXAMPLES.md`](./USAGE_EXAMPLES.md)
> Visual catalog: [`design-preview.html`](./design-preview.html)

This file intentionally follows the Stitch `DESIGN.md` section order so AI agents and humans can scan it predictably. Use this brief first. If an exact token, component contract, or markup pattern is still missing, continue through the linked deep spec and examples above instead of inventing a parallel design language.

## Overview

Workflow Studio is an Odoo-native workflow builder for technical operators. The interface should feel calm, precise, editorial, and system-led rather than soft SaaS. Think Swiss editorial hierarchy, Carbon-style utility, and hard-edged cobalt refinement.

- Dense where the user configures data; spacious where the user orients, reads, or compares.
- Borders, spacing, and alignment should create hierarchy before shadows do.
- Use one calm primary accent for the main interaction path; semantic states stay muted and purposeful.
- Canvas elements should feel structural: square sockets, orthogonal lines, framed corners, and restrained motion.
- Build major sections with **Eyebrow → Title → Copy** before modules or controls.
- Default page shell is centered and disciplined: `min(1180px, calc(100vw - 48px))`.
- On smaller screens, keep the reading order obvious: title, status, controls, metadata, then dense technical detail.

## Colors

- **Primary** (`#0040ff`): primary CTA, active tab, focus accent, selected state, and the most important workflow action on a screen.
- **Secondary** (`#ff6600`): editorial kicker and restrained highlight only; never compete with the primary CTA color.
- **Tertiary** (`#714b67`): Odoo-context emphasis only; use when the UI is explicitly referring to Odoo-specific context or branding.
- **Neutral** (`#526071`): seed the blue-gray neutral family used for muted copy, outlines, structural lines, and subdued UI surfaces.

Supporting neutrals stay close to white: main surfaces are `#ffffff`, muted surfaces are `#f6f8fc`, emphasized neutral surfaces are `#edf2fa`, and standard borders sit around `#d6dfeb`. Semantic colors should remain crisp but not loud: success `#0f8f62`, danger `#d92d20`, warning `#f08c00`, info `#0059ff`.

## Typography

- **Headline Font**: Space Grotesk
- **Body Font**: Space Grotesk
- **Label Font**: Space Grotesk

Headlines use bold weight with tight tracking and should feel compact, technical, and intentional rather than decorative. Body text stays highly readable at `14–16px`, with dense UI copy allowed at `0.875rem`. Uppercase metadata should be sparse and deliberate.

Use **JetBrains Mono** only for expressions, payload values, URLs, token labels, and other technical metadata. Do not turn mono into the default body voice.

## Elevation

This design is mostly flat. Depth is conveyed through border contrast, surface contrast, and layout framing before shadow. Default surfaces use no visible elevation or only a structural grounding shadow such as `0 1px 0 rgba(15, 23, 42, 0.08)`.

If a surface truly floats—such as a dropdown, popover, or modal overlay—use a restrained shadow like `0 10px 24px rgba(15, 23, 42, 0.08)`. Focus indication should stay crisp and accessible, for example `0 0 0 2px rgba(0, 64, 255, 0.18)`. Avoid plush shadows, glassmorphism, and dreamy layered depth.

## Components

- **Buttons**: Primary buttons use cobalt fill with white text. Secondary buttons stay border-led on white. Ghost actions remain subtle until hover. Corner treatment is tight (`0–4px`), not plush.
- **Inputs**: Inputs, selects, and textareas use neutral white surfaces with strong border behavior. Focus is driven by primary-color border + ring. Expression surfaces may use a cool tinted treatment to signal computed values.
- **Navigation**: Tabs and segmented controls are crisp and utility-first. Prefer active text plus a bottom indicator over pill-heavy fills.
- **Panels and cards**: Main tiles, cards, and panels are sharp-edged, border-led, and lightly editorial. Prefer a border and restrained accent rail over a soft card shadow.
- **Badges, chips, and banners**: Status badges are compact and semantic. Chips can switch to mono for technical payloads. Inline banners use a 3px rail with muted tinted backgrounds.
- **Canvas elements**: Node cards are compact and structural. Sockets are square, framed, and small. Connections are orthogonal and diagrammatic. Use accent only on the most meaningful segment or state change.
- **Layout modules**: Narrative grids can use a 12-column bento pattern. Detail pages can use an asymmetric 2-column layout. Panel stacks should preserve disciplined spacing, not card soup.

## Do's and Don'ts

- Do use one dominant interaction blue and keep semantic colors muted.
- Do let typography, spacing, and alignment create hierarchy before decoration does.
- Do prefer sharp corners on tiles, panels, sockets, and canvas surfaces.
- Do keep data-heavy regions efficient and compact while preserving whitespace around section intros and key moments.
- Do use mono only for technical payloads, never for all body copy.
- Don't use plush SaaS gradients, soft shadows, or oversized rounded cards.
- Don't introduce a second CTA color that competes with the primary blue.
- Don't turn every status into a bright badge wall.
- Don't make the canvas playful or organic; it should read like a technical instrument.
- Don't use decorative motion, bounce, or heavy animation choreography.
- Don't mix unrelated visual languages within the same screen.
