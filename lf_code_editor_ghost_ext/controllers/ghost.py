# -*- coding: utf-8 -*-

import json
import logging
import re
import time
import urllib.error
import urllib.request

from odoo import _, http
from odoo.http import request

from ..utils.api_utils import api_wrapper, create_response
from ..utils.error_codes import ErrorCode

_logger = logging.getLogger(__name__)

CURSOR_MARKER = "<CURSOR/>"
SYSTEM_PROMPT = (
    "You are a code edit model for Odoo server actions. "
    "Return only replacement text for <CURSOR/>. If needed, you can use the tools to get more information about Odoo models/fields/methods. "
    "If it's not a valid replacement text, return an empty string. No markdown, no explanation, no repeated prefix/suffix."
)
VALID_MODEL_NAME = re.compile(r"^[a-z0-9_.]+$")


class CodeEditorGhostController(http.Controller):
    @http.route(
        "/lf_code_editor_ghost_ext/suggest",
        type="json",
        auth="user",
        methods=["POST"],
        csrf=False,
    )
    @api_wrapper
    def suggest(self, prefix="", suffix="", title="", description="", tier="fast", model=False, max_tokens=64, temperature=0.0):
        if not isinstance(prefix, str) or not isinstance(suffix, str):
            return create_response(
                success=False,
                error_code=ErrorCode.INVALID_REQUEST,
                error_message=_("Invalid prefix/suffix payload"),
            )

        if not prefix and not suffix:
            return create_response(success=True, data={"suggestion": "", "tier": tier})

        config = self._get_provider_config()
        provider_model = model or config["model"]
        use_tools = tier == "rich"
        provider_mode = self._resolve_provider_mode(
            endpoint=config["endpoint"],
            configured_mode=config.get("provider_mode"),
        )

        user_prompt = self._build_user_prompt(prefix, suffix, title=title, description=description)
        trace = []
        t_start = time.monotonic()

        try:
            if use_tools:
                raw_text = self._request_responses_with_tools(
                    config=config,
                    model=provider_model,
                    user_prompt=user_prompt,
                    max_tokens=max_tokens,
                    temperature=temperature,
                    provider_mode=provider_mode,
                    trace=trace,
                )
            else:
                raw_text, _response_data, _provider_mode = self._request_responses(
                    config=config,
                    model=provider_model,
                    user_prompt=user_prompt,
                    max_tokens=max_tokens,
                    temperature=temperature,
                    tools=False,
                    provider_mode=provider_mode,
                )
        except Exception as exc:
            _logger.error("Ghost provider request failed: %s", exc, exc_info=True)
            return create_response(
                success=False,
                error_code=ErrorCode.PROVIDER_ERROR,
                error_message=str(exc),
            )

        execution_time = round(time.monotonic() - t_start, 3)
        suggestion = self._extract_replacement_text(raw_text, prefix, suffix)
        if self._is_low_quality_suggestion(suggestion):
            suggestion = ""

        if trace:
            _logger.debug(
                "Ghost tool-use trace [%s] (%.2fs):\n%s",
                provider_model,
                execution_time,
                json.dumps(trace, ensure_ascii=False, indent=2),
            )

        return create_response(
            success=True,
            data={
                "suggestion": suggestion,
                "tier": tier,
                "provider_model": provider_model,
                "execution_time": execution_time,
                "debug_trace": trace if trace else None,
            },
        )

    def _get_provider_config(self):
        icp = request.env["ir.config_parameter"].sudo()
        endpoint = icp.get_param(
            "lf_code_editor_ghost_ext.provider_endpoint",
            default="http://localhost:8317/v1/responses",
        )
        model = icp.get_param(
            "lf_code_editor_ghost_ext.provider_model",
            default="gemini-2.5-flash-lite",
        )
        api_key = icp.get_param("lf_code_editor_ghost_ext.provider_api_key", default="")
        provider_mode = (icp.get_param("lf_code_editor_ghost_ext.provider_mode", default="auto") or "auto").strip().lower()
        fast_timeout = float(icp.get_param("lf_code_editor_ghost_ext.fast_timeout_sec", default="4"))
        rich_timeout = float(icp.get_param("lf_code_editor_ghost_ext.rich_timeout_sec", default="8"))

        if not endpoint:
            raise ValueError("Missing provider endpoint configuration")

        return {
            "endpoint": endpoint,
            "model": model,
            "api_key": api_key,
            "provider_mode": provider_mode,
            "fast_timeout": fast_timeout,
            "rich_timeout": rich_timeout,
        }

    def _resolve_provider_mode(self, endpoint, configured_mode="auto"):
        mode = (configured_mode or "auto").strip().lower()
        if mode in {"responses", "chat"}:
            return mode

        endpoint_norm = (endpoint or "").lower()
        if "/chat/completions" in endpoint_norm:
            return "chat"
        if endpoint_norm.endswith("/responses") or "/v1/responses" in endpoint_norm:
            return "responses"
        return "chat"

    def _build_user_prompt(self, prefix, suffix, title="", description=""):
        context = f"{prefix}{CURSOR_MARKER}{suffix}"
        lines = []
        if title:
            lines.append(f"Server action name: {title}")
        if description:
            lines.append(f"Server action description: {description}")
        lines.extend([
            "",
            "Context:",
            context,
            "",
            "Return only content that should replace <CURSOR/>.",
            "No markdown, no explanation, no repeated prefix/suffix.",
        ])
        return "\n".join(lines)

    def _request_responses(
        self,
        config,
        model,
        user_prompt,
        max_tokens=64,
        temperature=0.0,
        tools=False,
        previous_response_id=False,
        input_items=False,
        provider_mode="responses",
    ):
        active_mode = provider_mode
        timeout = config["rich_timeout"] if tools else config["fast_timeout"]

        if active_mode == "chat":
            payload = {
                "model": model,
                "messages": input_items
                or [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt},
                ],
                "max_tokens": int(max_tokens),
                "temperature": float(temperature),
            }
            if tools:
                payload["tools"] = self._tool_definitions_chat()
                payload["tool_choice"] = "auto"
        else:
            payload = {
                "model": model,
                "input": input_items
                or [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt},
                ],
                "max_output_tokens": int(max_tokens),
                "temperature": float(temperature),
                "store": False,
            }
            if tools:
                payload["tools"] = self._tool_definitions()
                payload["tool_choice"] = "auto"
            if previous_response_id:
                payload["previous_response_id"] = previous_response_id

        try:
            response_data = self._provider_post(
                endpoint=config["endpoint"],
                api_key=config["api_key"],
                payload=payload,
                timeout=timeout,
            )
        except ValueError as exc:
            if (
                active_mode == "responses"
                and not previous_response_id
                and not input_items
                and "Expected input to contain field: 'messages'" in str(exc)
            ):
                # Only fall back on the *initial* request (no continuation state).
                # Continuation calls carry responses-API items that cannot be forwarded
                # to chat format — they must be handled at a higher level.
                _logger.warning("Provider expects chat payload; fallback from responses mode to chat mode (fresh start)")
                return self._request_responses(
                    config=config,
                    model=model,
                    user_prompt=user_prompt,
                    max_tokens=max_tokens,
                    temperature=temperature,
                    tools=tools,
                    provider_mode="chat",
                )
            raise

        return self._extract_output_text(response_data, provider_mode=active_mode), response_data, active_mode

    def _request_responses_with_tools(self, config, model, user_prompt, max_tokens=64, temperature=0.0, provider_mode="responses", trace=None):
        if trace is None:
            trace = []

        if provider_mode == "chat":
            return self._request_chat_with_tools(
                config=config,
                model=model,
                user_prompt=user_prompt,
                max_tokens=max_tokens,
                temperature=temperature,
                trace=trace,
            )

        max_tool_rounds = 3
        # Build a running input list per the Responses API docs pattern:
        # each round we append the model's function_call outputs + our tool results,
        # then send the full accumulated list — no previous_response_id required.
        accumulated_input = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ]

        trace.append({"step": "initial_request", "mode": provider_mode, "tools": True})
        text, response_data, active_mode = self._request_responses(
            config=config,
            model=model,
            user_prompt=user_prompt,
            max_tokens=max_tokens,
            temperature=temperature,
            tools=True,
            provider_mode=provider_mode,
        )
        trace.append({"step": "initial_response", "active_mode": active_mode, "text": text or None})

        if active_mode == "chat":
            trace.append({"step": "mode_switch", "reason": "initial_response_triggered_chat_fallback"})
            return self._request_chat_with_tools(
                config=config,
                model=model,
                user_prompt=user_prompt,
                max_tokens=max_tokens,
                temperature=temperature,
                trace=trace,
            )

        if text:
            trace.append({"step": "done", "source": "initial_response"})
            return text

        for round_idx in range(max_tool_rounds):
            function_calls = self._extract_function_calls(response_data, provider_mode=active_mode)
            if not function_calls:
                trace.append({"step": "done", "source": "no_more_tool_calls", "round": round_idx})
                break

            # Append the model's function_call items to the running input (docs pattern)
            previous_output_items = response_data.get("output") or []
            accumulated_input.extend(previous_output_items)

            # Execute tools and collect results
            tool_outputs = []
            for call in function_calls:
                t0 = time.monotonic()
                tool_result = self._execute_tool(call["name"], call["arguments"])
                elapsed = round(time.monotonic() - t0, 3)
                trace.append({
                    "step": "tool_call",
                    "round": round_idx,
                    "name": call["name"],
                    "arguments": call["arguments"],
                    "result": tool_result,
                    "elapsed_s": elapsed,
                })
                tool_outputs.append(
                    {
                        "type": "function_call_output",
                        "call_id": call["call_id"],
                        "output": json.dumps(tool_result, ensure_ascii=False),
                    }
                )
            accumulated_input.extend(tool_outputs)

            # Send the full accumulated history — no previous_response_id needed
            try:
                trace.append({"step": "continuation_request", "round": round_idx, "mode": active_mode, "input_len": len(accumulated_input)})
                text, response_data, active_mode = self._request_responses(
                    config=config,
                    model=model,
                    user_prompt=user_prompt,
                    max_tokens=max_tokens,
                    temperature=temperature,
                    tools=True,
                    input_items=accumulated_input,
                    provider_mode=active_mode,
                )
                trace.append({"step": "continuation_response", "round": round_idx, "active_mode": active_mode, "text": text or None})
            except ValueError as exc:
                trace.append({"step": "continuation_error", "round": round_idx, "error": str(exc)})
                if "Expected input to contain field: 'messages'" in str(exc):
                    _logger.warning(
                        "Responses tool loop continuation failed (%s); converting accumulated state to chat format",
                        exc,
                    )
                    chat_messages = self._convert_responses_input_to_chat_messages(accumulated_input)
                    trace.append({"step": "mode_switch", "reason": "continuation_400_fallback_to_chat", "chat_messages_count": len(chat_messages)})
                    return self._request_chat_with_tools(
                        config=config,
                        model=model,
                        user_prompt=user_prompt,
                        max_tokens=max_tokens,
                        temperature=temperature,
                        initial_messages=chat_messages,
                        trace=trace,
                    )
                raise

            if active_mode == "chat":
                trace.append({"step": "mode_switch", "reason": "continuation_response_triggered_chat_fallback", "round": round_idx})
                return self._request_chat_with_tools(
                    config=config,
                    model=model,
                    user_prompt=user_prompt,
                    max_tokens=max_tokens,
                    temperature=temperature,
                    trace=trace,
                )

            if text:
                trace.append({"step": "done", "source": "continuation_response", "round": round_idx})
                return text

        trace.append({"step": "done", "source": "exhausted"})
        return ""

    def _request_chat_with_tools(self, config, model, user_prompt, max_tokens=64, temperature=0.0, initial_messages=None, trace=None):
        if trace is None:
            trace = []
        max_tool_rounds = 3
        messages = initial_messages if initial_messages is not None else [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ]
        trace.append({"step": "chat_tool_loop_start", "messages_count": len(messages)})

        for round_idx in range(max_tool_rounds + 1):
            trace.append({"step": "chat_request", "round": round_idx, "messages_count": len(messages)})
            text, response_data, _active_mode = self._request_responses(
                config=config,
                model=model,
                user_prompt=user_prompt,
                max_tokens=max_tokens,
                temperature=temperature,
                tools=True,
                input_items=messages,
                provider_mode="chat",
            )
            trace.append({"step": "chat_response", "round": round_idx, "text": text or None})

            function_calls = self._extract_function_calls(response_data, provider_mode="chat")
            if not function_calls:
                trace.append({"step": "done", "source": "chat_no_more_tool_calls", "round": round_idx})
                return text

            assistant_message = self._extract_chat_assistant_message(response_data)
            if assistant_message:
                messages.append(assistant_message)

            for call in function_calls:
                t0 = time.monotonic()
                tool_result = self._execute_tool(call["name"], call["arguments"])
                elapsed = round(time.monotonic() - t0, 3)
                trace.append({
                    "step": "tool_call",
                    "round": round_idx,
                    "name": call["name"],
                    "arguments": call["arguments"],
                    "result": tool_result,
                    "elapsed_s": elapsed,
                })
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": call["call_id"],
                        "content": json.dumps(tool_result, ensure_ascii=False),
                    }
                )

        trace.append({"step": "done", "source": "chat_exhausted"})
        return ""

    def _convert_responses_input_to_chat_messages(self, accumulated_input):
        """Convert a running responses-API input list to chat-completions messages.

        The accumulated_input may contain:
          - {role: system/user, content: ...}  → kept as-is
          - {type: function_call, call_id, name, arguments}  → assistant with tool_calls
          - {type: function_call_output, call_id, output}  → role:tool message
        """
        messages = []
        # Collect consecutive function_call items to group into one assistant message
        pending_tool_calls = []

        def _flush_tool_calls():
            if not pending_tool_calls:
                return
            messages.append(
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": tc["call_id"],
                            "type": "function",
                            "function": {
                                "name": tc["name"],
                                "arguments": (
                                    json.dumps(tc["arguments"])
                                    if isinstance(tc["arguments"], dict)
                                    else (tc["arguments"] or "{}")
                                ),
                            },
                        }
                        for tc in pending_tool_calls
                    ],
                }
            )
            pending_tool_calls.clear()

        for item in (accumulated_input or []):
            item_type = item.get("type")
            item_role = item.get("role")

            if item_role in ("system", "user", "assistant"):
                _flush_tool_calls()
                messages.append(item)
            elif item_type == "function_call":
                pending_tool_calls.append(
                    {
                        "call_id": item.get("call_id") or item.get("id"),
                        "name": item.get("name"),
                        "arguments": item.get("arguments") or "{}",
                    }
                )
            elif item_type == "function_call_output":
                _flush_tool_calls()
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": item.get("call_id"),
                        "content": item.get("output", ""),
                    }
                )

        _flush_tool_calls()
        return messages

    def _provider_post(self, endpoint, api_key, payload, timeout):
        headers = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        encoded_payload = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(endpoint, data=encoded_payload, headers=headers, method="POST")

        try:
            with urllib.request.urlopen(req, timeout=timeout) as response:
                status_code = response.getcode()
                body = response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            err_body = exc.read().decode("utf-8", errors="ignore") if exc.fp else ""
            raise ValueError(f"Provider error {exc.code}: {err_body[:500]}") from exc
        except urllib.error.URLError as exc:
            raise ValueError(f"Provider connection error: {exc.reason}") from exc

        if status_code < 200 or status_code >= 300:
            raise ValueError(f"Provider error {status_code}: {body[:500]}")

        return json.loads(body or "{}")

    def _extract_output_text(self, payload, provider_mode="responses"):
        if not isinstance(payload, dict):
            return ""

        if provider_mode == "chat":
            choices = payload.get("choices") or []
            if choices:
                message = choices[0].get("message") or {}
                content = message.get("content")
                if isinstance(content, str):
                    return content
                if isinstance(content, list):
                    parts = [
                        item.get("text")
                        for item in content
                        if isinstance(item, dict) and item.get("text")
                    ]
                    if parts:
                        return "\n".join(parts)
            return ""

        if payload.get("output_text"):
            return payload.get("output_text") or ""

        output = payload.get("output") or []
        chunks = []
        for item in output:
            if item.get("type") != "message":
                continue
            for content_item in item.get("content", []):
                text = content_item.get("text")
                if text:
                    chunks.append(text)
        if chunks:
            return "\n".join(chunks)

        choices = payload.get("choices") or []
        if choices:
            first = choices[0]
            return first.get("text") or first.get("message", {}).get("content", "")

        return ""

    def _extract_function_calls(self, payload, provider_mode="responses"):
        if provider_mode == "chat":
            choices = payload.get("choices") or []
            if not choices:
                return []
            message = choices[0].get("message") or {}
            tool_calls = message.get("tool_calls") or []
            calls = []
            for item in tool_calls:
                function_info = item.get("function") or {}
                arguments = function_info.get("arguments") or "{}"
                if isinstance(arguments, dict):
                    parsed_arguments = arguments
                else:
                    try:
                        parsed_arguments = json.loads(arguments)
                    except Exception:
                        parsed_arguments = {}
                call_id = item.get("id")
                if not call_id:
                    continue
                calls.append(
                    {
                        "call_id": call_id,
                        "name": function_info.get("name"),
                        "arguments": parsed_arguments,
                    }
                )
            return calls

        output = payload.get("output") or []
        calls = []
        for item in output:
            if item.get("type") != "function_call":
                continue
            arguments = item.get("arguments") or "{}"
            if isinstance(arguments, dict):
                parsed_arguments = arguments
            else:
                try:
                    parsed_arguments = json.loads(arguments)
                except Exception:
                    parsed_arguments = {}
            call_id = item.get("call_id") or item.get("id")
            if not call_id:
                continue
            calls.append(
                {
                    "call_id": call_id,
                    "name": item.get("name"),
                    "arguments": parsed_arguments,
                }
            )
        return calls

    def _extract_chat_assistant_message(self, payload):
        choices = payload.get("choices") or []
        if not choices:
            return None

        message = choices[0].get("message")
        if not isinstance(message, dict):
            return None

        assistant_message = {
            "role": "assistant",
            "content": message.get("content") or "",
        }
        if message.get("tool_calls"):
            assistant_message["tool_calls"] = message.get("tool_calls")

        return assistant_message

    def _execute_tool(self, tool_name, arguments):
        arguments = arguments or {}
        if tool_name == "list_model_fields":
            return self._tool_list_model_fields(
                model_name=arguments.get("model_name"),
                field_type=arguments.get("field_type"),
                limit=arguments.get("limit", 80),
            )
        if tool_name == "list_model_methods":
            return self._tool_list_model_methods(
                model_name=arguments.get("model_name"),
                keyword=arguments.get("keyword"),
                limit=arguments.get("limit", 60),
            )
        if tool_name == "get_model_overview":
            return self._tool_get_model_overview(model_name=arguments.get("model_name"))

        return {"error": f"Unsupported tool: {tool_name}"}

    def _validate_model_name(self, model_name):
        if not model_name or not isinstance(model_name, str):
            return False
        return bool(VALID_MODEL_NAME.match(model_name))

    def _tool_list_model_fields(self, model_name, field_type=False, limit=80):
        if not self._validate_model_name(model_name):
            return {"error": "Invalid model_name"}

        limit = max(1, min(int(limit or 80), 200))
        domain = [("model", "=", model_name)]
        if field_type:
            domain.append(("ttype", "=", field_type))

        fields = request.env["ir.model.fields"].sudo().search(domain, limit=limit, order="name asc")
        return {
            "model_name": model_name,
            "fields": [
                {
                    "name": field.name,
                    "label": field.field_description,
                    "type": field.ttype,
                    "relation": field.relation,
                    "required": bool(field.required),
                    "readonly": bool(field.readonly),
                    "store": bool(field.store),
                    "compute": field.compute,
                }
                for field in fields
            ],
        }

    def _tool_list_model_methods(self, model_name, keyword=False, limit=60):
        if not self._validate_model_name(model_name):
            return {"error": "Invalid model_name"}

        limit = max(1, min(int(limit or 60), 200))
        keyword_norm = (keyword or "").strip().lower()

        try:
            model_obj = request.env[model_name]
        except KeyError:
            return {"error": f"Model not found: {model_name}"}

        methods = []
        for name in dir(model_obj):
            if name.startswith("_"):
                continue
            if keyword_norm and keyword_norm not in name.lower():
                continue
            attr = getattr(model_obj, name, None)
            if callable(attr):
                methods.append(name)

        methods = sorted(set(methods))[:limit]
        return {
            "model_name": model_name,
            "methods": methods,
        }

    def _tool_get_model_overview(self, model_name):
        if not self._validate_model_name(model_name):
            return {"error": "Invalid model_name"}

        model_record = request.env["ir.model"].sudo().search([("model", "=", model_name)], limit=1)
        if not model_record:
            return {"error": f"Model not found: {model_name}"}

        field_count = request.env["ir.model.fields"].sudo().search_count([("model", "=", model_name)])
        return {
            "model_name": model_name,
            "display_name": model_record.name,
            "field_count": field_count,
            "is_transient": bool(model_record.transient),
        }

    def _tool_definitions(self):
        return [
            {
                "type": "function",
                "name": "list_model_fields",
                "description": "List read-only metadata fields for an Odoo model",
                "parameters": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "model_name": {"type": "string"},
                        "field_type": {"type": "string"},
                        "limit": {"type": "integer", "minimum": 1, "maximum": 200},
                    },
                    "required": ["model_name"],
                },
            },
            {
                "type": "function",
                "name": "list_model_methods",
                "description": "List callable public method names for an Odoo model",
                "parameters": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "model_name": {"type": "string"},
                        "keyword": {"type": "string"},
                        "limit": {"type": "integer", "minimum": 1, "maximum": 200},
                    },
                    "required": ["model_name"],
                },
            },
            {
                "type": "function",
                "name": "get_model_overview",
                "description": "Get high-level overview information for an Odoo model",
                "parameters": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "model_name": {"type": "string"},
                    },
                    "required": ["model_name"],
                },
            },
        ]

    def _tool_definitions_chat(self):
        tools = []
        for item in self._tool_definitions():
            if item.get("type") != "function":
                continue
            tools.append(
                {
                    "type": "function",
                    "function": {
                        "name": item.get("name"),
                        "description": item.get("description"),
                        "parameters": item.get("parameters"),
                    },
                }
            )
        return tools

    def _sanitize_model_response(self, text):
        sanitized = (text or "").replace(CURSOR_MARKER, "")
        sanitized = re.sub(r"^```[\w-]*\n?", "", sanitized)
        sanitized = re.sub(r"\n?```$", "", sanitized)
        sanitized = re.sub(r"^<EDIT>\s*", "", sanitized, flags=re.IGNORECASE)
        sanitized = re.sub(r"\s*</EDIT>$", "", sanitized, flags=re.IGNORECASE)
        return sanitized.strip("\n")

    def _extract_replacement_text(self, raw_text, prefix, suffix):
        text = self._sanitize_model_response(raw_text)
        if not text:
            return ""

        start = text.find(prefix) if prefix else -1
        if prefix and suffix and start != -1:
            middle_start = start + len(prefix)
            middle_end = text.find(suffix, middle_start)
            if middle_end != -1:
                return text[middle_start:middle_end].strip("\n")

        candidate = text
        if prefix and candidate.startswith(prefix):
            candidate = candidate[len(prefix):]
        if suffix and candidate.endswith(suffix):
            candidate = candidate[: -len(suffix)]

        return candidate.strip("\n")

    def _is_low_quality_suggestion(self, suggestion):
        normalized = (suggestion or "").strip().lower()
        return bool(
            re.search(
                r"please provide the text|need something to go off of|i need something to go off",
                normalized,
            )
        )
