#!/usr/bin/env bash
# wt-restart.sh — Restart the Odoo worker inside a worktree container.
#
# Usage (from any directory):
#   ./scripts/wt-restart.sh <branch-name-or-slug>
#
# Usage (from inside the worktree — agent convenience):
#   If WT_SLUG env var is set (from .env.wt sourced), no arg needed:
#   ./scripts/wt-restart.sh
#
# Sends SIGUSR1 to the container, which supervisor-lite.py interprets
# as "kill current Odoo worker and respawn". Faster than docker restart.

set -euo pipefail

REPO_ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel)"

slug_from_branch() {
    echo "$1" | tr '[:upper:]' '[:lower:]' | sed 's|[/_. ]|-|g' | sed 's|[^a-z0-9-]||g' | cut -c1-28
}

# ---------------------------------------------------------------------------
# Resolve container
# ---------------------------------------------------------------------------

SLUG=""
if [ -n "${1:-}" ]; then
    SLUG="$(slug_from_branch "$1")"
elif [ -n "${WT_SLUG:-}" ]; then
    SLUG="$WT_SLUG"
else
    # Try to detect from CWD (agent running from inside worktree)
    CWD_BASENAME=$(basename "$(pwd)")
    if [[ "$CWD_BASENAME" == wt-* ]]; then
        SLUG="${CWD_BASENAME#wt-}"
    fi
fi

if [ -z "$SLUG" ]; then
    echo "ERROR: Cannot determine worktree slug. Pass branch/slug as first arg or set WT_SLUG." >&2
    exit 1
fi

CONTAINER_NAME="odoo-wt-${SLUG}"

echo "[wt-restart] Sending SIGUSR1 to ${CONTAINER_NAME} ..."
docker kill -s SIGUSR1 "$CONTAINER_NAME"
echo "[wt-restart] Worker respawn triggered. Odoo reloads in ~3-5s."
echo "[wt-restart] Logs: docker logs -f ${CONTAINER_NAME}"
