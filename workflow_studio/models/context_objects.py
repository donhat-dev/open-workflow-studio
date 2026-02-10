"""Context object helpers for expression evaluation.

Provides dot-notation wrappers for dict-like contexts without regex translation.
"""

from copy import deepcopy
from datetime import date, datetime

from odoo.tools.misc import DotDict, ReadonlyDict


class MutableDotDict(DotDict):
    """Mutable dict with dot-notation access."""

    def __init__(self, *args, tracker=None, path="", suspend_tracking=False, **kwargs):
        super().__init__(*args, **kwargs)
        object.__setattr__(self, "_tracker", tracker)
        object.__setattr__(self, "_path", path or "")
        object.__setattr__(self, "_suspend_tracking", bool(suspend_tracking))

    def _child_path(self, key):
        base = object.__getattribute__(self, "_path")
        if base:
            return "%s.%s" % (base, key)
        return str(key)

    def _mark_dirty(self, path):
        if object.__getattribute__(self, "_suspend_tracking"):
            return
        tracker = object.__getattribute__(self, "_tracker")
        if callable(tracker):
            tracker(path)

    def __getattr__(self, attrib):
        if attrib in self:
            val = self.get(attrib)
            if isinstance(val, dict) and not isinstance(val, MutableDotDict):
                tracker = object.__getattribute__(self, "_tracker")
                val = wrap_mutable(val, tracker=tracker, path=self._child_path(attrib))
                dict.__setitem__(self, attrib, val)
            return val

        return None

    def __setattr__(self, attrib, value):
        if attrib in ("_tracker", "_path", "_suspend_tracking"):
            object.__setattr__(self, attrib, value)
            return
        self.__setitem__(attrib, value)

    def __setitem__(self, key, value):
        tracker = object.__getattribute__(self, "_tracker")
        child_path = self._child_path(key)
        wrapped = wrap_mutable(value, tracker=tracker, path=child_path)
        dict.__setitem__(self, key, wrapped)
        self._mark_dirty(child_path)

    def __delattr__(self, attrib):
        if attrib in self:
            self.__delitem__(attrib)

    def __delitem__(self, key):
        if key in self:
            dict.__delitem__(self, key)
            self._mark_dirty(self._child_path(key))

    def update(self, *args, **kwargs):
        for key, value in dict(*args, **kwargs).items():
            self[key] = value

    def setdefault(self, key, default=None):
        if key in self:
            return self[key]
        self[key] = default
        return self[key]

    def pop(self, key, *args):
        if key in self:
            val = dict.pop(self, key)
            self._mark_dirty(self._child_path(key))
            return val
        if args:
            return args[0]
        raise KeyError(key)

    def popitem(self):
        key, val = dict.popitem(self)
        self._mark_dirty(self._child_path(key))
        return key, val

    def clear(self):
        dict.clear(self)
        self._mark_dirty(object.__getattribute__(self, "_path"))


class ReadonlyDotDict(ReadonlyDict):
    """Readonly dict with dot-notation access."""

    def __getattr__(self, attrib):
        if attrib.startswith('__') or attrib.startswith('_ReadonlyDict'):
            raise AttributeError(attrib)
        try:
            val = self[attrib]
        except KeyError:
            return None
        return wrap_readonly(val)

    def get(self, key, default=None):
        try:
            return self[key]
        except KeyError as e:
            return default

    def keys(self):
        return list(self)

    def values(self):
        return [self[key] for key in self]

    def items(self):
        return [(key, self[key]) for key in self]


def wrap_readonly(value):
    if isinstance(value, ReadonlyDotDict):
        return value
    if isinstance(value, DotDict):
        return ReadonlyDotDict(value)
    if isinstance(value, dict):
        return ReadonlyDotDict(value)
    if isinstance(value, list):
        return [wrap_readonly(item) for item in value]
    if isinstance(value, tuple):
        return tuple(wrap_readonly(item) for item in value)
    return value


def wrap_mutable(value, tracker=None, path=""):
    if isinstance(value, MutableDotDict):
        if tracker and object.__getattribute__(value, "_tracker") is None:
            object.__setattr__(value, "_tracker", tracker)
        return value
    if isinstance(value, ReadonlyDotDict):
        value = dict(value)
    if isinstance(value, DotDict) or isinstance(value, dict):
        wrapped = MutableDotDict(tracker=tracker, path=path, suspend_tracking=True)
        for key, item in value.items():
            child_path = ("%s.%s" % (path, key)) if path else str(key)
            wrapped[key] = wrap_mutable(item, tracker=tracker, path=child_path)
        object.__setattr__(wrapped, "_suspend_tracking", False)
        return wrapped
    if isinstance(value, list):
        return [
            wrap_mutable(item, tracker=tracker, path="%s[%s]" % (path, idx))
            for idx, item in enumerate(value)
        ]
    if isinstance(value, tuple):
        return tuple(
            wrap_mutable(item, tracker=tracker, path="%s[%s]" % (path, idx))
            for idx, item in enumerate(value)
        )
    return value


def to_plain(value):
    if isinstance(value, ReadonlyDotDict):
        return {key: to_plain(value[key]) for key in value}
    if isinstance(value, DotDict):
        return {key: to_plain(val) for key, val in value.items()}
    if isinstance(value, dict):
        return {key: to_plain(val) for key, val in value.items()}
    if isinstance(value, list):
        return [to_plain(item) for item in value]
    if isinstance(value, tuple):
        return [to_plain(item) for item in value]
    return value


def build_input_context(payload, include_input_item=False):
    """Build `_input` context view.

    When `include_input_item=True`, `_input` exposes both:
    - metadata keys: `json`, `item`, `items`
    - top-level payload keys (for dict payloads), making `_input` an alias-like
      convenience for `_json` in expression paths.
    """
    if not include_input_item:
        return payload

    items_value = payload if isinstance(payload, list) else ([] if payload is None else [payload])
    input_context = {
        "json": payload,
        "item": items_value[0] if items_value else None,
        "items": items_value,
    }

    if isinstance(payload, dict):
        merged = dict(payload)
        merged.update(input_context)
        return merged

    return input_context


class NodeOutputsProxy:
    """Lazy proxy for _node access.

    Exposes fields: json, item, items, meta, error.
    """

    __slots__ = ("_outputs", "_cache")

    def __init__(self, node_outputs):
        self._outputs = node_outputs
        self._cache = {}

    def _normalize_items(self, value):
        if isinstance(value, list):
            return value
        if value is None:
            return []
        return [value]

    def _build_view(self, output):
        if not isinstance(output, dict):
            json_value = output
            meta_value = None
            error_value = None
        else:
            json_value = output.get("json")
            meta_value = output.get("meta")
            error_value = output.get("error")

        items_value = None
        if isinstance(output, dict):
            items_value = output.get("items")

        if items_value is None:
            items_value = self._normalize_items(json_value)

        item_value = None
        if isinstance(output, dict):
            item_value = output.get("item")
        if item_value is None:
            item_value = items_value[0] if items_value else json_value

        view = {
            "json": json_value,
            "item": item_value,
            "items": items_value,
            "meta": meta_value,
            "error": error_value,
        }
        return wrap_readonly(view)

    def _get_view(self, key):
        output = self._outputs.get(key)
        if output is None:
            return None
        cached = self._cache.get(key)
        if cached and cached[0] is output:
            return cached[1]
        view = self._build_view(output)
        self._cache[key] = (output, view)
        return view

    def __getitem__(self, key):
        view = self._get_view(key)
        if view is None:
            raise KeyError(key)
        return view

    def __contains__(self, key):
        return key in self._outputs

    def get(self, key, default=None):
        view = self._get_view(key)
        if view is None:
            return default
        return view

    def keys(self):
        return self._outputs.keys()

    def values(self):
        return (self._build_view(out) for out in self._outputs.values())

    def items(self):
        return ((node_id, self._build_view(out)) for node_id, out in self._outputs.items())

    def __iter__(self):
        return iter(self._outputs)

    def __len__(self):
        return len(self._outputs)


class ExecutionContext:
    """Unified execution context for workflow runs.

    Keeps a single in-memory context and updates per node execution.
    """

    def __init__(self, *, node_outputs, vars_store, node_context, execution=None, workflow=None):
        self.node_outputs = node_outputs
        self.vars = vars_store
        self.node_context = node_context
        self.execution = execution
        self.workflow = workflow
        self.node_proxy = NodeOutputsProxy(self.node_outputs)

        self._eval_context = {
            "_json": wrap_readonly({}),
            "_input": wrap_readonly({}),
            "_vars": self.vars,
            "_node": self.node_proxy,
            "_loop": wrap_readonly({}),
            "_execution": wrap_readonly(self.execution or {}),
            "_workflow": wrap_readonly(self.workflow or {}),
            "_now": None,
            "_today": None,
        }

        self._runtime_context = {
            "exec_context": self,
            "current_node_id": None,
            "node": self.node_outputs,
            "vars": self.vars,
            "node_context": self.node_context,
            "execution": self.execution,
            "workflow": self.workflow,
        }

    def _normalize_items(self, value):
        if isinstance(value, list):
            return value
        if value is None:
            return []
        return [value]

    def update_vars(self, vars_store):
        self.vars = vars_store
        self._runtime_context["vars"] = vars_store
        self._eval_context["_vars"] = vars_store

    def update_runtime(self, execution=None, workflow=None):
        if execution is not None:
            self.execution = execution
        if workflow is not None:
            self.workflow = workflow
        self._runtime_context["execution"] = self.execution
        self._runtime_context["workflow"] = self.workflow
        self._eval_context["_execution"] = wrap_readonly(self.execution or {})
        self._eval_context["_workflow"] = wrap_readonly(self.workflow or {})

    def get_runtime_context(self, node_id=None, execution=None, workflow=None):
        self._runtime_context["current_node_id"] = node_id
        self.update_runtime(execution=execution, workflow=workflow)
        return self._runtime_context

    def get_eval_context(self, input_data, include_input_item=False, node_id=None):
        payload = input_data if input_data is not None else {}
        input_context = build_input_context(payload, include_input_item=include_input_item)

        loop_context = {}
        if node_id:
            loop_context = self.node_context.get(node_id, {}).get("loop", {})

        self._eval_context["_json"] = wrap_readonly(payload)
        self._eval_context["_input"] = wrap_readonly(input_context)
        self._eval_context["_loop"] = wrap_readonly(loop_context)
        self._eval_context["_execution"] = wrap_readonly(self.execution or {})
        self._eval_context["_workflow"] = wrap_readonly(self.workflow or {})
        self._eval_context["_now"] = datetime.now()
        self._eval_context["_today"] = date.today()
        return self._eval_context

    def build_snapshot(self, target_node_id=None, target_result=None):
        target_json = None
        if target_result:
            target_json = target_result.get("json")

        node_json_snapshot = {
            node_id: output.get("json")
            for node_id, output in self.node_outputs.items()
        }

        node_context_snapshot = {
            node_id: dict(ctx) for node_id, ctx in self.node_context.items()
        }

        return {
            "json": target_json,
            "node": node_json_snapshot,
            "vars": deepcopy(to_plain(self.vars)),
            "node_context": node_context_snapshot,
            "execution": self.execution,
            "workflow": self.workflow,
            "now": datetime.now().isoformat(),
            "today": date.today().isoformat(),
        }


def build_eval_context(payload, context, include_input_item=False):
    """Build evaluation context with dot-notation wrappers."""
    payload = payload if payload is not None else {}
    if isinstance(context, ExecutionContext):
        return context.get_eval_context(payload, include_input_item=include_input_item)

    base_context = context or {}
    exec_context = None
    if isinstance(base_context, dict):
        exec_context = base_context.get("exec_context")
    if isinstance(exec_context, ExecutionContext):
        node_id = base_context.get("current_node_id") if isinstance(base_context, dict) else None
        return exec_context.get_eval_context(payload, include_input_item=include_input_item, node_id=node_id)

    input_context = build_input_context(payload, include_input_item=include_input_item)

    eval_context = {
        '_json': wrap_readonly(payload),
        '_input': wrap_readonly(input_context),
        '_node': wrap_readonly(base_context.get('node') or {}),
        '_vars': wrap_mutable(base_context.get('vars') or {}),
    }

    if base_context.get('execution') is not None:
        eval_context['_execution'] = wrap_readonly(base_context.get('execution'))
    if base_context.get('workflow') is not None:
        eval_context['_workflow'] = wrap_readonly(base_context.get('workflow'))
    if base_context.get('loop') is not None:
        eval_context['_loop'] = wrap_readonly(base_context.get('loop'))

    return eval_context
