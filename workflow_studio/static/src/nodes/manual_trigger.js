/** @odoo-module **/

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
        this.addOutput('output', DataSocket);

        // No controls - no configuration needed
    }
}
