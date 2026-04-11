#!/usr/bin/env python3
"""
Odoo Supervisor — PID 1 process manager with socket activation + UDS control.

Responsibilities:
  - Pre-bind :8069, pass fd to Odoo HTTP worker via LISTEN_FDS
  - Spawn cron worker (odoo-rpc, periodic single-shot, XML-RPC triggered)
  - UDS control channel for restart/status commands
  - Signal shortcuts: SIGUSR1=restart http, SIGUSR2=restart cron
  - Idle timeout for HTTP worker (on-demand spawn)
"""
import compileall
import json
import logging
import os
import pwd
import select
import signal
import socket
import subprocess
import sys
import time
import xmlrpc.client

try:
    from setproctitle import setproctitle
except ImportError:
    def setproctitle(title):
        pass

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
IDLE_TIMEOUT = int(os.environ.get("SUPERVISOR_IDLE_TIMEOUT", "900"))
IDLE_COOLDOWN = int(os.environ.get("SUPERVISOR_IDLE_COOLDOWN", "5"))
HTTP_PORT = int(os.environ.get("SUPERVISOR_HTTP_PORT", "8069"))
BACKLOG = 128
ODOO_BIN = os.environ.get("ODOO_BIN", "/usr/local/bin/odoo-bin")
ODOO_RPC = os.environ.get("ODOO_RPC", "/usr/local/sbin/odoo-rpc")
ODOO_CONF = os.environ.get("ODOO_CONF", "/etc/odoo/odoo.conf")
ODOO_USER = os.environ.get("ODOO_USER", "odoo")
CRON_INTERVAL = int(os.environ.get("SUPERVISOR_CRON_INTERVAL", "300"))
CRON_TIMEOUT = int(os.environ.get("SUPERVISOR_CRON_TIMEOUT", "120"))
CRON_PORT = int(os.environ.get("SUPERVISOR_CRON_PORT", "8070"))
DEBUGPY_ENABLED = os.environ.get("DEBUGPY_ENABLE", "0") == "1"
DEBUGPY_PORT = int(os.environ.get("DEBUGPY_PORT", "5678"))
PRECOMPILE_ENABLED = os.environ.get("SUPERVISOR_PRECOMPILE", "1") == "1"
READY_SENTINEL = "/tmp/odoo-http.ready"
LABEL = os.environ.get(
    "SUPERVISOR_LABEL",
    "WF-STUDIO: [workflow-dev / dev / 18.0]",
)
CONTROL_SOCKET = os.environ.get("SUPERVISOR_SOCK", "/var/run/odoo-supervisor.sock")
PGDATABASE = os.environ.get("PGDATABASE", "")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [supervisor] %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("supervisor")

# ---------------------------------------------------------------------------
# Worker registry
# ---------------------------------------------------------------------------
VALID_GROUPS = ("http", "cron")


class WorkerSlot:
    """Tracks a single worker process and its metadata."""
    __slots__ = ("group", "proc", "started_at")

    def __init__(self, group):
        self.group = group
        self.proc = None
        self.started_at = 0.0

    @property
    def alive(self):
        return self.proc is not None and self.proc.poll() is None

    @property
    def pid(self):
        return self.proc.pid if self.proc else None

    @property
    def uptime(self):
        if not self.alive:
            return 0.0
        return time.monotonic() - self.started_at

    def reap_if_dead(self):
        """Check and clear proc if exited. Returns exit code or None."""
        if self.proc is None:
            return None
        rc = self.proc.poll()
        if rc is not None:
            self.proc = None
            return rc
        return None


_workers = {}           # group -> WorkerSlot
_last_activity = 0.0    # tracks HTTP socket activity for idle timeout
_idle_cooldown_until = 0.0  # monotonic deadline; connections drained during cooldown
_next_cron_spawn = 0.0  # monotonic time for next periodic cron spawn
_cron_rpc_pending = False  # True when cron is spawned, waiting for XML-RPC trigger
_shutdown = False
_sock = None            # pre-bound HTTP socket
_ctrl_sock = None       # UDS control socket
_restart_pending = set()  # groups queued for restart by signal handlers


def _get_odoo_pw():
    return pwd.getpwnam(ODOO_USER)


# ---------------------------------------------------------------------------
# Bytecode precompilation (boot-time, ~34% registry load speedup)
# ---------------------------------------------------------------------------
PYCACHE_PREFIX = os.environ.get("PYTHONPYCACHEPREFIX", "/tmp/pycache")
PRECOMPILE_WORKERS = int(os.environ.get("SUPERVISOR_PRECOMPILE_WORKERS", "1"))

# Targeted paths: only odoo core + addons we actually import.
# EXCLUDED (by design):
#   /opt/odoo/source          — recursive walk hits .python/site-packages (6k .py)
#                               and odoo/addons (14k .py, overlaps separate mount)
#   /opt/odoo/odoo/addons     — same inode as /opt/odoo/source/odoo/addons
#
# Instead, compile only the specific subdirs Odoo actually loads:
_COMPILE_PATHS = [
    "/opt/odoo/source/odoo",           # odoo core (framework + addons)
    "/opt/odoo/custom",                # workflow_studio, flight_json etc.
    "/opt/odoo/hrm_addons",
    "/opt/odoo/third_party_addons",
    "/opt/odoo/core_addons",
    "/opt/odoo/queue",
]
# Subdirs to skip when walking (not imported by Odoo, waste I/O)
_COMPILE_SKIP = {"tests", "test", "static", "doc", "docs", "i18n", "i18n_extra"}


def precompile_bytecode():
    """Precompile .pyc for addon paths. Runs once at boot as root.

    Skips when persistent cache volume has a sentinel file (warm boot).
    On Docker-on-Windows, stat() on volume mounts is ~32x slower than
    native, so the sentinel lives in the native pycache volume.
    To force recompile: `docker compose down -v` (removes volumes).
    """
    os.environ["PYTHONPYCACHEPREFIX"] = PYCACHE_PREFIX
    sys.pycache_prefix = PYCACHE_PREFIX
    os.makedirs(PYCACHE_PREFIX, exist_ok=True)

    compile_dirs = [p for p in _COMPILE_PATHS if os.path.isdir(p)]
    if not compile_dirs:
        log.warning("No addon paths found to precompile")
        return

    # Sentinel: if pycache volume survived restart, skip recompile
    sentinel = os.path.join(PYCACHE_PREFIX, ".compiled_sentinel")
    if os.path.isfile(sentinel):
        log.info("Bytecode cache warm (sentinel exists), skipping precompile "
                 "(docker compose down -v to force)")
        return

    t0 = time.monotonic()
    total_files = 0
    for d in compile_dirs:
        py_count = _compile_dir_selective(d)
        total_files += py_count

    # Write sentinel on success
    try:
        with open(sentinel, "w") as f:
            f.write(f"compiled={total_files} at={time.strftime('%Y-%m-%dT%H:%M:%S')}\n")
    except OSError as e:
        log.warning("Could not write compile sentinel: %s", e)

    elapsed = time.monotonic() - t0
    log.info(
        "Bytecode precompiled (%d paths, %d .py, %.1fs, prefix=%s)",
        len(compile_dirs), total_files, elapsed, PYCACHE_PREFIX,
    )


def _compile_dir_selective(path):
    """Walk path, compile .py files, skip dirs in _COMPILE_SKIP."""
    count = 0
    for root, dirs, files in os.walk(path):
        # Prune dirs we never import
        dirs[:] = [d for d in dirs if d not in _COMPILE_SKIP and not d.startswith('.')]
        py_files = [f for f in files if f.endswith('.py')]
        if not py_files:
            continue
        # compile_dir on this single directory (no recursion — we handle recursion)
        compileall.compile_dir(root, maxlevels=0, quiet=2, workers=0)
        count += len(py_files)
    return count


def _drop_privilege():
    """preexec_fn for child: switch to ODOO_USER."""
    pw = _get_odoo_pw()
    os.setgid(pw.pw_gid)
    os.initgroups(pw.pw_name, pw.pw_gid)
    os.setuid(pw.pw_uid)
    os.environ["HOME"] = pw.pw_dir


# ---------------------------------------------------------------------------
# Socket
# ---------------------------------------------------------------------------
def create_listen_socket():
    """Pre-bind and listen on HTTP_PORT. Returns the socket."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("0.0.0.0", HTTP_PORT))
    sock.listen(BACKLOG)
    sock.setblocking(False)
    os.set_inheritable(sock.fileno(), True)
    log.info("Socket bound on :%d (fd=%d, backlog=%d)", HTTP_PORT, sock.fileno(), BACKLOG)
    return sock


def create_control_socket():
    """Create UDS for control commands. Returns the socket."""
    if os.path.exists(CONTROL_SOCKET):
        os.unlink(CONTROL_SOCKET)
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.bind(CONTROL_SOCKET)
    sock.listen(5)
    sock.setblocking(False)
    # Make accessible to odoo user (shell usage)
    pw = _get_odoo_pw()
    os.chown(CONTROL_SOCKET, 0, pw.pw_gid)
    os.chmod(CONTROL_SOCKET, 0o660)
    log.info("Control socket at %s (mode=660)", CONTROL_SOCKET)
    return sock


# ---------------------------------------------------------------------------
# Worker spawn/kill (generic)
# ---------------------------------------------------------------------------
def _base_preexec():
    """Common preexec for all workers: bytecode cache + privilege drop."""
    os.environ["PYTHONPYCACHEPREFIX"] = PYCACHE_PREFIX
    _drop_privilege()


def spawn_worker(group):
    """Spawn a worker by group name. Returns the new PID."""
    slot = _workers[group]
    if slot.alive:
        log.warning("spawn_worker(%s): already alive (pid=%d), killing first", group, slot.pid)
        kill_worker(group)

    if group == "http":
        _spawn_http(slot)
    elif group == "cron":
        _spawn_cron(slot)

    log.info("%s worker spawned (pid=%d)", group.upper(), slot.pid)
    return slot.pid


def _cleanup_ready_sentinel():
    """Remove HTTP readiness sentinel (stale from previous worker)."""
    try:
        os.unlink(READY_SENTINEL)
    except FileNotFoundError:
        pass


def _spawn_http(slot):
    """Spawn HTTP worker with socket activation + optional debugpy."""
    global _last_activity
    _cleanup_ready_sentinel()
    fd = _sock.fileno()
    target_fd = 3

    cmd = []
    if DEBUGPY_ENABLED:
        log.info("debugpy enabled on :%d for HTTP worker", DEBUGPY_PORT)
        cmd = [
            sys.executable, "-m", "debugpy",
            "--listen", f"0.0.0.0:{DEBUGPY_PORT}",
            ODOO_BIN,
        ]
    else:
        cmd = [sys.executable, ODOO_BIN]
    cmd += ["server", "-c", ODOO_CONF, "--max-cron-threads=0"]
    if PGDATABASE:
        cmd += ["-d", PGDATABASE]

    def child_preexec():
        os.environ["LISTEN_FDS"] = "1"
        os.environ["LISTEN_PID"] = str(os.getpid())
        _base_preexec()
        if fd != target_fd:
            os.dup2(fd, target_fd)
            os.close(fd)
        os.set_inheritable(target_fd, True)

    slot.proc = subprocess.Popen(cmd, preexec_fn=child_preexec, pass_fds=(fd,))
    slot.started_at = time.monotonic()
    _last_activity = slot.started_at


def _spawn_cron(slot):
    """Spawn cron worker via odoo-rpc: XML-RPC triggered job processing."""
    cmd = [
        sys.executable, ODOO_RPC,
        "-c", ODOO_CONF,
        "--max-cron-threads=0",
        "--http-port=%d" % CRON_PORT,
        "--limit-time-real-cron=0",
        "--limit-time-real=0",
    ]
    if PGDATABASE:
        cmd += ["-d", PGDATABASE]

    def child_preexec():
        _base_preexec()

    slot.proc = subprocess.Popen(cmd, preexec_fn=child_preexec)
    slot.started_at = time.monotonic()


def _trigger_cron_rpc():
    """Send XML-RPC call to cron worker to trigger acquire_job.

    Returns True if RPC succeeded, False if worker not ready yet.
    """
    url = "http://127.0.0.1:%d/xmlrpc/2/object" % CRON_PORT
    try:
        proxy = xmlrpc.client.ServerProxy(url)
        proxy.execute_kw("ir.cron", "acquire_job", [[]], {})
        return True
    except ConnectionRefusedError:
        return False
    except OSError:
        return False
    except Exception:
        log.warning("Cron XML-RPC call failed", exc_info=True)
        return True  # still treat as triggered to avoid retry loop


def kill_worker(group, sig=signal.SIGTERM):
    """Terminate a worker by group. Escalates to SIGKILL after 15 minutes."""
    slot = _workers[group]
    if slot.proc is None:
        return
    pid = slot.pid
    try:
        os.kill(pid, sig)
        log.info("Sent %s to %s worker (pid=%d)", sig.name, group, pid)
        slot.proc.wait(timeout=CRON_TIMEOUT if group == "cron" else 15 * 60)
    except ProcessLookupError:
        pass
    except subprocess.TimeoutExpired:
        log.warning("%s worker (pid=%d) did not exit in 15 minutes, SIGKILL", group, pid)
        try:
            os.kill(pid, signal.SIGKILL)
            slot.proc.wait(timeout=5)
        except (ProcessLookupError, subprocess.TimeoutExpired):
            pass
    slot.proc = None
    log.info("%s worker stopped", group.upper())


def restart_worker(group):
    """Kill then respawn a worker. Returns response dict for UDS protocol."""
    if group not in VALID_GROUPS:
        return {"ok": False, "msg": f"Unknown group: {group}"}
    kill_worker(group)
    pid = spawn_worker(group)
    return {"ok": True, "pid": pid, "msg": f"{group.upper()} worker restarted"}


def get_status():
    """Return status dict for all workers."""
    result = {}
    for group, slot in _workers.items():
        result[group] = {
            "pid": slot.pid,
            "alive": slot.alive,
            "uptime": round(slot.uptime, 1),
        }
    return {"workers": result, "db": PGDATABASE}


# ---------------------------------------------------------------------------
# UDS control channel
# ---------------------------------------------------------------------------
def handle_control_client(client_sock):
    """Read one JSON command from client, dispatch, respond, close."""
    try:
        data = b""
        while True:
            chunk = client_sock.recv(4096)
            if not chunk:
                break
            data += chunk
            if b"\n" in data or len(data) > 65536:
                break

        if not data:
            return

        try:
            msg = json.loads(data.decode("utf-8", errors="replace").strip())
        except (json.JSONDecodeError, UnicodeDecodeError):
            _send_response(client_sock, {"ok": False, "msg": "Invalid JSON"})
            return

        action = msg.get("action", "")
        if action == "restart":
            group = msg.get("group", "")
            resp = restart_worker(group)
        elif action == "status":
            status = get_status()
            resp = {"ok": True, "workers": status["workers"], "db": status["db"]}
        else:
            resp = {"ok": False, "msg": f"Unknown action: {action}"}

        _send_response(client_sock, resp)
    except Exception as exc:
        log.error("Control channel error: %s", exc)
        try:
            _send_response(client_sock, {"ok": False, "msg": str(exc)})
        except Exception:
            pass
    finally:
        client_sock.close()


def _send_response(client_sock, resp):
    payload = json.dumps(resp).encode("utf-8") + b"\n"
    client_sock.sendall(payload)


# ---------------------------------------------------------------------------
# Signal handlers
# ---------------------------------------------------------------------------
def _on_sigterm(signum, frame):
    global _shutdown
    _shutdown = True
    log.info("SIGTERM received, shutting down...")


def _on_sigusr1(signum, frame):
    """SIGUSR1 = restart HTTP worker (deferred to main loop)."""
    _restart_pending.add("http")
    log.info("SIGUSR1 received, queuing HTTP restart")


def _on_sigusr2(signum, frame):
    """SIGUSR2 = restart cron worker (deferred to main loop)."""
    _restart_pending.add("cron")
    log.info("SIGUSR2 received, queuing cron restart")


def _on_sigchld(signum, frame):
    """Reap zombie children."""
    while True:
        try:
            pid, status = os.waitpid(-1, os.WNOHANG)
            if pid == 0:
                break
            log.info("Reaped child pid=%d status=%d", pid, status)
        except ChildProcessError:
            break


def _drain_pending_connections():
    """Accept and immediately close pending connections on the HTTP socket.

    Used during post-idle cooldown to prevent browser reconnect retries
    from triggering an immediate worker re-spawn.
    """
    drained = 0
    while True:
        try:
            conn, _ = _sock.accept()
            conn.close()
            drained += 1
        except (BlockingIOError, OSError):
            break
    if drained:
        remaining = max(0, _idle_cooldown_until - time.monotonic())
        log.info("Drained %d connection(s) during idle cooldown (%.0fs remaining)",
                 drained, remaining)


# Timeout for peeking at accepted connections to distinguish real HTTP
# clients from phantom TCP probes (Docker Desktop port-forwarding relays).
_PEEK_TIMEOUT = 1.0


def _is_real_http_connection():
    """Accept a pending connection and peek for HTTP data.

    Docker Desktop's wslrelay/com.docker.backend can create phantom TCP
    connections (SYN → established → no data → RST) when refreshing its
    port-forwarding table.  These trigger select() on the listening socket
    but never send any HTTP bytes.

    Strategy:
      1. accept() the pending connection
      2. recv(4, MSG_PEEK) with a short timeout
      3. If data arrives → real HTTP client.  Close the probed connection
         (client TCP stack will retry) and return True so the caller spawns
         the HTTP worker to accept subsequent connections.
      4. If timeout / empty → phantom probe.  Close quietly, return False.
    """
    try:
        conn, addr = _sock.accept()
    except (BlockingIOError, OSError):
        return False

    try:
        conn.setblocking(False)
        ready, _, _ = select.select([conn], [], [], _PEEK_TIMEOUT)
        if ready:
            data = conn.recv(4, socket.MSG_PEEK)
            if data:
                log.info("Real HTTP connection from %s (peeked %d bytes), spawning worker",
                         addr[0], len(data))
                return True
        # No data within timeout → phantom probe
        log.debug("Phantom TCP probe from %s (no HTTP data in %.1fs), ignoring",
                  addr[0], _PEEK_TIMEOUT)
        return False
    except OSError:
        return False
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------
def main():
    global _sock, _ctrl_sock, _last_activity, _idle_cooldown_until, _next_cron_spawn, _cron_rpc_pending

    # Auto-generate label with PGDATABASE if not explicitly set
    label = LABEL
    if PGDATABASE and PGDATABASE not in label:
        label = f"{LABEL} db={PGDATABASE}"
    setproctitle(label)

    signal.signal(signal.SIGTERM, _on_sigterm)
    signal.signal(signal.SIGINT, _on_sigterm)
    signal.signal(signal.SIGCHLD, _on_sigchld)
    signal.signal(signal.SIGUSR1, _on_sigusr1)
    signal.signal(signal.SIGUSR2, _on_sigusr2)

    # Initialize worker slots
    for g in VALID_GROUPS:
        _workers[g] = WorkerSlot(g)

    _sock = create_listen_socket()
    _ctrl_sock = create_control_socket()

    if PRECOMPILE_ENABLED:
        precompile_bytecode()
    else:
        log.info("Bytecode precompile skipped (SUPERVISOR_PRECOMPILE=0)")

    # Schedule first cron spawn immediately at boot
    _next_cron_spawn = time.monotonic()

    log.info("Supervisor ready (label=%s, idle_timeout=%ds, cron_interval=%ds, groups=%s)",
             LABEL, IDLE_TIMEOUT, CRON_INTERVAL, ",".join(VALID_GROUPS))

    while not _shutdown:
        # Process deferred signal restarts
        while _restart_pending:
            group = _restart_pending.pop()
            restart_worker(group)

        # select on: HTTP socket (for on-demand spawn) + control socket (for commands)
        try:
            readable, _, _ = select.select([_sock, _ctrl_sock], [], [], 1.0)
        except (OSError, ValueError):
            if _shutdown:
                break
            raise

        for sock in readable:
            if sock is _sock:
                now = time.monotonic()
                if now < _idle_cooldown_until:
                    # Post-idle cooldown: drain connections instead of spawning
                    _drain_pending_connections()
                else:
                    if not _workers["http"].alive:
                        if _is_real_http_connection():
                            _last_activity = now
                            spawn_worker("http")
                    else:
                        _last_activity = now
            elif sock is _ctrl_sock:
                # Control command incoming
                try:
                    client, _ = _ctrl_sock.accept()
                    handle_control_client(client)
                except OSError:
                    pass

        # Check HTTP worker for unexpected exits
        http = _workers["http"]
        rc = http.reap_if_dead()
        if rc is not None:
            log.warning("HTTP worker exited unexpectedly (code=%s)", rc)

        # Cron periodic lifecycle (odoo-rpc: spawn → XML-RPC trigger → SIGTERM)
        cron = _workers["cron"]
        now = time.monotonic()
        if CRON_INTERVAL > 0:
            # Reap cron if it exited (normal: SIGTERM after RPC completes)
            cron_uptime = now - cron.started_at if cron.started_at else 0
            cron_rc = cron.reap_if_dead()
            if cron_rc is not None:
                log.info("CRON worker exited (code=%s, uptime=%.0fs), next spawn in %ds",
                         cron_rc, cron_uptime, CRON_INTERVAL)
                _next_cron_spawn = now + CRON_INTERVAL
                _cron_rpc_pending = False

            # Force-kill if cron exceeded timeout (failsafe)
            if cron.alive and CRON_TIMEOUT > 0 and (now - cron.started_at) > CRON_TIMEOUT:
                log.warning("CRON worker exceeded %ds timeout (uptime=%.0fs), killing",
                            CRON_TIMEOUT, now - cron.started_at)
                kill_worker("cron")
                _next_cron_spawn = now + CRON_INTERVAL
                _cron_rpc_pending = False

            # Try XML-RPC trigger if cron is alive and RPC not yet sent
            if cron.alive and _cron_rpc_pending:
                if _trigger_cron_rpc():
                    log.info("CRON XML-RPC trigger sent, sending SIGTERM")
                    kill_worker("cron")
                    _next_cron_spawn = now + CRON_INTERVAL
                    _cron_rpc_pending = False

            # Spawn cron if interval elapsed and not already running
            if not cron.alive and now >= _next_cron_spawn:
                # Gate: defer cron while HTTP is loading registry to avoid
                # concurrent registry init (PostgreSQL SerializationFailure)
                if http.alive and not os.path.isfile(READY_SENTINEL):
                    log.info("Deferring cron spawn (HTTP worker pid=%d still loading)", http.pid)
                else:
                    log.info("Periodic cron spawn (interval=%ds)", CRON_INTERVAL)
                    spawn_worker("cron")
                    _cron_rpc_pending = True

        # HTTP idle timeout
        if http.alive and IDLE_TIMEOUT > 0:
            idle_secs = time.monotonic() - _last_activity
            if idle_secs > IDLE_TIMEOUT:
                log.info("HTTP worker idle for %ds (> %ds), stopping...",
                         int(idle_secs), IDLE_TIMEOUT)
                kill_worker("http")
                _idle_cooldown_until = time.monotonic() + IDLE_COOLDOWN
                log.info("Idle cooldown active for %ds (draining reconnects)", IDLE_COOLDOWN)

    # Shutdown
    log.info("Shutting down supervisor...")
    for g in VALID_GROUPS:
        kill_worker(g)
    _sock.close()
    _ctrl_sock.close()
    if os.path.exists(CONTROL_SOCKET):
        os.unlink(CONTROL_SOCKET)
    log.info("Supervisor exited cleanly.")


if __name__ == "__main__":
    main()
