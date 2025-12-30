/** @odoo-module **/

import { Component, useState, xml, onPatched, onMounted } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";

import { NodePalette } from "./components/node_palette";
import { EditorCanvas } from "./components/editor_canvas";
import { WorkflowAdapter } from "./core/adapter";
import { NodeRegistry, LoopNode, NoOpNode } from "./nodes/index";
import { HistoryManager, createAddNodeAction, createRemoveNodeAction, createAddConnectionAction, createRemoveConnectionAction } from "./core/history";
import { runStressTest } from "./utils/benchmark";

const STORAGE_KEY = 'workflow_pilot_state';

/**
 * WorkflowPilotDevApp - Development Demo Application
 *
 * Architecture (Phase 3 - Full Separation):
 * - Adapter is the bridge between UI and Core
 * - UI components use adapterService for config/execution
 * - No _node reference exposed to UI layer
 */
export class WorkflowPilotDevApp extends Component {
    static template = xml`
        <div class="workflow-pilot-dev">
            <div class="workflow-pilot-dev__sidebar">
                <NodePalette onAddNode="onAddNode"/>
                
                <!-- Variable Inspector -->
                <div class="variable-inspector">
                    <h3 class="sidebar__title">Variables ($vars)</h3>
                    <div class="variable-inspector__content">
                        <t t-if="Object.keys(variableState.vars).length === 0">
                            <div class="variable-inspector__empty">No variables set</div>
                        </t>
                        <t t-else="">
                            <t t-foreach="Object.entries(variableState.vars)" t-as="entry" t-key="entry[0]">
                                <div class="variable-inspector__item">
                                    <span class="variable-inspector__key">$vars.<t t-esc="entry[0]"/></span>
                                    <span class="variable-inspector__value"><t t-esc="formatVarValue(entry[1])"/></span>
                                </div>
                            </t>
                        </t>
                    </div>
                    <button class="workflow-pilot-dev__btn workflow-pilot-dev__btn--small" t-on-click="clearVariables">Clear Vars</button>
                </div>
            </div>

            <div class="workflow-pilot-dev__main">
                <div class="workflow-pilot-dev__topbar">
                    <div class="workflow-pilot-dev__title">Workflow Pilot - Dev Playground</div>
                    <button class="workflow-pilot-dev__btn" t-on-click="saveToStorage">💾 Save</button>
                    <button class="workflow-pilot-dev__btn" t-on-click="exportJSON">📤 Export</button>
                    <button class="workflow-pilot-dev__btn" t-on-click="runBenchmark">🚀 Benchmark</button>
                    <button class="workflow-pilot-dev__btn" t-on-click="clear">Clear All</button>
                </div>

                <EditorCanvas
                    nodes="state.nodes"
                    connections="state.connections"
                    dimensionConfig="dimensionConfig"
                    onDropNode="onDropNode"
                    onSelectNode="onSelectNode"
                    removeNode.bind="removeNode"
                    removeConnection.bind="removeConnection"
                    onNodePositionChange="onNodePositionChange"
                    onConnectionCreate="onConnectionCreate"
                    onPasteNode="onPasteNode"
                    undo.bind="undo"
                    redo.bind="redo"
                    onBeginBatch.bind="onBeginBatch"
                    onEndBatch.bind="onEndBatch"
                    onNodeExecute="onNodeExecute"/>
            </div>
        </div>
    `;

    static components = { NodePalette, EditorCanvas };

    setup() {
        // Initialize adapter (Core layer)
        this.adapter = new WorkflowAdapter();

        // Register adapter with service for child components
        // This allows NodeConfigPanel to access adapter methods via useService
        this.adapterService = useService("workflowAdapter");
        this.adapterService.setAdapter(this.adapter);

        // Initialize history manager for undo/redo
        this.history = new HistoryManager();

        // UI state: Use adapter's reactive state directly
        // The adapter is now the single source of truth using a reactive Store
        this.state = useState(this.adapter.state);

        // Variable Inspector state - reactive view of $vars
        this.variableState = useState({
            vars: {},
        });

        // Local UI state
        this.uiState = useState({
            selectedNode: null,
        });

        // Dimension configuration (can be customized here)
        // Available options: nodeWidth, nodeHeaderHeight, nodeBodyPadding,
        //                    socketRadius, socketSpacing, socketOffsetY, gridSize
        this.dimensionConfig = {
            nodeWidth: 220,          // 90 (small), 180 (normal), 360 (large)
            nodeHeaderHeight: 34,
            nodeBodyPadding: 4,
            socketSpacing: 28,
            socketRadius: 5,
            socketOffsetY: 15,
            gridSize: 20,
        };

        // Load from localStorage
        this._loadFromStorage();

        // Auto-save on state changes
        onPatched(() => this._autoSave());

        this._offset = { x: 40, y: 40 };
        window.app = this; // For debugging
    }

    /**
     * Sync UI state from adapter
     */
    /**
     * Sync UI state - Deprecated/Removed
     * Adapter state is now used directly via useState
     */
    _syncState() {
        // No-op, kept briefly for compatibility if needed during strict refactor
    }

    // =========================================
    // LocalStorage Persistence
    // =========================================

    _loadFromStorage() {
        try {
            const data = localStorage.getItem(STORAGE_KEY);
            if (!data) return;

            const parsed = JSON.parse(data);

            // Check if it's new format (has version) or legacy
            if (parsed.version) {
                this.adapter.fromJSON(parsed);
            } else {
                // Legacy format - migrate
                this.adapter.fromLegacyFormat(parsed);
            }
        } catch (e) {
            console.warn('Failed to load workflow from localStorage:', e);
        }
    }

    saveToStorage = () => {
        try {
            const data = this.adapter.toJSON();
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
            console.log('Workflow saved to localStorage');
        } catch (e) {
            console.error('Failed to save workflow:', e);
        }
    };

    exportJSON = () => {
        const json = this.adapter.toJSON();
        console.log('Workflow JSON (for Python):');
        console.log(JSON.stringify(json, null, 2));

        // Copy to clipboard
        navigator.clipboard?.writeText(JSON.stringify(json, null, 2));
        alert('Workflow JSON copied to clipboard!');
    };

    _autoSave() {
        clearTimeout(this._saveTimeout);
        this._saveTimeout = setTimeout(() => this.saveToStorage(), 500);
    }

    // =========================================
    // Node Management
    // =========================================

    onAddNode = (type) => {
        const x = 80 + (this._offset.x % 240);
        const y = 80 + (this._offset.y % 240);
        this._offset.x += 30;
        this._offset.y += 30;

        return this._createNode(type, { x, y });
    };

    onDropNode = ({ type, position }) => {
        return this._createNode(type, position);
    };

    onSelectNode = (node) => {
        this.uiState.selectedNode = node;
    };

    onNodePositionChange = ({ nodeId, x, y }) => {
        // Validate parameters - skip if missing required fields
        if (!nodeId || typeof x !== 'number' || typeof y !== 'number') {
            return;
        }

        // Sync with Core layer - canvas is infinite, allow any position
        this.adapter.updatePosition(nodeId, { x, y });
    };

    onConnectionCreate = ({ source, sourceHandle, target, targetHandle }) => {
        const conn = this.adapter.addConnection(source, sourceHandle, target, targetHandle);
        if (conn) {
            // Record for undo
            this.history.push(createAddConnectionAction(this.adapter, conn));
        }
    };

    _createNode(type, position) {
        // addNode now returns nodeId (string) not node object
        const nodeId = this.adapter.addNode(type, position);
        if (!nodeId) return null;

        // Get config for undo recording
        const config = this.adapter.getNodeConfig(nodeId);
        this.history.push(createAddNodeAction(this.adapter, { id: nodeId, type, position, config }));

        // n8n-style Loop Auto-Creation Pattern
        if (type === 'loop') {
            const LOOP_OFFSET_Y = 160;
            const noopId = this.adapter.addNode('noop', {
                x: position.x + 80,
                y: position.y + LOOP_OFFSET_Y,
            });

            if (noopId) {
                // Record NoOp for undo
                const noopConfig = this.adapter.getNodeConfig(noopId);
                this.history.push(createAddNodeAction(this.adapter, {
                    id: noopId, type: 'noop',
                    position: { x: position.x + 80, y: position.y + LOOP_OFFSET_Y },
                    config: noopConfig
                }));

                // Loop.loop → NoOp.data
                const conn1 = this.adapter.addConnection(nodeId, 'loop', noopId, 'data');
                if (conn1) this.history.push(createAddConnectionAction(this.adapter, conn1));

                // NoOp.result → Loop.data (back-edge)
                const conn2 = this.adapter.addConnection(noopId, 'result', nodeId, 'data');
                if (conn2) this.history.push(createAddConnectionAction(this.adapter, conn2));
            }
        }

        return nodeId;
    }

    clear = () => {
        this.adapter.clear();
        this.uiState.selectedNode = null;
        this._offset = { x: 40, y: 40 };
        localStorage.removeItem(STORAGE_KEY);
        // this._syncState(); // Not needed with reactive store
    };

    /**
     * Run performance benchmark
     */
    runBenchmark = async () => {
        await runStressTest(this.adapter, 500);
        // Reactive store updates automatically
        console.log("Benchmark complete. Check console for metrics.");
    };

    // =========================================
    // Connection Management
    // =========================================

    removeNode(nodeId) {
        // Record for undo before removing - use adapter methods
        const config = this.adapter.getNodeConfig(nodeId);
        const uiNode = this.state.nodes.find(n => n.id === nodeId);
        if (uiNode) {
            const nodeData = {
                id: nodeId,
                type: uiNode.type,
                position: { x: uiNode.x, y: uiNode.y },
                config,
            };
            const relatedConnections = this.adapter.getConnectionsForUI().filter(
                c => c.source === nodeId || c.target === nodeId
            );
            this.history.push(createRemoveNodeAction(this.adapter, nodeData, relatedConnections));
        }

        this.adapter.removeNode(nodeId);

        if (this.uiState.selectedNode?.id === nodeId) {
            this.uiState.selectedNode = null;
        }
    }

    removeConnection(connId) {
        // Record for undo before removing
        const conn = this.adapter.getConnectionsForUI().find(c => c.id === connId);
        if (conn) {
            this.history.push(createRemoveConnectionAction(this.adapter, conn));
        }

        this.adapter.removeConnection(connId);
    }

    // =========================================
    // Paste Handler (for Ctrl+V from EditorCanvas)
    // =========================================

    onPasteNode = ({ type, position, config }) => {
        // addNode now returns nodeId (string)
        const nodeId = this.adapter.addNode(type, position);
        if (nodeId) {
            if (config) {
                this.adapter.setNodeConfig(nodeId, config);
            }
            // Record for undo
            this.history.push(createAddNodeAction(this.adapter, { id: nodeId, type, position, config }));
        }
        return nodeId;
    };

    // =========================================
    // Undo/Redo
    // =========================================

    undo() {
        console.log('[DevApp] undo called');
        if (this.history.undo()) {
            this._syncState();
        } else {
            console.log('[DevApp] nothing to undo');
        }
    }

    redo() {
        console.log('[DevApp] redo called');
        if (this.history.redo()) {
            this._syncState();
        } else {
            console.log('[DevApp] nothing to redo');
        }
    }

    onBeginBatch(description) {
        this.history.startBatch();
    }

    onEndBatch(description) {
        this.history.commitBatch(description);
    }

    // =========================================
    // Variable Inspector
    // =========================================

    /**
     * Format variable value for display
     */
    formatVarValue(value) {
        if (value === null) return 'null';
        if (value === undefined) return 'undefined';
        if (typeof value === 'object') {
            try {
                const str = JSON.stringify(value);
                return str.length > 50 ? str.slice(0, 47) + '...' : str;
            } catch {
                return '[Object]';
            }
        }
        return String(value);
    }

    /**
     * Update variable inspector from execution context
     */
    updateVariableInspector(context) {
        if (context && context.$vars) {
            this.variableState.vars = { ...context.$vars };
        } else {
            this.variableState.vars = {};
        }
    }

    /**
     * Clear all variables
     */
    clearVariables = () => {
        this.variableState.vars = {};
        // Also clear in adapter if context exists
        if (this.adapterService.clearContext) {
            this.adapterService.clearContext();
        }
    };

    /**
     * Handle node execution - refresh variable inspector
     */
    onNodeExecute = (nodeId, result) => {
        console.log('[DevApp] Node executed:', nodeId, result);
        
        // Refresh variable inspector from current context
        const context = this.adapterService.getExpressionContext?.() || {};
        this.variableState.vars = { ...(context.$vars || {}) };
    };
}
