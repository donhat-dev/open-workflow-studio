# S2.1 - Executor consolidation: workflowExecutorService delegates to MockExecutionEngine
# Gherkin scenarios for future Playwright / integration-style tests

Feature: workflowExecutor delegates to engine
  As a developer
  I want workflowExecutorService to delegate execution to MockExecutionEngine
  So that execution behavior is centralized and consistent

  Background:
    Given a workflow with nodes and connections
    And the workflow variable service provides a real ExecutionContext

  Scenario: executeUntil stores outputs in both service results and execution context
    Given node "n_1" produces output json {"value": 1}
    And node "n_2" produces output json {"value": 2}
    When I execute workflow until node "n_2"
    Then workflowExecutor.hasExecuted("n_1") should be true
    And workflowExecutor.getNodeOutput("n_1").json.value should be 1
    And workflowVariable.getNodeOutput("n_2").json.value should be 2

  Scenario: Execution uses adapter-resolved config before legacy nodeData.config
    Given node "n_1" has adapter config {"url": "https://example.com"}
    And node "n_1" has legacy nodeData.config {"url": "https://legacy.example.com"}
    When I execute workflow until node "n_1"
    Then the node should execute with url "https://example.com"

  Scenario: Execution order follows workflowExecutor.getExecutionOrder
    Given the workflowExecutor.getExecutionOrder returns order ["a", "b", "c"]
    When I execute workflow until node "c"
    Then nodes should be executed in order ["a", "b", "c"]

  Scenario: Loop node execution does not crash consolidation path
    Given a loop node with collection expression "{{ $vars.items }}"
    And $vars.items is [1, 2]
    When I execute workflow until the loop node
    Then execution should complete
