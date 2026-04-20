#!/usr/bin/env bash
# wt-down.sh — Tear down a worktree container + optionally drop DB + remove worktree.
#
# Usage:
#   ./scripts/wt-down.sh <branch-name-or-slug> [--keep-db] [--keep-worktree]
#
# Examples:
#   ./scripts/wt-down.sh fix/connector-stat-buttons
#   ./scripts/wt-down.sh fix-connector-stat-buttons --keep-db
#
# Flags:
#   --keep-db         Do not drop the worktree database
#   --keep-worktree   Do not remove the git worktree directory
#
# Safe defaults: always asks for confirmation before dropping DB.

set -euo pipefail

REPO_ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel)"

# ---------------------------------------------------------------------------
# Parse args
# ---------------------------------------------------------------------------

BRANCH_OR_SLUG="${1:?Usage: wt-down.sh <branch-name-or-slug> [--keep-db] [--keep-worktree]}"
KEEP_DB=0
KEEP_WT=0

for arg in "${@:2}"; do
    case "$arg" in
        --keep-db)       KEEP_DB=1 ;;
        --keep-worktree) KEEP_WT=1 ;;
        *) echo "Unknown flag: $arg" >&2; exit 1 ;;
    esac
done

# ---------------------------------------------------------------------------
# Resolve slug
# ---------------------------------------------------------------------------

slug_from_branch() {
    echo "$1" | tr '[:upper:]' '[:lower:]' | sed 's|[/_. ]|-|g' | sed 's|[^a-z0-9-]||g' | cut -c1-28
}

SLUG="$(slug_from_branch "$BRANCH_OR_SLUG")"
WT_PATH="${REPO_ROOT}/../worktrees/wt-${SLUG}"
PROJECT_NAME="wt-${SLUG}"
ENV_FILE="${WT_PATH}/.env.wt"
REGISTRY_FILE="${REPO_ROOT}/.wt-registry"

# Try to load DB name from .env.wt
DB_NAME=""
if [ -f "$ENV_FILE" ]; then
    DB_NAME="$(grep '^WT_DB=' "$ENV_FILE" | cut -d= -f2)"
fi
[ -z "$DB_NAME" ] && DB_NAME="wt_${SLUG}"

echo ""
echo "=== wt-down: ${SLUG} ==="
echo "  project:  ${PROJECT_NAME}"
echo "  db:       ${DB_NAME}"
echo "  path:     ${WT_PATH}"
echo ""

# ---------------------------------------------------------------------------
# 1. Stop + remove container
# ---------------------------------------------------------------------------

if docker compose -f "${REPO_ROOT}/docker-compose.yml" -p "$PROJECT_NAME" ps -q 2>/dev/null | grep -q .; then
    echo "[wt-down] Stopping container ..."
    docker compose \
        -f "${REPO_ROOT}/docker-compose.yml" \
        --env-file "${ENV_FILE}" \
        -p "$PROJECT_NAME" \
        down --remove-orphans
    echo "[wt-down] Container stopped."
else
    echo "[wt-down] No running container for project: ${PROJECT_NAME}"
fi

# ---------------------------------------------------------------------------
# 2. Drop DB
# ---------------------------------------------------------------------------

if [ "$KEEP_DB" -eq 0 ]; then
    # shellcheck source=/dev/null
    source "${REPO_ROOT}/docker/.env"
    DB_HOST_VAL="${DB_HOST:-192.168.100.124}"
    DB_PORT_VAL="${DB_PORT:-5432}"
    DB_USER_VAL="${DB_USER:-odoo}"
    DB_PASS_VAL="${DB_PASSWORD:-odoo}"

    DB_EXISTS=$(PGPASSWORD="$DB_PASS_VAL" psql \
        -h "$DB_HOST_VAL" -p "$DB_PORT_VAL" -U "$DB_USER_VAL" -d postgres \
        -tc "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'" \
        | grep -c 1 || true)

    if [ "$DB_EXISTS" -gt 0 ]; then
        echo "[wt-down] Dropping DB: ${DB_NAME}"
        # Terminate active connections first
        PGPASSWORD="$DB_PASS_VAL" psql \
            -h "$DB_HOST_VAL" -p "$DB_PORT_VAL" -U "$DB_USER_VAL" -d postgres \
            -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${DB_NAME}' AND pid <> pg_backend_pid();" \
            > /dev/null 2>&1 || true
        PGPASSWORD="$DB_PASS_VAL" dropdb \
            -h "$DB_HOST_VAL" -p "$DB_PORT_VAL" -U "$DB_USER_VAL" \
            "$DB_NAME"
        echo "[wt-down] DB dropped: ${DB_NAME}"
    else
        echo "[wt-down] DB not found (already removed): ${DB_NAME}"
    fi
else
    echo "[wt-down] --keep-db: skipping DB drop (${DB_NAME})"
fi

# ---------------------------------------------------------------------------
# 3. Remove git worktree
# ---------------------------------------------------------------------------

if [ "$KEEP_WT" -eq 0 ]; then
    if [ -d "$WT_PATH" ]; then
        git -C "$REPO_ROOT" worktree remove --force "$WT_PATH" 2>/dev/null || rm -rf "$WT_PATH"
        echo "[wt-down] Worktree removed: ${WT_PATH}"
    else
        echo "[wt-down] Worktree directory not found: ${WT_PATH}"
    fi
    # Also remove the branch if it's been merged (optional, non-fatal)
    BRANCH_EXISTS=$(git -C "$REPO_ROOT" branch --list "$BRANCH_OR_SLUG" | grep -c . || true)
    if [ "$BRANCH_EXISTS" -gt 0 ]; then
        git -C "$REPO_ROOT" branch -d "$BRANCH_OR_SLUG" 2>/dev/null \
            && echo "[wt-down] Branch deleted (was fully merged): ${BRANCH_OR_SLUG}" \
            || echo "[wt-down] Branch kept (not yet merged): ${BRANCH_OR_SLUG}"
    fi
else
    echo "[wt-down] --keep-worktree: skipping worktree removal"
fi

# ---------------------------------------------------------------------------
# 4. Remove from registry
# ---------------------------------------------------------------------------

if [ -f "$REGISTRY_FILE" ]; then
    grep -v "^${SLUG}|" "$REGISTRY_FILE" > "${REGISTRY_FILE}.tmp" \
        && mv "${REGISTRY_FILE}.tmp" "$REGISTRY_FILE" || true
fi

echo ""
echo "=== Done: ${SLUG} torn down ==="
echo ""
