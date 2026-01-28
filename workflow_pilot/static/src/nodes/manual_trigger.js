/** @odoo-module **/

import { registry } from "@web/core/registry";
import { BaseNode, DataSocket } from '../core/node';

/**
 * ManualTriggerNode - Start node for manual workflow execution
 * 
 * No inputs (this is a start node)
 * No controls (no configuration needed)
 * One output: output (DataSocket)
 */
export class ManualTriggerNode extends BaseNode {
    static nodeType = 'manual_trigger';
    static label = 'Manual Trigger';
    static icon = 'fa-play';
    static category = 'trigger';
    static description = 'Manually start a workflow execution';

    constructor() {
        super();

        // No inputs - this is a start node

        // Outputs
        this.addOutput('output', DataSocket, 'Output');

        // No controls - no configuration needed
    }
}

// Self-register to Odoo registry (like Odoo actions/fields pattern)
registry.category("workflow_node_types").add("manual_trigger", ManualTriggerNode);
