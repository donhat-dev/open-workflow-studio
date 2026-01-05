# ADR-002: Node Output Format - 2D Array Structure

> Standardized node output format following n8n's `INodeExecutionData[][]` pattern

---

## Status

**Accepted ✅**

---

## Context

In the stack-based execution engine (see [ADR-001](./001-execution-engine.md)), nodes need a standardized output format that:

1. Supports **multiple output sockets** (e.g., If node has True/False outputs)
2. Supports **multiple items per socket** (e.g., HTTP returns array of records)
3. Enables **data-driven routing** (empty output = skip branch)
4. Is **self-describing** (engine doesn't need node-specific logic)

### n8n's Approach

n8n uses `INodeExecutionData[][]` - a 2D array where:
- First dimension = output connector/socket index
- Second dimension = array of items for that output

This elegant design allows the engine to be completely generic.

---

## Decision

### Output Format Specification

All nodes MUST return an `outputs` array following this structure:

```javascript
{
    outputs: [
        [item1, item2, ...],  // Socket 0 items
        [item3, item4, ...],  // Socket 1 items
        ...                   // Socket N items
    ],
    json: any,                // Convenience: first item of first socket
    meta: {
        duration: number,
        executedAt: string,
        // ... node-specific metadata
    },
    error?: string,           // Error message if failed
    branch?: string           // For conditional nodes: 'true' | 'false'
}
```

### Socket Mapping by Node Type

#### Standard Node (Single Output)

```javascript
// HTTP Request Node
return {
    outputs: [[
        { json: { id: 1, name: "Alice" } },
        { json: { id: 2, name: "Bob" } }
    ]],
    json: { id: 1, name: "Alice" }
};

// Socket mapping:
// outputs[0] = "output" socket → data flows to connected nodes
```

#### If Node (Two Outputs)

```javascript
// Condition: status === "active"
// Input: [{ status: "active" }, { status: "inactive" }]

// TRUE case:
return {
    outputs: [
        [{ json: { status: "active" } }],   // Socket 0: true
        []                                   // Socket 1: false (empty = skip)
    ],
    branch: 'true'
};

// FALSE case:
return {
    outputs: [
        [],                                  // Socket 0: true (empty = skip)
        [{ json: { status: "inactive" } }]  // Socket 1: false
    ],
    branch: 'false'
};

// Socket mapping:
// outputs[0] = "true" socket
// outputs[1] = "false" socket
```

#### Switch Node (N Outputs)

```javascript
// Route by category: electronics, clothing, food, default
return {
    outputs: [
        [item1],   // Socket 0: electronics
        [item2],   // Socket 1: clothing
        [],        // Socket 2: food (no matches)
        [item3]    // Socket 3: default
    ]
};

// Socket mapping:
// outputs[N] = case N socket
```

#### Loop Node (Two Outputs)

```javascript
// Still iterating (more items remain):
return {
    outputs: [
        [currentItem],  // Socket 0: loop body
        []              // Socket 1: done (empty)
    ],
    meta: { iteration: 3, total: 10 }
};

// Last iteration:
return {
    outputs: [
        [],           // Socket 0: loop body (empty)
        [lastItem]    // Socket 1: done
    ],
    meta: { iterations: 10, completed: true }
};

// Socket mapping:
// outputs[0] = "loop" socket (re-enter loop body)
// outputs[1] = "done" socket (exit loop)
```

#### Code Node (Single Output with Expression)

```javascript
// Execute user code, return result
return {
    outputs: [[
        { json: evaluatedResult }
    ]]
};
```

### Routing Algorithm

The execution engine uses this simple algorithm:

```javascript
_routeOutputs(node, result, workflow) {
    const outputs = result.outputs || [[result.json]];
    const outputSockets = this._getOutputSockets(node);

    for (let outputIndex = 0; outputIndex < outputs.length; outputIndex++) {
        const outputData = outputs[outputIndex];

        // KEY MECHANISM: Empty array = skip this output socket
        if (!outputData || outputData.length === 0) {
            continue;  // Branch is dead, don't push any children
        }

        const socketName = outputSockets[outputIndex];

        // Find connections from this socket
        const connections = workflow.connections.filter(c =>
            c.source === node.id && c.sourceHandle === socketName
        );

        // Push child nodes to execution stack
        for (const conn of connections) {
            this.state.executionStack.push({
                nodeId: conn.target,
                inputData: outputData[0]
            });
        }
    }
}
```

### Benefits of 2D Array Format

| Benefit                 | Description                                                    |
| ----------------------- | -------------------------------------------------------------- |
| **Data-driven routing** | Engine doesn't need If/Switch logic - just checks `length > 0` |
| **Generic engine**      | Same code handles any node type                                |
| **Self-documenting**    | Array index = socket index, always                             |
| **Easy debugging**      | Inspect outputs to see exactly what flows where                |
| **Extensible**          | Add 100 output sockets without engine changes                  |

---

## Consequences

### Positive

- **Engine simplicity**: Routing is just "iterate, check empty, push"
- **Node flexibility**: Any node can have any number of outputs
- **Predictable behavior**: If node returns `[]` for an output, that branch dies
- **Easy testing**: Mock outputs are simple 2D arrays

### Negative

- **Learning curve**: Node developers must understand 2D array format
- **Memory overhead**: Even single-output nodes wrap in `[[data]]`
- **Index management**: Must keep socket index consistent with node definition

### Neutral

- Existing nodes need migration to new format (minor refactor)
- Normalize helper exists to convert legacy formats

---

## Node Implementation Examples

### If Node Implementation

```javascript
async _executeIfNode(node, inputData, expressionContext, startTime) {
    const config = node.config || {};
    const conditionResult = this._evaluateCondition(config, expressionContext);

    // Return outputs based on condition
    // outputs[0] = true branch, outputs[1] = false branch
    const outputs = conditionResult
        ? [[inputData], []]   // TRUE: data to first, nothing to second
        : [[], [inputData]];  // FALSE: nothing to first, data to second

    return {
        outputs,
        json: inputData,
        branch: conditionResult ? 'true' : 'false',
        meta: {
            duration: Date.now() - startTime,
            condition: { result: conditionResult }
        }
    };
}
```

### Loop Node Implementation

```javascript
async _executeLoopNode(node, inputData, expressionContext, startTime) {
    let loopCtx = this.state.nodeContext.get(node.id);

    if (!loopCtx) {
        // First execution: initialize state
        loopCtx = {
            currentIndex: 0,
            items: resolveCollection(inputData, config),
            maxIndex: items.length
        };
    }

    const currentItem = loopCtx.items[loopCtx.currentIndex];
    loopCtx.currentIndex++;
    this.state.nodeContext.set(node.id, loopCtx);

    if (loopCtx.currentIndex < loopCtx.maxIndex) {
        // More items → output to "loop" (index 0)
        return {
            outputs: [[currentItem], []],
            meta: { iteration: loopCtx.currentIndex }
        };
    } else {
        // Done → output to "done" (index 1)
        this.state.nodeContext.delete(node.id);
        return {
            outputs: [[], [currentItem]],
            meta: { completed: true }
        };
    }
}
```

### HTTP Request Node Implementation

```javascript
async execute(context) {
    const response = await fetch(this.config.url, options);
    const data = await response.json();

    // Wrap in 2D array format
    return {
        outputs: [[
            { json: data }
        ]],
        json: data
    };
}
```

---

## Normalization Helper

For backward compatibility with legacy nodes:

```javascript
_normalizeResult(result, startTime) {
    if (!result) {
        return { outputs: [[]], json: null };
    }

    // Already has outputs array
    if (Array.isArray(result.outputs)) {
        return result;
    }

    // Has json property (legacy format)
    if (result.json !== undefined) {
        return {
            outputs: [[result.json]],
            json: result.json,
            ...result
        };
    }

    // Raw result
    return {
        outputs: [[result]],
        json: result
    };
}
```

---

## References

- [ADR-001: Stack-Based Execution Engine](./001-execution-engine.md)
- [n8n INodeExecutionData](https://docs.n8n.io/integrations/creating-nodes/reference/data-types/)
- [stack_executor.js](../../../workflow_pilot/static/src/mocks/stack_executor.js)

---

## Metadata

| Field             | Value          |
| ----------------- | -------------- |
| **Date**          | 2026-01-05     |
| **Author**        | Claude Code    |
| **Reviewers**     | -              |
| **Related ADRs**  | ADR-001        |
| **Related Tasks** | E2.2.1, E2.2.3 |
