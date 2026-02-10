/** @odoo-module **/

import { useHotkey } from "@web/core/hotkeys/hotkey_hook";

/**
 * Hook to manage Copy/Paste operations via System Clipboard.
 *
 * Uses Odoo-native `useHotkey` with `area` scoping so hotkeys only fire
 * when the canvas root element (or a descendant) is focused. This avoids
 * the anti-pattern of raw `window` keydown listeners that block native
 * browser copy/paste in text inputs, the NodeConfigPanel, etc.
 *
 * @param {Object} params
 * @param {Object} params.editor - Editor service instance (for actions)
 * @param {Function} params.getNodes - Getter for current nodes
 * @param {Function} params.getConnections - Getter for current connections
 * @param {Function} params.getSelection - Getter for current selection { nodeIds: [] }
 * @param {Function} [params.getReadonly] - () => boolean - runtime readonly
 * @param {Function} params.getRootEl - () => HTMLElement - canvas root for area scoping
 */
export function useClipboard({ editor, getNodes, getConnections, getSelection, getReadonly, getRootEl }) {

    function isReadonlyActive() {
        return getReadonly ? !!getReadonly() : false;
    }

    async function copySelectedNodes() {
        if (isReadonlyActive()) return;
        // Prioritize multiple selection list
        const selection = getSelection();
        const selectedNodeIds = selection.nodeIds || [];

        if (selectedNodeIds.length === 0) return;

        const nodes = getNodes();
        const connections = getConnections();

        const nodesToCopy = nodes.filter(n => selectedNodeIds.includes(n.id));
        const connectionsToCopy = connections.filter(
            c => selectedNodeIds.includes(c.source) && selectedNodeIds.includes(c.target)
        );

        if (!editor || !editor.getNodeConfig) {
            throw new Error('[EditorClipboard] workflowEditor adapter is required but not available');
        }

        const data = {
            nodes: nodesToCopy.map(n => ({
                id: n.id,  // Include for connection mapping
                type: n.type,
                x: n.x,
                y: n.y,
                title: n.title,
                // Get config via adapter service
                config: editor.getNodeConfig(n.id) || {},
            })),
            connections: connectionsToCopy,
        };

        try {
            await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
            console.log(`[EditorClipboard] Copied ${data.nodes.length} nodes to clipboard`);
        } catch (e) {
            console.error('[EditorClipboard] Failed to copy to clipboard:', e);
        }
    }

    async function pasteNodes() {
        if (isReadonlyActive()) return;
        try {
            const text = await navigator.clipboard.readText();
            const data = JSON.parse(text);

            if (!data.nodes || !Array.isArray(data.nodes)) {
                return;
            }

            // Start history batch via service
            editor.actions.beginBatch();

            const PASTE_OFFSET_X = 50;
            const PASTE_OFFSET_Y = 50;
            const idMap = {};
            if (!editor || !editor.setNodeConfig) {
                throw new Error('[EditorClipboard] workflowEditor adapter is required but not available');
            }

            // Create new nodes with offset
            data.nodes.forEach(nodeData => {
                const position = {
                    x: (nodeData.x || 0) + PASTE_OFFSET_X,
                    y: (nodeData.y || 0) + PASTE_OFFSET_Y,
                };
                const newId = editor.actions.addNode(nodeData.type, position);
                if (newId) {
                    idMap[nodeData.id] = newId;
                    // Apply config if available
                    if (nodeData.config) {
                        editor.setNodeConfig(newId, nodeData.config);
                    }
                }
            });

            // Recreate connections between pasted nodes
            (data.connections || []).forEach(conn => {
                if (idMap[conn.source] && idMap[conn.target]) {
                    editor.actions.addConnection(
                        idMap[conn.source],
                        conn.sourceHandle,
                        idMap[conn.target],
                        conn.targetHandle
                    );
                }
            });

            // End history batch
            editor.actions.endBatch('Paste nodes');
        } catch (e) {
            editor.actions.endBatch(); // Ensure batch ends even on error
            console.warn('[EditorClipboard] Failed to paste:', e);
        }
    }

    // ========================================
    // SCOPED HOTKEYS (area = canvas root)
    // ========================================
    // Copy (Ctrl+C) - scoped to canvas, won't intercept text inputs
    useHotkey("control+c", () => copySelectedNodes(), {
        bypassEditableProtection: false,
        area: getRootEl,
    });

    // Paste (Ctrl+V) - scoped to canvas, won't intercept text inputs
    useHotkey("control+v", () => pasteNodes(), {
        bypassEditableProtection: false,
        area: getRootEl,
    });

    return {
        copySelectedNodes,
        pasteNodes
    };
}
