/** @odoo-module **/

/**
 * Global debug bridge for Odoo WOWL ORM (docstring-style overview)
 * ================================================================
 *
 * Why this file exists
 * --------------------
 * In Odoo backend debug mode, the WOWL root component can expose services
 * through `window.odoo.__WOWL_DEBUG__.root`. This module wraps that access and
 * provides a Python-like developer experience in browser console:
 *
 *     env['res.partner'].search([...])
 *
 * which is translated into:
 *
 *     orm.call('res.partner', 'search', [...], kwargs)
 *
 *
 * High-level flow
 * ---------------------------------------------------------------
 *
 *     GlobalDebugBridge (class)
 *         constructor
 *             -> create Map cache for model proxies
 *             -> create env Proxy
 *             -> create self Proxy
 *
 *     window.model getter
 *         -> returns bridge.proxy (self Proxy)
 *             -> unknown prop read => interpreted as model name
 *             -> returns model Proxy
 *                 -> unknown prop read => interpreted as method name
 *                 -> returns function(...args)
 *                     -> parse args/kwargs wrapper
 *                     -> bridge._call(model, method, args, kwargs)
 *                     -> orm.call(model, method, args, kwargs)
 *
 *     window.env getter
 *         -> returns bridge.env Proxy
 *             -> env['res.partner'] => model Proxy (same behavior as above)
 *             -> env.call(...) and env.kwargs(...) also available
 *
 *
 * -------------------------------------------
 *
 * 1) class GlobalDebugBridge
 *    - Equivalent mindset: a small service object that encapsulates state and
 *      behavior, like a Python helper class.
 *    - Keeps internals private-by-convention (`_name`) and exposes behavior via
 *      methods/getters.
 *
 * 2) Getter/Setter (`get orm()` / `set orm(value)`)
 *    - Similar to Python `@property` and setter.
 *    - Getter dynamically resolves ORM from WOWL debug root, with fallback to
 *      a manual global slot (`window.__LF_GLOBAL_DEBUG_ORM__`).
 *
 * 3) Proxy
 *    - Closest analogy: Python `__getattr__` / dynamic attribute interception.
 *    - We intercept property reads to convert free-form chained syntax into ORM
 *      RPC calls.
 *    - Example:
 *          env['res.partner'].search(domain)
 *      becomes:
 *          _call('res.partner', 'search', [domain], {})
 *
 * 4) Reflect
 *    - `Reflect.has(...)` / `Reflect.get(...)` behave like safe/intention-revealing
 *      built-ins for object introspection/access.
 *    - Used here to preserve native behavior for real class members, and only
 *      treat unknown keys as dynamic model names.
 *
 * 5) Map
 *    - Similar to Python dict used as cache, but with semantics optimized for
 *      key/value mapping in JS.
 *    - Stores `modelName -> modelProxy` so repeated access to the same model
 *      reuses an existing proxy object.
 *
 * 6) Object.defineProperty / Object.defineProperties
 *    - Used to install lazy global getters on `window`.
 *    - Ensures values are resolved at access time (not frozen at module-load
 *      time), which is important when WOWL root initializes after scripts load.
 *
 * 7) kwargs wrapper helper
 *    - JavaScript does not have Python-style `**kwargs` in arbitrary call
 *      forwarding with the exact same ergonomics.
 *    - We emulate it with:
 *          env.kwargs({ limit: 10, context: {...} })
 *      and detect this marker at runtime.
 *
 *
 * Public debug API exported to browser globals
 * --------------------------------------------
 *
 * - window.model
 *     Main dynamic proxy.
 *
 * - window.env
 *     Alias with Python-ish intent for model access + helpers.
 *
 * - window.externalDebug.orm
 *     Read/write access to underlying ORM service (useful for manual override).
 *
 * - window.externalDebug.model / window.externalDebug.env
 *     Same proxies for external tooling.
 *
 * - window.externalDebug.call(model, method, args, kwargs)
 *     Low-level explicit call.
 *
 * - window.externalDebug.kwargs({...})
 *     Build kwargs marker object.
 *
 *
 * Notes / limitations
 * -------------------
 * - This is a debug convenience layer, not a security boundary.
 * - Availability depends on backend debug context (`__WOWL_DEBUG__`) unless ORM
 *   is manually injected.
 * - Dynamic proxy calls are intentionally permissive for exploration and may
 *   surface server-side errors directly from `orm.call`.
 */

const getDebugRoot = () => window.odoo?.__WOWL_DEBUG__?.root;

class GlobalDebugBridge {
    constructor() {
        this._modelProxyCache = new Map();
        this._envProxy = this._createEnvProxy();
        this._selfProxy = this._createSelfProxy();
    }

    get orm() {
        const root = getDebugRoot();
        return root?.orm || root?.env?.services?.orm || window.__LF_GLOBAL_DEBUG_ORM__ || null;
    }

    set orm(value) {
        window.__LF_GLOBAL_DEBUG_ORM__ = value;
    }

    get env() {
        return this._envProxy;
    }

    get proxy() {
        return this._selfProxy;
    }

    call(modelName, methodName, args = [], kwargs = {}) {
        return this._call(modelName, methodName, args, kwargs);
    }

    kwargs(kwargs = {}) {
        return {
            __lfKwargs__: true,
            kwargs,
        };
    }

    _createSelfProxy() {
        return new Proxy(this, {
            get: (target, prop, receiver) => {
                if (typeof prop !== 'string' || Reflect.has(target, prop)) {
                    return Reflect.get(target, prop, receiver);
                }
                return target._getModelProxy(prop);
            },
        });
    }

    _createEnvProxy() {
        return new Proxy({}, {
            get: (_target, prop) => {
                if (typeof prop !== 'string') {
                    return undefined;
                }
                if (prop === 'orm') {
                    return this.orm;
                }
                if (prop === 'call') {
                    return this.call.bind(this);
                }
                if (prop === 'kwargs') {
                    return this.kwargs.bind(this);
                }
                return this._getModelProxy(prop);
            },
        });
    }

    _getModelProxy(modelName) {
        if (!this._modelProxyCache.has(modelName)) {
            this._modelProxyCache.set(modelName, this._createModelProxy(modelName));
        }
        return this._modelProxyCache.get(modelName);
    }

    _createModelProxy(modelName) {
        return new Proxy({}, {
            get: (_target, methodName) => {
                if (typeof methodName !== 'string') {
                    return undefined;
                }
                if (methodName === '__model__') {
                    return modelName;
                }
                if (methodName === 'toString') {
                    return () => `[GlobalDebugModelProxy ${modelName}]`;
                }

                return (...args) => {
                    const { callArgs, callKwargs } = this._extractCallParams(args);
                    return this._call(modelName, methodName, callArgs, callKwargs);
                };
            },
        });
    }

    _extractCallParams(args) {
        if (!args.length) {
            return { callArgs: [], callKwargs: {} };
        }
        const lastArg = args[args.length - 1];
        if (this._isKwargsWrapper(lastArg)) {
            return {
                callArgs: args.slice(0, -1),
                callKwargs: lastArg.kwargs,
            };
        }
        return {
            callArgs: args,
            callKwargs: {},
        };
    }

    _isKwargsWrapper(value) {
        return Boolean(value)
            && typeof value === 'object'
            && value.__lfKwargs__ === true
            && this._isPlainObject(value.kwargs);
    }

    _isPlainObject(value) {
        return Object.prototype.toString.call(value) === '[object Object]';
    }

    _call(modelName, methodName, args = [], kwargs = {}) {
        const orm = this.orm;
        if (!orm || typeof orm.call !== 'function') {
            throw new Error(
                'ORM service is not available. Open a backend screen in debug mode or assign window.model.orm manually.'
            );
        }
        // return orm.call(modelName, methodName, args, kwargs);

        let r = async () => {
            let result = await orm.call(modelName, methodName, args, kwargs);
            console.log(result);
            return result;
        }
        return r();
    }
}

const debugBridge = new GlobalDebugBridge();

const assignGlobalDebugProps = () => {
    // Object.defineProperty(window, 'model', {
    //     configurable: true,
    //     get() {
    //         return debugBridge.proxy;
    //     },
    // });

    Object.defineProperty(window, 'env', {
        configurable: true,
        get() {
            return debugBridge.env;
        },
    });

    const externalDebug = window.externalDebug || {};
    Object.defineProperties(externalDebug, {
        orm: {
            configurable: true,
            get() {
                return debugBridge.orm;
            },
            set(value) {
                debugBridge.orm = value;
            },
        },
        model: {
            configurable: true,
            get() {
                return debugBridge.proxy;
            },
        },
        env: {
            configurable: true,
            get() {
                return debugBridge.env;
            },
        },
    });
    externalDebug.call = debugBridge.call.bind(debugBridge);
    externalDebug.kwargs = debugBridge.kwargs.bind(debugBridge);
    window.externalDebug = externalDebug;
};

if (typeof window !== 'undefined') {
    assignGlobalDebugProps();
}
