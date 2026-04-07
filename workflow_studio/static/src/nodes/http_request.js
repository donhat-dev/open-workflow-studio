/** @odoo-module **/

import { BaseNode, DataSocket, ErrorSocket } from '../core/node';
import { TextInputControl, SelectControl, KeyValueControl } from '../core/control';

/**
 * HttpRequestNode - Configures HTTP API calls
 *
 * Inputs: data (optional trigger)
 * Outputs: response, error
 * Config: method, url, headers, body
 */
export class HttpRequestNode extends BaseNode {
    static nodeType = 'http';
    static label = 'HTTP Request';
    static icon = 'fa-globe';
    static category = 'integration';
    static description = 'Make HTTP API calls to external services';

    constructor() {
        super();

        // Inputs
        this.addInput('data', DataSocket, 'Input Data');

        // Outputs
        this.addOutput('response', DataSocket, 'Response');
        this.addOutput('error', ErrorSocket, 'Error');

        // Controls
        this.addControl('method', new SelectControl('method', {
            label: 'Method',
            options: [
                { value: 'GET', label: 'GET' },
                { value: 'POST', label: 'POST' },
                { value: 'PUT', label: 'PUT' },
                { value: 'PATCH', label: 'PATCH' },
                { value: 'DELETE', label: 'DELETE' },
            ],
            default: 'GET',
        }));

        this.addControl('url', new TextInputControl('url', {
            label: 'URL',
            placeholder: 'https://api.example.com/endpoint',
        }));

        this.addControl('headers', new KeyValueControl('headers', {
            label: 'Headers',
            keyPlaceholder: 'Header name',
            valuePlaceholder: 'Header value',
        }));

        this.addControl('body', new TextInputControl('body', {
            label: 'Request Body',
            placeholder: '{"key": "value"}',
            multiline: true,
        }));
    }

}
