/** @odoo-module **/

import { useCommand } from "@web/core/commands/command_hook";
import { useHotkey } from "@web/core/hotkeys/hotkey_hook";

/**
 * useWorkflowCommands Hook
 *
 * Replaces the old useKeyboardShortcuts hook with Odoo-native command/hotkey integration.
 *
 * Pattern follows PdfManager (documents module):
 * - useCommand: discoverable actions in Ctrl+K palette (Save, Run, Undo, Redo, Select All)
 * - useHotkey: navigation/continuous keys (Delete, Arrow keys) scoped to canvas area
 *
 * Scoping:
 * - EditorCanvas uses tabindex="0" on root element for focus.
 * - useHotkey `area` option restricts hotkeys to fire only when canvas is focused.
 * - Odoo's hotkey service auto-suppresses hotkeys when dialogs/overlays are active.
 *
 * @param {Object} options
 * @param {Object} options.editor - workflowEditor service
 * @param {Function} options.getNodes - () => nodes array
 * @param {Function} [options.getReadonly] - () => boolean - runtime readonly check
 * @param {Function} [options.onSave] - () => void - save handler (triggers bus event)
 * @param {Function} [options.onRun] - () => void - run/execute handler (triggers bus event)
 * @param {Function} options.getRootEl - () => HTMLElement - canvas root element for area scoping
 */
export function useWorkflowCommands({ editor, getNodes, getReadonly, onSave, onRun, getRootEl }) {

    function isReadonlyActive() {
        return getReadonly ? !!getReadonly() : false;
    }

    // ========================================
    // DISCOVERABLE COMMANDS (Ctrl+K palette)
    // ========================================

    // Save (Ctrl+S)
    if (onSave) {
        useCommand("Save Workflow", () => {
            if (isReadonlyActive()) return;
            onSave();
        }, {
            hotkey: "control+s",
            category: "Workflow",
        });
    }

    // Run/Execute (Ctrl+Enter)
    if (onRun) {
        useCommand("Execute Workflow", () => {
            if (isReadonlyActive()) return;
            onRun();
        }, {
            hotkey: "control+enter",
            category: "Workflow",
        });
    }

    // Undo (Ctrl+Z)
    useCommand("Undo", () => {
        if (isReadonlyActive()) return;
        editor.actions.undo();
    }, {
        hotkey: "control+z",
        category: "Workflow",
    });

    // Redo (Ctrl+Shift+Z or Ctrl+Y)
    useCommand("Redo", () => {
        if (isReadonlyActive()) return;
        editor.actions.redo();
    }, {
        hotkey: "control+shift+z",
        category: "Workflow",
    });

    // Redo alternative (Ctrl+Y) - not shown in palette, just a binding
    useHotkey("control+y", () => {
        if (isReadonlyActive()) return;
        editor.actions.redo();
    });

    // Select All (Ctrl+A)
    useCommand("Select All Nodes", () => {
        if (isReadonlyActive()) return;
        const allNodeIds = getNodes().map(n => n.id);
        editor.actions.select(allNodeIds, []);
    }, {
        hotkey: "control+a",
        category: "Workflow",
    });

    // ========================================
    // SCOPED HOTKEYS (navigation / continuous)
    // ========================================

    // Delete/Backspace - remove selected nodes/connections
    useHotkey("delete", () => {
        if (isReadonlyActive()) return;
        _deleteSelection();
    }, {
        bypassEditableProtection: false,
        area: getRootEl,
    });

    useHotkey("backspace", () => {
        if (isReadonlyActive()) return;
        _deleteSelection();
    }, {
        bypassEditableProtection: false,
        area: getRootEl,
    });

    // Arrow Keys - move selected nodes (with allowRepeat for held keys)
    useHotkey("arrowup", () => {
        if (isReadonlyActive()) return;
        _moveSelection(0, -1, false);
    }, {
        allowRepeat: true,
        bypassEditableProtection: false,
        area: getRootEl,
    });

    useHotkey("arrowdown", () => {
        if (isReadonlyActive()) return;
        _moveSelection(0, 1, false);
    }, {
        allowRepeat: true,
        bypassEditableProtection: false,
        area: getRootEl,
    });

    useHotkey("arrowleft", () => {
        if (isReadonlyActive()) return;
        _moveSelection(-1, 0, false);
    }, {
        allowRepeat: true,
        bypassEditableProtection: false,
        area: getRootEl,
    });

    useHotkey("arrowright", () => {
        if (isReadonlyActive()) return;
        _moveSelection(1, 0, false);
    }, {
        allowRepeat: true,
        bypassEditableProtection: false,
        area: getRootEl,
    });

    // Shift+Arrow Keys - move with larger step (50px)
    useHotkey("shift+arrowup", () => {
        if (isReadonlyActive()) return;
        _moveSelection(0, -1, true);
    }, {
        allowRepeat: true,
        bypassEditableProtection: false,
        area: getRootEl,
    });

    useHotkey("shift+arrowdown", () => {
        if (isReadonlyActive()) return;
        _moveSelection(0, 1, true);
    }, {
        allowRepeat: true,
        bypassEditableProtection: false,
        area: getRootEl,
    });

    useHotkey("shift+arrowleft", () => {
        if (isReadonlyActive()) return;
        _moveSelection(-1, 0, true);
    }, {
        allowRepeat: true,
        bypassEditableProtection: false,
        area: getRootEl,
    });

    useHotkey("shift+arrowright", () => {
        if (isReadonlyActive()) return;
        _moveSelection(1, 0, true);
    }, {
        allowRepeat: true,
        bypassEditableProtection: false,
        area: getRootEl,
    });

    // ========================================
    // INTERNAL HELPERS
    // ========================================

    /**
     * Delete selected nodes and connections
     */
    function _deleteSelection() {
        const { nodeIds, connectionIds } = editor.state.ui.selection;

        if (nodeIds.length > 0) {
            editor.actions.beginBatch();
            nodeIds.forEach(id => editor.actions.removeNode(id));
            editor.actions.endBatch("Delete nodes");
            editor.actions.select([], connectionIds);
        }

        if (connectionIds.length > 0) {
            if (connectionIds.length > 1) editor.actions.beginBatch();
            connectionIds.forEach(id => editor.actions.removeConnection(id));
            if (connectionIds.length > 1) editor.actions.endBatch("Delete connections");
            editor.actions.select(editor.state.ui.selection.nodeIds, []);
        }
    }

    /**
     * Move selected nodes by direction * step
     * @param {number} dx - direction X (-1, 0, 1)
     * @param {number} dy - direction Y (-1, 0, 1)
     * @param {boolean} large - use larger step (Shift held)
     */
    function _moveSelection(dx, dy, large = false) {
        const selectedNodeIds = editor.state.ui.selection.nodeIds;
        if (selectedNodeIds.length === 0) return;

        const step = large ? 50 : 20;
        const moveX = dx * step;
        const moveY = dy * step;

        editor.actions.beginBatch();
        const nodes = getNodes();
        selectedNodeIds.forEach(id => {
            const node = nodes.find(n => n.id === id);
            if (node) {
                editor.actions.moveNode(id, {
                    x: node.x + moveX,
                    y: node.y + moveY,
                });
            }
        });
        editor.actions.endBatch("Move nodes (keyboard)");
    }
}
