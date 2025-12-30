# E5.4.1 - n8n-style Node Selector Syntax
# Gherkin scenarios for future Playwright test automation

Feature: n8n-style Node Selector Expression
  As a workflow builder user
  I want to reference previous node outputs using $('nodeId') syntax
  So that I can use familiar n8n-style expressions

  Background:
    Given an execution context with nodes:
      | nodeId | json                                |
      | n_1    | {"body": {"data": "hello"}}         |
      | n_2    | {"items": [1, 2, 3]}                |
      | http_1 | {"status": 200, "response": "OK"}   |

  # Happy Path Scenarios

  Scenario: Single-quoted node selector with json accessor
    When I evaluate expression "{{ $('n_1').json.body.data }}"
    Then the result should be "hello"

  Scenario: Double-quoted node selector with json accessor
    When I evaluate expression "{{ $(\"n_1\").json.body.data }}"
    Then the result should be "hello"

  Scenario: Node selector with array access
    When I evaluate expression "{{ $('n_2').json.items[1] }}"
    Then the result should be 2

  Scenario: Node selector with whitespace tolerance
    When I evaluate expression "{{ $(  'n_1'  ).json.body.data }}"
    Then the result should be "hello"

  Scenario: Multiple node selectors in one expression
    When I evaluate expression "Status: {{ $('http_1').json.status }}, Data: {{ $('n_1').json.body.data }}"
    Then the result should be "Status: 200, Data: hello"

  Scenario: Node selector with underscore in nodeId
    When I evaluate expression "{{ $('http_1').json.status }}"
    Then the result should be 200

  # Rewrite Verification Scenarios

  Scenario: Verify rewriter transforms single-quoted selector
    Given expression "$('n_1').json.body"
    When the rewriter processes it
    Then the rewritten expression should be "$node['n_1'].json.body"

  Scenario: Verify rewriter transforms double-quoted selector
    Given expression "$(\"n_2\").json.items"
    When the rewriter processes it
    Then the rewritten expression should be "$node['n_2'].json.items"

  Scenario: Verify rewriter handles mixed content
    Given expression "prefix $('n_1').json.key suffix"
    When the rewriter processes it
    Then the rewritten expression should be "prefix $node['n_1'].json.key suffix"

  Scenario: Verify rewriter ignores non-selector expressions
    Given expression "$json.body.data"
    When the rewriter processes it
    Then the rewritten expression should be "$json.body.data"

  # Edge Cases

  Scenario: Empty expression passes through unchanged
    When I evaluate expression ""
    Then the result should be ""

  Scenario: Plain text without expression passes through
    When I evaluate expression "Hello World"
    Then the result should be "Hello World"

  Scenario: Node selector accessing root json
    When I evaluate expression "{{ $('http_1').json }}"
    Then the result should be an object with keys "status" and "response"

  # Backward Compatibility

  Scenario: Traditional $node['id'] syntax still works
    When I evaluate expression "{{ $node['n_1'].json.body.data }}"
    Then the result should be "hello"

  Scenario: Traditional $json syntax still works
    Given $json is the output of node "n_1"
    When I evaluate expression "{{ $json.body.data }}"
    Then the result should be "hello"

  Scenario: Mixed old and new syntax in same workflow
    When I evaluate expression "Old: {{ $node['n_1'].json.body.data }}, New: {{ $('n_2').json.items[0] }}"
    Then the result should be "Old: hello, New: 1"

  # Error Handling Scenarios

  Scenario: Reference non-existent node
    When I evaluate expression "{{ $('nonexistent').json.data }}"
    Then the result should be undefined

  Scenario: Access non-existent property
    When I evaluate expression "{{ $('n_1').json.nonexistent.deep }}"
    Then the result should be undefined

  # Future Consideration (Not implemented yet)

  @wip
  Scenario: Node selector without .json should show helpful error
    When I evaluate expression "{{ $('n_1').body }}"
    Then an error should indicate ".json accessor is required"
