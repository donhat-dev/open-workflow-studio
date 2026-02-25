/** @odoo-module **/

const WEBAWESOME_VERSION = "3.2.1";
const WEBAWESOME_BASE_PATH = `/workflow_studio/static/lib/webawesome/${WEBAWESOME_VERSION}`;
const WEBAWESOME_LOADER_URL = `${WEBAWESOME_BASE_PATH}/webawesome.loader.js`;
const WEBAWESOME_THEME_URL = `${WEBAWESOME_BASE_PATH}/styles/themes/awesome.css`;
const WEBAWESOME_UTILITIES_URL = `${WEBAWESOME_BASE_PATH}/styles/utilities.css`;

let webAwesomeLoadPromise = null;

function ensureStylesheet(url, id) {
    const existing = document.getElementById(id);
    if (existing) {
        return existing;
    }

    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = url;
    document.head.appendChild(link);
    return link;
}

function withDefaults(options) {
    const safeOptions = options || {};
    return {
        loadTheme: safeOptions.loadTheme !== false,
        loadUtilities: safeOptions.loadUtilities === true,
    };
}

export function getWebAwesomeConfig() {
    return {
        version: WEBAWESOME_VERSION,
        basePath: WEBAWESOME_BASE_PATH,
        loaderUrl: WEBAWESOME_LOADER_URL,
        themeUrl: WEBAWESOME_THEME_URL,
        utilitiesUrl: WEBAWESOME_UTILITIES_URL,
    };
}

export async function loadWebAwesome(options) {
    if (webAwesomeLoadPromise) {
        return webAwesomeLoadPromise;
    }

    const finalOptions = withDefaults(options);

    webAwesomeLoadPromise = (async () => {
        if (finalOptions.loadTheme) {
            ensureStylesheet(WEBAWESOME_THEME_URL, "workflow-studio-webawesome-theme");
        }
        if (finalOptions.loadUtilities) {
            ensureStylesheet(WEBAWESOME_UTILITIES_URL, "workflow-studio-webawesome-utilities");
        }

        const webAwesomeModule = await import(WEBAWESOME_LOADER_URL);
        if (webAwesomeModule && typeof webAwesomeModule.setBasePath === "function") {
            webAwesomeModule.setBasePath(WEBAWESOME_BASE_PATH);
        }
        return webAwesomeModule;
    })();

    return webAwesomeLoadPromise;
}

if (!window.workflowStudioDebug) {
    window.workflowStudioDebug = {};
}
window.workflowStudioDebug.loadWebAwesome = loadWebAwesome;
window.workflowStudioDebug.webAwesomeConfig = getWebAwesomeConfig();
