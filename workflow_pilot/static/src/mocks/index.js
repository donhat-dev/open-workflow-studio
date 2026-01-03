/** @odoo-module **/

/**
 * Mock Services Index
 *
 * This module exports mock implementations for services that will
 * eventually be handled by the Odoo backend.
 *
 * MIGRATION PATH:
 * ───────────────
 * Phase 1 (Current): Frontend uses mocks directly
 * Phase 2: Create backend Python equivalents
 * Phase 3: Create RPC endpoints
 * Phase 4: Replace mock imports with RPC service calls
 * Phase 5: Remove mocks (or keep for testing)
 *
 * USAGE:
 * ──────
 * import { StackExecutor, stackExecutor } from '@workflow_pilot/mocks';
 * const result = await stackExecutor.executeUntil(workflow, nodeId);
 */

// Primary executor - Stack-Based (replaces topological sort approach)
export { StackExecutor, stackExecutor } from './stack_executor';

export { MockVariableStore, mockVariableStore } from './variable_store';
export { MockOdooRPC, mockOdooRPC } from './odoo_rpc';
