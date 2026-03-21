/** @odoo-module **/

import { ConfirmationDialog } from "@web/core/confirmation_dialog/confirmation_dialog";
import { getStructuralConnections } from "@workflow_studio/utils/graph_utils";
import { NodeConfigPanel } from "./node_config_panel";

function getNodeDisplayName(node) {
    if (!node) {
        return "Unknown node";
    }
    return node.title || node.label || node.type || `Node ${node.id}`;
}

function getSocketLabel(connection) {
    const sourceHandle = connection.sourceHandle || connection.source_socket || connection.sourceSocket || "";
    const targetHandle = connection.targetHandle || connection.target_socket || connection.targetSocket || "";
    if (sourceHandle && targetHandle) {
        return `${sourceHandle} → ${targetHandle}`;
    }
    return sourceHandle || targetHandle || "";
}

export class ConfigPanelDialog extends ConfirmationDialog {
    static template = "workflow_studio.ConfigPanelDialog";
    static components = {
        ...ConfirmationDialog.components,
        NodeConfigPanel,
    };
    static props = {
        ...ConfirmationDialog.props,
        body: { optional: true },
        node: { type: Object },
        workflow: { type: Object, optional: true },
        actions: { type: Object },
        execution: { type: Object, optional: true },
        viewMode: { type: String, optional: true },
        onSave: { type: Function, optional: true },
    };

    get previousNavigation() {
        return this._getNavigationModel("previous");
    }

    get nextNavigation() {
        return this._getNavigationModel("next");
    }

    _getNavigationModel(direction) {
        const options = this._getNavigationOptions(direction);
        const heading = direction === "next" ? "Next" : "Previous";
        const hasMultiple = options.length > 1;
        const primary = options.length === 1 ? options[0] : null;

        return {
            heading,
            hasMultiple,
            hasOptions: options.length > 0,
            primary,
            options,
            summaryTitle: primary
                ? primary.title
                : hasMultiple
                    ? `Choose ${heading.toLowerCase()} node`
                    : `No ${heading.toLowerCase()} node`,
            summaryMeta: primary
                ? primary.socketLabel
                : hasMultiple
                    ? `${options.length} direct connections`
                    : direction === "next"
                        ? "This node has no outgoing connections"
                        : "This node has no incoming connections",
        };
    }

    _getNavigationOptions(direction) {
        const workflow = this.props.workflow;
        const currentNode = this.props.node;
        if (!workflow || !currentNode) {
            return [];
        }

        const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
        const nodeMap = new Map(nodes.map((node) => [String(node.id), node]));
        const structuralConnections = getStructuralConnections(workflow.connections || []);
        const currentNodeId = String(currentNode.id);
        const relevantConnections = structuralConnections.filter((connection) => {
            return direction === "next"
                ? String(connection.source) === currentNodeId
                : String(connection.target) === currentNodeId;
        });

        return relevantConnections
            .map((connection) => {
                const neighborId = String(direction === "next" ? connection.target : connection.source);
                const neighbor = nodeMap.get(neighborId);
                if (!neighbor) {
                    return null;
                }
                return {
                    key: connection.id || `${direction}:${neighborId}:${getSocketLabel(connection)}`,
                    nodeId: neighbor.id,
                    title: getNodeDisplayName(neighbor),
                    socketLabel: getSocketLabel(connection),
                };
            })
            .filter(Boolean)
            .sort((left, right) => {
                const titleCompare = left.title.localeCompare(right.title);
                if (titleCompare !== 0) {
                    return titleCompare;
                }
                return (left.socketLabel || "").localeCompare(right.socketLabel || "");
            });
    }

    onNavigateToNode(nodeId) {
        if (!nodeId || !this.props.actions || !this.props.actions.openNodeConfig) {
            return;
        }
        this.props.actions.openNodeConfig(nodeId);
    }
}
