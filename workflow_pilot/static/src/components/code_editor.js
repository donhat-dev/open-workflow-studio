/** @odoo-module **/

/**
 * CodeEditor Component
 * 
 * OWL wrapper for Monaco Editor with workflow context autocomplete.
 * Loads Monaco from CDN and provides suggestions for $json, $vars, etc.
 */

import { Component, useRef, onMounted, onWillUnmount, useState } from "@odoo/owl";

// Monaco CDN base URL
const MONACO_CDN = "https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs";

// Global Monaco loader promise (singleton)
let monacoLoaderPromise = null;

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

    monaco.languages.registerCompletionItemProvider("javascript", {
        triggerCharacters: ["$", "."],

        provideCompletionItems: (model, position) => {
            const word = model.getWordUntilPosition(position);
            const range = {
                startLineNumber: position.lineNumber,
                endLineNumber: position.lineNumber,
                startColumn: word.startColumn,
                endColumn: word.endColumn,
            };

            // Context variable suggestions
            const suggestions = [
                {
                    label: "$",
                    kind: monaco.languages.CompletionItemKind.Function,
                    insertText: "$('${1:node_name}')",
                    insertTextRules: 2, // monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
                    detail: "Access other node data",
                    documentation: "Helper function to access data from other nodes by name or ID. Example: $('HTTP Request').json",
                    range,
                },
                {
                    label: "$json",
                    kind: monaco.languages.CompletionItemKind.Variable,
                    insertText: "$json",
                    detail: "Input data from previous node",
                    documentation: "Object containing the output data from the previous node in the workflow.",
                    range,
                },
                {
                    label: "$input",
                    kind: monaco.languages.CompletionItemKind.Variable,
                    insertText: "$input",
                    detail: "Alias for $json",
                    documentation: "Same as $json - input data from previous node.",
                    range,
                },
                {
                    label: "$vars",
                    kind: monaco.languages.CompletionItemKind.Variable,
                    insertText: "$vars",
                    detail: "Workflow variables",
                    documentation: "Access workflow-level variables set by Variable nodes. Example: $vars.myVar",
                    range,
                },
                {
                    label: "$node",
                    kind: monaco.languages.CompletionItemKind.Variable,
                    insertText: "$node",
                    detail: "Access other node outputs",
                    documentation: "Access output from specific nodes. Example: $node['HTTP Request'].json",
                    range,
                },
            ];

            return { suggestions };
        },
    });
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
                await this.initEditor();
            } catch (error) {
                console.error("[CodeEditor] Init error:", error);
                this.state.error = error.message;
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
