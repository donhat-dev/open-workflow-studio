/** @odoo-module **/

import { registry } from "@web/core/registry";
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

    /**
     * Execute HTTP request
     * Uses real fetch when URL is provided, falls back to mock for testing
     * Returns n8n-compatible outputs[][] format:
     *   outputs[0] = response socket
     *   outputs[1] = error socket
     */
    async execute(inputData = {}) {
        const config = this.getConfig();
        const url = config.url?.trim();
        const method = config.method || 'GET';

        // If no URL provided, return mock data
        if (!url) {
            const mockResp = this._getMockResponse(config);
            return {
                outputs: [[mockResp], []],  // response socket, empty error
                json: mockResp,
            };
        }

        try {
            // Build headers from KeyValue control
            const headers = {};
            if (config.headers && Array.isArray(config.headers)) {
                for (const { key, value } of config.headers) {
                    if (key) headers[key] = value || '';
                }
            }

            // Build fetch options
            const options = {
                method,
                headers,
            };

            // Add body for non-GET requests
            if (method !== 'GET' && config.body) {
                options.body = config.body;
                if (!headers['Content-Type']) {
                    headers['Content-Type'] = 'application/json';
                }
            }

            console.log(`[HTTP Request] Fetching: ${method} ${url}`);
            const response = await fetch(url, options);

            // Try to parse response
            let body;
            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
                body = await response.json();
            } else {
                body = await response.text();
            }

            const result = {
                status: response.status,
                statusText: response.statusText,
                headers: Object.fromEntries(response.headers.entries()),
                body,
            };

            // outputs[0] = response, outputs[1] = error (empty on success)
            return {
                outputs: [[result], []],
                json: result,
            };
        } catch (error) {
            console.warn('[HTTP Request] Fetch failed:', error.message);
            const errorResult = {
                error: error.message,
                url,
                method,
            };
            // outputs[0] = response (empty on error), outputs[1] = error
            return {
                outputs: [[], [errorResult]],
                json: errorResult,
                error: error.message,
            };
        }
    }

    /**
     * Generate mock response for testing
     */
    _getMockResponse(config, errorNote = null) {
        return {
            status: 200,
            statusText: 'OK (Mock)',
            headers: {
                'content-type': 'application/json',
                'x-request-id': `mock-${Date.now()}`,
            },
            body: {
                _mock: true,
                _note: errorNote || 'No URL provided - using mock data',
                success: true,
                message: 'Mock response from HTTP Request node',
                request: {
                    url: config.url || 'https://api.example.com',
                    method: config.method || 'GET',
                },
                data: {
                    id: 1,
                    name: 'Sample Data',
                    email: 'sample@example.com',
                    items: [
                        { id: 101, title: 'Item 1', price: 29.99 },
                        { id: 102, title: 'Item 2', price: 49.99 },
                    ],
                },
                timestamp: new Date().toISOString(),
            },
        };
    }
}

// Self-register to Odoo registry (like Odoo actions/fields pattern)
registry.category("workflow_node_types").add("http", HttpRequestNode);
