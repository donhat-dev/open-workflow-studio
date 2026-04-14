#!/usr/bin/env python3
"""Ensure a debug-ready Odoo worker exists for VS Code attach.

This helper replaces the long shell one-liner previously embedded in
``.vscode/tasks.json``. It supports two flows:

1. If the running container is already in debug mode, restart the worker via
   ``SIGUSR1`` and wait until a *new* debugpy worker PID appears.
2. Otherwise, bring the stack up with the debug compose overlay and wait until
   the debugpy worker process is present.

The script intentionally does *not* probe port 5678, because touching the DAP
port can interfere with the real debugger attach performed by VS Code.
"""

from __future__ import annotations

import json
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path


WORKSPACE_ROOT = Path(__file__).resolve().parent.parent
CONTAINER_NAME = "odoo-workflow-dev"
IN_CONTAINER_RESTART_SCRIPT = "/opt/odoo/open-workflow-studio/docker/odoo-restart"
DEBUG_ENV_NAME = "ODOO_ENABLE_DEBUGPY"
DEBUG_ENV_VALUE = "1"
DEBUG_PATTERN = (
    r"[d]ebugpy --listen 0\.0\.0\.0:5678 --wait-for-client "
    r"/opt/odoo/source/odoo-bin"
)
RESTART_TIMEOUT_SECONDS = 30
SPAWN_TIMEOUT_SECONDS = 30
POLL_INTERVAL_SECONDS = 1.0


@dataclass(frozen=True)
class ContainerState:
    exists: bool
    running: bool
    env: dict[str, str]

    @property
    def is_debug_enabled(self) -> bool:
        return self.env.get(DEBUG_ENV_NAME) == DEBUG_ENV_VALUE


def log(message: str) -> None:
    print(message, flush=True)


def run_command(*args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        cwd=WORKSPACE_ROOT,
        text=True,
        capture_output=True,
        check=check,
    )


def get_container_state() -> ContainerState:
    result = run_command("docker", "inspect", CONTAINER_NAME, check=False)
    if result.returncode != 0:
        return ContainerState(exists=False, running=False, env={})

    inspect_data = json.loads(result.stdout)[0]
    raw_env = inspect_data.get("Config", {}).get("Env", [])
    env = {}
    for item in raw_env:
        key, _, value = item.partition("=")
        env[key] = value

    return ContainerState(
        exists=True,
        running=bool(inspect_data.get("State", {}).get("Running")),
        env=env,
    )


def get_debug_worker_pid() -> str | None:
    result = run_command(
        "docker",
        "exec",
        CONTAINER_NAME,
        "sh",
        "-lc",
        f'pgrep -f "{DEBUG_PATTERN}" | tail -n 1',
        check=False,
    )
    pid = result.stdout.strip()
    return pid or None


def restart_worker() -> None:
    result = run_command(
        "docker",
        "exec",
        CONTAINER_NAME,
        "python3",
        IN_CONTAINER_RESTART_SCRIPT,
        "http",
    )
    stdout = result.stdout.strip()
    if stdout:
        print(stdout, flush=True)


def compose_up_debug() -> None:
    result = run_command(
        "docker",
        "compose",
        "-f",
        "docker-compose.yml",
        "-f",
        "docker-compose.debug.yml",
        "up",
        "--force-recreate",
        "-d",
    )
    stdout = result.stdout.strip()
    if stdout:
        print(stdout, flush=True)


def wait_for_old_worker_to_stop(old_pid: str) -> None:
    log("Waiting for old debug worker to stop...")
    deadline = time.monotonic() + RESTART_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        current_pid = get_debug_worker_pid()
        if not current_pid or current_pid != old_pid:
            return
        time.sleep(POLL_INTERVAL_SECONDS)
    raise TimeoutError(
        f"Timed out waiting for old debug worker pid={old_pid} to stop"
    )


def wait_for_new_worker(old_pid: str | None) -> str:
    log("Waiting for debugpy process...")
    deadline = time.monotonic() + SPAWN_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        current_pid = get_debug_worker_pid()
        if current_pid and (old_pid is None or current_pid != old_pid):
            log(f"debugpy ready (pid={current_pid})")
            return current_pid
        time.sleep(POLL_INTERVAL_SECONDS)
    raise TimeoutError("Timed out waiting for debugpy process")


def ensure_debug_worker() -> str:
    state = get_container_state()
    old_pid = None

    if state.exists and state.running and state.is_debug_enabled:
        old_pid = get_debug_worker_pid()
        restart_worker()
        if old_pid:
            wait_for_old_worker_to_stop(old_pid)
    else:
        compose_up_debug()

    return wait_for_new_worker(old_pid=old_pid)


def main() -> int:
    try:
        ensure_debug_worker()
    except (OSError, subprocess.SubprocessError, TimeoutError, json.JSONDecodeError) as exc:
        print(f"ensure_debug_worker failed: {exc}", file=sys.stderr, flush=True)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())