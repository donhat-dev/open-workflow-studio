#!/bin/bash
set -e

ODOO_DEBUG="${ODOO_DEBUG:-0}"
DEBUGPY_PORT="${DEBUGPY_PORT:-5678}"
ODOO_CONF="${ODOO_CONF:-/etc/odoo/odoo.conf}"

ODOO_BIN="/opt/odoo/source/odoo-bin"

if [ ! -f "$ODOO_BIN" ]; then
    echo "ERROR: odoo-bin not found at $ODOO_BIN"
    echo "Make sure Odoo source is mounted to /opt/odoo/source"
    exit 1
fi

ODOO_ARGS="-c $ODOO_CONF"

# Append any extra args passed to the container
if [ $# -gt 0 ]; then
    ODOO_ARGS="$ODOO_ARGS $@"
fi

if [ "$ODOO_DEBUG" = "1" ]; then
    echo "==> Starting Odoo with debugpy on port $DEBUGPY_PORT (waiting for VS Code to attach...)"
    exec python -m debugpy \
        --listen "0.0.0.0:$DEBUGPY_PORT" \
        --wait-for-client \
        "$ODOO_BIN" $ODOO_ARGS
else
    echo "==> Starting Odoo (no debug)"
    exec python "$ODOO_BIN" $ODOO_ARGS
fi
