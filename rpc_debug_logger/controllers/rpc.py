# Part of Odoo. See LICENSE file for full copyright and licensing details.
import logging
import xmlrpc.client

from odoo.http import route, request
from odoo.addons.base.controllers.rpc import RPC


_logger = logging.getLogger(__name__)


class RPCDebugLogger(RPC):
    def _xmlrpc(self, service):
        data = request.httprequest.get_data()
        params = None
        method = None
        try:
            params, method = xmlrpc.client.loads(data, use_datetime=True)
        except Exception:
            _logger.debug(
                "RPC XML-RPC parse failed | service=%s | data=%r",
                service,
                data,
                exc_info=True,
            )

        _logger.debug(
            "RPC XML-RPC request | service=%s | method=%s | params=%s | data=%r",
            service,
            method,
            params,
            data,
        )

        result = super()._xmlrpc(service)

        _logger.debug(
            "RPC XML-RPC response | service=%s | method=%s | result=%s",
            service,
            method,
            result,
        )
        return result

    @route()
    def jsonrpc(self, service, method, args):
        _logger.debug(
            "RPC JSON-RPC request | service=%s | method=%s | params=%s | data=%s",
            service,
            method,
            args,
            request.jsonrequest,
        )

        result = super().jsonrpc(service, method, args)

        _logger.debug(
            "RPC JSON-RPC response | service=%s | method=%s | result=%s",
            service,
            method,
            result,
        )
        return result
