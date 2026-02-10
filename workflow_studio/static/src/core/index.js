/** @odoo-module **/

/**
 * Core Module - Workflow Pilot Library
 * 
 * This module exports all core classes for building workflow editors.
 * Inspired by Rete.js architecture with OWL-compatible design.
 * 
 * Usage:
 *   import { WorkflowEditor, BaseNode, DataSocket } from './core';
 */

// Socket types
export {
    Socket,
    DataSocket,
    ErrorSocket,
    TriggerSocket,
    SocketRegistry
} from './socket';

// Control types
export {
    Control,
    TextInputControl,
    SelectControl,
    KeyValueControl,
    NumberControl,
    CheckboxControl,
    ControlRegistry
} from './control';

// Node base class
export { BaseNode } from './node';

// Connection class
export { Connection } from './connection';

// Editor (state manager)
export { WorkflowEditor } from './editor';

// Adapter (UI bridge)
export { WorkflowAdapter } from './adapter';

// History (undo/redo)
export {
    HistoryManager,
    createAddNodeAction,
    createRemoveNodeAction,
    createMoveNodeAction,
    createAddConnectionAction,
    createRemoveConnectionAction,
} from './history';
