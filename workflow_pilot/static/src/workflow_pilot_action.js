/** @odoo-module **/

import { registry } from "@web/core/registry";
import { WorkflowPilotDevApp } from "./dev_demo_app";
import { WorkflowEditorApp } from "./app/workflow_editor_app";

// Register client actions
registry.category("actions").add("workflow_pilot.editor_app", WorkflowEditorApp);
registry.category("actions").add("workflow_pilot.dev_app", WorkflowPilotDevApp);
