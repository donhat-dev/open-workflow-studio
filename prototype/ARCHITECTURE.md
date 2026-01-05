# Code Node - Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                      WORKFLOW BUILDER APP                       │
│                     (OWL + Rete.js v2)                         │
└─────────────────────────────────────────────────────────────────┘
                                │
                ┌───────────────┴───────────────┐
                │                               │
        ┌───────▼────────┐            ┌────────▼────────┐
        │  Node Palette  │            │  Properties     │
        │   (Sidebar)    │            │     Panel       │
        └───────┬────────┘            └────────┬────────┘
                │                               │
        ┌───────▼────────┐            ┌────────▼────────┐
        │ 🌐 HTTP Request│            │ Monaco Editor   │
        │ ✓  Validation  │            │   Integration   │
        │ ⇄  Mapping     │            │                 │
        │ 💻 Code  [NEW] │◄───────────┤ - Dark theme    │
        └────────────────┘            │ - Autocomplete  │
                                      │ - Syntax check  │
                                      └─────────────────┘


┌─────────────────────────────────────────────────────────────────┐
│                      CODE NODE FLOW                             │
└─────────────────────────────────────────────────────────────────┘

  Input Node          Code Node              Output Node
┌──────────┐       ┌──────────┐            ┌──────────┐
│  HTTP    │──────▶│   CODE   │───────────▶│ Mapping  │
│ Request  │       │          │            │          │
└──────────┘       └────┬─────┘            └──────────┘
                        │
                        │ Error
                        ▼
                   ┌──────────┐
                   │  Error   │
                   │ Handler  │
                   └──────────┘


┌─────────────────────────────────────────────────────────────────┐
│                  CODE NODE INTERNALS                            │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                      CodeNode Class                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Inputs                                                         │
│  ├─ data (DataSocket) ◄───── từ node trước                     │
│                                                                 │
│  Controls                                                       │
│  ├─ code: TextInputControl (multiline)                         │
│  └─ language: SelectControl (javascript)                       │
│                                                                 │
│  Execution Method: async data(inputs)                          │
│  ┌──────────────────────────────────────────┐                  │
│  │ 1. Get input data                        │                  │
│  │ 2. Create AsyncFunction                  │                  │
│  │ 3. Execute code with 'data' parameter    │                  │
│  │ 4. Return result or catch error          │                  │
│  └──────────────────────────────────────────┘                  │
│                                                                 │
│  Outputs                                                        │
│  ├─ result (DataSocket) ────▶ success output                   │
│  └─ error (ErrorSocket) ─────▶ error output                    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘


┌─────────────────────────────────────────────────────────────────┐
│                  MONACO EDITOR INTEGRATION                      │
└─────────────────────────────────────────────────────────────────┘

PropertiesPanel Component (OWL)
│
├─ setup()
│  ├─ monacoEditor = null
│  ├─ monacoContainerRef = useRef("monacoContainer")
│  ├─ onMounted() ──▶ initMonacoEditor()
│  └─ onWillUnmount() ──▶ editor.dispose()
│
└─ initMonacoEditor()
   │
   ├─ require.config({ paths: { 'vs': 'CDN_URL' } })
   │
   ├─ require(['vs/editor/editor.main'], () => {
   │     monaco.editor.create(container, {
   │       value: code,
   │       language: 'javascript',
   │       theme: 'vs-dark',
   │       ...options
   │     })
   │  })
   │
   └─ editor.onDidChangeModelContent(() => {
         updateControl('code', editor.getValue())
      })


┌─────────────────────────────────────────────────────────────────┐
│                   EXECUTION FLOW                                │
└─────────────────────────────────────────────────────────────────┘

User writes code in Monaco
         │
         ▼
Code saved to node.controls.code
         │
         ▼
User clicks "Run Workflow"
         │
         ▼
Rete Engine executes nodes
         │
         ▼
CodeNode.data(inputs) called
         │
         ├─ Get input: inputs.data[0]
         │
         ├─ Create executor:
         │    AsyncFunction('data', codeString)
         │
         ├─ Execute:
         │    result = await executeFn(inputData)
         │
         └─ Return:
              { result: ..., error: null }
              OR
              { result: null, error: {...} }
         │
         ▼
Output routed to connected nodes
         │
         ▼
Workflow continues


┌─────────────────────────────────────────────────────────────────┐
│                    STYLING SYSTEM                               │
└─────────────────────────────────────────────────────────────────┘

Neo-Brutalism Design
├─ Colors
│  ├─ Code Node: #8b5cf6 (Purple)
│  ├─ Border: #000 (Black)
│  └─ Shadow: 4px 4px 0 #000
│
├─ Node Palette Item
│  └─ .node-palette__item--code
│     ├─ border: 3px solid #8b5cf6
│     └─ box-shadow: 4px 4px 0 #000
│
├─ Rete Node
│  └─ .rete-node--code
│     ├─ Header: background #8b5cf6
│     └─ Body: white background
│
└─ Monaco Container
   ├─ height: 400px
   ├─ border: 3px solid #000
   └─ box-shadow: 4px 4px 0 #000


┌─────────────────────────────────────────────────────────────────┐
│                  FILE STRUCTURE                                 │
└─────────────────────────────────────────────────────────────────┘

prototype/
│
├─ index.html ────────────┐
│                         ├─ Monaco CDN
│                         ├─ OWL Framework
│                         ├─ Rete.js
│                         └─ Load app.js + nodes.js
│
├─ nodes.js ──────────────┐
│                         ├─ CodeNode class
│                         ├─ async data() method
│                         └─ Export to window.WorkflowNodes
│
├─ app.js ────────────────┐
│                         ├─ PropertiesPanel
│                         │  └─ Monaco integration
│                         ├─ NodePalette
│                         │  └─ Code node item
│                         └─ WorkflowApp
│                            └─ addNode('code')
│
└─ styles.css ────────────┐
                          ├─ .node-palette__item--code
                          └─ .rete-node--code


┌─────────────────────────────────────────────────────────────────┐
│                    COMPONENT TREE                               │
└─────────────────────────────────────────────────────────────────┘

WorkflowApp (OWL Component)
│
├─ NodePalette
│  └─ Code Node Item 💻
│     └─ onClick: addNode('code')
│
├─ Editor Canvas (SimpleEditor)
│  └─ Rete Nodes
│     ├─ HTTP Request
│     ├─ Validation
│     ├─ Mapping
│     └─ Code ◄── NEW
│
└─ PropertiesPanel
   ├─ HTTP properties
   ├─ Validation properties
   ├─ Mapping properties
   └─ Code properties ◄── NEW
      ├─ Language selector
      └─ Monaco Editor ◄── 400px height
         ├─ JavaScript syntax
         ├─ Dark theme
         ├─ Auto-complete
         └─ Error detection
```

---

**Legend**:
- `─▶` Data flow
- `◄─` Inheritance/Reference
- `┌─┐` Component boundary
- `├─┤` Properties/Methods
- `└─┘` End of structure
