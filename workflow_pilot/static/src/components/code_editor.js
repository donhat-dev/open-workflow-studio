/** @odoo-module **/

/**
 * CodeEditor Component
 * 
 * OWL wrapper for Monaco Editor with workflow context autocomplete.
 * Loads Monaco from CDN and provides suggestions for Python workflow context.
 */

import { Component, useRef, onMounted, onWillUnmount, onWillUpdateProps, useState } from "@odoo/owl";

// Monaco CDN base URL
const MONACO_CDN = "https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs";

// Global Monaco loader promise (singleton)
let monacoLoaderPromise = null;
let completionContext = {};

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
            ];

            return { suggestions };
        },
    });
}

function buildDynamicSuggestions(monaco, linePrefix, range) {
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
    static template = "workflow_pilot.CodeEditor";

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
