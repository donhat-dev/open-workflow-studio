# E4.5.1 - Node-scoped drag/drop from INPUT panel
# Gherkin scenarios for future Playwright test automation

Feature: INPUT panel drag/drop generates node-scoped expressions
  As a workflow builder user
  I want dragging fields from ancestor outputs to generate node-scoped expressions
  So that mappings always reference the correct source node

  Background:
    Given a workflow with nodes:
      | nodeId | title     |
      | n_1    | Fetch A   |
      | n_2    | Fetch B   |
      | n_3    | Transform |
    And node "n_1" has output json {"body": {"data": "A"}}
    And node "n_2" has output json {"body": {"data": "B"}}

  Scenario: Dragging from ancestor node output generates node-scoped selector
    Given I open config panel for node "n_3"
    And the INPUT panel shows ancestor section for node "n_1"
    When I drag field "body.data" from ancestor node "n_1" into an expression input
    Then the inserted expression should be "{{ $(\"n_1\").json.body.data }}"

  Scenario: Dragging from a different ancestor node preserves its nodeId
    Given I open config panel for node "n_3"
    And the INPUT panel shows ancestor section for node "n_2"
    When I drag field "body.data" from ancestor node "n_2" into an expression input
    Then the inserted expression should be "{{ $(\"n_2\").json.body.data }}"

  Scenario: Preview output tree is read-only (no drag)
    Given I open config panel for a node without workflow context
    And the panel shows preview output in the INPUT tree
    Then JSON tree key badges should not be draggable
    And dragging should not insert any expression into expression inputs
