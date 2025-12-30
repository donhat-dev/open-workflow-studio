/** @odoo-module **/

/**
 * Node Index - Re-exports and backward compatibility
 * 
 * This file provides:
 * 1. Re-exports of all node classes for direct import
 * 2. Legacy NodeRegistry object for backward compatibility
 * 
 * Note: Nodes now self-register to Odoo registry in their own files.
 * The registry is the source of truth; this file is for compatibility.
 */

// Re-export node classes (they self-register when imported)
export { HttpRequestNode } from './http_request';
export { LoopNode, IfNode, CodeNode, NoOpNode } from './flow_nodes';
export { DataValidationNode, DataMappingNode } from './data_nodes';

// Import for building legacy object
import { HttpRequestNode } from './http_request';
import { LoopNode, IfNode, CodeNode, NoOpNode } from './flow_nodes';
import { DataValidationNode, DataMappingNode } from './data_nodes';

/**
 * @deprecated Use workflowNode service or import directly from node files
 * Legacy NodeRegistry for backward compatibility during migration
 */
// export const NodeRegistry = {
//     [HttpRequestNode.nodeType]: HttpRequestNode,
//     [LoopNode.nodeType]: LoopNode,
//     [IfNode.nodeType]: IfNode,
//     [CodeNode.nodeType]: CodeNode,
//     [NoOpNode.nodeType]: NoOpNode,
//     [DataValidationNode.nodeType]: DataValidationNode,
//     [DataMappingNode.nodeType]: DataMappingNode,
// };

// // Convenience array of all node classes
// export const NodeClasses = [
//     HttpRequestNode,
//     LoopNode,
//     IfNode,
//     CodeNode,
//     NoOpNode,
//     DataValidationNode,
//     DataMappingNode,
// ];
