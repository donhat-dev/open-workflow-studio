#!/usr/bin/env bash
# wt-list.sh — List all active worktrees and their status.
#
# Usage:
#   ./scripts/wt-list.sh

set -euo pipefail

REPO_ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel)"
REGISTRY_FILE="${REPO_ROOT}/.wt-registry"

echo ""
echo "=== Active Worktrees ==="
printf "%-28s  %-6s  %-22s  %-12s  %s\n" "SLUG" "PORT" "DB" "CONTAINER" "STATUS"
printf "%-28s  %-6s  %-22s  %-12s  %s\n" "---" "----" "--" "---------" "------"

if [ ! -f "$REGISTRY_FILE" ] || [ ! -s "$REGISTRY_FILE" ]; then
    echo "  (no worktrees registered)"
    echo ""
    echo "Git worktrees (raw):"
    git -C "$REPO_ROOT" worktree list
    echo ""
    exit 0
fi

while IFS='|' read -r slug port db wt_path container; do
    [ -z "$slug" ] && continue
    # Check container status
    STATUS="stopped"
    if docker inspect "$container" > /dev/null 2>&1; then
        RUNNING=$(docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null || echo "false")
        [ "$RUNNING" = "true" ] && STATUS="running" || STATUS="exited"
    fi
    printf "%-28s  %-6s  %-22s  %-12s  %s\n" "$slug" "$port" "$db" "$container" "$STATUS"
done < "$REGISTRY_FILE"

echo ""
echo "Git worktrees:"
git -C "$REPO_ROOT" worktree list
echo ""

# Show running containers that look like worktrees
RUNNING_WTS=$(docker ps --format '{{.Names}}' 2>/dev/null | grep '^odoo-wt-' || true)
if [ -n "$RUNNING_WTS" ]; then
    echo "Running worktree containers:"
    echo "$RUNNING_WTS" | while read -r name; do
        PORT=$(docker inspect -f '{{range $p, $conf := .NetworkSettings.Ports}}{{$p}} -> {{(index $conf 0).HostPort}}{{end}}' "$name" 2>/dev/null || echo "unknown")
        echo "  ${name}  (${PORT})"
    done
    echo ""
fi
