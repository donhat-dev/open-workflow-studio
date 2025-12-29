/** @odoo-module **/

/**
 * MockOdooRPC - Simulates Odoo RPC calls for workflow nodes
 *
 * In production, this will be replaced by actual Odoo RPC calls
 * through the standard @web/core/network/rpc_service.
 *
 * BACKEND MIGRATION:
 * ──────────────────
 * Replace mock calls with actual RPC:
 *
 *   // Mock (current)
 *   const result = await mockOdooRPC.search('product.product', domain);
 *
 *   // Production (future)
 *   const result = await this.rpc('/web/dataset/search_read', {
 *       model: 'product.product',
 *       domain: domain,
 *       fields: fields,
 *   });
 *
 * INTERFACE CONTRACT:
 * ───────────────────
 * search(model, domain, options) → Promise<Array>
 * searchRead(model, domain, fields, options) → Promise<Array>
 * read(model, ids, fields) → Promise<Array>
 * create(model, values) → Promise<{id: number}>
 * write(model, ids, values) → Promise<boolean>
 * unlink(model, ids) → Promise<boolean>
 * callMethod(model, method, args, kwargs) → Promise<any>
 */

export class MockOdooRPC {
    constructor() {
        // Mock data registry for different models
        this._mockData = {
            'product.product': [
                { id: 1, name: 'iPhone 15 Pro', default_code: 'IPHONE-15', list_price: 999.99, uom_id: [1, 'Unit'] },
                { id: 2, name: 'iPhone Case', default_code: 'CASE-001', list_price: 29.99, uom_id: [1, 'Unit'] },
                { id: 3, name: 'USB-C Cable', default_code: 'CABLE-USB', list_price: 19.99, uom_id: [1, 'Unit'] },
            ],
            'res.partner': [
                { id: 1, name: 'John Doe', email: 'john@example.com', phone: '+84123456789' },
                { id: 2, name: 'Jane Smith', email: 'jane@example.com', phone: '+84987654321' },
                { id: 3, name: 'Acme Corp', email: 'contact@acme.com', is_company: true },
            ],
            'uom.uom': [
                { id: 1, name: 'Unit', category_id: [1, 'Unit'] },
                { id: 2, name: 'Dozen', category_id: [1, 'Unit'], factor: 12 },
                { id: 3, name: 'kg', category_id: [2, 'Weight'] },
            ],
            'sale.order': [
                { id: 1, name: 'SO001', partner_id: [1, 'John Doe'], state: 'draft', amount_total: 1029.98 },
            ],
            'sale.order.line': [
                { id: 1, order_id: [1, 'SO001'], product_id: [1, 'iPhone 15 Pro'], product_uom_qty: 1, price_unit: 999.99 },
                { id: 2, order_id: [1, 'SO001'], product_id: [2, 'iPhone Case'], product_uom_qty: 1, price_unit: 29.99 },
            ],
        };

        // Auto-increment ID counter per model
        this._idCounters = {};
    }

    /**
     * Search for record IDs matching domain
     *
     * @param {string} model - Odoo model name
     * @param {Array} domain - Odoo domain filter
     * @param {Object} options - { limit, offset, order }
     * @returns {Promise<Array<number>>} Array of matching IDs
     */
    async search(model, domain = [], options = {}) {
        console.log(`[MockRPC] search ${model}`, { domain, options });

        const records = this._filterByDomain(model, domain);
        const ids = records.map(r => r.id);

        // Apply limit/offset
        const { limit, offset = 0 } = options;
        const sliced = limit ? ids.slice(offset, offset + limit) : ids.slice(offset);

        return sliced;
    }

    /**
     * Search and read records
     *
     * @param {string} model - Odoo model name
     * @param {Array} domain - Odoo domain filter
     * @param {Array} fields - Fields to return
     * @param {Object} options - { limit, offset, order }
     * @returns {Promise<Array<Object>>} Array of records
     */
    async searchRead(model, domain = [], fields = [], options = {}) {
        console.log(`[MockRPC] search_read ${model}`, { domain, fields, options });

        let records = this._filterByDomain(model, domain);

        // Apply limit/offset
        const { limit, offset = 0 } = options;
        if (limit) {
            records = records.slice(offset, offset + limit);
        } else if (offset) {
            records = records.slice(offset);
        }

        // Filter fields if specified
        if (fields.length > 0) {
            records = records.map(r => {
                const filtered = { id: r.id };
                for (const field of fields) {
                    if (field in r) {
                        filtered[field] = r[field];
                    }
                }
                return filtered;
            });
        }

        return records;
    }

    /**
     * Read specific records by ID
     *
     * @param {string} model - Odoo model name
     * @param {Array<number>} ids - Record IDs to read
     * @param {Array} fields - Fields to return
     * @returns {Promise<Array<Object>>} Array of records
     */
    async read(model, ids, fields = []) {
        console.log(`[MockRPC] read ${model}`, { ids, fields });

        const allRecords = this._mockData[model] || [];
        let records = allRecords.filter(r => ids.includes(r.id));

        // Filter fields if specified
        if (fields.length > 0) {
            records = records.map(r => {
                const filtered = { id: r.id };
                for (const field of fields) {
                    if (field in r) {
                        filtered[field] = r[field];
                    }
                }
                return filtered;
            });
        }

        return records;
    }

    /**
     * Create new record
     *
     * @param {string} model - Odoo model name
     * @param {Object} values - Field values
     * @returns {Promise<number>} New record ID
     */
    async create(model, values) {
        console.log(`[MockRPC] create ${model}`, values);

        // Initialize model data if not exists
        if (!this._mockData[model]) {
            this._mockData[model] = [];
        }
        if (!this._idCounters[model]) {
            this._idCounters[model] = Math.max(0, ...this._mockData[model].map(r => r.id)) + 1;
        }

        const newId = this._idCounters[model]++;
        const newRecord = { id: newId, ...values };

        this._mockData[model].push(newRecord);

        console.log(`[MockRPC] Created ${model} with id=${newId}:`, newRecord);
        return newId;
    }

    /**
     * Update existing records
     *
     * @param {string} model - Odoo model name
     * @param {Array<number>} ids - Record IDs to update
     * @param {Object} values - Field values to update
     * @returns {Promise<boolean>} Success
     */
    async write(model, ids, values) {
        console.log(`[MockRPC] write ${model}`, { ids, values });

        const records = this._mockData[model] || [];
        let updated = 0;

        for (const record of records) {
            if (ids.includes(record.id)) {
                Object.assign(record, values);
                updated++;
            }
        }

        console.log(`[MockRPC] Updated ${updated} records in ${model}`);
        return true;
    }

    /**
     * Delete records
     *
     * @param {string} model - Odoo model name
     * @param {Array<number>} ids - Record IDs to delete
     * @returns {Promise<boolean>} Success
     */
    async unlink(model, ids) {
        console.log(`[MockRPC] unlink ${model}`, { ids });

        if (this._mockData[model]) {
            this._mockData[model] = this._mockData[model].filter(r => !ids.includes(r.id));
        }

        return true;
    }

    /**
     * Call a model method
     *
     * @param {string} model - Odoo model name
     * @param {string} method - Method name
     * @param {Array} args - Positional arguments
     * @param {Object} kwargs - Keyword arguments
     * @returns {Promise<any>} Method result
     */
    async callMethod(model, method, args = [], kwargs = {}) {
        console.log(`[MockRPC] call ${model}.${method}`, { args, kwargs });

        // Mock some common methods
        if (method === 'name_get') {
            const ids = args[0] || [];
            const records = (this._mockData[model] || []).filter(r => ids.includes(r.id));
            return records.map(r => [r.id, r.name || r.display_name || `${model},${r.id}`]);
        }

        if (method === 'name_search') {
            const name = args[0] || '';
            const records = (this._mockData[model] || [])
                .filter(r => (r.name || '').toLowerCase().includes(name.toLowerCase()))
                .slice(0, kwargs.limit || 10);
            return records.map(r => [r.id, r.name]);
        }

        if (method === 'fields_get') {
            // Return mock field definitions
            return this._getFieldsDefinition(model);
        }

        // Default: return empty result
        console.warn(`[MockRPC] Unknown method: ${model}.${method}`);
        return null;
    }

    /**
     * Filter records by Odoo domain
     * @private
     */
    _filterByDomain(model, domain) {
        const records = this._mockData[model] || [];
        if (!domain || domain.length === 0) {
            return [...records];
        }

        return records.filter(record => {
            return domain.every(condition => {
                if (typeof condition === 'string') {
                    // Operator like '&', '|', '!'
                    return true; // Simplified: ignore operators
                }

                const [field, operator, value] = condition;
                const fieldValue = record[field];

                switch (operator) {
                    case '=':
                        return fieldValue === value;
                    case '!=':
                        return fieldValue !== value;
                    case 'in':
                        return Array.isArray(value) && value.includes(fieldValue);
                    case 'not in':
                        return Array.isArray(value) && !value.includes(fieldValue);
                    case 'like':
                    case 'ilike':
                        return String(fieldValue).toLowerCase().includes(String(value).toLowerCase());
                    case '>':
                        return fieldValue > value;
                    case '>=':
                        return fieldValue >= value;
                    case '<':
                        return fieldValue < value;
                    case '<=':
                        return fieldValue <= value;
                    default:
                        console.warn(`[MockRPC] Unknown operator: ${operator}`);
                        return true;
                }
            });
        });
    }

    /**
     * Get mock field definitions for a model
     * @private
     */
    _getFieldsDefinition(model) {
        const fieldDefs = {
            'product.product': {
                id: { type: 'integer', string: 'ID' },
                name: { type: 'char', string: 'Name', required: true },
                default_code: { type: 'char', string: 'Internal Reference' },
                list_price: { type: 'float', string: 'Sales Price' },
                uom_id: { type: 'many2one', string: 'Unit of Measure', relation: 'uom.uom' },
            },
            'res.partner': {
                id: { type: 'integer', string: 'ID' },
                name: { type: 'char', string: 'Name', required: true },
                email: { type: 'char', string: 'Email' },
                phone: { type: 'char', string: 'Phone' },
                is_company: { type: 'boolean', string: 'Is Company' },
            },
            'sale.order': {
                id: { type: 'integer', string: 'ID' },
                name: { type: 'char', string: 'Order Reference', required: true },
                partner_id: { type: 'many2one', string: 'Customer', relation: 'res.partner', required: true },
                order_line: { type: 'one2many', string: 'Order Lines', relation: 'sale.order.line' },
                state: { type: 'selection', string: 'Status' },
                amount_total: { type: 'monetary', string: 'Total', readonly: true },
            },
            'sale.order.line': {
                id: { type: 'integer', string: 'ID' },
                order_id: { type: 'many2one', string: 'Order', relation: 'sale.order' },
                product_id: { type: 'many2one', string: 'Product', relation: 'product.product', required: true },
                product_uom_qty: { type: 'float', string: 'Quantity', required: true },
                price_unit: { type: 'float', string: 'Unit Price' },
            },
        };

        return fieldDefs[model] || {};
    }

    /**
     * Add mock data for a model (for testing)
     *
     * @param {string} model - Model name
     * @param {Array<Object>} records - Records to add
     */
    addMockData(model, records) {
        if (!this._mockData[model]) {
            this._mockData[model] = [];
        }
        this._mockData[model].push(...records);
    }

    /**
     * Clear mock data for a model (for testing)
     *
     * @param {string} model - Model name (optional, clears all if not provided)
     */
    clearMockData(model = null) {
        if (model) {
            this._mockData[model] = [];
        } else {
            this._mockData = {};
        }
    }
}

// Singleton instance
export const mockOdooRPC = new MockOdooRPC();
