import { _t } from "@web/core/l10n/translation";
import { registry } from "@web/core/registry";
import { onMounted, onWillDestroy, useRef } from "@odoo/owl";
import { AceField, aceField } from "@web/views/fields/ace/ace_field";
import { session } from "@web/session";

export const CURSOR_MARKER = "<CURSOR/>";
export const INTERNAL_PROXY_ENDPOINT = "/lf_code_editor_ghost_ext/suggest";
export const SYSTEM_PROMPT = `You are a code edit model for Odoo. Return replacement text only. The cursor position is marked with ${CURSOR_MARKER}. No markdown, no explanation, no repeated prefix/suffix.`;
export function buildUserPrompt(prefix, suffix, title = "", description = "", additionalContext = "") {
    const contextWithCursor = `${prefix}${CURSOR_MARKER}${suffix}`;
    const lines = [];

    if (title) {
        lines.push(`Server action name: ${title}\n`);
    }
    if (description) {
        lines.push(`Server action description: ${description}\n`);
    }
    if (additionalContext) {
        lines.push(`Additional context: ${additionalContext}\n`);
    }

    lines.push("", "Context:", contextWithCursor, "");
    lines.push(`Return only content that should replace ${CURSOR_MARKER}.`);
    lines.push("No markdown, no explanation, no repeated prefix/suffix.");

    return lines.join("\n");
}

export function buildCompletionPrompt(prefix, suffix) {
    const contextWithCursor = `${prefix}${CURSOR_MARKER}${suffix}`;
    return [
        "Return only text that should replace <CURSOR/> in the following code context.",
        "No markdown. No explanation.",
        "",
        contextWithCursor,
    ].join("\n");
}

export class LfCodeGhostField extends AceField {
    static template = "lf_code_editor_ghost_ext.LfCodeGhostField";
    static props = {
        ...AceField.props,
        suggestionEndpoint: { type: String, optional: true },
        suggestionModel: { type: String, optional: true },
        suggestionToken: { type: String, optional: true },
        suggestionDescription: { type: String, optional: true },
        suggestionDebug: { type: Boolean, optional: true },
        suggestionDebounceMs: { type: Number, optional: true },
        suggestionMinIdleMs: { type: Number, optional: true },
        suggestionMaxTokens: { type: Number, optional: true },
        suggestionTemperature: { type: Number, optional: true },
    };
    static defaultProps = {
        ...AceField.defaultProps,
        suggestionEndpoint: INTERNAL_PROXY_ENDPOINT,
        suggestionModel: "",
        suggestionToken: "",
        suggestionDebug: true,
        suggestionDebounceMs: 150,
        suggestionMinIdleMs: 150,
        suggestionMaxTokens: 64,
        suggestionTemperature: 0,
    };

    setup() {
        super.setup();

        this.editorHostRef = useRef("editorHostRef");
        this._debounceTimer = null;
        this._lastTrackingAt = 0;
        this._suggestionController = null;
        this._suggestionEpoch = 0;
        this._isSuggesting = false;

        this._currentGhost = "";
        this._currentGhostPos = null;
        this._settingGhost = false;
        this._isApplyingGhost = false;

        this._aceEditor = null;
        this._keyupHandler = null;
        this._changeCursorHandler = null;
        this._changeSelectionHandler = null;
        this._tabCommandName = `lfCodeGhostAccept_${this.props.name || "code"}`;
        this.recordData = this.env.model.root.data;
        this.title = this.recordData.name || "";
        this.session = session;
        window.editor = this;
        onMounted(() => {
            this._tryAttachAceEditor(0);
        });

        onWillDestroy(() => {
            this._teardown();
        });
    }

    handleChange(editedValue) {
        super.handleChange(editedValue);

        if (this.props.readonly || this._isApplyingGhost) {
            return;
        }

        this._clearGhost();
        this._cancelInFlightSuggest();
        this._scheduleAutoSuggest();
    }

    _isDebugEnabled() {
        return Boolean(this.props.suggestionDebug || window.__LF_CODE_GHOST_DEBUG__ === true);
    }

    _debugLog(step, payload) {
        if (!this._isDebugEnabled()) {
            return;
        }
        console.log(`[lf_code_ghost][${step}]`, payload);
    }

    _teardown() {
        this._cancelAutoSuggest();
        this._cancelInFlightSuggest();
        this._clearGhost();
        this._detachAceBindings();
    }

    _tryAttachAceEditor(attempt) {
        const host = this.editorHostRef.el;
        if (!host) {
            return;
        }
        const editorEl = host.querySelector(".ace-view-editor");
        if (!editorEl || !window.ace) {
            return;
        }

        const editor = editorEl?.env?.editor;
        if (!editor) {
            if (attempt < 20) {
                window.requestAnimationFrame(() => this._tryAttachAceEditor(attempt + 1));
            }
            return;
        }

        if (this._aceEditor === editor) {
            return;
        }

        this._detachAceBindings();
        this._aceEditor = editor;
        this._attachAceBindings();
    }

    _attachAceBindings() {
        if (!this._aceEditor) {
            return;
        }

        this._keyupHandler = (event) => {
            if (this.props.readonly) {
                return;
            }
            if (this._isIgnoredKey(event)) {
                return;
            }
            this._scheduleAutoSuggest();
        };
        this._aceEditor.container?.addEventListener("keyup", this._keyupHandler);

        this._changeCursorHandler = () => {
            this._clearGhost();
        };
        this._aceEditor.selection?.on("changeCursor", this._changeCursorHandler);

        this._changeSelectionHandler = () => {
            if (this._aceEditor.selection?.isEmpty()) {
                return;
            }
            this._clearGhost();
            this._cancelAutoSuggest();
            this._cancelInFlightSuggest();
        };
        this._aceEditor.selection?.on("changeSelection", this._changeSelectionHandler);

        this._aceEditor.commands.addCommand({
            name: this._tabCommandName,
            bindKey: { win: "Tab", mac: "Tab" },
            exec: (ed) => {
                if (this._acceptGhost()) {
                    return;
                }
                ed.execCommand("indent");
            },
            readOnly: false,
        });
    }

    _detachAceBindings() {
        if (!this._aceEditor) {
            return;
        }

        if (this._keyupHandler) {
            this._aceEditor.container?.removeEventListener("keyup", this._keyupHandler);
            this._keyupHandler = null;
        }

        if (this._changeCursorHandler) {
            this._aceEditor.selection?.off("changeCursor", this._changeCursorHandler);
            this._changeCursorHandler = null;
        }

        if (this._changeSelectionHandler) {
            this._aceEditor.selection?.off("changeSelection", this._changeSelectionHandler);
            this._changeSelectionHandler = null;
        }

        if (this._aceEditor.commands?.byName?.[this._tabCommandName]) {
            this._aceEditor.commands.removeCommand(this._tabCommandName);
        }

        this._aceEditor = null;
    }

    _isIgnoredKey(event) {
        if (!event) {
            return true;
        }
        if (event.isComposing) {
            return true;
        }
        if (event.ctrlKey || event.metaKey || event.altKey) {
            return true;
        }
        const ignoredKeys = new Set([
            "Shift",
            "Control",
            "Alt",
            "Meta",
            "ArrowLeft",
            "ArrowRight",
            "ArrowUp",
            "ArrowDown",
            "Escape",
            "CapsLock",
            "Tab",
        ]);
        return ignoredKeys.has(event.key);
    }

    _hasGhost() {
        return Boolean(this._currentGhost);
    }

    _clearGhost() {
        if (this._settingGhost) {
            return;
        }
        if (this._aceEditor && typeof this._aceEditor.removeGhostText === "function") {
            try {
                this._aceEditor.removeGhostText();
            } catch {
                // no-op
            }
        }
        this._currentGhost = "";
        this._currentGhostPos = null;
    }

    _setGhost(text, pos) {
        if (!text || !this._aceEditor || typeof this._aceEditor.setGhostText !== "function") {
            return;
        }
        this._currentGhost = text;
        this._currentGhostPos = { row: pos.row, column: pos.column };
        this._settingGhost = true;
        try {
            this._aceEditor.setGhostText(text, pos);
        } finally {
            this._settingGhost = false;
        }
    }

    _acceptGhost() {
        if (!this._hasGhost() || !this._currentGhostPos || !this._aceEditor) {
            return false;
        }

        const session = this._aceEditor.session;
        if (!session) {
            return false;
        }

        this._isApplyingGhost = true;
        try {
            session.insert(this._currentGhostPos, this._currentGhost);
        } finally {
            this._isApplyingGhost = false;
        }

        this._clearGhost();
        return true;
    }

    _scheduleAutoSuggest() {
        this._lastTrackingAt = Date.now();
        this._cancelAutoSuggest();

        const debounceMs = this.props.suggestionDebounceMs || 150;
        const minIdleMs = this.props.suggestionMinIdleMs || debounceMs;

        this._debounceTimer = setTimeout(() => {
            const idleMs = Date.now() - this._lastTrackingAt;
            if (
                idleMs >= minIdleMs
                && this._aceEditor
                && this._aceEditor.selection?.isEmpty()
                && !this._hasGhost()
                && !this._isSuggesting
            ) {
                this._debugLog("scheduleAutoSuggest:trigger", {
                    idleMs,
                    debounceMs,
                    minIdleMs,
                });
                this._showSuggestionAtCursor();
            }
        }, debounceMs);
    }

    _cancelAutoSuggest() {
        if (this._debounceTimer) {
            clearTimeout(this._debounceTimer);
            this._debounceTimer = null;
        }
    }

    _cancelInFlightSuggest() {
        if (this._suggestionController) {
            this._suggestionController.abort();
            this._suggestionController = null;
        }
        this._isSuggesting = false;
        this._suggestionEpoch += 1;
    }

    _getDocContextAtCursor() {
        if (!this._aceEditor || !this._aceEditor.session) {
            return { prefix: "", suffix: "" };
        }

        const session = this._aceEditor.session;
        const pos = this._aceEditor.getCursorPosition();
        const lastRow = session.getLength() - 1;

        const prefixLines = session.getLines(0, pos.row);
        prefixLines[pos.row] = (prefixLines[pos.row] || "").slice(0, pos.column);
        const prefix = prefixLines.join("\n");

        const suffixLines = session.getLines(pos.row, lastRow);
        suffixLines[0] = (suffixLines[0] || "").slice(pos.column);
        const suffix = suffixLines.join("\n");

        return { prefix, suffix };
    }

    async _showSuggestionAtCursor() {
        if (!this._aceEditor || this.props.readonly) {
            return;
        }
        if (!this._aceEditor.selection?.isEmpty()) {
            return;
        }

        const cursor = this._aceEditor.getCursorPosition();
        this._clearGhost();

        const { prefix, suffix } = this._getDocContextAtCursor();
        if (!prefix && !suffix) {
            return;
        }

        const endpoint = this._getSuggestionEndpoint();

        this._debugLog("showSuggestion:start", {
            endpoint,
            model: this.props.suggestionModel,
            cursor,
            prefixLen: prefix.length,
            suffixLen: suffix.length,
        });

        this._cancelInFlightSuggest();
        const epoch = ++this._suggestionEpoch;
        const controller = new AbortController();
        this._suggestionController = controller;
        this._isSuggesting = true;

        try {
            const fastSuggestion = await this._fetchSuggestion(prefix, suffix, controller.signal, {
                tier: "fast",
            });

            if (epoch !== this._suggestionEpoch) {
                this._debugLog("showSuggestion:staleEpoch", {
                    expectedEpoch: this._suggestionEpoch,
                    responseEpoch: epoch,
                });
                return;
            }

            if (fastSuggestion && this._isCursorUnchanged(cursor)) {
                this._setGhost(fastSuggestion, cursor);
                this._debugLog("showSuggestion:setGhostFast", {
                    suggestionPreview: fastSuggestion.slice(0, 180),
                    suggestionLen: fastSuggestion.length,
                    cursor,
                });
            }

            const richSuggestion = await this._fetchSuggestion(prefix, suffix, controller.signal, {
                tier: "rich",
            });
            if (epoch !== this._suggestionEpoch) {
                return;
            }

            if (
                richSuggestion
                && this._isCursorUnchanged(cursor)
                && this._shouldApplyRichSuggestion(fastSuggestion, richSuggestion)
            ) {
                this._setGhost(richSuggestion, cursor);
                this._debugLog("showSuggestion:setGhostRich", {
                    suggestionPreview: richSuggestion.slice(0, 180),
                    suggestionLen: richSuggestion.length,
                    cursor,
                });
            }
        } finally {
            this._isSuggesting = false;
            if (this._suggestionController === controller) {
                this._suggestionController = null;
            }
        }
    }

    _isCursorUnchanged(cursor) {
        const currentCursor = this._aceEditor.getCursorPosition();
        if (currentCursor.row === cursor.row && currentCursor.column === cursor.column) {
            return true;
        }
        this._debugLog("showSuggestion:cursorMoved", {
            requestCursor: cursor,
            currentCursor,
        });
        return false;
    }

    _scoreSuggestion(text) {
        if (!text) {
            return 0;
        }
        const lengthScore = Math.min(text.length, 240);
        const multilineBonus = text.includes("\n") ? 20 : 0;
        return lengthScore + multilineBonus;
    }

    _shouldApplyRichSuggestion(fastSuggestion, richSuggestion) {
        if (!richSuggestion) {
            return false;
        }
        if (!fastSuggestion) {
            return true;
        }
        if (fastSuggestion === richSuggestion) {
            return false;
        }
        return this._scoreSuggestion(richSuggestion) >= this._scoreSuggestion(fastSuggestion);
    }

    _buildUserPrompt(prefix, suffix) {
        return buildUserPrompt(
            prefix,
            suffix,
            this.recordData.name || "",
            this.recordData.description || "",
        );
    }

    _getSuggestionEndpoint() {
        return this.props.suggestionEndpoint || INTERNAL_PROXY_ENDPOINT;
    }

    _isInternalProxyEndpoint(endpoint = this._getSuggestionEndpoint()) {
        return /^\/lf_code_editor_ghost_ext\/suggest(?:\?|$)/.test(endpoint || "");
    }

    _isChatEndpoint(endpoint = this._getSuggestionEndpoint()) {
        return /\/chat\/completions(?:\?|$)/.test(endpoint || "");
    }

    _buildCompletionPrompt(prefix, suffix) {
        return buildCompletionPrompt(prefix, suffix);
    }

    _sanitizeModelResponse(rawText) {
        let text = rawText || "";
        text = text.replace(/^```[\w-]*\n?/, "").replace(/\n?```$/, "");
        text = text.replace(/^<EDIT>\s*/i, "").replace(/\s*<\/EDIT>$/i, "");
        text = text.replace(/^<INSERT>\s*/i, "").replace(/\s*<\/INSERT>$/i, "");
        if (/^<NO_CHANGE>$/i.test(text.trim())) {
            return "";
        }
        return text;
    }

    _isLowQualitySuggestion(text) {
        const normalized = (text || "").trim().toLowerCase();
        return /please provide the text|need something to go off of|i need something to go off/.test(
            normalized
        );
    }

    _extractReplacementText(rawText, prefix, suffix) {
        let text = this._sanitizeModelResponse(rawText);
        if (!text) {
            this._debugLog("extract:emptyAfterSanitize", {
                rawPreview: (rawText || "").slice(0, 180),
            });
            return "";
        }

        text = text.split(CURSOR_MARKER).join("");
        this._debugLog("extract:afterSanitize", {
            sanitizedPreview: text.slice(0, 180),
            sanitizedLen: text.length,
            prefixLen: prefix.length,
            suffixLen: suffix.length,
        });

        if (prefix && suffix) {
            const start = text.indexOf(prefix);
            if (start !== -1) {
                const from = start + prefix.length;
                const end = text.indexOf(suffix, from);
                if (end !== -1) {
                    const middle = text
                        .slice(from, end)
                        .replace(/^\n+/, "")
                        .replace(/\n+$/, "");
                    this._debugLog("extract:middleByPrefixSuffix", {
                        resultPreview: middle.slice(0, 180),
                        resultLen: middle.length,
                    });
                    return middle;
                }
            }
        }

        let candidate = text;
        if (prefix && candidate.startsWith(prefix)) {
            candidate = candidate.slice(prefix.length);
        }
        if (suffix && candidate.endsWith(suffix)) {
            candidate = candidate.slice(0, candidate.length - suffix.length);
        }

        const normalized = candidate.replace(/^\n+/, "").replace(/\n+$/, "");
        this._debugLog("extract:fallback", {
            resultPreview: normalized.slice(0, 180),
            resultLen: normalized.length,
        });
        return normalized;
    }

    async _fetchSuggestion(prefix, suffix, signal, options = {}) {
        const endpoint = this._getSuggestionEndpoint();
        if (!endpoint) {
            return "";
        }

        if (this._isInternalProxyEndpoint(endpoint)) {
            return this._fetchViaInternalProxy(endpoint, prefix, suffix, signal, options);
        }
        return this._fetchDirectProvider(endpoint, prefix, suffix, signal);
    }

    async _fetchViaInternalProxy(endpoint, prefix, suffix, signal, options = {}) {
        const tier = options.tier || "fast";
        const payload = {
            prefix,
            suffix,
            title: this.recordData.name || "",
            description: this.recordData.description || "",
            tier,
            model: this.props.suggestionModel,
            max_tokens: this.props.suggestionMaxTokens,
            temperature: this.props.suggestionTemperature,
        };
        const rpcBody = {
            jsonrpc: "2.0",
            method: "call",
            params: payload,
            id: Date.now(),
        };

        this._debugLog("fetch:proxyRequest", {
            endpoint,
            tier,
            model: payload.model,
            prefixLen: prefix.length,
            suffixLen: suffix.length,
            maxTokens: payload.max_tokens,
            temperature: payload.temperature,
        });

        try {
            const response = await fetch(endpoint, {
                method: "POST",
                signal,
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(rpcBody),
            });

            if (!response.ok) {
                this._debugLog("fetch:proxyNon200", {
                    status: response.status,
                    statusText: response.statusText,
                });
                return "";
            }

            const data = await response.json();
            const result = data?.result || data || {};
            if (result?.success === false) {
                this._debugLog("fetch:proxyError", {
                    tier,
                    error: result?.error,
                });
                return "";
            }

            const suggestion = result?.suggestion || result?.data?.suggestion || "";
            this._debugLog("fetch:proxyResponse", {
                tier,
                suggestionPreview: suggestion.slice(0, 220),
                suggestionLen: suggestion.length,
                responseTier: result?.tier,
            });
            return suggestion;
        } catch (error) {
            if (error?.name === "AbortError") {
                this._debugLog("fetch:proxyAborted", { tier });
                return "";
            }
            this._debugLog("fetch:proxyException", {
                tier,
                error,
            });
            return "";
        }
    }

    async _fetchDirectProvider(endpoint, prefix, suffix, signal) {
        const headers = {
            "Content-Type": "application/json",
        };
        if (this.props.suggestionToken) {
            headers.Authorization = `Bearer ${this.props.suggestionToken}`;
        }

        const userPrompt = this._buildUserPrompt(prefix, suffix);
        const completionPrompt = this._buildCompletionPrompt(prefix, suffix);
        const payloadMode = this._isChatEndpoint(endpoint) ? "chat" : "completion";
        const payload = payloadMode === "chat"
            ? {
                model: this.props.suggestionModel,
                messages: [
                    {
                        role: "system",
                        content: SYSTEM_PROMPT,
                    },
                    { role: "user", content: userPrompt },
                ],
                max_tokens: this.props.suggestionMaxTokens,
                temperature: this.props.suggestionTemperature,
            }
            : {
                model: this.props.suggestionModel,
                prompt: completionPrompt,
                suffix,
                max_tokens: this.props.suggestionMaxTokens,
                temperature: this.props.suggestionTemperature,
                stop: ["```", "\n\n\n", "<NO_CHANGE>"],
            };

        this._debugLog("fetch:request", {
            endpoint,
            payloadMode,
            hasAuth: Boolean(headers.Authorization),
            model: payload.model,
            promptPreview: userPrompt.slice(0, 220),
            promptLen: userPrompt.length,
            completionPromptPreview: completionPrompt.slice(0, 220),
            completionPromptLen: completionPrompt.length,
            prefixLen: prefix.length,
            suffixLen: suffix.length,
            maxTokens: payload.max_tokens,
            temperature: payload.temperature,
        });

        try {
            const response = await fetch(endpoint, {
                method: "POST",
                signal,
                headers,
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                this._debugLog("fetch:non200", {
                    status: response.status,
                    statusText: response.statusText,
                });
                return "";
            }

            const data = await response.json();
            const rawSuggestion =
                data?.choices?.[0]?.message?.content
                || data?.choices?.[0]?.text
                || "";

            this._debugLog("fetch:response", {
                status: response.status,
                rawSuggestionPreview: rawSuggestion.slice(0, 220),
                rawSuggestionLen: rawSuggestion.length,
                data,
            });

            const extracted = this._extractReplacementText(rawSuggestion, prefix, suffix);
            if (this._isLowQualitySuggestion(extracted)) {
                this._debugLog("fetch:lowQualityFiltered", {
                    extractedPreview: extracted.slice(0, 220),
                });
                return "";
            }

            return extracted;
        } catch (error) {
            if (error?.name === "AbortError") {
                this._debugLog("fetch:aborted", {});
                return "";
            }
            this._debugLog("fetch:error", { error });
            return "";
        }
    }
}

export const lfCodeGhostField = {
    ...aceField,
    component: LfCodeGhostField,
    displayName: _t("Code (Ghost)"),
    supportedOptions: [
        ...(aceField.supportedOptions || []),
        {
            label: _t("Suggestion Endpoint"),
            name: "suggestion_endpoint",
            type: "string",
        },
        {
            label: _t("Suggestion Model"),
            name: "suggestion_model",
            type: "string",
        },
        {
            label: _t("Suggestion Token"),
            name: "suggestion_token",
            type: "string",
        },
        {
            label: _t("Suggestion Debounce (ms)"),
            name: "suggestion_debounce_ms",
            type: "number",
        },
        {
            label: _t("Suggestion Debug"),
            name: "suggestion_debug",
            type: "boolean",
        },
    ],
    extractProps: ({ options }) => ({
        ...(aceField.extractProps ? aceField.extractProps({ options }) : {}),
        suggestionEndpoint: options.suggestion_endpoint,
        suggestionModel: options.suggestion_model,
        suggestionToken: options.suggestion_token,
        suggestionDebounceMs: options.suggestion_debounce_ms,
        suggestionDebug: options.suggestion_debug,
    }),
};

registry.category("fields").add("lf_code_ghost", lfCodeGhostField);
