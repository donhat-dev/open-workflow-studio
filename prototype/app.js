/**
 * Workflow Builder - OWL Application
 * Main application with Rete.js integration
 */

const { Component, mount, xml, useState, useRef, onMounted, onWillUnmount } = owl;
// Note: ClassicPreset is already declared in nodes.js, use Rete.ClassicPreset if needed
const { AreaPlugin, AreaExtensions } = ReteAreaPlugin;
const { ConnectionPlugin, Presets: ConnectionPresets } = ReteConnectionPlugin;

// Node classes are accessed via window.WorkflowNodes (defined in nodes.js)
// Do not redeclare them as const to avoid "already declared" errors

// ============================================
// CUSTOM DOM RENDERER FOR RETE.JS
// ============================================

class DomRenderer {
    constructor(container, editor) {
        this.container = container;
        this.editor = editor;
        this.nodeElements = new Map();
        this.connectionElements = new Map();
    }

    renderNode(node, position) {
        const el = document.createElement('div');
        el.className = `rete-node rete-node--${node.nodeType}`;
        el.dataset.nodeId = node.id;
        el.style.position = 'absolute';
        el.style.left = `${position.x}px`;
        el.style.top = `${position.y}px`;

        // Header
        const header = document.createElement('div');
        header.className = 'rete-node__header';
        header.textContent = node.label;
        el.appendChild(header);

        // Body
        const body = document.createElement('div');
        body.className = 'rete-node__body';

        // Inputs
        const inputs = Object.entries(node.inputs);
        inputs.forEach(([key, input]) => {
            const row = document.createElement('div');
            row.className = 'rete-node__row';

            const socket = document.createElement('div');
            socket.className = 'rete-socket input';
            socket.dataset.nodeId = node.id;
            socket.dataset.key = key;
            socket.dataset.type = 'input';
            row.appendChild(socket);

            const label = document.createElement('span');
            label.textContent = input.label || key;
            label.style.marginLeft = '12px';
            label.style.fontSize = '0.75rem';
            row.appendChild(label);

            body.appendChild(row);
        });

        // Outputs
        const outputs = Object.entries(node.outputs);
        outputs.forEach(([key, output]) => {
            const row = document.createElement('div');
            row.className = 'rete-node__row';
            row.style.justifyContent = 'flex-end';

            const label = document.createElement('span');
            label.textContent = output.label || key;
            label.style.marginRight = '12px';
            label.style.fontSize = '0.75rem';
            row.appendChild(label);

            const socket = document.createElement('div');
            socket.className = 'rete-socket output';
            socket.dataset.nodeId = node.id;
            socket.dataset.key = key;
            socket.dataset.type = 'output';
            row.appendChild(socket);

            body.appendChild(row);
        });

        el.appendChild(body);
        this.container.appendChild(el);
        this.nodeElements.set(node.id, el);

        // Make draggable
        this.makeDraggable(el, node);

        return el;
    }

    makeDraggable(element, node) {
        let isDragging = false;
        let startX, startY;
        let initialX, initialY;

        const header = element.querySelector('.rete-node__header');

        header.addEventListener('mousedown', (e) => {
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            initialX = parseInt(element.style.left) || 0;
            initialY = parseInt(element.style.top) || 0;
            element.classList.add('selected');

            // Notify selection
            if (this.onNodeSelect) {
                this.onNodeSelect(node);
            }
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;

            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            element.style.left = `${initialX + dx}px`;
            element.style.top = `${initialY + dy}px`;

            this.updateConnections(node.id);
        });

        document.addEventListener('mouseup', () => {
            isDragging = false;
        });

        element.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.rete-node').forEach(n => n.classList.remove('selected'));
            element.classList.add('selected');
            if (this.onNodeSelect) {
                this.onNodeSelect(node);
            }
        });
    }

    getSocketPosition(nodeId, key, type) {
        const nodeEl = this.nodeElements.get(nodeId);
        if (!nodeEl) return null;

        const socket = nodeEl.querySelector(`.rete-socket[data-key="${key}"][data-type="${type}"]`);
        if (!socket) return null;

        const nodeRect = nodeEl.getBoundingClientRect();
        const socketRect = socket.getBoundingClientRect();
        const containerRect = this.container.getBoundingClientRect();

        return {
            x: socketRect.left - containerRect.left + socketRect.width / 2,
            y: socketRect.top - containerRect.top + socketRect.height / 2
        };
    }

    renderConnection(connection, sourcePos, targetPos) {
        // Create SVG path for connection
        let svg = this.container.querySelector('.rete-connections');
        if (!svg) {
            svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.classList.add('rete-connections');
            svg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:0;';
            this.container.insertBefore(svg, this.container.firstChild);
        }

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.classList.add('rete-connection');
        path.dataset.connectionId = connection.id;

        const d = this.getCurvePath(sourcePos, targetPos);
        path.setAttribute('d', d);

        svg.appendChild(path);
        this.connectionElements.set(connection.id, path);
    }

    getCurvePath(source, target) {
        const dx = Math.abs(target.x - source.x);
        const controlOffset = Math.max(dx * 0.8, 50);

        return `M ${source.x} ${source.y} 
                C ${source.x + controlOffset} ${source.y}, 
                  ${target.x - controlOffset} ${target.y}, 
                  ${target.x} ${target.y}`;
    }

    updateConnections(nodeId) {
        // Re-render connections for this node
        this.connectionElements.forEach((path, connId) => {
            const conn = this.editor.connections.find(c => c.id === connId);
            if (conn && (conn.source === nodeId || conn.target === nodeId)) {
                const sourcePos = this.getSocketPosition(conn.source, conn.sourceOutput, 'output');
                const targetPos = this.getSocketPosition(conn.target, conn.targetInput, 'input');
                if (sourcePos && targetPos) {
                    path.setAttribute('d', this.getCurvePath(sourcePos, targetPos));
                }
            }
        });
    }

    removeNode(nodeId) {
        const el = this.nodeElements.get(nodeId);
        if (el) {
            el.remove();
            this.nodeElements.delete(nodeId);
        }
    }

    removeConnection(connectionId) {
        const path = this.connectionElements.get(connectionId);
        if (path) {
            path.remove();
            this.connectionElements.delete(connectionId);
        }
    }
}

// ============================================
// SIMPLE EDITOR WRAPPER
// ============================================

class SimpleEditor {
    constructor(container) {
        this.container = container;
        this.nodes = new Map();
        this.connections = [];
        this.renderer = new DomRenderer(container, this);
        this.selectedNode = null;
        this.onSelectionChange = null;
        this.nodeIdCounter = 1;
        this.connIdCounter = 1;

        // Connection drawing state
        this.isConnecting = false;
        this.connectionStart = null;
        this.tempLine = null;

        this.setupConnectionHandlers();
        this.setupClickHandler();
    }

    setupClickHandler() {
        this.container.addEventListener('click', (e) => {
            if (e.target === this.container || e.target.classList.contains('rete-connections')) {
                document.querySelectorAll('.rete-node').forEach(n => n.classList.remove('selected'));
                this.selectedNode = null;
                if (this.onSelectionChange) {
                    this.onSelectionChange(null);
                }
            }
        });
    }

    setupConnectionHandlers() {
        this.container.addEventListener('mousedown', (e) => {
            if (e.target.classList.contains('rete-socket')) {
                this.startConnection(e.target, e);
            }
        });

        this.container.addEventListener('mousemove', (e) => {
            if (this.isConnecting && this.tempLine) {
                this.updateTempLine(e);
            }
        });

        this.container.addEventListener('mouseup', (e) => {
            if (this.isConnecting) {
                if (e.target.classList.contains('rete-socket')) {
                    this.finishConnection(e.target);
                } else {
                    this.cancelConnection();
                }
            }
        });
    }

    startConnection(socket, e) {
        const nodeId = socket.dataset.nodeId;
        const key = socket.dataset.key;
        const type = socket.dataset.type;

        this.isConnecting = true;
        this.connectionStart = { nodeId, key, type };

        // Create temp line
        let svg = this.container.querySelector('.rete-connections');
        if (!svg) {
            svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.classList.add('rete-connections');
            svg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:0;';
            this.container.insertBefore(svg, this.container.firstChild);
        }

        this.tempLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        this.tempLine.style.cssText = 'stroke:#000;stroke-width:3;stroke-dasharray:5,5;fill:none;';
        svg.appendChild(this.tempLine);

        this.updateTempLine(e);
    }

    updateTempLine(e) {
        if (!this.connectionStart) return;

        const startPos = this.renderer.getSocketPosition(
            this.connectionStart.nodeId,
            this.connectionStart.key,
            this.connectionStart.type
        );

        const containerRect = this.container.getBoundingClientRect();
        const endPos = {
            x: e.clientX - containerRect.left,
            y: e.clientY - containerRect.top
        };

        const d = this.renderer.getCurvePath(startPos, endPos);
        this.tempLine.setAttribute('d', d);
    }

    finishConnection(targetSocket) {
        const targetNodeId = targetSocket.dataset.nodeId;
        const targetKey = targetSocket.dataset.key;
        const targetType = targetSocket.dataset.type;

        // Validate connection (output to input only)
        if (this.connectionStart.type === 'output' && targetType === 'input') {
            this.addConnection(
                this.connectionStart.nodeId,
                this.connectionStart.key,
                targetNodeId,
                targetKey
            );
        } else if (this.connectionStart.type === 'input' && targetType === 'output') {
            this.addConnection(
                targetNodeId,
                targetKey,
                this.connectionStart.nodeId,
                this.connectionStart.key
            );
        }

        this.cancelConnection();
    }

    cancelConnection() {
        this.isConnecting = false;
        this.connectionStart = null;
        if (this.tempLine) {
            this.tempLine.remove();
            this.tempLine = null;
        }
    }

    addNode(NodeClass, position = { x: 100, y: 100 }) {
        const node = new NodeClass();
        node.id = `node_${this.nodeIdCounter++}`;
        this.nodes.set(node.id, node);

        this.renderer.renderNode(node, position);
        this.renderer.onNodeSelect = (n) => {
            this.selectedNode = n;
            if (this.onSelectionChange) {
                this.onSelectionChange(n);
            }
        };

        return node;
    }

    addConnection(sourceId, sourceOutput, targetId, targetInput) {
        // Check if connection already exists
        const exists = this.connections.find(c =>
            c.source === sourceId &&
            c.sourceOutput === sourceOutput &&
            c.target === targetId &&
            c.targetInput === targetInput
        );
        if (exists) return;

        const connection = {
            id: `conn_${this.connIdCounter++}`,
            source: sourceId,
            sourceOutput,
            target: targetId,
            targetInput
        };

        this.connections.push(connection);

        const sourcePos = this.renderer.getSocketPosition(sourceId, sourceOutput, 'output');
        const targetPos = this.renderer.getSocketPosition(targetId, targetInput, 'input');

        if (sourcePos && targetPos) {
            this.renderer.renderConnection(connection, sourcePos, targetPos);
        }

        return connection;
    }

    removeNode(nodeId) {
        // Remove related connections
        const relatedConns = this.connections.filter(c => c.source === nodeId || c.target === nodeId);
        relatedConns.forEach(c => this.removeConnection(c.id));

        // Remove node
        this.nodes.delete(nodeId);
        this.renderer.removeNode(nodeId);

        if (this.selectedNode && this.selectedNode.id === nodeId) {
            this.selectedNode = null;
            if (this.onSelectionChange) {
                this.onSelectionChange(null);
            }
        }
    }

    removeConnection(connectionId) {
        this.connections = this.connections.filter(c => c.id !== connectionId);
        this.renderer.removeConnection(connectionId);
    }

    getWorkflow() {
        return {
            nodes: Array.from(this.nodes.values()).map(node => ({
                id: node.id,
                type: node.nodeType,
                label: node.label,
                config: node.getConfig ? node.getConfig() : {}
            })),
            connections: this.connections.map(c => ({
                source: c.source,
                sourceOutput: c.sourceOutput,
                target: c.target,
                targetInput: c.targetInput
            }))
        };
    }
}

// ============================================
// OWL COMPONENTS
// ============================================

/**
 * Key-Value Editor Component
 */
class KeyValueEditor extends Component {
    static template = xml`
        <div class="kv-editor">
            <label class="form-label"><t t-esc="props.label"/></label>
            <div class="kv-list">
                <t t-foreach="state.pairs" t-as="pair" t-key="pair_index">
                    <div class="kv-row">
                        <input type="text" class="form-input" 
                            t-att-placeholder="props.keyPlaceholder"
                            t-att-value="pair.key"
                            t-on-input="(e) => this.updateKey(pair_index, e.target.value)"/>
                        <input type="text" class="form-input"
                            t-att-placeholder="props.valuePlaceholder"
                            t-att-value="pair.value"
                            t-on-input="(e) => this.updateValue(pair_index, e.target.value)"/>
                        <button class="btn btn--small btn--danger" t-on-click="() => this.removePair(pair_index)">×</button>
                    </div>
                </t>
            </div>
            <button class="btn btn--small mt-sm" t-on-click="addPair">+ Add</button>
        </div>
    `;

    static props = ["label", "pairs", "keyPlaceholder", "valuePlaceholder", "onChange"];

    setup() {
        this.state = useState({
            pairs: this.props.pairs || [{ key: "", value: "" }]
        });
    }

    addPair() {
        this.state.pairs.push({ key: "", value: "" });
        this.notifyChange();
    }

    removePair(index) {
        if (this.state.pairs.length > 1) {
            this.state.pairs.splice(index, 1);
            this.notifyChange();
        }
    }

    updateKey(index, value) {
        this.state.pairs[index].key = value;
        this.notifyChange();
    }

    updateValue(index, value) {
        this.state.pairs[index].value = value;
        this.notifyChange();
    }

    notifyChange() {
        if (this.props.onChange) {
            this.props.onChange([...this.state.pairs]);
        }
    }
}

/**
 * Node Properties Panel
 */
class PropertiesPanel extends Component {
    static template = xml`
        <div class="properties-panel">
            <h3 class="properties-panel__title">Properties</h3>
            <t t-if="!props.node">
                <p class="properties-panel__empty">Select a node to view its properties</p>
            </t>
            <t t-else="">
                <div class="mb-md">
                    <span class="form-label">Node Type</span>
                    <div style="font-weight: 600; text-transform: uppercase;">
                        <t t-esc="props.node.label"/>
                    </div>
                </div>

                <!-- HTTP Request Node -->
                <t t-if="props.node.nodeType === 'http'">
                    <div class="form-group">
                        <label class="form-label">Method</label>
                        <select class="form-select" t-on-change="(e) => this.updateControl('method', e.target.value)">
                            <option value="GET" t-att-selected="getControlValue('method') === 'GET'">GET</option>
                            <option value="POST" t-att-selected="getControlValue('method') === 'POST'">POST</option>
                            <option value="PUT" t-att-selected="getControlValue('method') === 'PUT'">PUT</option>
                            <option value="PATCH" t-att-selected="getControlValue('method') === 'PATCH'">PATCH</option>
                            <option value="DELETE" t-att-selected="getControlValue('method') === 'DELETE'">DELETE</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">URL</label>
                        <input type="text" class="form-input" 
                            placeholder="https://api.example.com/endpoint"
                            t-att-value="getControlValue('url')"
                            t-on-input="(e) => this.updateControl('url', e.target.value)"/>
                    </div>
                    <div class="form-group">
                        <KeyValueEditor 
                            label="'Headers'"
                            pairs="getControlPairs('headers')"
                            keyPlaceholder="'Header name'"
                            valuePlaceholder="'Header value'"
                            onChange="(pairs) => this.updateControlPairs('headers', pairs)"/>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Request Body</label>
                        <textarea class="form-textarea" 
                            placeholder='{"key": "value"}'
                            t-on-input="(e) => this.updateControl('body', e.target.value)"><t t-esc="getControlValue('body')"/></textarea>
                    </div>
                </t>

                <!-- Validation Node -->
                <t t-if="props.node.nodeType === 'validation'">
                    <div class="form-group">
                        <label class="form-label">Required Fields</label>
                        <input type="text" class="form-input" 
                            placeholder="field1, field2, field3"
                            t-att-value="getControlValue('requiredFields')"
                            t-on-input="(e) => this.updateControl('requiredFields', e.target.value)"/>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Validation Schema (JSON)</label>
                        <textarea class="form-textarea" 
                            placeholder='{"field": {"type": "string"}}'
                            t-on-input="(e) => this.updateControl('schema', e.target.value)"><t t-esc="getControlValue('schema')"/></textarea>
                    </div>
                    <div class="form-group">
                        <KeyValueEditor 
                            label="'Custom Rules'"
                            pairs="getControlPairs('customRules')"
                            keyPlaceholder="'Field path'"
                            valuePlaceholder="'Rule'"
                            onChange="(pairs) => this.updateControlPairs('customRules', pairs)"/>
                    </div>
                </t>

                <!-- Mapping Node -->
                <t t-if="props.node.nodeType === 'mapping'">
                    <div class="form-group">
                        <KeyValueEditor 
                            label="'Field Mappings'"
                            pairs="getControlPairs('mappings')"
                            keyPlaceholder="'Source path'"
                            valuePlaceholder="'Target path'"
                            onChange="(pairs) => this.updateControlPairs('mappings', pairs)"/>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Transform Function</label>
                        <select class="form-select" t-on-change="(e) => this.updateControl('transform', e.target.value)">
                            <option value="none" t-att-selected="getControlValue('transform') === 'none'">None</option>
                            <option value="uppercase" t-att-selected="getControlValue('transform') === 'uppercase'">Uppercase</option>
                            <option value="lowercase" t-att-selected="getControlValue('transform') === 'lowercase'">Lowercase</option>
                            <option value="trim" t-att-selected="getControlValue('transform') === 'trim'">Trim Whitespace</option>
                            <option value="number" t-att-selected="getControlValue('transform') === 'number'">To Number</option>
                            <option value="string" t-att-selected="getControlValue('transform') === 'string'">To String</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Default Value</label>
                        <input type="text" class="form-input" 
                            placeholder="Value if source is empty"
                            t-att-value="getControlValue('defaultValue')"
                            t-on-input="(e) => this.updateControl('defaultValue', e.target.value)"/>
                    </div>
                </t>

                <!-- Code Node -->
                <t t-if="props.node.nodeType === 'code'">
                    <div class="form-group">
                        <label class="form-label">Language</label>
                        <select class="form-select" t-on-change="(e) => this.updateControl('language', e.target.value)">
                            <option value="javascript" t-att-selected="getControlValue('language') === 'javascript'">JavaScript</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Code Editor</label>
                        <div t-ref="monacoContainer" style="height: 400px; border: 3px solid #000; box-shadow: 4px 4px 0 #000;"></div>
                    </div>
                </t>

                <!-- Delete Button -->
                <button class="btn btn--danger mt-md" t-on-click="deleteNode" style="width: 100%;">
                    Delete Node
                </button>
            </t>
        </div>
    `;

    static components = { KeyValueEditor };
    static props = ["node", "onDelete"];

    setup() {
        this.monacoEditor = null;
        this.monacoContainerRef = useRef("monacoContainer");

        onMounted(() => {
            this.initMonacoEditor();
        });

        onWillUnmount(() => {
            if (this.monacoEditor) {
                this.monacoEditor.dispose();
            }
        });
    }

    initMonacoEditor() {
        if (this.props.node?.nodeType !== 'code') return;

        const container = this.monacoContainerRef.el;
        if (!container) return;

        // Configure Monaco Editor loader
        require.config({ 
            paths: { 
                'vs': 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs' 
            } 
        });

        require(['vs/editor/editor.main'], () => {
            const code = this.getControlValue('code');
            
            this.monacoEditor = monaco.editor.create(container, {
                value: code,
                language: 'javascript',
                theme: 'vs-dark',
                automaticLayout: true,
                minimap: { enabled: false },
                fontSize: 13,
                scrollBeyondLastLine: false,
                lineNumbers: 'on',
                renderLineHighlight: 'all',
                tabSize: 2
            });

            // Update control value on change
            this.monacoEditor.onDidChangeModelContent(() => {
                const newCode = this.monacoEditor.getValue();
                this.updateControl('code', newCode);
            });
        });
    }

    getControlValue(name) {
        const control = this.props.node?.controls?.[name];
        return control?.value || "";
    }

    getControlPairs(name) {
        const control = this.props.node?.controls?.[name];
        return control?.pairs || [{ key: "", value: "" }];
    }

    updateControl(name, value) {
        const control = this.props.node?.controls?.[name];
        if (control) {
            control.value = value;
        }
    }

    updateControlPairs(name, pairs) {
        const control = this.props.node?.controls?.[name];
        if (control) {
            control.pairs = pairs;
        }
    }

    deleteNode() {
        if (this.props.onDelete && this.props.node) {
            this.props.onDelete(this.props.node.id);
        }
    }
}

/**
 * Node Palette Sidebar
 */
class NodePalette extends Component {
    static template = xml`
        <div class="sidebar">
            <h3 class="sidebar__title">Nodes</h3>
            <div class="node-palette">
                <div class="node-palette__item node-palette__item--http" 
                    t-on-click="() => this.addNode('http')"
                    draggable="true">
                    <div class="node-palette__icon">🌐</div>
                    <div class="node-palette__label">HTTP Request</div>
                </div>
                <div class="node-palette__item node-palette__item--validation"
                    t-on-click="() => this.addNode('validation')"
                    draggable="true">
                    <div class="node-palette__icon">✓</div>
                    <div class="node-palette__label">Data Validation</div>
                </div>
                <div class="node-palette__item node-palette__item--mapping"
                    t-on-click="() => this.addNode('mapping')"
                    draggable="true">
                    <div class="node-palette__icon">⇄</div>
                    <div class="node-palette__label">Data Mapping</div>
                </div>
                <div class="node-palette__item node-palette__item--code"
                    t-on-click="() => this.addNode('code')"
                    draggable="true">
                    <div class="node-palette__icon">💻</div>
                    <div class="node-palette__label">Code</div>
                </div>
            </div>
        </div>
    `;

    static props = ["onAddNode"];

    addNode(type) {
        if (this.props.onAddNode) {
            this.props.onAddNode(type);
        }
    }
}

/**
 * Main Application Component
 */
class WorkflowApp extends Component {
    static template = xml`
        <div class="workflow-app" t-att-class="state.isExecuting ? 'executing' : ''">
            <header class="header">
                <div class="header__logo">⚡ Workflow Builder</div>
                <div class="header__actions">
                    <button class="btn btn--secondary" 
                        t-on-click="runWorkflow" 
                        t-att-disabled="state.isExecuting">
                        <t t-if="state.isExecuting">⏳ Running...</t>
                        <t t-else="">▶ Run</t>
                    </button>
                    <button class="btn btn--primary" t-on-click="exportWorkflow">Export JSON</button>
                    <button class="btn btn--accent" t-on-click="clearWorkflow">Clear All</button>
                </div>
            </header>
            <NodePalette onAddNode="(type) => this.addNode(type)"/>
            <div class="editor-container">
                <div class="editor-canvas" t-ref="editorCanvas"/>
                <!-- Execution Log Panel -->
                <t t-if="state.showLog">
                    <div class="log-panel">
                        <div class="log-panel__header">
                            <span>Execution Log</span>
                            <button class="btn btn--small" t-on-click="() => state.showLog = false">×</button>
                        </div>
                        <div class="log-panel__content">
                            <t t-foreach="state.logs" t-as="log" t-key="log_index">
                                <div t-att-class="'log-entry log-entry--' + log.type">
                                    <span class="log-entry__time"><t t-esc="log.time"/></span>
                                    <span class="log-entry__node"><t t-esc="log.node"/></span>
                                    <span class="log-entry__message"><t t-esc="log.message"/></span>
                                </div>
                            </t>
                            <t t-if="state.executionResult">
                                <div class="log-entry log-entry--result">
                                    <pre><t t-esc="formatResult()"/></pre>
                                </div>
                            </t>
                        </div>
                    </div>
                </t>
            </div>
            <PropertiesPanel 
                node="state.selectedNode" 
                onDelete="(id) => this.deleteNode(id)"/>
        </div>
    `;

    static components = { NodePalette, PropertiesPanel };

    setup() {
        this.state = useState({
            selectedNode: null,
            isExecuting: false,
            showLog: false,
            logs: [],
            executionResult: null
        });
        this.canvasRef = useRef("editorCanvas");
        this.editor = null;
        this.nodePositionOffset = { x: 0, y: 0 };
        window.app = this; // For debugging

        onMounted(() => {
            this.initEditor();
        });
    }

    initEditor() {
        const container = this.canvasRef.el;
        this.editor = new SimpleEditor(container);

        this.editor.onSelectionChange = (node) => {
            this.state.selectedNode = node;
        };

        // Add initial demo nodes
        const httpNode = this.editor.addNode(window.WorkflowNodes.HttpRequestNode, { x: 100, y: 100 });
        const validationNode = this.editor.addNode(window.WorkflowNodes.DataValidationNode, { x: 400, y: 80 });
        const mappingNode = this.editor.addNode(window.WorkflowNodes.DataMappingNode, { x: 700, y: 120 });

        // Add demo connections
        setTimeout(() => {
            this.editor.addConnection(httpNode.id, 'response', validationNode.id, 'data');
            this.editor.addConnection(validationNode.id, 'valid', mappingNode.id, 'data');
        }, 100);
    }

    addNode(type) {
        const nodeClasses = {
            http: window.WorkflowNodes.HttpRequestNode,
            validation: window.WorkflowNodes.DataValidationNode,
            mapping: window.WorkflowNodes.DataMappingNode,
            code: window.WorkflowNodes.CodeNode
        };

        const NodeClass = nodeClasses[type];
        if (NodeClass && this.editor) {
            // Calculate position with offset
            this.nodePositionOffset.x += 30;
            this.nodePositionOffset.y += 30;
            if (this.nodePositionOffset.x > 200) {
                this.nodePositionOffset.x = 0;
                this.nodePositionOffset.y = 0;
            }

            this.editor.addNode(NodeClass, {
                x: 150 + this.nodePositionOffset.x,
                y: 150 + this.nodePositionOffset.y
            });
        }
    }

    deleteNode(nodeId) {
        if (this.editor) {
            this.editor.removeNode(nodeId);
            this.state.selectedNode = null;
        }
    }

    exportWorkflow() {
        if (this.editor) {
            const workflow = this.editor.getWorkflow();
            const json = JSON.stringify(workflow, null, 2);

            // Create download
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'workflow.json';
            a.click();
            URL.revokeObjectURL(url);
        }
    }

    clearWorkflow() {
        if (this.editor && confirm('Are you sure you want to clear all nodes?')) {
            const nodeIds = Array.from(this.editor.nodes.keys());
            nodeIds.forEach(id => this.editor.removeNode(id));
        }
    }

    /**
     * Execute the workflow using dataflow engine
     */
    async runWorkflow() {
        if (!this.editor || this.state.isExecuting) return;

        this.state.isExecuting = true;
        this.state.showLog = true;
        this.state.logs = [];
        this.state.executionResult = null;

        this.addLog('info', 'System', 'Starting workflow execution...');

        try {
            // Find start nodes (nodes with no incoming connections)
            const startNodes = this.findStartNodes();

            if (startNodes.length === 0) {
                this.addLog('error', 'System', 'No start nodes found!');
                return;
            }

            this.addLog('info', 'System', `Found ${startNodes.length} start node(s)`);

            // Process nodes in topological order
            const processedNodes = new Set();
            const nodeOutputs = new Map();

            const processNode = async (nodeId, inputData = {}) => {
                if (processedNodes.has(nodeId)) {
                    return nodeOutputs.get(nodeId);
                }

                const node = this.editor.nodes.get(nodeId);
                if (!node) return null;

                // Highlight node as executing
                this.highlightNode(nodeId, 'executing');
                this.addLog('info', node.label, 'Executing...');

                try {
                    // Call the node's data() method
                    const outputs = await node.data({ data: [inputData] });

                    processedNodes.add(nodeId);
                    nodeOutputs.set(nodeId, outputs);

                    this.highlightNode(nodeId, 'success');
                    this.addLog('success', node.label, 'Completed successfully');

                    // Find connected nodes and process them
                    const connections = this.editor.connections.filter(c => c.source === nodeId);

                    for (const conn of connections) {
                        const outputData = outputs[conn.sourceOutput];
                        if (outputData !== null && outputData !== undefined) {
                            await processNode(conn.target, outputData);
                        }
                    }

                    return outputs;
                } catch (err) {
                    this.highlightNode(nodeId, 'error');
                    this.addLog('error', node.label, err.message || 'Unknown error');
                    // Don't re-throw - continue execution and return error output
                    return { error: { message: err.message } };
                }
            };

            // Process all start nodes
            let finalResult = null;
            for (const startNode of startNodes) {
                finalResult = await processNode(startNode.id, {});
            }

            this.state.executionResult = finalResult;
            this.addLog('success', 'System', 'Workflow completed!');

        } catch (error) {
            this.addLog('error', 'System', `Execution failed: ${error.message}`);
        } finally {
            this.state.isExecuting = false;

            // Clear node highlights after 3 seconds
            setTimeout(() => {
                this.clearNodeHighlights();
            }, 3000);
        }
    }

    /**
     * Find nodes with no incoming connections (start nodes)
     */
    findStartNodes() {
        const nodesWithIncoming = new Set();
        this.editor.connections.forEach(c => nodesWithIncoming.add(c.target));

        return Array.from(this.editor.nodes.values())
            .filter(node => !nodesWithIncoming.has(node.id));
    }

    /**
     * Add a log entry (safely, outside of render cycle)
     */
    addLog(type, node, message) {
        const time = new Date().toLocaleTimeString();
        // Use setTimeout to avoid OWL render cycle conflicts
        setTimeout(() => {
            this.state.logs.push({ type, node, message, time });
        }, 0);
    }

    /**
     * Highlight a node during execution
     */
    highlightNode(nodeId, status) {
        const nodeEl = this.editor.renderer.nodeElements.get(nodeId);
        if (nodeEl) {
            nodeEl.classList.remove('node--executing', 'node--success', 'node--error');
            nodeEl.classList.add(`node--${status}`);
        }
    }

    /**
     * Clear all node highlights
     */
    clearNodeHighlights() {
        this.editor.renderer.nodeElements.forEach(el => {
            el.classList.remove('node--executing', 'node--success', 'node--error');
        });
    }

    /**
     * Safely format execution result for display
     */
    formatResult() {
        try {
            return JSON.stringify(this.state.executionResult, null, 2);
        } catch (e) {
            return '[Unable to display result]';
        }
    }
}

// ============================================
// MOUNT APPLICATION
// ============================================
mount(WorkflowApp, document.getElementById("app"));
