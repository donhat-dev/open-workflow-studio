/** @odoo-module **/

/**
 * Expression Utils Unit Tests
 *
 * Tests for utils/expression_utils.js - Expression parsing and evaluation
 */

import {
    hasExpressions,
    extractExpressions,
    parseExpressionPath,
    resolveExpression,
    evaluateExpression,
    NAMESPACES,
} from '../utils/expression_utils';

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
        toContain(expected) {
            if (!actual.includes(expected)) {
                throw new Error(`Expected ${JSON.stringify(actual)} to contain ${expected}`);
            }
        },
    };
}

/**
 * Test Suite: Expression Utils
 */
export class TestExpressionUtils {
    static run() {
        describe('Expression Utils', () => {
            this.testNamespaces();
            this.testHasExpressions();
            this.testExtractExpressions();
            this.testParseExpressionPath();
            this.testResolveExpression();
            this.testEvaluateExpression();
        });
    }

    static testNamespaces() {
        describe('NAMESPACES constant', () => {
            test('includes all supported namespaces', () => {
                expect(NAMESPACES).toContain('$json');
                expect(NAMESPACES).toContain('$vars');
                expect(NAMESPACES).toContain('$loop');
                expect(NAMESPACES).toContain('$node');
            });
        });
    }

    static testHasExpressions() {
        describe('hasExpressions()', () => {
            test('returns true for template strings', () => {
                expect(hasExpressions('{{ $json.email }}')).toBe(true);
                expect(hasExpressions('Hello {{ $vars.name }}')).toBe(true);
            });

            test('returns false for plain strings', () => {
                expect(hasExpressions('plain text')).toBe(false);
                expect(hasExpressions('')).toBe(false);
            });

            test('returns false for non-strings', () => {
                expect(hasExpressions(123)).toBe(false);
                expect(hasExpressions(null)).toBe(false);
            });
        });
    }

    static testExtractExpressions() {
        describe('extractExpressions()', () => {
            test('extracts single expression', () => {
                const result = extractExpressions('{{ $json.email }}');
                expect(result.length).toBe(1);
                expect(result[0].expression).toBe('$json.email');
            });

            test('extracts multiple expressions', () => {
                const result = extractExpressions('{{ $vars.first }} and {{ $vars.second }}');
                expect(result.length).toBe(2);
                expect(result[0].expression).toBe('$vars.first');
                expect(result[1].expression).toBe('$vars.second');
            });

            test('handles mixed content', () => {
                const result = extractExpressions('Name: {{ $json.name }}, Age: {{ $json.age }}');
                expect(result.length).toBe(2);
            });
        });
    }

    static testParseExpressionPath() {
        describe('parseExpressionPath()', () => {
            test('parses $json namespace', () => {
                const result = parseExpressionPath('$json.items[0].name');
                expect(result.namespace).toBe('$json');
                expect(result.parts).toEqual(['items', '0', 'name']);
            });

            test('parses $vars namespace', () => {
                const result = parseExpressionPath('$vars.result.order_line');
                expect(result.namespace).toBe('$vars');
                expect(result.parts).toEqual(['result', 'order_line']);
            });

            test('parses $loop namespace', () => {
                const result = parseExpressionPath('$loop.item.sku');
                expect(result.namespace).toBe('$loop');
                expect(result.parts).toEqual(['item', 'sku']);
            });

            test('parses $node namespace', () => {
                const result = parseExpressionPath('$node.HTTP_Request.json.data');
                expect(result.namespace).toBe('$node');
                expect(result.parts).toEqual(['HTTP_Request', 'json', 'data']);
            });

            test('handles bracket notation', () => {
                const result = parseExpressionPath("$json['special-key'][0]");
                expect(result.namespace).toBe('$json');
                expect(result.parts).toEqual(['special-key', '0']);
            });

            test('handles namespace only', () => {
                const result = parseExpressionPath('$loop');
                expect(result.namespace).toBe('$loop');
                expect(result.parts).toEqual([]);
            });
        });
    }

    static testResolveExpression() {
        describe('resolveExpression()', () => {
            const context = {
                $json: { email: 'test@example.com', items: [{ id: 1 }, { id: 2 }] },
                $vars: { count: 5, result: { lines: [] } },
                $loop: { item: { sku: 'ABC123' }, index: 0, total: 3 },
                $node: { 'HTTP_Request': { json: { status: 200 } } },
            };

            test('resolves $json path', () => {
                const result = resolveExpression('$json.email', context);
                expect(result).toBe('test@example.com');
            });

            test('resolves $json array access', () => {
                const result = resolveExpression('$json.items[1].id', context);
                expect(result).toBe(2);
            });

            test('resolves $vars path', () => {
                const result = resolveExpression('$vars.count', context);
                expect(result).toBe(5);
            });

            test('resolves $vars nested path', () => {
                const result = resolveExpression('$vars.result.lines', context);
                expect(result).toEqual([]);
            });

            test('resolves $loop.item', () => {
                const result = resolveExpression('$loop.item.sku', context);
                expect(result).toBe('ABC123');
            });

            test('resolves $loop.index', () => {
                const result = resolveExpression('$loop.index', context);
                expect(result).toBe(0);
            });

            test('resolves $node path', () => {
                const result = resolveExpression('$node.HTTP_Request.json.status', context);
                expect(result).toBe(200);
            });

            test('returns undefined for missing path', () => {
                const result = resolveExpression('$json.nonexistent.path', context);
                expect(result).toBe(undefined);
            });
        });
    }

    static testEvaluateExpression() {
        describe('evaluateExpression()', () => {
            const context = {
                $json: { name: 'John', age: 30 },
                $vars: { prefix: 'Hello' },
                $loop: { item: { id: 1 }, index: 0 },
            };

            test('evaluates single $json expression', () => {
                const result = evaluateExpression('{{ $json.name }}', context);
                expect(result.value).toBe('John');
                expect(result.error).toBe(null);
            });

            test('evaluates single $vars expression', () => {
                const result = evaluateExpression('{{ $vars.prefix }}', context);
                expect(result.value).toBe('Hello');
            });

            test('evaluates $loop expression', () => {
                const result = evaluateExpression('{{ $loop.item.id }}', context);
                expect(result.value).toBe(1);
            });

            test('evaluates mixed content', () => {
                const result = evaluateExpression('{{ $vars.prefix }} {{ $json.name }}!', context);
                expect(result.value).toBe('Hello John!');
            });

            test('returns plain string as-is', () => {
                const result = evaluateExpression('plain text', context);
                expect(result.value).toBe('plain text');
            });

            test('replaces undefined with empty string in mixed content', () => {
                const result = evaluateExpression('Value: {{ $json.missing }}', context);
                expect(result.value).toBe('Value: ');
            });
        });
    }
}

// Auto-run if loaded directly
if (typeof window !== 'undefined') {
    window.TestExpressionUtils = TestExpressionUtils;
}
