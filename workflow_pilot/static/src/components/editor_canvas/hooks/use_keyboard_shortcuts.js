/** @odoo-module **/

import { useExternalListener } from "@odoo/owl";

/**
 * useKeyboardShortcuts Hook
 *
 * Handles global keyboard shortcuts for the editor:
 * - Delete/Backspace: Remove selected nodes/connections
 * - Arrow Keys: Move selected nodes
 * - Ctrl+Z/Y: Undo/Redo
 * - Ctrl+A: Select All
 * 
 * Note: Copy/Paste is handled separately (see EditorCanvas or useClipboard)
 *
 * @param {Object} options
 * @param {Object} options.editor - workflowEditor service
 * @param {Function} options.getNodes - () => nodes array
 * @param {Function} [options.getReadonly] - () => boolean - runtime readonly
 */
export function useKeyboardShortcuts({ editor, getNodes, getReadonly }) {

    function isReadonlyActive() {
        return getReadonly ? !!getReadonly() : false;
    }

    function handleKeyDown(ev) {
        if (isReadonlyActive()) return;
        // Skip if typing in an input/textarea
        const targetTag = ev.target.tagName;
        if (targetTag === 'INPUT' || targetTag === 'TEXTAREA' || ev.target.isContentEditable) {
            return;
        }

        const keys = {
            delete: ev.key === 'Delete' || ev.key === 'Backspace',
            undo: (ev.ctrlKey || ev.metaKey) && !ev.shiftKey && ev.key.toLowerCase() === 'z',
            redo: (ev.ctrlKey || ev.metaKey) && (ev.key.toLowerCase() === 'y' || (ev.shiftKey && ev.key.toLowerCase() === 'z')),
            selectAll: (ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'a',
        };

        // 1. Delete
        if (keys.delete) {
            const { nodeIds, connectionIds } = editor.state.ui.selection;
            if (nodeIds.length > 0) {
                // Batch removal for nodes
                editor.actions.beginBatch();
                nodeIds.forEach(id => editor.actions.removeNode(id));
                editor.actions.endBatch("Delete nodes");
                editor.actions.select([], connectionIds); // Clear node selection
            }
            if (connectionIds.length > 0) {
                // Batch removal for connections (though history usually batches single actions unless explicit)
                // If we delete multiple connections, batching is good.
                if (connectionIds.length > 1) editor.actions.beginBatch();
                connectionIds.forEach(id => editor.actions.removeConnection(id));
                if (connectionIds.length > 1) editor.actions.endBatch("Delete connections");
                editor.actions.select(editor.state.ui.selection.nodeIds, []); // Clear conn selection
            }
            return;
        }

        // 2. Undo/Redo
        if (keys.undo) {
            ev.preventDefault();
            editor.actions.undo();
            return;
        }
        if (keys.redo) {
            ev.preventDefault();
            editor.actions.redo();
            return;
        }

        // 3. Select All
        if (keys.selectAll) {
            ev.preventDefault();
            const allNodeIds = getNodes().map(n => n.id);
            editor.actions.select(allNodeIds, []);
            return;
        }

        // 4. Arrow Navigation (Move Nodes)
        const arrowMoves = {
            'ArrowUp': { x: 0, y: -1 },
            'ArrowDown': { x: 0, y: 1 },
            'ArrowLeft': { x: -1, y: 0 },
            'ArrowRight': { x: 1, y: 0 },
        };

        if (arrowMoves[ev.key]) {
            ev.preventDefault();
            const { x, y } = arrowMoves[ev.key];
            const step = ev.shiftKey ? 50 : 20;
            const dx = x * step;
            const dy = y * step;

            const selectedNodeIds = editor.state.ui.selection.nodeIds;
            if (selectedNodeIds.length > 0) {
                editor.actions.beginBatch();
                const nodes = getNodes();
                selectedNodeIds.forEach(id => {
                    const node = nodes.find(n => n.id === id);
                    if (node) {
                        editor.actions.moveNode(id, {
                            x: node.x + dx,
                            y: node.y + dy
                        });
                    }
                });
                editor.actions.endBatch("Move nodes (keyboard)");
            }
        }
    }

    useExternalListener(window, "keydown", handleKeyDown);
}
