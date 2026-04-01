# -*- coding: utf-8 -*-
"""Global workflow extension namespace.

Provides queue-neutral lifecycle decorators and node decorators, similar in
spirit to Odoo's global extension APIs (``@api.model``, ``@http.route``).

``@workflow.execution(event_name, priority=5)``
    Register a function or model method as an execution lifecycle handler.
    Handlers are dispatched in **(priority DESC, qualname DESC)** order.

``@workflow.node(node_type=None, **metadata)``
    Register a Python callable as a workflow node type.
"""

import copy
import logging

_logger = logging.getLogger(__name__)

_DEFAULT_EXECUTION_PRIORITY = 5


class WorkflowExecutionRegistry:
    """Registry of global workflow execution event handlers.

    Each entry is a tuple ``(priority, qualname, func)`` kept sorted
    by ``(priority DESC, qualname DESC)`` so dispatch order is deterministic.

    The execution pipeline runs three phases in order::

        pre_execution  →  execution  →  post_execution

    Call ``run_pipeline(event)`` to execute all three phases.  If any
    handler sets ``event['handled'] = True`` the pipeline stops early
    (used by the queue module to defer execution).
    """

    _handlers = {}  # {event_name: [(priority, qualname, func), ...]}
    _PHASES = ('pre_execution', 'execution', 'post_execution')

    @classmethod
    def register(cls, event_name, func, priority=_DEFAULT_EXECUTION_PRIORITY):
        qualname = getattr(func, '__qualname__', '') or getattr(func, '__name__', '')
        entry = (priority, qualname, func)
        handlers = cls._handlers.setdefault(event_name, [])
        # Avoid duplicates (same func ref for same event)
        for existing in handlers:
            if existing[2] is func:
                return func
        handlers.append(entry)
        handlers.sort(key=_execution_sort_key)
        return func

    @classmethod
    def get_handlers(cls, event_name):
        return list(cls._handlers.get(event_name, []))

    @classmethod
    def dispatch(cls, event_name, event):
        for _priority, _qualname, handler in cls.get_handlers(event_name):
            returned = handler(event)
            if returned is not None:
                event = returned
        return event

    @classmethod
    def run_pipeline(cls, event):
        """Execute the full pre → execution → post pipeline.

        Dispatches each phase in order.  If a handler sets
        ``event['handled'] = True`` (e.g. queue intercept), the
        remaining phases are skipped and the event is returned as-is.
        """
        for phase in cls._PHASES:
            event['_current_phase'] = phase
            event = cls.dispatch(phase, event)
            if event.get('handled'):
                break
        return event

    @classmethod
    def clear(cls, event_name=None):
        if event_name is None:
            cls._handlers.clear()
            return
        cls._handlers.pop(event_name, None)

    @classmethod
    def unregister(cls, event_name, func):
        handlers = cls._handlers.get(event_name)
        if not handlers:
            return
        cls._handlers[event_name] = [
            entry for entry in handlers if entry[2] is not func
        ]

    @classmethod
    def unregister_model(cls, model_name):
        """Remove all model-method wrappers for the given model.

        Called from ``_register_hook()`` before re-scanning, so that
        module upgrades / reloads do not accumulate stale entries.
        """
        for event_name in list(cls._handlers):
            cls._handlers[event_name] = [
                entry for entry in cls._handlers[event_name]
                if not getattr(entry[2], '_model_name', None) == model_name
            ]


def _execution_sort_key(entry):
    """Sort key: priority DESC, qualname DESC."""
    priority, qualname, _func = entry
    # Negate priority for DESC. For qualname DESC, we invert char codes.
    return (-priority, tuple(-ord(c) for c in qualname) if qualname else ())


class WorkflowNodeRegistry:
    """Registry of decorated Python callables exposed as workflow nodes."""

    _nodes_by_type = {}
    _nodes_by_callable_key = {}

    @classmethod
    def register(cls, node_type, metadata, func):
        entry = {
            'node_type': node_type,
            'metadata': copy.deepcopy(metadata or {}),
            'func': func,
        }
        cls._nodes_by_type[node_type] = entry
        callable_key = entry['metadata'].get('callable_key')
        if callable_key:
            cls._nodes_by_callable_key[callable_key] = entry
        return func

    @classmethod
    def get_node(cls, node_type):
        return cls._nodes_by_type.get(node_type)

    @classmethod
    def get_by_callable_key(cls, callable_key):
        return cls._nodes_by_callable_key.get(callable_key)

    @classmethod
    def get_all(cls):
        return dict(cls._nodes_by_type)

    @classmethod
    def clear(cls):
        cls._nodes_by_type.clear()
        cls._nodes_by_callable_key.clear()


class WorkflowNamespace:
    """Namespace object exported as ``workflow``."""

    @staticmethod
    def execution(event_name, priority=_DEFAULT_EXECUTION_PRIORITY):
        """Decorator to register an execution lifecycle handler.

        Works on both standalone functions and Odoo model methods.
        When used on a model method, the method is marked with attributes
        and collected by ``_register_hook()`` at module load time
        (following the ``@http.route`` pattern).

        Args:
            event_name: Lifecycle event name (e.g. ``'pre_execution'``).
            priority: Dispatch priority (default 5). Higher = runs first.
        """
        if not isinstance(event_name, str) or not event_name.strip():
            raise ValueError("workflow.execution(event_name) requires a non-empty string event name.")
        event_name = event_name.strip()
        priority = int(priority)

        def decorator(func):
            func._workflow_execution_event = event_name
            func._workflow_execution_priority = priority
            # Only register standalone functions into the global registry
            # immediately. Model methods are collected by _register_hook().
            # Heuristic: model methods are defined inside a class body —
            # their qualname is ``ClassName.method_name`` (single dot,
            # no ``<locals>``).  Inner functions (e.g. closures created
            # at runtime in tests or factories) contain ``<locals>`` and
            # must be registered immediately.
            qualname = getattr(func, '__qualname__', '')
            if '.' not in qualname or '<locals>' in qualname:
                WorkflowExecutionRegistry.register(event_name, func, priority=priority)
            return func

        return decorator

    @staticmethod
    def node(node_type=None, **metadata):
        """Decorator to register a Python callable as a workflow node.

        Args:
            node_type: Custom node type (must start with ``x_``).
                       Defaults to ``x_<func.__name__>``.
            **metadata: Node metadata (icon, category, group_id, etc.).
        """
        def decorator(func):
            actual_node_type = (node_type or ("x_%s" % func.__name__)).strip()
            if not actual_node_type.startswith('x_'):
                raise ValueError(
                    "Decorated workflow nodes must use an 'x_' node_type. "
                    "Received %r." % actual_node_type
                )

            callable_key = metadata.get('callable_key')
            if not callable_key:
                callable_key = '%s:%s' % (func.__module__, func.__qualname__)

            entry_metadata = copy.deepcopy(metadata or {})
            entry_metadata['callable_key'] = callable_key
            entry_metadata.setdefault('name', getattr(func, '__name__', actual_node_type))
            entry_metadata.setdefault('description', (getattr(func, '__doc__', '') or '').strip())

            # Warn on missing recommended metadata
            if not (getattr(func, '__doc__', None) or '').strip():
                _logger.warning(
                    "@workflow.node '%s': missing docstring. "
                    "Add __doc__ for palette description.", actual_node_type,
                )
            if 'group_id' not in metadata:
                _logger.warning(
                    "@workflow.node '%s': no group_id specified, "
                    "defaulting to base.group_user.", actual_node_type,
                )
            if 'icon' not in metadata:
                _logger.warning(
                    "@workflow.node '%s': no icon specified, "
                    "defaulting to 'fa-cube'.", actual_node_type,
                )
            if 'category' not in metadata:
                _logger.warning(
                    "@workflow.node '%s': no category specified, "
                    "defaulting to 'transform'.", actual_node_type,
                )

            # Apply defaults for common metadata
            entry_metadata.setdefault('icon', 'fa-cube')
            entry_metadata.setdefault('category', 'transform')
            entry_metadata.setdefault('sequence', 10)
            entry_metadata.setdefault('active', True)

            func._workflow_node_type = actual_node_type
            func._workflow_node_metadata = entry_metadata

            WorkflowNodeRegistry.register(actual_node_type, entry_metadata, func)
            return func

        return decorator


workflow = WorkflowNamespace()

