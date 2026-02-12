"""Trigger Odoo server restart — for coding agents.

Call this ONCE after finishing all Python code edits.
Unlike --dev=reload, this does NOT auto-restart on every file save.

How it works:
1. Creates .restart_signal file
2. Terminates the current Odoo process
3. dev_server.py wrapper detects the signal and spawns fresh Odoo

Usage:
    python trigger_restart.py                     # auto-detect ODOO_ROOT
    python trigger_restart.py C:\\path\\to\\18EE-NS   # explicit path

Env var: ODOO_ROOT overrides the default path.
"""
import os
import signal
import sys
import time

# Resolve Odoo root directory
if len(sys.argv) > 1:
    ODOO_ROOT = sys.argv[1]
elif os.environ.get('ODOO_ROOT'):
    ODOO_ROOT = os.environ['ODOO_ROOT']
else:
    ODOO_ROOT = r'C:\Users\ODOO\Documents\GitHub\18EE-NS'

PID_FILE = os.path.join(ODOO_ROOT, '.odoo.pid')
SIGNAL_FILE = os.path.join(ODOO_ROOT, '.restart_signal')


def main():
    if not os.path.exists(PID_FILE):
        print(f"[trigger] ERROR: PID file not found: {PID_FILE}")
        print(f"[trigger] Is dev_server.py running?")
        sys.exit(1)

    with open(PID_FILE) as f:
        pid = int(f.read().strip())

    # Create signal file BEFORE killing (wrapper checks after process exits)
    with open(SIGNAL_FILE, 'w') as f:
        f.write(str(time.time()))

    try:
        os.kill(pid, signal.SIGTERM)
        print(f"[trigger] Sent SIGTERM to Odoo (pid {pid})")
        print(f"[trigger] dev_server.py will restart automatically.")
    except ProcessLookupError:
        print(f"[trigger] Process {pid} already stopped.")
        print(f"[trigger] Signal file created — wrapper will restart on next cycle.")
    except PermissionError:
        print(f"[trigger] Permission denied for pid {pid}")
        sys.exit(1)


if __name__ == '__main__':
    main()
