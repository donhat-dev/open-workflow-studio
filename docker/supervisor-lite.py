#!/usr/bin/env python3
"""
supervisor-lite — Lean PID 1 for Odoo dev containers.

Spawns Odoo HTTP worker immediately, respawns on SIGUSR1
(so code changes take effect without recreating the container).

Config (env vars):
    SUPERVISOR_KILL_IDLE   int  seconds idle before killing worker (0=off, default 0)
    ODOO_ENABLE_DEBUGPY    0|1  wrap worker with debugpy --wait-for-client (default 0)
    DEBUGPY_PORT           int  debugpy listen port (default 5678)
    ODOO_EXTRA_ARGS        str  extra args appended to odoo-bin command
    ODOO_BIN               str  path to odoo-bin (default /opt/odoo/source/odoo-bin)
    ODOO_CONF              str  path to odoo.conf (default /etc/odoo/odoo.conf)
    DB_HOST                str  overrides Odoo db_host when provided
    DB_PORT                str  overrides Odoo db_port when provided
    DB_USER                str  overrides Odoo db_user when provided
    DB_PASSWORD            str  overrides Odoo db_password when provided
"""
import logging
import os
import signal
import subprocess
import sys
import time

try:
    from setproctitle import setproctitle
except ImportError:
    def setproctitle(title):
        pass

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
KILL_IDLE = int(os.environ.get("SUPERVISOR_KILL_IDLE", "0"))
ODOO_BIN = os.environ.get("ODOO_BIN", "/opt/odoo/source/odoo-bin")
ODOO_CONF = os.environ.get("ODOO_CONF", "/etc/odoo/odoo.conf")
DEBUGPY_ENABLED = os.environ.get("ODOO_ENABLE_DEBUGPY", "0") == "1"
DEBUGPY_PORT = int(os.environ.get("DEBUGPY_PORT", "5678"))
EXTRA_ARGS = os.environ.get("ODOO_EXTRA_ARGS", "").split() or []

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [supervisor-lite] %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("supervisor-lite")


def _db_override_args():
    args = []
    mappings = [
        ("DB_HOST", "--db_host"),
        ("DB_PORT", "--db_port"),
        ("DB_USER", "--db_user"),
        ("DB_PASSWORD", "--db_password"),
    ]
    for env_name, cli_flag in mappings:
        value = os.environ.get(env_name)
        if value:
            args.extend([cli_flag, value])
    return args


# ---------------------------------------------------------------------------
# Worker slot
# ---------------------------------------------------------------------------
class WorkerSlot:
    __slots__ = ("proc", "started_at")

    def __init__(self):
        self.proc = None
        self.started_at = 0.0

    @property
    def alive(self):
        return self.proc is not None and self.proc.poll() is None

    @property
    def pid(self):
        return self.proc.pid if self.proc else None

    def reap_if_dead(self):
        if self.proc is None:
            return None
        rc = self.proc.poll()
        if rc is not None:
            self.proc = None
            return rc
        return None


# ---------------------------------------------------------------------------
# Globals
# ---------------------------------------------------------------------------
_worker = WorkerSlot()
_last_activity = 0.0
_shutdown = False
_restart_pending = False


# ---------------------------------------------------------------------------
# Spawn / kill
# ---------------------------------------------------------------------------
def _spawn_worker():
    global _last_activity

    cmd = []
    if DEBUGPY_ENABLED:
        log.info("debugpy enabled on :%d (--wait-for-client)", DEBUGPY_PORT)
        cmd = [
            sys.executable, "-m", "debugpy",
            "--listen", "0.0.0.0:%d" % DEBUGPY_PORT,
            "--wait-for-client",
            ODOO_BIN,
        ]
    else:
        cmd = [sys.executable, ODOO_BIN]

    db_override_args = _db_override_args()
    cmd += ["-c", ODOO_CONF, "--max-cron-threads=0"]
    cmd += EXTRA_ARGS
    cmd += db_override_args

    _worker.proc = subprocess.Popen(cmd)
    _worker.started_at = time.monotonic()
    _last_activity = _worker.started_at
    log.info("HTTP worker spawned (pid=%d, debug=%s)", _worker.pid, DEBUGPY_ENABLED)
    if db_override_args:
        log.info(
            "DB connection overridden from env (host=%s, port=%s, user=%s)",
            os.environ.get("DB_HOST", "(config)"),
            os.environ.get("DB_PORT", "(config)"),
            os.environ.get("DB_USER", "(config)"),
        )


def _kill_worker(timeout=30):
    if _worker.proc is None:
        return
    pid = _worker.pid
    try:
        os.kill(pid, signal.SIGTERM)
        log.info("SIGTERM sent to worker (pid=%d)", pid)
        _worker.proc.wait(timeout=timeout)
    except ProcessLookupError:
        pass
    except subprocess.TimeoutExpired:
        log.warning("Worker pid=%d did not exit in %ds, SIGKILL", pid, timeout)
        try:
            os.kill(pid, signal.SIGKILL)
            _worker.proc.wait(timeout=5)
        except (ProcessLookupError, subprocess.TimeoutExpired):
            pass
    _worker.proc = None
    log.info("HTTP worker stopped")


def _restart_worker():
    _kill_worker()
    _spawn_worker()


# ---------------------------------------------------------------------------
# Signal handlers (deferred to main loop)
# ---------------------------------------------------------------------------
def _on_sigterm(signum, frame):
    global _shutdown
    _shutdown = True
    log.info("SIGTERM received, shutting down")


def _on_sigusr1(signum, frame):
    global _restart_pending
    _restart_pending = True
    log.info("SIGUSR1 received, queuing worker restart")


def _on_sigchld(signum, frame):
    while True:
        try:
            pid, status = os.waitpid(-1, os.WNOHANG)
            if pid == 0:
                break
        except ChildProcessError:
            break


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    global _last_activity, _restart_pending

    setproctitle("supervisor-lite: odoo-dev")
    signal.signal(signal.SIGTERM, _on_sigterm)
    signal.signal(signal.SIGINT, _on_sigterm)
    signal.signal(signal.SIGCHLD, _on_sigchld)
    signal.signal(signal.SIGUSR1, _on_sigusr1)

    log.info("Ready (kill_idle=%s, debugpy=%s, extra_args=%s)",
             KILL_IDLE or "off", DEBUGPY_ENABLED, EXTRA_ARGS or "(none)")

    _spawn_worker()

    while not _shutdown:
        # --- Deferred restart from SIGUSR1 ---
        if _restart_pending:
            _restart_pending = False
            _restart_worker()

        # --- Reap unexpected exit ---
        rc = _worker.reap_if_dead()
        if rc is not None:
            log.warning("HTTP worker exited unexpectedly (code=%s)", rc)
            if not _shutdown:
                log.info("Respawning worker in 2s...")
                time.sleep(2)
                _spawn_worker()

        # --- Idle timeout ---
        now = time.monotonic()
        if _worker.alive and KILL_IDLE > 0:
            idle = now - _last_activity
            if idle > KILL_IDLE:
                log.info("Worker idle for %ds (> %ds), stopping", int(idle), KILL_IDLE)
                _kill_worker()

        # --- Sleep to avoid busy loop ---
        time.sleep(1.0)

    # --- Shutdown ---
    log.info("Shutting down...")
    _kill_worker()
    log.info("Exited cleanly")


if __name__ == "__main__":
    main()
