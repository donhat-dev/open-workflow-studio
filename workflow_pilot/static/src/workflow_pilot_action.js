/** @odoo-module **/

import { registry } from "@web/core/registry";
import { WorkflowEditorApp } from "./app/workflow_editor_app";

// Register client actions
registry.category("actions").add("workflow_pilot.editor_app", WorkflowEditorApp);
