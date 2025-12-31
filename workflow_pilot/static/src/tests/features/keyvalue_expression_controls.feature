# E4.5.2 - Expressions in KeyValue controls (drop + preview)
# Gherkin scenarios for future Playwright test automation

Feature: KeyValue controls support expressions
  As a workflow builder user
  I want KeyValue "value" fields to support drag/drop expressions and preview
  So that I can build headers/mappings using dynamic data

  Background:
    Given a workflow with nodes:
      | nodeId | type         | title      |
      | n_1    | http_request  | Fetch Data |
      | n_2    | http_request  | Call API   |
    And node "n_1" has output json {"body": {"token": "abc"}}
    And I open config panel for node "n_2"

  Scenario: Dragging a field into a KeyValue value inserts expression template
    Given the node has a KeyValue control "headers" with a row key "Authorization"
    When I drag field "body.token" from ancestor node "n_1" into the "headers" value cell
    Then the value cell should contain "{{ $(\"n_1\").json.body.token }}"

  Scenario: KeyValue value preview shows resolved value
    Given the node has a KeyValue control "headers" with value "{{ $(\"n_1\").json.body.token }}"
    When the expression preview context is available
    Then the preview should display "abc"

  Scenario: Adding a new KeyValue row creates a stable row identifier
    Given the node has a KeyValue control "headers" with 1 row
    When I click "+ Add"
    Then the KeyValue control should have 2 rows
    And each row should have a stable id

  Scenario: Removing a row keeps at least one row
    Given the node has a KeyValue control "headers" with 1 row
    Then the remove button should be disabled

  Scenario: Switching nodes without remount refreshes KeyValue rows
    Given the config panel stays open while I switch selected node
    And node "n_2" has a KeyValue control "headers" with a row key "Authorization"
    And the "headers" value is "{{ $(\"n_1\").json.body.token }}"
    When I switch config panel to a different node "n_1" without remounting
    And node "n_1" has a KeyValue control "headers" with a row key "X-Debug"
    Then the KeyValue rows shown should match node "n_1" config (not stale from node "n_2")
