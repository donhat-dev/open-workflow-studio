# -*- coding: utf-8 -*-

"""
Webhook Trigger Runner

Passthrough runner for the webhook trigger node.
When the executor encounters this node, the webhook controller has
already invoked ``_execute_from_trigger`` with the HTTP payload.
The runner exposes the request data as its output.
"""

import logging

from .base import BaseNodeRunner

_logger = logging.getLogger(__name__)


class WebhookTriggerNodeRunner(BaseNodeRunner):
    """Runner for webhook_trigger nodes.

    Output ``$json`` contains:

    - ``trigger_type``: 'webhook'
    - ``context``: sanitized env.context
    - ``method``: HTTP method used
    - ``headers``: request headers (safe subset)
    - ``query``: URL query parameters
    - ``body``: parsed request body (JSON or form)
    """

    node_type = 'webhook_trigger'

    def execute(self, node_config, input_data, context):
        trigger_payload = input_data.get('_trigger', {})

        output = {
            'trigger_type': 'webhook',
            'context': trigger_payload.get('context', {}),
            'method': trigger_payload.get('method', ''),
            'headers': trigger_payload.get('headers', {}),
            'query': trigger_payload.get('query', {}),
            'body': trigger_payload.get('body', {}),
        }

        return {
            'outputs': [[output]],
            'json': output,
        }
