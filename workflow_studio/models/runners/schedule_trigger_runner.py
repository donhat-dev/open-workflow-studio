"""
Schedule Trigger Runner

Passthrough runner for the schedule trigger node.
When the executor encounters this node, the trigger has already fired
(via ir.cron), so the runner simply forwards the trigger payload
(including ``env.context``) as its output.
"""

import logging

from .base import BaseNodeRunner

_logger = logging.getLogger(__name__)


class ScheduleTriggerNodeRunner(BaseNodeRunner):
    """Runner for schedule_trigger nodes.

    By the time the executor reaches this node, the cron job has
    already invoked ``_execute_from_trigger`` which populated
    ``input_data['_trigger']``.  The runner unwraps that payload
    so downstream nodes see a clean ``$json`` with:

    - ``trigger_type``: 'schedule'
    - ``context``: sanitized env.context from the cron execution
    - ``fired_at``: ISO timestamp of trigger
    """

    node_type = "schedule_trigger"

    def execute(self, node_config, input_data, context):
        trigger_payload = input_data.get("_trigger", {})

        output = {
            "trigger_type": "schedule",
            "context": trigger_payload.get("context", {}),
            "fired_at": trigger_payload.get("fired_at", ""),
        }

        return {
            "outputs": [[output]],
            "json": output,
        }
