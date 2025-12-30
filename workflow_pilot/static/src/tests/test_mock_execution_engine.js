/** @odoo-module **/

/**
 * MockExecutionEngine Unit Tests
 *
 * Tests for mocks/execution_engine.js
 */

import { MockExecutionEngine } from '../mocks/execution_engine';

/**
 * Simple test runner helper
 */
function describe(name, fn) {
    console.group(`📦 ${name}`);
    fn();
    console.groupEnd();
}

function test(name, fn) {
    try {
        fn();
        console.log(`  ✅ ${name}`);
    } catch (err) {
        console.error(`  ❌ ${name}: ${err.message}`);
    }
}

async function asyncTest(name, fn) {
    try {
        await fn();
        console.log(`  ✅ ${name}`);
    } catch (err) {
        console.error(`  ❌ ${name}: ${err.message}`);
    }
}

function expect(actual) {
    return {
        toBe(expected) {
            if (actual !== expected) {
                throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
            }
        },
        toEqual(expected) {
            if (JSON.stringify(actual) !== JSON.stringify(expected)) {
                throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
            }
        },
        toBeDefined() {
            if (actual === undefined) {
                throw new Error(`Expected value to be defined`);
            }
        },
        toBeNull() {
            if (actual !== null) {
                throw new Error(`Expected null, got ${JSON.stringify(actual)}`);
            }
        },
        toHaveLength(expected) {
            if (actual.length !== expected) {
                throw new Error(`Expected length ${expected}, got ${actual.length}`);
            }
        },
    };
}

/**
 * Test Suite: MockExecutionEngine
 */
export class TestMockExecutionEngine {
    static async run() {
        describe('MockExecutionEngine', () => {
            this.testConstruction();
            this.testReset();
        });

        // Async tests
        await this.testExecution();
    }

    static testConstruction() {
        describe('Construction', () => {
            test('creates engine with null context', () => {
                const engine = new MockExecutionEngine();
                expect(engine.context).toBeNull();
                expect(engine.isExecuting).toBe(false);
            });

            test('creates empty node outputs map', () => {
                const engine = new MockExecutionEngine();
                expect(engine.nodeOutputs.size).toBe(0);
            });
        });
    }

    static testReset() {
        describe('reset()', () => {
            test('creates new ExecutionContext', () => {
                const engine = new MockExecutionEngine();
                engine.reset();
                expect(engine.context).toBeDefined();
            });

            test('clears node outputs', () => {
                const engine = new MockExecutionEngine();
                engine.nodeOutputs.set('test', { data: 1 });
                engine.reset();
                expect(engine.nodeOutputs.size).toBe(0);
            });

            test('resets execution order', () => {
                const engine = new MockExecutionEngine();
                engine.executionOrder.push('node1');
                engine.reset();
                expect(engine.executionOrder).toHaveLength(0);
            });
        });
    }

    static async testExecution() {
        console.group('📦 executeUntil()');
        
        await asyncTest('executes simple linear workflow', async () => {
                const engine = new MockExecutionEngine();

                const workflow = {
                    nodes: [
                        { id: 'node_1', type: 'trigger', x: 0, y: 0 },
                        { id: 'node_2', type: 'action', x: 100, y: 0 },
                    ],
                    connections: [
                        { id: 'c1', source: 'node_1', sourceHandle: 'output', target: 'node_2', targetHandle: 'input' },
                    ],
                };

                const result = await engine.executeUntil(workflow, 'node_2');

                expect(result.error).toBeNull();
                expect(result.executionOrder).toHaveLength(2);
                expect(result.executionOrder[0]).toBe('node_1');
                expect(result.executionOrder[1]).toBe('node_2');
            });

            await asyncTest('sets initial variables', async () => {
                const engine = new MockExecutionEngine();

                const workflow = {
                    nodes: [{ id: 'node_1', type: 'trigger', x: 0, y: 0 }],
                    connections: [],
                };

                await engine.executeUntil(workflow, 'node_1', {
                    initialVars: { test: 'value', count: 0 },
                });

                expect(engine.context.getVariable('test')).toBe('value');
                expect(engine.context.getVariable('count')).toBe(0);
            });

            await asyncTest('calls onNodeStart callback', async () => {
                const engine = new MockExecutionEngine();
                const startedNodes = [];

                const workflow = {
                    nodes: [{ id: 'node_1', type: 'trigger', x: 0, y: 0 }],
                    connections: [],
                };

                await engine.executeUntil(workflow, 'node_1', {
                    onNodeStart: (nodeId) => startedNodes.push(nodeId),
                });

                expect(startedNodes).toHaveLength(1);
                expect(startedNodes[0]).toBe('node_1');
            });

            await asyncTest('calls onNodeComplete callback', async () => {
                const engine = new MockExecutionEngine();
                const completedNodes = [];

                const workflow = {
                    nodes: [{ id: 'node_1', type: 'trigger', x: 0, y: 0 }],
                    connections: [],
                };

                await engine.executeUntil(workflow, 'node_1', {
                    onNodeComplete: (nodeId, result) => completedNodes.push({ nodeId, result }),
                });

                expect(completedNodes).toHaveLength(1);
                expect(completedNodes[0].nodeId).toBe('node_1');
                expect(completedNodes[0].result.json).toBeDefined();
            });

            await asyncTest('returns error for unknown target node', async () => {
                const engine = new MockExecutionEngine();

                const workflow = {
                    nodes: [{ id: 'node_1', type: 'trigger', x: 0, y: 0 }],
                    connections: [],
                };

                const result = await engine.executeUntil(workflow, 'unknown_node');
                expect(result.error).toBeDefined();
            });
        
        console.groupEnd();
    }
}

// Auto-run if loaded directly
if (typeof window !== 'undefined') {
    window.TestMockExecutionEngine = TestMockExecutionEngine;
}
