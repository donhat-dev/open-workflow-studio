# -*- coding: utf-8 -*-

"""
HTTP Node Runner

Executes HTTP requests via requests library.
Supports expression evaluation in URL, headers, and body.
Postman-style auth, query params, body type, and settings.
"""

import json as json_lib
import logging
from urllib.parse import urlencode

import requests

from ..context_objects import build_eval_context
from .base import BaseNodeRunner, ExpressionEvaluator

_logger = logging.getLogger(__name__)


class HttpNodeRunner(BaseNodeRunner):
    """HTTP Request node runner.

    Config:
        url: Request URL (supports expressions)
        method: HTTP method (GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS)
        query_params: Array of {key, value, enabled} for URL query params
        auth: {type, token, username, password, key_name, key_value, key_location, ...}
        body_config: {content_type, body, form_data, raw_type}
        headers: Array of {key, value} pairs
        timeout: Request timeout in seconds (default 30)
        follow_redirects: Boolean (default True)
    """

    node_type = 'http'
    DEFAULT_TIMEOUT = 30
    MAX_RESPONSE_SIZE = 1024 * 1024  # 1MB

    def execute(self, node_config, input_data, context):
        # Build context for expression evaluation
        payload = input_data or {}
        eval_context = build_eval_context(payload, context, include_input_item=True)

        # Evaluate URL
        url = node_config.get('url', '')
        url = ExpressionEvaluator.evaluate(url, eval_context)

        if not url:
            raise ValueError("HTTP node requires a URL")

        # Get method
        method = node_config.get('method', 'GET').upper()

        # Build query params
        query_params = self._build_query_params(node_config, eval_context)

        # Build auth headers / params
        auth_headers, auth_params, auth_obj = self._build_auth(node_config, eval_context)

        # Build request headers
        evaluated_headers = self._build_headers(node_config, eval_context)
        evaluated_headers.update(auth_headers)

        # Merge auth query params
        if auth_params:
            query_params.update(auth_params)

        # Build body
        json_body, data_body, content_type_header = self._build_body(
            node_config, method, eval_context
        )
        if content_type_header:
            evaluated_headers.setdefault('Content-Type', content_type_header)

        # Get timeout
        timeout = node_config.get('timeout', self.DEFAULT_TIMEOUT)
        try:
            timeout = int(timeout) if timeout else self.DEFAULT_TIMEOUT
        except (ValueError, TypeError):
            timeout = self.DEFAULT_TIMEOUT

        # Follow redirects
        follow_redirects = node_config.get('follow_redirects', True)
        if isinstance(follow_redirects, str):
            follow_redirects = follow_redirects.lower() not in ('false', '0', 'no')

        # Make request
        try:
            response = requests.request(
                method=method,
                url=url,
                headers=evaluated_headers or None,
                params=query_params or None,
                json=json_body,
                data=data_body,
                timeout=timeout,
                allow_redirects=follow_redirects,
                auth=auth_obj,
            )

            # Parse response
            try:
                response_data = response.json()
            except ValueError:
                content = response.text
                if len(content) > self.MAX_RESPONSE_SIZE:
                    content = content[:self.MAX_RESPONSE_SIZE]
                    _logger.warning("HTTP response truncated to %d bytes", self.MAX_RESPONSE_SIZE)
                response_data = {'body': content, 'text': True}

            result = {
                'data': response_data,
                'status': response.status_code,
                'headers': dict(response.headers),
            }

            if not response.ok:
                raise ValueError(f"HTTP {response.status_code}: {response.reason}")

            return {
                'outputs': [[result]],
                'json': result,
            }

        except requests.RequestException as e:
            raise ValueError(f"HTTP request failed: {str(e)}")

    # ------------------------------------------------------------------
    # Auth
    # ------------------------------------------------------------------
    def _build_auth(self, node_config, eval_context):
        """Build auth headers, query params, and requests auth object.

        Returns: (headers_dict, query_params_dict, auth_tuple_or_None)
        """
        auth_config = node_config.get('auth', {})
        if not auth_config or not isinstance(auth_config, dict):
            return {}, {}, None

        auth_type = auth_config.get('type', 'none')

        if auth_type == 'bearer':
            token = ExpressionEvaluator.evaluate(auth_config.get('token', ''), eval_context)
            return {'Authorization': f'Bearer {token}'}, {}, None

        if auth_type == 'basic':
            username = ExpressionEvaluator.evaluate(auth_config.get('username', ''), eval_context)
            password = ExpressionEvaluator.evaluate(auth_config.get('password', ''), eval_context)
            return {}, {}, (username, password)

        if auth_type == 'api_key':
            key_name = ExpressionEvaluator.evaluate(auth_config.get('key_name', ''), eval_context)
            key_value = ExpressionEvaluator.evaluate(auth_config.get('key_value', ''), eval_context)
            location = auth_config.get('key_location', 'header')
            if location == 'query':
                return {}, {key_name: key_value} if key_name else {}, None
            return {key_name: key_value} if key_name else {}, {}, None

        if auth_type == 'oauth2':
            access_token = ExpressionEvaluator.evaluate(
                auth_config.get('access_token', ''), eval_context
            )
            if access_token:
                return {'Authorization': f'Bearer {access_token}'}, {}, None
            return {}, {}, None

        if auth_type == 'custom_header':
            header_name = ExpressionEvaluator.evaluate(
                auth_config.get('header_name', ''), eval_context
            )
            header_value = ExpressionEvaluator.evaluate(
                auth_config.get('header_value', ''), eval_context
            )
            if header_name:
                return {header_name: header_value}, {}, None
            return {}, {}, None

        return {}, {}, None

    # ------------------------------------------------------------------
    # Query params
    # ------------------------------------------------------------------
    def _build_query_params(self, node_config, eval_context):
        """Build query params dict from config array."""
        raw_params = node_config.get('query_params', [])
        if not raw_params or not isinstance(raw_params, list):
            return {}

        params = {}
        for p in raw_params:
            if not isinstance(p, dict):
                continue
            if not p.get('enabled', True):
                continue
            key = p.get('key', '')
            if not key:
                continue
            value = ExpressionEvaluator.evaluate(p.get('value', ''), eval_context)
            params[key] = value
        return params

    # ------------------------------------------------------------------
    # Headers
    # ------------------------------------------------------------------
    def _build_headers(self, node_config, eval_context):
        """Build headers dict from config array."""
        headers = node_config.get('headers', [])
        evaluated = {}
        if not headers or not isinstance(headers, list):
            return evaluated

        for h in headers:
            if not isinstance(h, dict):
                continue
            key = h.get('key', '')
            if not key:
                continue
            value = h.get('value', '')
            evaluated[key] = ExpressionEvaluator.evaluate(value, eval_context)
        return evaluated

    # ------------------------------------------------------------------
    # Body
    # ------------------------------------------------------------------
    def _build_body(self, node_config, method, eval_context):
        """Build request body based on body_config.

        Returns: (json_body, data_body, content_type_header)
        """
        if method not in ('POST', 'PUT', 'PATCH'):
            return None, None, None

        body_config = node_config.get('body_config', {})

        # Backward compat: old schema used flat 'body' string
        if not body_config or not isinstance(body_config, dict):
            old_body = node_config.get('body', '')
            if old_body:
                if isinstance(old_body, str):
                    body_str = ExpressionEvaluator.evaluate(old_body, eval_context)
                    # Try to parse as JSON
                    try:
                        return json_lib.loads(body_str), None, 'application/json'
                    except (json_lib.JSONDecodeError, TypeError):
                        return None, body_str, None
                if isinstance(old_body, dict):
                    evaluated = {}
                    for k, v in old_body.items():
                        evaluated[k] = ExpressionEvaluator.evaluate(v, eval_context)
                    return evaluated, None, 'application/json'
            return None, None, None

        content_type = body_config.get('content_type', 'none')

        if content_type == 'none':
            return None, None, None

        if content_type == 'json':
            raw_body = body_config.get('body', '')
            body_str = ExpressionEvaluator.evaluate(raw_body, eval_context)
            if body_str:
                try:
                    return json_lib.loads(body_str), None, 'application/json'
                except (json_lib.JSONDecodeError, TypeError):
                    return None, body_str, 'application/json'
            return None, None, 'application/json'

        if content_type == 'form_data':
            form_data = body_config.get('form_data', [])
            if isinstance(form_data, list):
                data = {}
                for item in form_data:
                    if not isinstance(item, dict):
                        continue
                    key = item.get('key', '')
                    if not key:
                        continue
                    value = ExpressionEvaluator.evaluate(item.get('value', ''), eval_context)
                    data[key] = value
                return None, data, 'multipart/form-data'
            return None, None, None

        if content_type == 'urlencoded':
            form_data = body_config.get('form_data', [])
            if isinstance(form_data, list):
                data = {}
                for item in form_data:
                    if not isinstance(item, dict):
                        continue
                    key = item.get('key', '')
                    if not key:
                        continue
                    value = ExpressionEvaluator.evaluate(item.get('value', ''), eval_context)
                    data[key] = value
                return None, urlencode(data), 'application/x-www-form-urlencoded'
            return None, None, None

        if content_type == 'raw':
            raw_body = body_config.get('body', '')
            body_str = ExpressionEvaluator.evaluate(raw_body, eval_context)
            raw_type = body_config.get('raw_type', 'text/plain')
            return None, body_str, raw_type

        return None, None, None
