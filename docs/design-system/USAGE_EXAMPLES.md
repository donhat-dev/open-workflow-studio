# Design System — Usage Examples

Tham chiếu nhanh cho 5 shared primitives trong `shared_primitives.scss`.
Copy-paste trực tiếp vào OWL QWeb templates.

> **Scope:** Tất cả primitives yêu cầu ancestor `.wf-container`.

---

## 1. Button (`.wf-btn`)

### Variants

```html
<div class="wf-container">
    <!-- Primary (filled action color) -->
    <button class="wf-btn wf-btn-primary">
        <i class="fa fa-play"></i>
        <span>Execute</span>
    </button>

    <!-- Secondary (bordered, neutral) -->
    <button class="wf-btn wf-btn-secondary">
        <i class="fa fa-save"></i>
        <span>Save</span>
    </button>

    <!-- Ghost (transparent, muted text) -->
    <button class="wf-btn wf-btn-ghost">Cancel</button>

    <!-- Danger (filled red) -->
    <button class="wf-btn wf-btn-danger">
        <i class="fa fa-trash"></i>
        <span>Delete Workflow</span>
    </button>

    <!-- Danger Ghost (transparent, red text) -->
    <button class="wf-btn wf-btn-danger-ghost">Remove Node</button>
</div>
```

### Sizes

```html
<div class="wf-container">
    <!-- Small (32px height) -->
    <button class="wf-btn wf-btn-primary wf-btn-sm">Small</button>

    <!-- Medium / default (40px height) — no size class needed -->
    <button class="wf-btn wf-btn-primary">Medium</button>

    <!-- Large (52px height) -->
    <button class="wf-btn wf-btn-primary wf-btn-lg">Large</button>
</div>
```

### Icon-Only

```html
<div class="wf-container">
    <!-- Icon button (28×28, square) -->
    <button class="wf-btn wf-btn-ghost wf-btn-icon" title="Settings">
        <i class="fa fa-cog"></i>
    </button>

    <!-- Icon button — small (24×24) -->
    <button class="wf-btn wf-btn-ghost wf-btn-icon wf-btn-sm" title="Close">
        <i class="fa fa-times"></i>
    </button>

    <!-- Icon button — large (36×36) -->
    <button class="wf-btn wf-btn-secondary wf-btn-icon wf-btn-lg" title="Add">
        <i class="fa fa-plus"></i>
    </button>
</div>
```

### States

```html
<div class="wf-container">
    <!-- Disabled (native attribute) -->
    <button class="wf-btn wf-btn-primary" disabled="disabled">Disabled</button>

    <!-- Disabled (class — for non-button elements) -->
    <a class="wf-btn wf-btn-primary disabled">Disabled</a>

    <!-- Loading (text hidden, spinner shown) -->
    <button class="wf-btn wf-btn-primary loading">Executing...</button>
</div>
```

### Typical usage: Canvas Node Toolbar

```html
<div class="wf-container">
    <div class="wf-canvas-toolbar">
        <button class="wf-btn wf-btn-ghost wf-btn-icon wf-btn-sm" title="Execute">
            <i class="fa fa-play"></i>
        </button>
        <button class="wf-btn wf-btn-ghost wf-btn-icon wf-btn-sm" title="Configure">
            <i class="fa fa-cog"></i>
        </button>
        <button class="wf-btn wf-btn-danger-ghost wf-btn-icon wf-btn-sm" title="Delete">
            <i class="fa fa-trash"></i>
        </button>
    </div>
</div>
```

### Typical usage: Panel Footer

```html
<div class="wf-container">
    <div class="wf-panel-footer d-flex gap-2 justify-content-end">
        <button class="wf-btn wf-btn-ghost">Cancel</button>
        <button class="wf-btn wf-btn-primary">
            <i class="fa fa-save"></i>
            <span>Save Changes</span>
        </button>
    </div>
</div>
```

---

## 2. Badge (`.wf-badge`)

### Variants

```html
<div class="wf-container">
    <!-- Neutral (draft, idle) -->
    <span class="wf-badge wf-badge-neutral">
        <span class="wf-badge-dot"></span> Draft
    </span>

    <!-- Success (completed, passed) -->
    <span class="wf-badge wf-badge-success">
        <span class="wf-badge-dot"></span> Completed
    </span>

    <!-- Danger (failed, error) -->
    <span class="wf-badge wf-badge-danger">
        <span class="wf-badge-dot"></span> Failed
    </span>

    <!-- Warning (pending, waiting) -->
    <span class="wf-badge wf-badge-warning">
        <span class="wf-badge-dot"></span> Pending
    </span>

    <!-- Info (queued, processing) -->
    <span class="wf-badge wf-badge-info">
        <span class="wf-badge-dot"></span> Queued
    </span>

    <!-- Active (running, in progress) -->
    <span class="wf-badge wf-badge-active">
        <span class="wf-badge-dot"></span> Running
    </span>
</div>
```

### Sizes

```html
<div class="wf-container">
    <!-- Small (20px height) — for dense lists -->
    <span class="wf-badge wf-badge-success wf-badge-sm">
        <span class="wf-badge-dot"></span> OK
    </span>

    <!-- Default (24px height) -->
    <span class="wf-badge wf-badge-danger">
        <span class="wf-badge-dot"></span> Error
    </span>
</div>
```

### Without Dot

```html
<div class="wf-container">
    <!-- Text-only badge (omit wf-badge-dot) -->
    <span class="wf-badge wf-badge-info">v2.1</span>
</div>
```

### Typical usage: Execution Log List

```html
<div class="wf-container">
    <div class="wf-exec-row d-flex align-items-center gap-2">
        <span class="wf-badge wf-badge-success wf-badge-sm">
            <span class="wf-badge-dot"></span> Completed
        </span>
        <span class="wf-text-muted">Run #42 — 1.2s</span>
    </div>
</div>
```

### Typical usage: Node Header

```html
<div class="wf-container">
    <div class="wf-node-header d-flex align-items-center gap-2">
        <i class="fa fa-code"></i>
        <span class="wf-node-title">HTTP Request</span>
        <span class="wf-badge wf-badge-active wf-badge-sm">
            <span class="wf-badge-dot"></span> Running
        </span>
    </div>
</div>
```

---

## 3. Form Control (`.wf-control`)

### Text Input

```html
<div class="wf-container">
    <input type="text" class="wf-control" placeholder="Enter node name..." />
</div>
```

### Select

```html
<div class="wf-container">
    <select class="wf-control wf-control-select">
        <option value="">Select method...</option>
        <option value="GET">GET</option>
        <option value="POST">POST</option>
        <option value="PUT">PUT</option>
    </select>
</div>
```

### Textarea

```html
<div class="wf-container">
    <textarea class="wf-control wf-control-textarea" placeholder="Request body (JSON)..."></textarea>
</div>
```

### Expression Input

```html
<div class="wf-container">
    <input type="text"
           class="wf-control wf-control-expression"
           value="{{ $json.customer.email }}" />
</div>
```

### Sizes

```html
<div class="wf-container">
    <input type="text" class="wf-control wf-control-sm" placeholder="Small" />
    <input type="text" class="wf-control" placeholder="Default" />
    <input type="text" class="wf-control wf-control-lg" placeholder="Large" />
</div>
```

### States

```html
<div class="wf-container">
    <!-- Error -->
    <input type="text" class="wf-control error" value="invalid url" />

    <!-- Readonly -->
    <input type="text" class="wf-control readonly" value="auto-generated-id" readonly="readonly" />

    <!-- Disabled -->
    <input type="text" class="wf-control" disabled="disabled" placeholder="Disabled" />
</div>
```

### Typical usage: Field Row in Config Panel

```html
<div class="wf-container">
    <div class="wf-field-row">
        <label class="wf-field-row__label">URL</label>
        <input type="text" class="wf-control" placeholder="https://api.example.com" />
    </div>

    <div class="wf-field-row">
        <label class="wf-field-row__label">Method</label>
        <select class="wf-control wf-control-select">
            <option value="GET">GET</option>
            <option value="POST">POST</option>
        </select>
    </div>

    <div class="wf-field-row">
        <label class="wf-field-row__label">Expression</label>
        <input type="text"
               class="wf-control wf-control-expression wf-control-sm"
               value="{{ $json.headers['Content-Type'] }}" />
    </div>
</div>
```

### Typical usage: Expression with Error

```html
<div class="wf-container">
    <div class="wf-field-row">
        <label class="wf-field-row__label">Value</label>
        <input type="text"
               class="wf-control wf-control-expression error"
               value="{{ $json.undefined_field }}" />
        <span class="wf-field-row__error">Field "undefined_field" not found in input data</span>
    </div>
</div>
```

---

## 4. Banner (`.wf-banner`)

### Variants

```html
<div class="wf-container">
    <!-- Info -->
    <div class="wf-banner wf-banner-info">
        <i class="wf-banner-icon fa fa-info-circle"></i>
        <div class="wf-banner-body">
            <div class="wf-banner-title">Tip</div>
            <p class="wf-banner-text">Use expressions to reference data from previous nodes.</p>
        </div>
    </div>

    <!-- Success -->
    <div class="wf-banner wf-banner-success">
        <i class="wf-banner-icon fa fa-check-circle"></i>
        <div class="wf-banner-body">
            <p class="wf-banner-text">Workflow executed successfully — 5 items processed.</p>
        </div>
    </div>

    <!-- Warning -->
    <div class="wf-banner wf-banner-warning">
        <i class="wf-banner-icon fa fa-exclamation-triangle"></i>
        <div class="wf-banner-body">
            <div class="wf-banner-title">Rate limit approaching</div>
            <p class="wf-banner-text">85% of API quota consumed. Consider adding a delay node.</p>
        </div>
    </div>

    <!-- Danger -->
    <div class="wf-banner wf-banner-danger">
        <i class="wf-banner-icon fa fa-times-circle"></i>
        <div class="wf-banner-body">
            <div class="wf-banner-title">Execution failed</div>
            <p class="wf-banner-text">ConnectionError: Unable to reach https://api.example.com</p>
        </div>
    </div>

    <!-- Neutral -->
    <div class="wf-banner wf-banner-neutral">
        <i class="wf-banner-icon fa fa-file-text-o"></i>
        <div class="wf-banner-body">
            <p class="wf-banner-text">No execution data available. Run the workflow to see results.</p>
        </div>
    </div>
</div>
```

### Minimal (Text Only, No Title)

```html
<div class="wf-container">
    <div class="wf-banner wf-banner-info">
        <i class="wf-banner-icon fa fa-info-circle"></i>
        <div class="wf-banner-body">
            <p class="wf-banner-text">This node has no input connections.</p>
        </div>
    </div>
</div>
```

### With Dismiss Button

```html
<div class="wf-container">
    <div class="wf-banner wf-banner-warning">
        <i class="wf-banner-icon fa fa-exclamation-triangle"></i>
        <div class="wf-banner-body">
            <p class="wf-banner-text">Unsaved changes will be lost.</p>
        </div>
        <button class="wf-banner-dismiss wf-btn wf-btn-ghost wf-btn-icon wf-btn-sm" title="Dismiss">
            <i class="fa fa-times"></i>
        </button>
    </div>
</div>
```

### Typical usage: Config Panel Empty State

```html
<div class="wf-container">
    <div class="wf-config-panel__body">
        <div class="wf-banner wf-banner-neutral">
            <i class="wf-banner-icon fa fa-cube"></i>
            <div class="wf-banner-body">
                <div class="wf-banner-title">No node selected</div>
                <p class="wf-banner-text">Click a node on the canvas to configure it.</p>
            </div>
        </div>
    </div>
</div>
```

---

## 5. Toggle (`.wf-toggle`)

### Basic (2 Options)

```html
<div class="wf-container">
    <div class="wf-toggle">
        <button class="wf-toggle-item active">Input</button>
        <button class="wf-toggle-item">Output</button>
    </div>
</div>
```

### Multiple Options

```html
<div class="wf-container">
    <div class="wf-toggle">
        <button class="wf-toggle-item active">Table</button>
        <button class="wf-toggle-item">JSON</button>
        <button class="wf-toggle-item">Schema</button>
    </div>
</div>
```

### With Icons

```html
<div class="wf-container">
    <div class="wf-toggle">
        <button class="wf-toggle-item active">
            <i class="fa fa-table"></i> Table
        </button>
        <button class="wf-toggle-item">
            <i class="fa fa-code"></i> JSON
        </button>
    </div>
</div>
```

### Icon-Only

```html
<div class="wf-container">
    <div class="wf-toggle">
        <button class="wf-toggle-item active" title="List view">
            <i class="fa fa-list"></i>
        </button>
        <button class="wf-toggle-item" title="Grid view">
            <i class="fa fa-th"></i>
        </button>
    </div>
</div>
```

### Small Size

```html
<div class="wf-container">
    <div class="wf-toggle wf-toggle-sm">
        <button class="wf-toggle-item active">Fixed</button>
        <button class="wf-toggle-item">Expression</button>
    </div>
</div>
```

### With Disabled Item

```html
<div class="wf-container">
    <div class="wf-toggle">
        <button class="wf-toggle-item active">7d</button>
        <button class="wf-toggle-item">14d</button>
        <button class="wf-toggle-item" disabled="disabled">30d</button>
    </div>
</div>
```

### Typical usage: Execution Log Panel Header

```html
<div class="wf-container">
    <div class="wf-exec-panel__header d-flex align-items-center justify-content-between">
        <span class="wf-eyebrow">Execution Data</span>
        <div class="wf-toggle wf-toggle-sm">
            <button class="wf-toggle-item active">Input</button>
            <button class="wf-toggle-item">Output</button>
        </div>
    </div>
</div>
```

### Typical usage: Dashboard Period Selector

```html
<div class="wf-container">
    <div class="wf-dashboard-controls d-flex align-items-center gap-3">
        <span class="wf-text-muted">Period:</span>
        <div class="wf-toggle">
            <button class="wf-toggle-item active">7d</button>
            <button class="wf-toggle-item">14d</button>
            <button class="wf-toggle-item">30d</button>
        </div>
    </div>
</div>
```

### Typical usage: Fixed / Expression Mode Switcher

```html
<div class="wf-container">
    <div class="wf-field-row">
        <div class="d-flex align-items-center justify-content-between mb-1">
            <label class="wf-field-row__label">Value</label>
            <div class="wf-toggle wf-toggle-sm">
                <button class="wf-toggle-item active">Fixed</button>
                <button class="wf-toggle-item">
                    <i class="fa fa-code"></i> Expr
                </button>
            </div>
        </div>
        <!-- Fixed mode: normal input -->
        <input type="text" class="wf-control" placeholder="Enter value..." />
        <!-- Expression mode (swap when toggled): -->
        <!-- <input type="text" class="wf-control wf-control-expression" value="{{ $json.field }}" /> -->
    </div>
</div>
```

---

## Quick Reference: Class Composition

| Component | Base | Variant | Size | State |
|-----------|------|---------|------|-------|
| Button | `wf-btn` | `wf-btn-primary` `-secondary` `-ghost` `-danger` `-danger-ghost` `-icon` | `wf-btn-sm` `-lg` | `disabled` `loading` |
| Badge | `wf-badge` | `wf-badge-neutral` `-success` `-danger` `-warning` `-info` `-active` | `wf-badge-sm` | `disabled` |
| Control | `wf-control` | `wf-control-select` `-textarea` `-expression` | `wf-control-sm` `-lg` | `disabled` `error` `readonly` |
| Banner | `wf-banner` | `wf-banner-info` `-success` `-warning` `-danger` `-neutral` | — | — |
| Toggle | `wf-toggle` | — | `wf-toggle-sm` | — |
| Toggle Item | `wf-toggle-item` | — | — | `active` `disabled` |

### Child Elements

| Parent | Children |
|--------|----------|
| `wf-badge` | `wf-badge-dot` |
| `wf-banner` | `wf-banner-icon` `wf-banner-body` `wf-banner-title` `wf-banner-text` `wf-banner-dismiss` |
| `wf-toggle` | `wf-toggle-item` |

### Naming Convention

```
wf-{component}              → base class
wf-{component}-{variant}    → visual variant (single dash)
wf-{component}-{size}       → size modifier
wf-{component}-{child}      → child element
.disabled / .loading / ...  → state (short, no prefix)
.wf-container               → required ancestor scope
```
