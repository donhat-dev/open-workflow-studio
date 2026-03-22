# -*- coding: utf-8 -*-

from enum import Enum


class ErrorCode(Enum):
    INVALID_REQUEST = 1001
    CONFIGURATION_ERROR = 1002
    PROVIDER_ERROR = 1003
    TOOL_EXECUTION_ERROR = 1004
    SERVER_ERROR = 1999
