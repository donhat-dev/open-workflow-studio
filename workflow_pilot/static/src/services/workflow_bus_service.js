/** @odoo-module **/

/**
 * Workflow Execution Bus Service
 *
 * Subscribes to real-time bus notifications emitted by the backend
 * WorkflowExecutor during manual workflow runs.
 *
 * Notification types handled:
 * - `workflow.execution/node_done`  → per-node completion (incremental UI update)
 * - `workflow.execution/done`       → full workflow completion
 *
 * The service bridges bus events to the workflowEditor store via its
 * `actions.onNodeExecutionProgress` and `actions.onExecutionDone` methods,
 * enabling the EditorCanvas to highlight nodes/connections in real-time.
 */

import { registry } from "@web/core/registry";

export const workflowBusService = {
    dependencies: ["bus_service"],

    start(env, { bus_service }) {
        // Subscribe to node-start (spinner / running indicator)
        bus_service.subscribe(
            "workflow.execution/node_start",
            (payload) => {
                const editor = env.services.workflowEditor;
                if (!editor) {
                    return;
                }
                editor.actions.onNodeExecutionStart(payload);
            }
        );

        // Subscribe to per-node completion
        bus_service.subscribe(
            "workflow.execution/node_done",
            (payload) => {
                const editor = env.services.workflowEditor;
                if (!editor) {
                    return;
                }
                editor.actions.onNodeExecutionProgress(payload);
            }
        );

        // Subscribe to execution completion
        bus_service.subscribe(
            "workflow.execution/done",
            (payload) => {
                const editor = env.services.workflowEditor;
                if (!editor) {
                    return;
                }
                editor.actions.onExecutionDone(payload);
            }
        );

        // Ensure websocket connection is started
        bus_service.start();
    },
};

registry.category("services").add("workflow_bus", workflowBusService);
