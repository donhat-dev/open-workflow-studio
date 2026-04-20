"""Connector request node runner.

Executes ``connector_request`` nodes. These are managed outbound HTTP calls
that merge config from three sources (in priority order):

    1. Snapshot node config  — canvas-configured values (source of truth)
    2. Endpoint preset       — shared template from workflow.endpoint
    3. Backend config        — admin-side additive overrides from bridge record

Auth is resolved via workflow.auth.profile + SecretBroker.
Execution health is written back to the bridge record after each run.
"""

import json as json_lib
import logging
import time

from ..context_objects import build_eval_context
from ..security.secret_broker import SecretBrokerFactory
from .base import BaseNodeRunner
from .http_runner import HttpNodeRunner

_logger = logging.getLogger(__name__)


class ConnectorRequestNodeRunner(BaseNodeRunner):
    """Managed connector HTTP node runner.

    Resolves connector / endpoint / auth profile from the bridge record, merges
    configs, then delegates HTTP execution to the shared HttpNodeRunner logic.

    Node type: ``connector_request``

    Config keys (in snapshot):
        url: Full URL override (takes priority over endpoint preset)
        method: HTTP method override
        connector_id: backend connector ID (set by panel, not canvas)
        endpoint_id: backend endpoint ID (set by panel)
        auth_profile_id: backend auth profile ID (set by panel)
        operation_code: stable logical operation key
        ... (all standard http node keys are also accepted as overrides)
    """

    node_type = "connector_request"
    DEFAULT_TIMEOUT = 30

    def execute(self, node_config, input_data, context):
        payload = input_data or {}
        build_eval_context(payload, context, include_input_item=True)

        # --- Resolve bridge record ---
        bridge = self._get_bridge(node_config, context)

        # --- Build effective config by merging layers ---
        effective_config = self._build_effective_config(node_config, bridge)

        # --- Build auth headers/params via auth profile ---
        auth_headers, auth_query_params = self._resolve_auth(
            effective_config, bridge
        )

        # --- Inject auth into the config so HttpNodeRunner picks it up ---
        # We merge auth headers into the existing headers list
        if auth_headers:
            existing_headers = effective_config.get("headers") or []
            for k, v in auth_headers.items():
                existing_headers.append({"key": k, "value": v, "enabled": True})
            effective_config["headers"] = existing_headers

        if auth_query_params:
            existing_params = effective_config.get("query_params") or []
            for k, v in auth_query_params.items():
                existing_params.append({"key": k, "value": v, "enabled": True})
            effective_config["query_params"] = existing_params

        # --- Delegate to HttpNodeRunner ---
        http_runner = HttpNodeRunner(self.executor)
        start_time = time.monotonic()
        error_msg = None
        status_code = 0

        try:
            result = http_runner.execute(effective_config, input_data, context)
            elapsed_ms = int((time.monotonic() - start_time) * 1000)

            # Record success to bridge
            if bridge:
                try:
                    bridge.record_execution(
                        status_code=result.get("json", {}).get("status", 200)
                        if isinstance(result.get("json"), dict)
                        else 200,
                        duration_ms=elapsed_ms,
                    )
                except Exception:
                    pass  # Observability must not block execution

            return result

        except ValueError as exc:
            elapsed_ms = int((time.monotonic() - start_time) * 1000)
            error_msg = str(exc)

            # Extract status code from error message if possible
            msg = error_msg
            if msg.startswith("HTTP "):
                try:
                    status_code = int(msg.split(" ")[1].rstrip(":"))
                except (IndexError, ValueError):
                    status_code = 0

            if bridge:
                try:
                    bridge.record_execution(
                        status_code=status_code,
                        duration_ms=elapsed_ms,
                        error=error_msg,
                    )
                except Exception:
                    pass

            raise

    # ------------------------------------------------------------------
    # Bridge resolution
    # ------------------------------------------------------------------
    def _get_bridge(self, node_config, context):
        """Find the workflow.http.request bridge record for this node."""
        try:
            env = self.executor.env
            workflow = (context or {}).get("workflow") or {}
            node_id = (context or {}).get("current_node_id") or node_config.get("id")
            workflow_id = workflow.get("id") if isinstance(workflow, dict) else False

            if not (workflow_id and node_id):
                return None

            bridge = env["workflow.http.request"].search(
                [
                    ("workflow_id", "=", workflow_id),
                    ("node_id", "=", node_id),
                    ("active", "=", True),
                ],
                limit=1,
            )
            return bridge or None
        except Exception as exc:
            _logger.debug("Could not resolve connector bridge: %s", exc)
            return None

    # ------------------------------------------------------------------
    # Config merge
    # ------------------------------------------------------------------
    def _build_effective_config(self, node_config, bridge):
        """Merge endpoint preset + backend config + snapshot config.

        Priority (highest last wins):
            endpoint preset → backend_config_json → snapshot node_config
        """
        effective = {}

        if bridge and bridge.endpoint_id:
            endpoint = bridge.endpoint_id
            # Base from endpoint preset
            effective["method"] = endpoint.method
            url = endpoint.get_effective_url(bridge.connector_id)
            if url:
                effective["url"] = url

            # Timeout from endpoint
            if endpoint.timeout_seconds:
                effective["timeout"] = endpoint.timeout_seconds

            # Headers template
            hdrs = endpoint.get_parsed_template("headers_template")
            if hdrs:
                effective["headers"] = [
                    {"key": k, "value": v, "enabled": True}
                    for k, v in hdrs.items()
                ]

            # Query template
            qry = endpoint.get_parsed_template("query_template")
            if qry:
                effective["query_params"] = [
                    {"key": k, "value": v, "enabled": True}
                    for k, v in qry.items()
                ]

            # Body template
            body_tmpl = endpoint.get_parsed_template("body_template")
            if body_tmpl:
                effective["body_config"] = {
                    "content_type": "json",
                    "body": json_lib.dumps(body_tmpl),
                }

        # Layer 2: backend config additive overrides
        if bridge:
            backend_cfg = bridge.get_backend_config()
            self._deep_merge(effective, backend_cfg)

        # Layer 3: snapshot config (source of truth, highest priority)
        self._deep_merge(
            effective,
            self._build_snapshot_overrides(node_config, bridge),
        )

        for relation_key in ("connector_id", "workspace_id", "endpoint_id", "auth_profile_id"):
            effective.pop(relation_key, None)

        return effective

    def _build_snapshot_overrides(self, node_config, bridge):
        """Drop blank connector-node defaults before applying snapshot overrides.

        Connector nodes intentionally use blank canvas values to mean "fall
        back to the endpoint/backend preset". Older snapshots may still contain
        those defaults, so we filter them here before merging onto the preset.
        """

        overrides = {}
        for key, value in (node_config or {}).items():
            if key in (
                "connector_id",
                "workspace_id",
                "endpoint_id",
                "auth_profile_id",
            ):
                continue

            if not self._should_apply_snapshot_override(key, value, bridge):
                continue

            overrides[key] = value

        return overrides

    def _should_apply_snapshot_override(self, key, value, bridge):
        """Return whether a snapshot field should override preset config."""

        if key in ("url", "method"):
            return bool(str(value or "").strip())

        if key in ("headers", "query_params", "path_params"):
            return self._has_enabled_pairs(value)

        if key == "body_config":
            return not self._is_blank_body_config(value)

        if key == "timeout":
            if value in (None, "", False):
                return False
            try:
                timeout = int(value)
            except (TypeError, ValueError):
                return False

            endpoint_timeout = (
                bridge.endpoint_id.timeout_seconds
                if bridge and bridge.endpoint_id
                else 0
            )
            if endpoint_timeout and timeout == self.DEFAULT_TIMEOUT:
                return False
            return True

        return value is not None

    def _has_enabled_pairs(self, pairs):
        """Return whether a key/value override list contains active entries."""

        if not isinstance(pairs, list):
            return False

        for pair in pairs:
            if not isinstance(pair, dict):
                continue
            if not pair.get("enabled", True):
                continue
            if str(pair.get("key", "")).strip():
                return True

        return False

    def _is_blank_body_config(self, body_config):
        """Return whether a body_config value is only the default no-op shell."""

        if not isinstance(body_config, dict):
            return True

        content_type = str(body_config.get("content_type") or "none").strip().lower()
        if not content_type or content_type == "none":
            return True

        if content_type in ("form_data", "urlencoded"):
            return not self._has_enabled_pairs(body_config.get("form_data"))

        return False

    def _deep_merge(self, base, override):
        """Merge *override* into *base* in-place, lists are replaced not appended."""
        for k, v in override.items():
            if v is None:
                continue
            if isinstance(v, dict) and isinstance(base.get(k), dict):
                self._deep_merge(base[k], v)
            else:
                base[k] = v

    # ------------------------------------------------------------------
    # Auth resolution
    # ------------------------------------------------------------------
    def _resolve_auth(self, effective_config, bridge):
        """Resolve auth profile and build headers/query params."""
        if not bridge:
            return {}, {}

        auth_profile = bridge.get_effective_auth_profile()
        if not auth_profile:
            return {}, {}

        try:
            secret_broker = SecretBrokerFactory.for_execution(self.executor.env)
            headers = auth_profile.build_auth_headers(secret_broker)
            query_params = auth_profile.build_auth_query_params(secret_broker)
            return headers, query_params
        except Exception as exc:
            _logger.error(
                "Auth profile resolution failed for node %s: %s",
                bridge.node_id,
                exc,
            )
            return {}, {}
