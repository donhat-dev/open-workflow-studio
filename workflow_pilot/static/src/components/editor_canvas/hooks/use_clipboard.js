/** @odoo-module **/

import { useEnv, useExternalListener } from "@odoo/owl";

/**
 * Hook to manage Copy/Paste operations via System Clipboard
 * 
 * @param {Object} params
 * @param {Object} params.editor - Editor service instance (for actions)
 * @param {Function} params.getNodes - Getter for current nodes
 * @param {Function} params.getConnections - Getter for current connections
 * @param {Function} params.getSelection - Getter for current selection { nodeIds: [] }
 */
export function useClipboard({ editor, getNodes, getConnections, getSelection }) {
    const env = useEnv();

    async function copySelectedNodes() {
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

    /**
     * Handle keydown events
     * @param {KeyboardEvent} ev 
     */
    function onKeyDown(ev) {
        // Skip if in input field
        if (ev.target.tagName === 'INPUT' || ev.target.tagName === 'TEXTAREA' || ev.target.isContentEditable) {
            return;
        }
        // If input is not likely in canvas, we should skip them
        if (!ev.target.classList.contains('o_web_client')){
            return;
        }

        const ctrl = ev.ctrlKey || ev.metaKey;
        const key = ev.key.toLowerCase();

        // Copy
        if (ctrl && key === 'c') {
            ev.preventDefault();
            copySelectedNodes();
            return;
        }

        // Paste
        if (ctrl && key === 'v') {
            ev.preventDefault();
            pasteNodes();
            return;
        }
    }

    useExternalListener(window, "keydown", onKeyDown);

    return {
        copySelectedNodes,
        pasteNodes
    };
}
