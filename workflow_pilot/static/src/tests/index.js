/** @odoo-module **/

/**
 * Tests Index
 *
 * Unit tests for Workflow Pilot core functionality.
 * Tests are designed to run without Odoo server dependency.
 *
 * Run tests:
 *   node --experimental-vm-modules tests/run_tests.js
 *   OR
 *   Open tests/test_runner.html in browser
 *
 * Test naming convention:
 *   test_<module>.js - Tests for specific module
 */

export { TestContext } from './test_context';
export { TestExpressionUtils } from './test_expression_utils';
export { TestMockExecutionEngine } from './test_mock_execution_engine';
