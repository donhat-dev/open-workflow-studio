# -*- coding: utf-8 -*-

"""
HTTP Node Runner

Executes HTTP requests via requests library.
Supports expression evaluation in URL, headers, and body.
"""

import logging
import requests

from ..context_objects import build_eval_context
from .base import BaseNodeRunner, ExpressionEvaluator

_logger = logging.getLogger(__name__)


class HttpNodeRunner(BaseNodeRunner):
    """HTTP Request node runner.
    
    Config:
        url: Request URL (supports expressions)
        method: HTTP method (GET, POST, PUT, DELETE, PATCH)
        headers: Dict of headers
        body: Request body (for POST/PUT/PATCH)
        timeout: Request timeout in seconds (default 30)
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
        
        # Evaluate headers
        headers = node_config.get('headers', [])
        headers_dict = {}
        for h in headers:
            key = h.get('key')
            value = h.get('value', '')
            headers_dict[key] = value
        evaluated_headers = {}
        for key, value in headers_dict.items():
            if not key:
                continue
            evaluated_headers[key] = ExpressionEvaluator.evaluate(value, eval_context)
        
        # Evaluate body for methods that support it
        body = None
        if method in ('POST', 'PUT', 'PATCH'):
            body_config = node_config.get('body', {})
            if isinstance(body_config, str):
                body = ExpressionEvaluator.evaluate(body_config, eval_context)
            elif isinstance(body_config, dict):
                # Evaluate each field
                body = {}
                for key, value in body_config.items():
                    body[key] = ExpressionEvaluator.evaluate(value, eval_context)
        
        # Get timeout
        timeout = node_config.get('timeout', self.DEFAULT_TIMEOUT)
        
        # Make request
        try:
            response = requests.request(
                method=method,
                url=url,
                headers=evaluated_headers,
                json=body if isinstance(body, dict) else None,
                data=body if isinstance(body, str) else None,
                timeout=timeout,
            )
            
            # Parse response
            try:
                response_data = response.json()
            except ValueError:
                # Non-JSON response
                content = response.text
                if len(content) > self.MAX_RESPONSE_SIZE:
                    content = content[:self.MAX_RESPONSE_SIZE]
                    _logger.warning(f"HTTP response truncated to {self.MAX_RESPONSE_SIZE} bytes")
                response_data = {'body': content, 'text': True}
            
            result = {
                'data': response_data,
                'status': response.status_code,
                'headers': dict(response.headers),
            }
            
            # Check for error status codes
            if not response.ok:
                raise ValueError(f"HTTP {response.status_code}: {response.reason}")
            
            return {
                'outputs': [[result]],
                'json': result,
            }
            
        except requests.RequestException as e:
            raise ValueError(f"HTTP request failed: {str(e)}")
