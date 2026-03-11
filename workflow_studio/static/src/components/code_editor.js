/** @odoo-module **/

/**
 * CodeEditor Component
 * 
 * OWL wrapper for Monaco Editor with workflow context autocomplete.
 * Loads Monaco from CDN and provides suggestions for Python workflow context.
 */

import { Component, useRef, onMounted, onWillUnmount, onWillUpdateProps, useState } from "@odoo/owl";
import { useOdooModels, ODOO_MODELS_FALLBACK } from "@workflow_studio/utils/use_odoo_models";

// Monaco CDN base URL
const MONACO_CDN = "https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs";

// Global Monaco loader promise (singleton)
let monacoLoaderPromise = null;
let completionContext = {};

// Updated by each CodeEditor instance via the useOdooModels hook
let _getOdooModels = () => ODOO_MODELS_FALLBACK;

// =============================================================================
// STATIC COMPLETION DATA
// =============================================================================
const COMMON_ODOO_MODELS = ODOO_MODELS_FALLBACK;

// Class-level ORM methods (available on env['model.name'])
const ENV_MODEL_METHODS = [
    {
        label: "search",
        detail: "search(domain, limit=None, order=None, offset=0) → recordset",
        documentation: "Find records matching domain. Returns a recordset.\nExample: env['res.partner'].search([('is_company', '=', True)], limit=10)",
    },
    {
        label: "browse",
        detail: "browse(ids) → recordset",
        documentation: "Get records by integer ID or list of IDs.\nExample: env['res.partner'].browse([1, 2, 3])",
    },
    {
        label: "create",
        detail: "create(vals) → record",
        documentation: "Create a new record. vals is a dict of field values.\nExample: env['res.partner'].create({'name': 'Acme', 'email': 'hi@example.com'})",
    },
    {
        label: "search_count",
        detail: "search_count(domain) → int",
        documentation: "Count records matching domain without fetching them.\nExample: env['sale.order'].search_count([('state', '=', 'draft')])",
    },
    {
        label: "search_read",
        detail: "search_read(domain, fields, limit=None, order=None, offset=0) → list[dict]",
        documentation: "Search and read fields in one call. Returns list of dicts.\nExample: env['res.partner'].search_read([('is_company','=',True)], ['name','email'])",
    },
    {
        label: "with_context",
        detail: "with_context(**kwargs) → model",
        documentation: "Return an instance with extra context keys.\nExample: env['sale.order'].with_context(lang='vi_VN').search([])",
    },
    {
        label: "name_search",
        detail: "name_search(name='', domain=None, operator='ilike', limit=100) → list",
        documentation: "Autocomplete-style search; returns [(id, display_name), ...].\nExample: env['res.partner'].name_search('Acme')",
    },
    {
        label: "fields_get",
        detail: "fields_get(attributes=None) → dict",
        documentation: "Return field metadata. attributes can be a list like ['string','type'].",
    },
];

// Instance-level methods callable on a recordset
const RECORD_METHODS = [
    {
        label: "write",
        detail: "write(vals) → bool",
        documentation: "Update fields on all records in the set.\nExample: partners.write({'active': False})",
        isProperty: false,
    },
    {
        label: "unlink",
        detail: "unlink() → bool",
        documentation: "Delete all records in the set. Raises if any record is protected.",
        isProperty: false,
    },
    {
        label: "read",
        detail: "read(fields=None) → list[dict]",
        documentation: "Read specified fields. Returns list of dicts with 'id' included.\nExample: partners.read(['name', 'email'])",
        isProperty: false,
    },
    {
        label: "copy",
        detail: "copy(default=None) → record",
        documentation: "Duplicate this record. default overrides field values on the copy.",
        isProperty: false,
    },
    {
        label: "name_get",
        detail: "name_get() → list[(id, name)]",
        documentation: "Return the display names for all records as [(id, display_name), ...].",
        isProperty: false,
    },
    {
        label: "mapped",
        detail: "mapped(field) → list | recordset",
        documentation: "Extract field value across all records.\nExample: orders.mapped('partner_id.name')  →  ['Alice', 'Bob']",
        isProperty: false,
    },
    {
        label: "filtered",
        detail: "filtered(func) → recordset",
        documentation: "Return subset where func(record) is truthy.\nExample: orders.filtered(lambda o: o.amount_total > 1000)",
        isProperty: false,
    },
    {
        label: "sorted",
        detail: "sorted(key=None, reverse=False) → recordset",
        documentation: "Return sorted copy of the recordset.\nExample: orders.sorted('date_order', reverse=True)",
        isProperty: false,
    },
    {
        label: "ensure_one",
        detail: "ensure_one() → record",
        documentation: "Assert the set contains exactly one record; raises ValueError otherwise.",
        isProperty: false,
    },
    {
        label: "exists",
        detail: "exists() → recordset",
        documentation: "Return only records that still exist in the database (removes deleted ones).",
        isProperty: false,
    },
    {
        label: "ids",
        detail: "ids: list[int]",
        documentation: "List of integer IDs in this recordset.",
        isProperty: true,
    },
    {
        label: "id",
        detail: "id: int",
        documentation: "Integer ID of this record. Only valid on single-record sets.",
        isProperty: true,
    },
];

/**
 * Load Monaco Editor from CDN
 * @returns {Promise<monaco>}
 */
async function loadMonaco() {
    if (window.monaco) {
        return window.monaco;
    }

    if (monacoLoaderPromise) {
        return monacoLoaderPromise;
    }

    monacoLoaderPromise = new Promise((resolve, reject) => {
        // Load AMD loader
        const loaderScript = document.createElement("script");
        loaderScript.src = `${MONACO_CDN}/loader.js`;
        loaderScript.async = true;

        loaderScript.onload = () => {
            window.require.config({ paths: { vs: MONACO_CDN } });
            window.require(["vs/editor/editor.main"], () => {
                registerWorkflowCompletions();
                resolve(window.monaco);
            });
        };

        loaderScript.onerror = () => {
            reject(new Error("Failed to load Monaco Editor"));
        };

        document.head.appendChild(loaderScript);
    });

    return monacoLoaderPromise;
}

/**
 * Register custom completion provider for workflow context variables
 */
function registerWorkflowCompletions() {
    const monaco = window.monaco;
    if (!monaco) return;

    monaco.languages.registerCompletionItemProvider("python", {
        triggerCharacters: ["_", ".", "[", "\"", "'"],

        provideCompletionItems: (model, position) => {
            const word = model.getWordUntilPosition(position);
            const range = {
                startLineNumber: position.lineNumber,
                endLineNumber: position.lineNumber,
                startColumn: word.startColumn,
                endColumn: word.endColumn,
            };

            const linePrefix = model
                .getLineContent(position.lineNumber)
                .slice(0, position.column - 1);

            const dynamicSuggestions = buildDynamicSuggestions(monaco, linePrefix, range);
            if (dynamicSuggestions.length) {
                return { suggestions: dynamicSuggestions };
            }

            // Context variable suggestions
            const suggestions = [
                {
                    label: "_json",
                    kind: monaco.languages.CompletionItemKind.Variable,
                    insertText: "_json",
                    detail: "Input data from previous node",
                    documentation: "Object containing output data from the previous node.",
                    range,
                },
                {
                    label: "_input",
                    kind: monaco.languages.CompletionItemKind.Variable,
                    insertText: "_input",
                    detail: "Alias for _json",
                    documentation: "Same as _json - input data from previous node.",
                    range,
                },
                {
                    label: "_vars",
                    kind: monaco.languages.CompletionItemKind.Variable,
                    insertText: "_vars",
                    detail: "Workflow variables",
                    documentation: "Mutable workflow variables. Example: _vars['myVar']",
                    range,
                },
                {
                    label: "_node",
                    kind: monaco.languages.CompletionItemKind.Variable,
                    insertText: "_node",
                    detail: "Other node outputs",
                    documentation: "Access output from specific nodes. Example: _node['HTTP Request']",
                    range,
                },
                {
                    label: "_now",
                    kind: monaco.languages.CompletionItemKind.Variable,
                    insertText: "_now",
                    detail: "Current datetime",
                    documentation: "Datetime at execution time.",
                    range,
                },
                {
                    label: "_today",
                    kind: monaco.languages.CompletionItemKind.Variable,
                    insertText: "_today",
                    detail: "Current date",
                    documentation: "Date at execution time.",
                    range,
                },
                {
                    label: "_execution",
                    kind: monaco.languages.CompletionItemKind.Variable,
                    insertText: "_execution",
                    detail: "Execution metadata",
                    documentation: "Run metadata when available.",
                    range,
                },
                {
                    label: "_workflow",
                    kind: monaco.languages.CompletionItemKind.Variable,
                    insertText: "_workflow",
                    detail: "Workflow metadata",
                    documentation: "Workflow id/name/active when available.",
                    range,
                },
                {
                    label: "result",
                    kind: monaco.languages.CompletionItemKind.Variable,
                    insertText: "result",
                    detail: "Output variable",
                    documentation: "Set result to control node output.",
                    range,
                },
                {
                    label: "env",
                    kind: monaco.languages.CompletionItemKind.Variable,
                    insertText: "env",
                    detail: "Odoo environment",
                    documentation: "Access Odoo models via env['model.name'].\nExample: env['res.partner'].search([('is_company', '=', True)])\nBlocked: sudo(), ir.* models.",
                    range,
                },
            ];

            return { suggestions };
        },
    });
}

function buildDynamicSuggestions(monaco, linePrefix, range) {
    // Branch A: env['<prefix>  →  Odoo model name completions
    const envModelMatch = linePrefix.match(/\benv\s*\[\s*['"]([a-zA-Z0-9._]*)$/);
    if (envModelMatch) {
        const prefix = envModelMatch[1];
        // Build range that covers the full dotted prefix (getWordUntilPosition stops at '.')
        const modelRange = {
            startLineNumber: range.startLineNumber,
            endLineNumber: range.endLineNumber,
            startColumn: linePrefix.length - prefix.length + 1,
            endColumn: range.endColumn,
        };
        const models = _getOdooModels();
        return models
            .filter((m) => m.model.startsWith(prefix))
            .map((m) => ({
                label: m.model,
                kind: monaco.languages.CompletionItemKind.Module,
                insertText: m.model,
                detail: m.description,
                documentation: `Odoo model: ${m.model}`,
                range: modelRange,
            }));
    }

    // Branch B: env['model.name'].  →  model-level + record-level ORM method completions
    const envMethodMatch = linePrefix.match(/\benv\s*\[\s*['"][a-zA-Z0-9._]+['"]\s*\]\s*\.([a-zA-Z_]*)$/);
    if (envMethodMatch) {
        const prefix = envMethodMatch[1];
        return [...ENV_MODEL_METHODS, ...RECORD_METHODS]
            .filter((m) => m.label.startsWith(prefix))
            .map((m) => ({
                label: m.label,
                kind: m.isProperty
                    ? monaco.languages.CompletionItemKind.Property
                    : monaco.languages.CompletionItemKind.Method,
                insertText: m.isProperty ? m.label : `${m.label}(`,
                detail: m.detail,
                documentation: m.documentation,
                range,
            }));
    }

    // Branch C: env['...'].method(...).  →  chained record method completions
    const envChainMatch = linePrefix.match(/\benv\s*\[.*?\](?:\.[a-zA-Z_]+\([^)]*\))+\s*\.([a-zA-Z_]*)$/);
    if (envChainMatch) {
        const prefix = envChainMatch[1];
        return RECORD_METHODS
            .filter((m) => m.label.startsWith(prefix))
            .map((m) => ({
                label: m.label,
                kind: m.isProperty
                    ? monaco.languages.CompletionItemKind.Property
                    : monaco.languages.CompletionItemKind.Method,
                insertText: m.isProperty ? m.label : `${m.label}(`,
                detail: m.detail,
                documentation: m.documentation,
                range,
            }));
    }

    // Existing: _json/_vars/_node bracket/dot key completions from dynamic context
    const bracketMatch = linePrefix.match(/_(json|vars|node|execution|workflow)\s*\[\s*['"]?([a-zA-Z0-9_]*)$/);
    const dotMatch = linePrefix.match(/_(json|vars|node|execution|workflow)\.([a-zA-Z0-9_]*)$/);
    if (!bracketMatch && !dotMatch) {
        return [];
    }
    const match = bracketMatch || dotMatch;
    const scope = `_${match[1]}`;
    const prefix = match[2] || "";
    const data = completionContext && completionContext[scope];
    if (!data || typeof data !== "object") {
        return [];
    }
    return Object.keys(data)
        .filter((key) => key.startsWith(prefix))
        .map((key) => ({
            label: key,
            kind: monaco.languages.CompletionItemKind.Field,
            insertText: key,
            detail: `${scope} key`,
            range,
        }));
}

export class CodeEditor extends Component {
    static template = "workflow_studio.CodeEditor";

    static props = {
        value: { type: String, optional: true },
        onChange: { type: Function, optional: true },
        height: { type: Number, optional: true },
        language: { type: String, optional: true },
        placeholder: { type: String, optional: true },
        readonly: { type: Boolean, optional: true },
        completionContext: { type: Object, optional: true },
    };

    static defaultProps = {
        value: "",
        height: 200,
        language: "javascript",
        placeholder: "",
        readonly: false,
    };

    setup() {
        this.containerRef = useRef("container");
        this.editor = null;
        this.state = useState({ loading: true, error: null });

        // Wire the shared model-list hook; fire-and-forget fetch on first mount
        const { getOdooModels } = useOdooModels();
        _getOdooModels = getOdooModels;

        onMounted(async () => {
            try {
                completionContext = this.props.completionContext || {};
                await this.initEditor();
            } catch (error) {
                console.error("[CodeEditor] Init error:", error);
                this.state.error = error.message;
            }
        });

        onWillUpdateProps((nextProps) => {
            completionContext = nextProps.completionContext || {};
            if (this.editor) {
                const nextValue = nextProps.value || nextProps.placeholder || "";
                if (nextValue !== this.editor.getValue()) {
                    this.editor.setValue(nextValue);
                }
                this.editor.updateOptions({ readOnly: !!nextProps.readonly });
                const model = this.editor.getModel();
                if (model && window.monaco && nextProps.language !== this.props.language) {
                    window.monaco.editor.setModelLanguage(model, nextProps.language);
                }
                requestAnimationFrame(() => {
                    if (this.editor) {
                        this.editor.layout();
                    }
                });
            }
        });

        onWillUnmount(() => {
            this.destroyEditor();
        });
    }

    async initEditor() {
        const monaco = await loadMonaco();
        this.state.loading = false;

        if (!this.containerRef.el) return;

        // Create editor instance
        this.editor = monaco.editor.create(this.containerRef.el, {
            value: this.props.value || this.props.placeholder || "",
            language: this.props.language,
            theme: "vs-dark",
            minimap: { enabled: false },
            lineNumbers: "on",
            scrollBeyondLastLine: false,
            automaticLayout: true,
            fontSize: 13,
            fontFamily: "'Fira Code', 'Consolas', 'Monaco', monospace",
            tabSize: 2,
            wordWrap: "on",
            readOnly: this.props.readonly,
            padding: { top: 8, bottom: 8 },
            scrollbar: {
                vertical: "auto",
                horizontal: "auto",
            },
        });

        // Listen for content changes
        this.editor.onDidChangeModelContent(() => {
            const value = this.editor.getValue();
            this.props.onChange?.(value);
        });
    }

    destroyEditor() {
        if (this.editor) {
            this.editor.dispose();
            this.editor = null;
        }
    }

    /**
     * Get current editor value
     */
    getValue() {
        return this.editor?.getValue() || "";
    }

    /**
     * Set editor value programmatically
     */
    setValue(value) {
        if (this.editor && value !== this.editor.getValue()) {
            this.editor.setValue(value);
        }
    }

    get containerStyle() {
        return `height: ${this.props.height}px; border: 1px solid var(--border-color, #374151); border-radius: 6px; overflow: hidden;`;
    }
}

CodeEditor.template = owl.xml`
    <div class="code-editor-wrapper">
        <t t-if="state.loading">
            <div class="code-editor-loading" style="display: flex; align-items: center; justify-content: center; height: 100px; color: #888;">
                <span>Loading editor...</span>
            </div>
        </t>
        <t t-elif="state.error">
            <div class="code-editor-error" style="padding: 10px; color: #ef4444; background: #1f2937; border-radius: 6px;">
                <strong>Error:</strong> <t t-esc="state.error"/>
            </div>
        </t>
        <div t-ref="container" t-att-style="containerStyle" class="code-editor-container"/>
    </div>
`;
