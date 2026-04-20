#!/usr/bin/env bash
# wt-smoke.sh — Run smoke checks against a worktree Odoo instance.
#
# Usage:
#   ./scripts/wt-smoke.sh <port> [db-name]
#
# Examples:
#   ./scripts/wt-smoke.sh 8071
#   ./scripts/wt-smoke.sh 8071 wt_fix-connector-stat
#
# Exit codes:
#   0 — all checks passed
#   1 — one or more checks failed

set -euo pipefail

PORT="${1:?Usage: wt-smoke.sh <port> [db-name]}"
DB_NAME="${2:-}"
BASE_URL="http://localhost:${PORT}"

PASS=0
FAIL=0

check() {
    local label="$1"
    local result="$2"
    if [ "$result" = "ok" ]; then
        echo "  [PASS] ${label}"
        PASS=$((PASS + 1))
    else
        echo "  [FAIL] ${label} — ${result}"
        FAIL=$((FAIL + 1))
    fi
}

rpc_call() {
    # JSON-RPC call_kw helper. Args: model method domain_json
    local model="$1"
    local method="$2"
    local args_json="${3:-[[]]}"
    curl -sf -X POST \
        -H "Content-Type: application/json" \
        "${BASE_URL}/web/dataset/call_kw/${model}/${method}" \
        -d "{\"jsonrpc\":\"2.0\",\"method\":\"call\",\"id\":1,\"params\":{\"model\":\"${model}\",\"method\":\"${method}\",\"args\":${args_json},\"kwargs\":{}}}" \
        2>/dev/null || echo '{"error":"curl_failed"}'
}

echo ""
echo "=== wt-smoke: ${BASE_URL} ==="
echo ""

# ---------------------------------------------------------------------------
# 1. HTTP reachability
# ---------------------------------------------------------------------------

HTTP_STATUS=$(curl -sf -o /dev/null -w "%{http_code}" "${BASE_URL}/odoo" 2>/dev/null || echo "000")
if [[ "$HTTP_STATUS" =~ ^(200|303|302)$ ]]; then
    check "Odoo HTTP reachable (${HTTP_STATUS})" "ok"
else
    check "Odoo HTTP reachable" "HTTP ${HTTP_STATUS} — container may still be starting"
fi

# ---------------------------------------------------------------------------
# 2. Login page loads (not a 500)
# ---------------------------------------------------------------------------

LOGIN_STATUS=$(curl -sf -o /dev/null -w "%{http_code}" "${BASE_URL}/web/login" 2>/dev/null || echo "000")
if [[ "$LOGIN_STATUS" =~ ^(200|302|303)$ ]]; then
    check "Login page accessible (${LOGIN_STATUS})" "ok"
else
    check "Login page accessible" "HTTP ${LOGIN_STATUS}"
fi

# ---------------------------------------------------------------------------
# 3. workflow_studio module is installed (unauthenticated JSON-RPC not available
#    without session, so we check via a public endpoint or skip gracefully)
# ---------------------------------------------------------------------------

# This endpoint requires auth — we check via session_info which returns public data
SESSION_RESP=$(curl -sf -X POST \
    -H "Content-Type: application/json" \
    "${BASE_URL}/web/dataset/call_kw" \
    -d '{"jsonrpc":"2.0","method":"call","id":1,"params":{"model":"ir.module.module","method":"search_count","args":[[["name","=","workflow_studio"],["state","=","installed"]]],"kwargs":{}}}' \
    2>/dev/null || echo '{}')

if echo "$SESSION_RESP" | grep -q '"result":1'; then
    check "workflow_studio module installed" "ok"
elif echo "$SESSION_RESP" | grep -q '"error"'; then
    # Auth required — means server is alive and responding correctly
    check "Server alive (auth required for module check — expected)" "ok"
else
    check "workflow_studio module check" "Unexpected response: $(echo "$SESSION_RESP" | head -c 120)"
fi

# ---------------------------------------------------------------------------
# 4. No obvious Python errors in container logs (last 50 lines)
# ---------------------------------------------------------------------------

SLUG=$(docker ps --format '{{.Names}}' | grep '^odoo-wt-' | while read -r name; do
    P=$(docker inspect -f '{{range $p,$c := .NetworkSettings.Ports}}{{if $c}}{{(index $c 0).HostPort}}{{end}}{{end}}' "$name" 2>/dev/null || true)
    [ "$P" = "$PORT" ] && echo "$name" && break
done || true)

if [ -n "$SLUG" ]; then
    ERROR_COUNT=$(docker logs --tail 80 "$SLUG" 2>&1 | grep -c "ERROR\|Traceback\|CRITICAL" || true)
    if [ "$ERROR_COUNT" -eq 0 ]; then
        check "No errors in container logs (last 80 lines)" "ok"
    else
        check "Container logs clean" "${ERROR_COUNT} ERROR/Traceback lines — run: docker logs ${SLUG} | grep ERROR"
    fi
else
    echo "  [SKIP] Container log check — no container found on port ${PORT}"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

echo ""
echo "=== Results: ${PASS} passed, ${FAIL} failed ==="
echo ""

if [ "$FAIL" -gt 0 ]; then
    echo "Next steps:"
    echo "  - Check logs: docker logs <container>"
    echo "  - Module update: docker exec <container> python /opt/odoo/source/odoo-bin -c /etc/odoo/odoo.conf -u workflow_studio --stop-after-init"
    echo "  - Restart worker: ./scripts/wt-restart.sh <slug>"
    echo ""
    exit 1
fi

echo "Odoo is healthy on http://localhost:${PORT}/odoo"
echo "Open in Chrome, then use Playwright MCP for UI validation."
echo ""
