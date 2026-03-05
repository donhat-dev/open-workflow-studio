# -*- coding: utf-8 -*-

import functools
import logging
import time

from .error_codes import ErrorCode

_logger = logging.getLogger(__name__)


def create_response(success=True, data=None, error_code=None, error_message=None):
    response = {"success": success}

    if success and isinstance(data, dict):
        response.update(data)

    if not success:
        response["error"] = {
            "code": error_code.name if error_code else ErrorCode.SERVER_ERROR.name,
            "code_value": error_code.value if error_code else ErrorCode.SERVER_ERROR.value,
            "message": error_message or "Unknown error",
        }

    return response


def api_wrapper(func):
    @functools.wraps(func)
    def wrapper(self, *args, **kwargs):
        start_at = time.time()
        endpoint = func.__name__
        try:
            result = func(self, *args, **kwargs)
            if not isinstance(result, dict):
                result = create_response(success=True, data={"data": result})
            result["execution_time"] = round(time.time() - start_at, 3)
            return result
        except Exception as exc:
            _logger.error("API %s failed: %s", endpoint, exc, exc_info=True)
            return create_response(
                success=False,
                error_code=ErrorCode.SERVER_ERROR,
                error_message=str(exc),
            )

    return wrapper
