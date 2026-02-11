/** @odoo-module **/

/**
 * Workflow Execution Bus Service
 *
 * Subscribes to real-time bus notifications emitted by the backend
 * WorkflowExecutor during manual workflow runs.
 *
 * Notification type handled:
 * - `workflow.execution/progress` → batched node completions, connections,
 *   next running node, and optional final status.
 *
 * The service bridges bus events to the workflowEditor store via its
 * `actions.onExecutionProgress` method, enabling the EditorCanvas to
 * highlight nodes/connections in real-time.
 */

import { registry } from "@web/core/registry";

export const workflowBusService = {
    dependencies: ["bus_service"],

    start(env, { bus_service }) {
        bus_service.subscribe(
            "workflow.execution/progress",
            (payload) => {
                const editor = env.services.workflowEditor;
                if (!editor) {
                    return;
                }
                editor.actions.onExecutionProgress(payload);
            }
        );

        bus_service.start();
    },
};

registry.category("services").add("workflow_bus", workflowBusService);
