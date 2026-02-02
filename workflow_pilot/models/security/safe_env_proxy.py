# -*- coding: utf-8 -*-
"""
SafeEnvProxy - Secure Environment Proxy for Workflow Execution.

Uses odoo.tools.facade.Proxy pattern (whitelist-based).
Blocks: sudo(), with_user(), with_context()
Exposes: user, uid, company, context, ref(), model access via __getitem__

Hook System:
    Use @pre_hook and @post_hook decorators to register hooks that
    are auto-bound when SafeEnvProxy is initialized.

Example:
    @SafeEnvProxy.pre_hook
    def audit_model_access(ctx, model_name, method_name, args, kwargs):
        # Log model access
        pass
"""
import fnmatch
import json
from odoo.api import Environment
from odoo.exceptions import AccessError
from odoo.tools.facade import Proxy, ProxyAttr, ProxyFunc


# =============================================================================
# HOOK DECORATORS
# =============================================================================

def _make_hook_decorator(hook_type):
    """
    Factory for creating hook decorators.
    
    Similar to Odoo's attrsetter pattern in api.py.
    Sets _safe_env_hook attribute on the decorated function.
    """
    def decorator(func):
        func._safe_env_hook = hook_type
        return func
    return decorator


# Module-level decorators (can be used as @pre_hook or @post_hook)
pre_hook = _make_hook_decorator('pre')
post_hook = _make_hook_decorator('post')


# =============================================================================
# HOOK REGISTRY
# =============================================================================

class HookRegistry:
    """
    Registry for SafeEnvProxy hooks.
    
    Collects functions decorated with @pre_hook and @post_hook.
    Hooks are auto-bound when SafeEnvProxy is initialized.
    """
    _pre_hooks = []
    _post_hooks = []
    
    @classmethod
    def register(cls, func):
        """Register a hook function based on its _safe_env_hook attribute."""
        hook_type = getattr(func, '_safe_env_hook', None)
        if hook_type == 'pre':
            if func not in cls._pre_hooks:
                cls._pre_hooks.append(func)
        elif hook_type == 'post':
            if func not in cls._post_hooks:
                cls._post_hooks.append(func)
        return func
    
    @classmethod
    def get_pre_hooks(cls):
        """Return list of registered pre-hooks."""
        return list(cls._pre_hooks)
    
    @classmethod
    def get_post_hooks(cls):
        """Return list of registered post-hooks."""
        return list(cls._post_hooks)
    
    @classmethod
    def clear(cls):
        """Clear all registered hooks (for testing)."""
        cls._pre_hooks.clear()
        cls._post_hooks.clear()


# =============================================================================
# SAFE ENV PROXY
# =============================================================================

class SafeEnvProxy(Proxy):
    """
    Secure Environment proxy that:
    - Blocks sudo(), with_user(), with_context() (not declared = blocked)
    - Enforces model allowlist/denylist
    - Always blocks ir.* models
    - Returns SafeModelProxy for model access
    - Auto-binds registered hooks on initialization
    
    Hook Decorators:
        @SafeEnvProxy.pre_hook - Called before model method execution
        @SafeEnvProxy.post_hook - Called after model method execution
    """
    _wrapped__ = Environment
    
    # === Class-level hook decorators ===
    pre_hook = staticmethod(lambda func: HookRegistry.register(pre_hook(func)))
    post_hook = staticmethod(lambda func: HookRegistry.register(post_hook(func)))

    # === Exposed Attributes (whitelist) ===
    user = ProxyAttr()
    uid = ProxyAttr()
    company = ProxyAttr()
    companies = ProxyAttr()
    context = ProxyAttr()
    lang = ProxyAttr()

    # === Exposed Methods ===
    ref = ProxyFunc()

    def __init__(self, env, allowlist=None, denylist=None, hooks=None, context=None):
        """
        Initialize SafeEnvProxy.

        Args:
            env: Odoo Environment instance
            allowlist: List of allowed model patterns (None = all except denylist)
            denylist: List of denied model patterns (always includes ir.*)
            hooks: Dict with 'pre' and 'post' hook lists (overrides registry)
            context: Execution context dict (run_id, node_id, etc.) passed to hooks
        """
        super().__init__(env)
        object.__setattr__(self, '_allowlist', allowlist or [])
        object.__setattr__(self, '_denylist', denylist or ['ir.%'])
        object.__setattr__(self, '_context', context or {})
        
        # Build hooks: merge registry hooks with explicit hooks
        merged_hooks = {
            'pre': HookRegistry.get_pre_hooks().copy(),
            'post': HookRegistry.get_post_hooks().copy(),
        }
        if hooks:
            merged_hooks['pre'].extend(hooks.get('pre', []))
            merged_hooks['post'].extend(hooks.get('post', []))
        
        object.__setattr__(self, '_hooks', merged_hooks)

    @classmethod
    def from_workflow(cls, env, workflow, context=None):
        """
        Create SafeEnvProxy from workflow security settings.

        Args:
            env: Odoo Environment
            workflow: ir.workflow record with model_allowlist/denylist
            context: Execution context dict (run_id, node_id, etc.)
        """
        allowlist = []
        denylist = ['ir.%']

        if workflow.model_allowlist:
            try:
                allowlist = json.loads(workflow.model_allowlist)
            except (json.JSONDecodeError, TypeError):
                pass

        if workflow.model_denylist:
            try:
                denylist = json.loads(workflow.model_denylist)
            except (json.JSONDecodeError, TypeError):
                denylist = ['ir.%']

        # Always include ir.* in denylist
        if 'ir.%' not in denylist and 'ir.*' not in denylist:
            denylist.append('ir.%')

        return cls(env, allowlist=allowlist, denylist=denylist, context=context)

    def _is_model_allowed(self, model_name):
        """
        Check if model access is allowed.

        Logic:
        1. Check denylist first (block if matches)
        2. If allowlist is set, only allow if matches
        3. Otherwise allow
        """
        # Check denylist (% is SQL wildcard, convert to fnmatch *)
        for pattern in self._denylist:
            fnmatch_pattern = pattern.replace('%', '*')
            if fnmatch.fnmatch(model_name, fnmatch_pattern):
                return False

        # Check allowlist (if set)
        if self._allowlist:
            for pattern in self._allowlist:
                fnmatch_pattern = pattern.replace('%', '*')
                if fnmatch.fnmatch(model_name, fnmatch_pattern):
                    return True
            return False

        return True

    def __getitem__(self, model_name):
        """
        Access model with security checks.

        Returns SafeModelProxy for allowed models.
        Raises AccessError for blocked models.
        """
        from .safe_model_proxy import SafeModelProxy

        if not self._is_model_allowed(model_name):
            raise AccessError(
                f"Access to model '{model_name}' is blocked by workflow security policy"
            )

        model = self._wrapped__[model_name]
        return SafeModelProxy(
            model,
            env_proxy=self,
            hooks=self._hooks,
            context=self._context
        )

    def __contains__(self, model_name):
        """Check if model exists and is allowed."""
        if not self._is_model_allowed(model_name):
            return False
        return model_name in self._wrapped__


# =============================================================================
# BUILT-IN HOOKS
# =============================================================================

@SafeEnvProxy.pre_hook
def audit_model_access(ctx, model_name, method_name, args, kwargs):
    """
    Audit hook for logging model access.
    
    Auto-registered via @SafeEnvProxy.pre_hook decorator.
    Uses raw SQL with separate cursor to avoid transaction blocking.
    Pattern from odoo/addons/base/models/ir_actions.py
    
    Args:
        ctx: Execution context dict with:
            - env: Odoo Environment
            - run_id: workflow.run ID (optional)
            - node_id: workflow.node ID (optional)
            - workflow_id: ir.workflow ID (optional)
            - persist: Whether to persist logs
        model_name: Name of model being accessed
        method_name: Name of method being called
        args: Method positional arguments
        kwargs: Method keyword arguments
    """
    env = ctx.get('env')
    run_id = ctx.get('run_id')
    node_id = ctx.get('node_id')
    workflow_id = ctx.get('workflow_id')
    persist = ctx.get('persist', True)
    
    if not env or not persist:
        return
    
    try:
        message_display = f"Accessed {model_name}.{method_name}"
        # Use separate cursor to avoid transaction issues
        with env.registry.cursor() as cr:
            # Insert base ir_logging record first
            cr.execute("""
                INSERT INTO ir_logging (create_date, create_uid, type, dbname, name, level, message, path, line, func)
                VALUES (NOW() at time zone 'UTC', %s, 'server', %s, 'workflow_pilot', 'INFO', %s, '', '0', 'audit_model_access')
                RETURNING id
            """, (env.uid, cr.dbname, message_display))
            logging_id = cr.fetchone()[0]
            
            # Insert workflow-specific record
            cr.execute("""
                INSERT INTO ir_workflow_logging (
                    logging_id, workflow_run_id, workflow_node_id, workflow_id,
                    event_type, model_name, method_name, message_display, success
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (logging_id, run_id, node_id, workflow_id, 'model_access', model_name, method_name, message_display, True))
    except Exception:
        pass  # Silently ignore logging errors
