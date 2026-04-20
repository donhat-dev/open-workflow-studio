/** @odoo-module **/

import { BaseNode, DataSocket, ErrorSocket } from '../core/node';
import { TextInputControl, SelectControl } from '../core/control';

/**
 * ConnectorRequestNode — Managed outbound HTTP node (ADR-010)
 *
 * Unlike the generic HttpRequestNode, this node is bound at the backend to a
 * workflow.connector + workflow.endpoint + workflow.auth.profile.  The canvas
 * stores only the operation_code and optional overrides; all shared config
 * (base URL, auth) is resolved by the ConnectorRequestNodeRunner at runtime.
 *
 * Inputs:  data (trigger / payload)
 * Outputs: response, error
 *
 * Config keys written to snapshot:
 *   connector_id      — backend ID, set by node config panel (read-only on canvas)
 *   endpoint_id       — backend ID, set by node config panel (read-only on canvas)
 *   auth_profile_id   — backend ID, set by node config panel (read-only on canvas)
 *   operation_code    — logical operation key (e.g. "create_order")
 *   url               — optional full URL override (empty = use endpoint preset)
 *   method            — optional HTTP method override
 *   timeout           — optional timeout override in seconds
 */
export class ConnectorRequestNode extends BaseNode {
    static nodeType = 'connector_request';
    static label = 'Connector Request';
    static icon = 'fa-plug';
    static category = 'integration';
    static description = 'Managed HTTP call via a reusable connector';

    constructor() {
        super();

        // --- Sockets ---
        this.addInput('data', DataSocket, 'Input Data');
        this.addOutput('response', DataSocket, 'Response');
        this.addOutput('error', ErrorSocket, 'Error');

        // --- Controls ---
        // operation_code is the only canvas-editable field users normally touch.
        // connector/endpoint/auth IDs are set by the backend config panel.
        this.addControl('operation_code', new TextInputControl('operation_code', {
            label: 'Operation Code',
            placeholder: 'e.g. create_order',
            help: 'Stable logical identifier for this API call. '
                + 'Used to look up backend config.',
        }));

        // Optional URL override (leave empty to use endpoint preset base_url + path)
        this.addControl('url', new TextInputControl('url', {
            label: 'URL Override',
            placeholder: 'Leave empty to use endpoint preset',
        }));

        // Optional method override
        this.addControl('method', new SelectControl('method', {
            label: 'Method Override',
            options: [
                { value: '', label: '— Use endpoint preset —' },
                { value: 'GET', label: 'GET' },
                { value: 'POST', label: 'POST' },
                { value: 'PUT', label: 'PUT' },
                { value: 'PATCH', label: 'PATCH' },
                { value: 'DELETE', label: 'DELETE' },
            ],
            default: '',
        }));

        // Timeout override
        this.addControl('timeout', new TextInputControl('timeout', {
            label: 'Timeout Override (s)',
            placeholder: 'Leave empty for endpoint/connector default',
            inputType: 'number',
        }));
    }
}
