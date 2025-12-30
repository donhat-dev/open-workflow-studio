/** @odoo-module **/

/**
 * ExecutionContext Unit Tests
 *
 * Tests for core/context.js - Variable system foundation
 */

import { ExecutionContext } from '../core/context';

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
        toThrow() {
            if (typeof actual !== 'function') {
                throw new Error('Expected a function');
            }
            let threw = false;
            try {
                actual();
            } catch (e) {
                threw = true;
            }
            if (!threw) {
                throw new Error('Expected function to throw');
            }
        },
    };
}

/**
 * Test Suite: ExecutionContext
 */
export class TestContext {
    static run() {
        describe('ExecutionContext', () => {
            this.testVariables();
            this.testNodeOutputs();
            this.testLoopContext();
            this.testExpressionContext();
            this.testSerialization();
        });
    }

    static testVariables() {
        describe('$vars (Variables)', () => {
            test('setVariable creates simple path', () => {
                const ctx = new ExecutionContext();
                ctx.setVariable('name', 'test');
                expect(ctx.getVariable('name')).toBe('test');
            });

            test('setVariable creates nested path', () => {
                const ctx = new ExecutionContext();
                ctx.setVariable('result.order_line', []);
                expect(ctx.getVariable('result.order_line')).toEqual([]);
            });

            test('appendVariable adds to array', () => {
                const ctx = new ExecutionContext();
                ctx.setVariable('items', []);
                ctx.appendVariable('items', { id: 1 });
                ctx.appendVariable('items', { id: 2 });
                expect(ctx.getVariable('items').length).toBe(2);
            });

            test('appendVariable creates array if not exists', () => {
                const ctx = new ExecutionContext();
                ctx.appendVariable('newItems', { id: 1 });
                expect(ctx.getVariable('newItems')).toEqual([{ id: 1 }]);
            });

            test('mergeVariable merges objects', () => {
                const ctx = new ExecutionContext();
                ctx.setVariable('config', { a: 1 });
                ctx.mergeVariable('config', { b: 2 });
                expect(ctx.getVariable('config')).toEqual({ a: 1, b: 2 });
            });

            test('incrementVariable adds to number', () => {
                const ctx = new ExecutionContext();
                ctx.setVariable('count', 5);
                const result = ctx.incrementVariable('count', 3);
                expect(result).toBe(8);
                expect(ctx.getVariable('count')).toBe(8);
            });

            test('deleteVariable removes value', () => {
                const ctx = new ExecutionContext();
                ctx.setVariable('temp', 'value');
                ctx.deleteVariable('temp');
                expect(ctx.getVariable('temp')).toBe(undefined);
            });

            test('hasVariable returns correct status', () => {
                const ctx = new ExecutionContext();
                ctx.setVariable('exists', true);
                expect(ctx.hasVariable('exists')).toBe(true);
                expect(ctx.hasVariable('notexists')).toBe(false);
            });
        });
    }

    static testNodeOutputs() {
        describe('$node / $json (Node Outputs)', () => {
            test('setNodeOutput stores output', () => {
                const ctx = new ExecutionContext();
                ctx.setNodeOutput('node_1', { data: 'test' });
                expect(ctx.getNodeOutput('node_1')).toEqual({ data: 'test' });
            });

            test('$json returns last node output', () => {
                const ctx = new ExecutionContext();
                ctx.setNodeOutput('node_1', { first: true });
                ctx.setNodeOutput('node_2', { second: true });
                expect(ctx.$json).toEqual({ second: true });
            });

            test('getNodeOutput returns undefined for unknown node', () => {
                const ctx = new ExecutionContext();
                expect(ctx.getNodeOutput('unknown')).toBe(undefined);
            });
        });
    }

    static testLoopContext() {
        describe('$loop (Loop Context)', () => {
            test('pushLoop creates iteration context', () => {
                const ctx = new ExecutionContext();
                ctx.pushLoop(['a', 'b', 'c']);
                expect(ctx.$loop).toBeDefined();
                expect(ctx.$loop.item).toBe('a');
                expect(ctx.$loop.index).toBe(0);
                expect(ctx.$loop.total).toBe(3);
                expect(ctx.$loop.isFirst).toBe(true);
                expect(ctx.$loop.isLast).toBe(false);
            });

            test('advanceLoop moves to next item', () => {
                const ctx = new ExecutionContext();
                ctx.pushLoop(['a', 'b']);
                expect(ctx.advanceLoop()).toBe(true);
                expect(ctx.$loop.item).toBe('b');
                expect(ctx.$loop.index).toBe(1);
                expect(ctx.$loop.isLast).toBe(true);
            });

            test('advanceLoop returns false at end', () => {
                const ctx = new ExecutionContext();
                ctx.pushLoop(['a']);
                expect(ctx.advanceLoop()).toBe(false);
            });

            test('popLoop removes loop context', () => {
                const ctx = new ExecutionContext();
                ctx.pushLoop(['a', 'b']);
                ctx.popLoop();
                expect(ctx.$loop).toBeNull();
            });

            test('nested loops work correctly', () => {
                const ctx = new ExecutionContext();
                ctx.pushLoop(['outer1', 'outer2']);
                ctx.pushLoop(['inner1', 'inner2']);
                expect(ctx.$loop.item).toBe('inner1');
                ctx.popLoop();
                expect(ctx.$loop.item).toBe('outer1');
            });
        });
    }

    static testExpressionContext() {
        describe('toExpressionContext()', () => {
            test('returns all namespaces', () => {
                const ctx = new ExecutionContext();
                ctx.setVariable('test', 'value');
                ctx.setNodeOutput('node_1', { data: 1 });

                const exprCtx = ctx.toExpressionContext();
                expect(exprCtx.$vars).toEqual({ test: 'value' });
                expect(exprCtx.$node).toBeDefined();
                expect(exprCtx.$json).toBeDefined();
            });

            test('includes loop context when active', () => {
                const ctx = new ExecutionContext();
                ctx.pushLoop(['item1']);

                const exprCtx = ctx.toExpressionContext();
                expect(exprCtx.$loop).toBeDefined();
                expect(exprCtx.$loop.item).toBe('item1');
            });
        });
    }

    static testSerialization() {
        describe('Serialization', () => {
            test('toJSON captures state', () => {
                const ctx = new ExecutionContext();
                ctx.setVariable('x', 1);
                ctx.setNodeOutput('n1', { y: 2 });

                const json = ctx.toJSON();
                expect(json.vars).toEqual({ x: 1 });
                expect(json.nodeOutputs.n1).toEqual({ y: 2 });
            });

            test('fromJSON restores state', () => {
                const original = new ExecutionContext();
                original.setVariable('test', 'value');
                original.setNodeOutput('node_1', { data: 123 });

                const json = original.toJSON();
                const restored = ExecutionContext.fromJSON(json);

                expect(restored.getVariable('test')).toBe('value');
                expect(restored.getNodeOutput('node_1')).toEqual({ data: 123 });
            });
        });
    }
}

// Auto-run if loaded directly
if (typeof window !== 'undefined') {
    window.TestContext = TestContext;
}
