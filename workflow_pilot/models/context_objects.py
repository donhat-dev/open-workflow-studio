"""Context object helpers for expression evaluation.

Provides dot-notation wrappers for dict-like contexts without regex translation.
"""

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
        try:
            val = self[attrib]
        except KeyError:
            return None
        return wrap_readonly(val)

    def get(self, key, default=None):
        try:
            return self[key]
        except KeyError:
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


def build_eval_context(payload, context, include_input_item=False):
    """Build evaluation context with dot-notation wrappers."""
    payload = payload if payload is not None else {}
    base_context = context or {}
    input_context = {
        'item': payload,
        'json': payload,
    } if include_input_item else payload

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
