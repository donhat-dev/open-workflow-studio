"""
SafeModelProxy - Secure Model Proxy for Workflow Execution.

Blocks: sudo(), with_user()
Allows: All other ORM methods with optional hooks for auditing.
"""

from odoo import models
from odoo.exceptions import AccessError


class SafeModelProxy:
    """
    Secure Model proxy that:
    - Blocks sudo() method
    - Wraps all method calls with pre/post hooks
    - Returns SafeModelProxy for chained operations
    """

    # Methods that should never be allowed
    BLOCKED_METHODS = {"sudo", "with_user"}

    def __init__(self, model, env_proxy=None, hooks=None, context=None):
        """
        Initialize SafeModelProxy.

        Args:
            model: Odoo Model/Recordset instance
            env_proxy: SafeEnvProxy instance for env access
            hooks: Dict with 'pre' and 'post' hook lists
            context: Execution context dict passed to hooks
        """
        object.__setattr__(self, "_model", model)
        object.__setattr__(self, "_env_proxy", env_proxy)
        object.__setattr__(self, "_hooks", hooks or {"pre": [], "post": []})
        object.__setattr__(self, "_context", context or {})

    def __getattr__(self, name):
        """
        Get attribute/method from wrapped model.

        Blocks sudo(), wraps methods with hooks.
        """
        if name in self.BLOCKED_METHODS:
            raise AccessError(
                f"Method '{name}()' is blocked by workflow security policy. "
                f"Workflows cannot escalate privileges."
            )

        attr = getattr(self._model, name)

        if isinstance(attr, models.BaseModel):
            return SafeModelProxy(
                attr,
                env_proxy=self._env_proxy,
                hooks=self._hooks,
                context=self._context,
            )

        # If callable, wrap with hooks
        if callable(attr):
            return self._wrap_method(name, attr)

        return attr

    def _wrap_method(self, method_name, method):
        """
        Wrap method with pre/post hooks.

        Args:
            method_name: Name of the method
            method: Actual method callable
        """
        hooks = self._hooks
        context = self._context
        model = self._model

        def wrapped(*args, **kwargs):
            # Run pre-hooks with context
            for hook in hooks.get("pre", []):
                try:
                    hook(context, model._name, method_name, args, kwargs)
                except Exception:
                    pass  # Silently ignore hook errors

            # Execute method
            result = method(*args, **kwargs)

            # Run post-hooks with context
            for hook in hooks.get("post", []):
                try:
                    hook(context, model._name, method_name, args, kwargs, result)
                except Exception:
                    pass  # Silently ignore hook errors

            # Wrap recordset results
            if isinstance(result, models.BaseModel):
                return SafeModelProxy(
                    result, env_proxy=self._env_proxy, hooks=hooks, context=context
                )

            return result

        return wrapped

    def __iter__(self):
        """Iterate over wrapped recordset."""
        for record in self._model:
            yield SafeModelProxy(
                record,
                env_proxy=self._env_proxy,
                hooks=self._hooks,
                context=self._context,
            )

    def __len__(self):
        """Return length of wrapped recordset."""
        return len(self._model)

    def __bool__(self):
        """Return truthiness of wrapped recordset."""
        return bool(self._model)

    def __getitem__(self, key):
        """Index into wrapped recordset."""
        result = self._model[key]
        if isinstance(result, models.BaseModel):
            return SafeModelProxy(
                result,
                env_proxy=self._env_proxy,
                hooks=self._hooks,
                context=self._context,
            )
        return result

    def __contains__(self, item):
        """Check if item in wrapped recordset."""
        if isinstance(item, SafeModelProxy):
            item = item._model
        return item in self._model

    @property
    def ids(self):
        """Return IDs of wrapped recordset."""
        return self._model.ids

    @property
    def id(self):
        """Return ID of single record."""
        return self._model.id

    @property
    def _name(self):
        """Return model name."""
        return self._model._name

    @property
    def env(self):
        """Return environment (wrapped)."""
        return self._env_proxy

    def ensure_one(self):
        """Ensure single record."""
        self._model.ensure_one()
        return self

    def exists(self):
        """Check existence."""
        result = self._model.exists()
        return SafeModelProxy(
            result, env_proxy=self._env_proxy, hooks=self._hooks, context=self._context
        )

    def __repr__(self):
        return f"SafeModelProxy({self._model!r})"

    def __str__(self):
        return str(self._model)
