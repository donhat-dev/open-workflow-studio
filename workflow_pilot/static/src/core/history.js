/** @odoo-module **/

/**
 * HistoryManager - Undo/Redo functionality using Command pattern
 * 
 * Uses simple action objects instead of class hierarchy for simplicity.
 */
export class HistoryManager {
    constructor(options = {}) {
        this.undoStack = [];
        this.redoStack = [];
        this.maxSize = options.maxSize || 50;
        this._recording = true;
        this._callbacks = [];
        this._currentBatch = null;
    }

    /**
     * Start a new batch of actions that will be treated as one in history
     */
    startBatch() {
        this._currentBatch = [];
    }

    /**
     * Commit the current batch as a single action
     * @param {string} description 
     */
    commitBatch(description) {
        if (!this._currentBatch || this._currentBatch.length === 0) {
            this._currentBatch = null;
            return;
        }
        const batch = this._currentBatch;
        this._currentBatch = null;

        this.push({
            description,
            undo: () => {
                // Undo in reverse order
                for (let i = batch.length - 1; i >= 0; i--) {
                    batch[i].undo();
                }
            },
            redo: () => {
                // Redo in original order
                for (let i = 0; i < batch.length; i++) {
                    batch[i].redo();
                }
            }
        });
    }

    /**
     * Subscribe to history changes
     */
    onChange(callback) {
        this._callbacks.push(callback);
        return () => {
            this._callbacks = this._callbacks.filter(cb => cb !== callback);
        };
    }

    _notify() {
        this._callbacks.forEach(cb => cb({
            canUndo: this.undoStack.length > 0,
            canRedo: this.redoStack.length > 0,
        }));
    }

    /**
     * Push an action to history
     * @param {Object} action - { undo: Function, redo: Function, description?: string }
     */
    push(action) {
        if (!this._recording) return;

        // If batching is active, collect into current batch instead of stacks
        if (this._currentBatch) {
            this._currentBatch.push(action);
            return;
        }

        this.undoStack.push({
            ...action,
            timestamp: Date.now(),
        });
        this.redoStack = [];  // Clear redo on new action

        // Limit stack size
        if (this.undoStack.length > this.maxSize) {
            this.undoStack.shift();
        }

        this._notify();
    }

    /**
     * Undo last action
     */
    undo() {
        const action = this.undoStack.pop();
        if (!action) return false;

        this._recording = false;
        try {
            action.undo();
        } finally {
            this._recording = true;
        }

        this.redoStack.push(action);
        this._notify();
        console.log('[History] Undo:', action.description || 'action');
        return true;
    }

    /**
     * Redo last undone action
     */
    redo() {
        const action = this.redoStack.pop();
        if (!action) return false;

        this._recording = false;
        try {
            action.redo();
        } finally {
            this._recording = true;
        }

        this.undoStack.push(action);
        this._notify();
        console.log('[History] Redo:', action.description || 'action');
        return true;
    }

    /**
     * Clear all history
     */
    clear() {
        this.undoStack = [];
        this.redoStack = [];
        this._notify();
    }

    /**
     * Check if undo is available
     */
    canUndo() {
        return this.undoStack.length > 0;
    }

    /**
     * Check if redo is available
     */
    canRedo() {
        return this.redoStack.length > 0;
    }

    /**
     * Pause recording (for batch operations)
     */
    pause() {
        this._recording = false;
    }

    /**
     * Resume recording
     */
    resume() {
        this._recording = true;
    }
}

// ============================================
// COMMAND FACTORY FUNCTIONS
// ============================================

/**
 * Create an action for adding a node
 */
export function createAddNodeAction(adapter, nodeData) {
    return {
        description: `Add ${nodeData.type} node`,
        undo: () => adapter.removeNode(nodeData.id),
        redo: () => {
            adapter.addNodeWithId(nodeData.type, nodeData.position, nodeData.id, nodeData.config);
        },
    };
}

/**
 * Create an action for removing a node
 */
export function createRemoveNodeAction(adapter, nodeData, relatedConnections) {
    return {
        description: `Remove ${nodeData.type} node`,
        undo: () => {
            adapter.addNodeWithId(nodeData.type, nodeData.position, nodeData.id, nodeData.config);
            // Restore connections
            relatedConnections.forEach(c => {
                adapter.addConnection(c.source, c.sourceHandle, c.target, c.targetHandle);
            });
        },
        redo: () => adapter.removeNode(nodeData.id),
    };
}

/**
 * Create an action for moving a node
 */
export function createMoveNodeAction(adapter, nodeId, oldPosition, newPosition) {
    return {
        description: `Move node`,
        undo: () => adapter.updatePosition(nodeId, oldPosition),
        redo: () => adapter.updatePosition(nodeId, newPosition),
    };
}

/**
 * Create an action for moving multiple nodes in one command
 * @param {WorkflowAdapter} adapter
 * @param {Array<{nodeId:string, oldPosition:{x:number,y:number}, newPosition:{x:number,y:number}}>} nodeMoves
 */
export function createMoveNodesAction(adapter, nodeMoves) {
    return {
        description: `Move nodes`,
        undo: () => {
            for (let i = 0; i < nodeMoves.length; i++) {
                const move = nodeMoves[i];
                adapter.updatePosition(move.nodeId, move.oldPosition);
            }
        },
        redo: () => {
            for (let i = 0; i < nodeMoves.length; i++) {
                const move = nodeMoves[i];
                adapter.updatePosition(move.nodeId, move.newPosition);
            }
        },
    };
}

/**
 * Create an action for adding a connection
 */
export function createAddConnectionAction(adapter, connectionData) {
    return {
        description: `Add connection`,
        undo: () => adapter.removeConnection(connectionData.id),
        redo: () => adapter.addConnection(
            connectionData.source,
            connectionData.sourceHandle,
            connectionData.target,
            connectionData.targetHandle
        ),
    };
}

/**
 * Create an action for removing a connection
 */
export function createRemoveConnectionAction(adapter, connectionData) {
    return {
        description: `Remove connection`,
        undo: () => adapter.addConnection(
            connectionData.source,
            connectionData.sourceHandle,
            connectionData.target,
            connectionData.targetHandle
        ),
        redo: () => adapter.removeConnection(connectionData.id),
    };
}
