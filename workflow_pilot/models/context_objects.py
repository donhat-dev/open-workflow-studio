"""Context object helpers for expression evaluation.

Provides dot-notation wrappers for dict-like contexts without regex translation.
"""

from odoo.tools.misc import DotDict, ReadonlyDict


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


def wrap_mutable(value):
    if isinstance(value, DotDict):
        return value
    if isinstance(value, ReadonlyDotDict):
        return DotDict(dict(value))
    if isinstance(value, dict):
        return DotDict(value)
    if isinstance(value, list):
        return [wrap_mutable(item) for item in value]
    if isinstance(value, tuple):
        return tuple(wrap_mutable(item) for item in value)
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
