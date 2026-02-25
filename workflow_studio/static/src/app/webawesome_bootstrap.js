/** @odoo-module **/

import { loadWebAwesome } from "@workflow_studio/utils/webawesome_loader";

const ENABLE_WEBAWESOME_POC = false;

export async function bootstrapWebAwesomeForPoc() {
    if (!ENABLE_WEBAWESOME_POC) {
        return null;
    }

    return loadWebAwesome({
        loadTheme: true,
        loadUtilities: false,
    });
}
