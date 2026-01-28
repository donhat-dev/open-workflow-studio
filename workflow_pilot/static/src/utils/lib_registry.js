/** @odoo-module **/

import { registry } from "@web/core/registry";

const libRegistry = registry.category("workflow_libs");

export function getLib(libName) {
    if (!libRegistry.contains(libName)) {
        console.warn(`[WorkflowLib] Library "${libName}" not registered`);
        return null;
    }

    const lib = libRegistry.get(libName);
    const instance = lib.get();

    if (!instance) {
        console.warn(`[WorkflowLib] Library "${libName}" registered but not loaded (window.${lib.globalName} is undefined)`);
    }

    return instance;
}

export function hasLib(libName) {
    if (!libRegistry.contains(libName)) {
        return false;
    }
    return !!getLib(libName);
}

export function getLibDefinition(libName) {
    if (!libRegistry.contains(libName)) {
        return null;
    }
    return libRegistry.get(libName);
}

export function getRegisteredLibs() {
    return libRegistry.getEntries().map(([key]) => key);
}
