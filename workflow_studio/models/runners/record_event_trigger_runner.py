"""
Record Event Trigger Runner

Passthrough runner for the record_event trigger node.
When the executor encounters this node, base.automation has already
invoked ``_execute_from_trigger`` with the record details.
The runner exposes the event data as its output.
"""

import logging

from .base import BaseNodeRunner

_logger = logging.getLogger(__name__)


class RecordEventTriggerNodeRunner(BaseNodeRunner):
    """Runner for record_event_trigger nodes.

    Output ``$json`` contains:

    - ``trigger_type``: 'record_event'
    - ``context``: sanitized env.context from the automation execution
    - ``model``: target Odoo model name
    - ``record_ids``: list of affected record IDs
    - ``event_type``: 'on_create' | 'on_write' | 'on_unlink' | etc.
    """

    node_type = "record_event_trigger"

    def execute(self, node_config, input_data, context):
        trigger_payload = input_data.get("_trigger", {})

        output = {
            "trigger_type": "record_event",
            "context": trigger_payload.get("context", {}),
            "model": trigger_payload.get("model", ""),
            "record_ids": trigger_payload.get("record_ids", []),
            "event_type": trigger_payload.get("event_type", ""),
        }

        return {
            "outputs": [[output]],
            "json": output,
        }
