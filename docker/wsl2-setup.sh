#!/bin/bash
# =============================================================================
# WSL2 Source Copy Script
# Copies Odoo source + custom addons from Windows mounts into native WSL2 ext4
# to bypass Docker Desktop's 9p filesystem penalty.
#
# Usage (from PowerShell):
#   wsl -d Ubuntu -e bash /mnt/c/Users/ODOO/Documents/workflow_automation_builder/docker/wsl2-setup.sh
#
# Or from WSL terminal:
#   bash /mnt/c/Users/ODOO/Documents/workflow_automation_builder/docker/wsl2-setup.sh
# =============================================================================
set -euo pipefail

# --- Configuration ---
WSL_WORKSPACE="/home/odoo/odoo-workspace"

# Windows source paths (accessible via /mnt/c/... inside WSL)
WIN_ODOO_SOURCE="/mnt/c/Users/ODOO/Documents/GitHub/18EE-NS"
WIN_PROJECT="/mnt/c/Users/ODOO/Documents/workflow_automation_builder"
WIN_HRM="/mnt/c/Users/ODOO/Documents/GitHub/hrm-odoo/addons"
WIN_QUEUE="/mnt/c/Users/ODOO/Documents/GitHub/queue"
WIN_ODOO_DATA="/mnt/c/var/lib/odoo"

# --- Functions ---
elapsed() {
    local start=$1
    local end=$(date +%s)
    echo "$((end - start))s"
}

copy_with_progress() {
    local src="$1"
    local dest="$2"
    local label="$3"
    local start=$(date +%s)

    echo -n "  [$label] Copying $(basename "$src") ... "
    if [ -d "$src" ]; then
        # Use rsync for incremental updates (much faster on subsequent runs)
        rsync -a --delete "$src/" "$dest/"
        echo "done ($(elapsed $start))"
    else
        echo "SKIP (source not found: $src)"
    fi
}

# --- Main ---
echo "============================================="
echo "  WSL2 Odoo Workspace Setup"
echo "  Target: $WSL_WORKSPACE"
echo "  Filesystem: $(df -Th /home/odoo | tail -1 | awk '{print $2}')"
echo "============================================="
echo ""

TOTAL_START=$(date +%s)

# Create workspace structure
echo "[1/4] Creating workspace structure..."
mkdir -p "$WSL_WORKSPACE"/{source,custom,hrm_addons,third_party_addons,core_addons,odoo_addons,queue,data,docker}

# Copy Odoo source (the big one - ~4000+ py files)
echo "[2/4] Syncing Odoo source (first run is slow, subsequent runs are incremental)..."
copy_with_progress "$WIN_ODOO_SOURCE/odoo"   "$WSL_WORKSPACE/source/odoo"    "odoo-core"
copy_with_progress "$WIN_ODOO_SOURCE/addons"  "$WSL_WORKSPACE/source/addons"  "odoo-addons"
# Copy odoo-bin
cp -f "$WIN_ODOO_SOURCE/odoo-bin" "$WSL_WORKSPACE/source/odoo-bin" 2>/dev/null || true
cp -f "$WIN_ODOO_SOURCE/setup.py" "$WSL_WORKSPACE/source/setup.py" 2>/dev/null || true

# Copy custom addons
echo "[3/4] Syncing custom + third-party addons..."
copy_with_progress "$WIN_PROJECT/workflow_studio"               "$WSL_WORKSPACE/custom/workflow_studio"               "workflow_studio"
copy_with_progress "$WIN_PROJECT/workflow_studio_queue_job"     "$WSL_WORKSPACE/custom/workflow_studio_queue_job"     "queue_job_ext"
copy_with_progress "$WIN_PROJECT/flight_json_widget"            "$WSL_WORKSPACE/custom/flight_json_widget"            "flight_json"
copy_with_progress "$WIN_PROJECT/lf_web_studio"                 "$WSL_WORKSPACE/custom/lf_web_studio"                 "lf_web_studio"
copy_with_progress "$WIN_HRM/hrm"           "$WSL_WORKSPACE/hrm_addons"           "hrm"
copy_with_progress "$WIN_HRM/third_party"   "$WSL_WORKSPACE/third_party_addons"   "third_party"
copy_with_progress "$WIN_HRM/core"          "$WSL_WORKSPACE/core_addons"          "core"
copy_with_progress "$WIN_QUEUE"             "$WSL_WORKSPACE/queue"                "queue"
# Odoo addons (writable copy)
copy_with_progress "$WIN_ODOO_SOURCE/odoo/addons"  "$WSL_WORKSPACE/odoo_addons"  "odoo/addons"

# Copy docker build context
echo "[4/4] Syncing Docker build context..."
copy_with_progress "$WIN_PROJECT/docker"  "$WSL_WORKSPACE/docker"  "docker-ctx"

# Create persistent data dir
mkdir -p "$WSL_WORKSPACE/data"

# Summary
echo ""
echo "============================================="
echo "  DONE in $(elapsed $TOTAL_START)"
echo "  Workspace: $WSL_WORKSPACE"
echo "  Size: $(du -sh "$WSL_WORKSPACE" | cut -f1)"
echo "============================================="
echo ""
echo "Next steps:"
echo "  cd $WSL_WORKSPACE"
echo "  docker compose -f docker/docker-compose.wsl.yml up --build"
echo ""
echo "To re-sync after code changes:"
echo "  bash $0   # rsync makes subsequent runs fast (~seconds)"
