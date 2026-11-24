#!/usr/bin/env python3
"""Gate A relock-only Unix stop bridge. SOURCE CANDIDATE; NOT INSTALLED.

The independent DynamicUser watchdog calls notify_stage_stop BEFORE its
fixed-function DB relock. A failed STOP must never prevent the SQL relock
attempt. systemd accepts an AF_UNIX socket and
runs the server as a narrowly sandboxed privileged one-shot. The receiver
compares SO_PEERCRED PID with the current watchdog MainPID and stops ONLY the
single fixed Gate A preapproval broker unit. Never starts broker, opens LOGIN,
executes SQL, accepts a unit name, or reads a password.
"""
import os
import socket
import struct
import subprocess
import sys

SOCKET_PATH = "/run/cst-onejob-gatea-stage-stop.sock"
WATCHDOG = "cst-onejob-gatea-watchdog.service"
BROKER = "cst-onejob-gatea-preapproval-broker.service"
BROKER_SOCKET = "/run/cst-onejob-stage-db/pg-pooler.sock"
COMMAND = b"CST_GATEA_BEFORE_RELOCK_STOP_V1\n"
ACK = (b"STAGE_BROKER_STOPPED_V1\n", b"STAGE_BROKER_ABSENT_V1\n")
DENIED = "GATEA_STOP_BRIDGE_DENIED"

class StopBridgeDenied(RuntimeError):
    pass

def _execute(*argv):
    try:
        return subprocess.run(argv, capture_output=True, text=True,
                              timeout=8, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise StopBridgeDenied("EXEC_FAILED") from None

def _unit_property(unit, prop):
    r = _execute("/usr/bin/systemctl", "show", "-p", prop,
                 "--value", unit)
    if r.returncode or not r.stdout.strip():
        raise StopBridgeDenied("UNIT_STATE_UNAVAILABLE")
    return r.stdout.strip()

def _watchdog_main_pid():
    if _unit_property(WATCHDOG, "ActiveState") != "active":
        raise StopBridgeDenied("WATCHDOG_INACTIVE")
    raw = _unit_property(WATCHDOG, "MainPID")
    if not raw.isdigit() or int(raw) < 2:
        raise StopBridgeDenied("WATCHDOG_PID_UNAVAILABLE")
    return int(raw)

def _watchdog_cgroup(pid):
    try:
        with open("/proc/%d/cgroup" % pid, "r", encoding="utf-8") as handle:
            lines = handle.read(4096).splitlines()
    except OSError:
        raise StopBridgeDenied("WATCHDOG_CGROUP_UNAVAILABLE") from None
    # Exact unified cgroup rather than a foreign nested path with same suffix.
    return lines == ["0::/system.slice/" + WATCHDOG]

def _peercred(connection):
    packed = connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED,
                                    struct.calcsize("3i"))
    return struct.unpack("3i", packed)

def _read_small_command(connection):
    # SOCK_STREAM does not guarantee a single recv returns the full message.
    # The client shuts down writing after sending one exact framed command.
    payload=bytearray()
    while len(payload)<len(COMMAND)+1:
        chunk=connection.recv(len(COMMAND)+1-len(payload))
        if not chunk:
            break
        payload.extend(chunk)
    if bytes(payload)!=COMMAND:
        raise StopBridgeDenied("COMMAND_INVALID")

def _read_bounded_ack(connection):
    result=bytearray()
    while len(result)<64:
        chunk=connection.recv(64-len(result))
        if not chunk:
            break
        result.extend(chunk)
        if result.endswith(b"\n"):
            break
    return bytes(result)

def stop_exact_stage_broker():
    """No unit name from clients; requires unit + Unix socket absence readback."""
    state = _unit_property(BROKER, "LoadState")
    if state not in ("not-found", "loaded"):
        raise StopBridgeDenied("BROKER_UNIT_UNTRUSTED")
    if state == "loaded":
        # Deny a replaced or unsafe unit before privileged STOP.
        if (_unit_property(BROKER, "FragmentPath") !=
                "/etc/systemd/system/" + BROKER
            or _unit_property(BROKER, "KillMode") != "control-group"
            or _unit_property(BROKER, "Restart") != "no"):
            raise StopBridgeDenied("BROKER_UNIT_PROVENANCE_DENIED")
        if _unit_property(BROKER, "ActiveState") == "active":
            r = _execute("/usr/bin/systemctl", "stop", BROKER)
            if r.returncode:
                raise StopBridgeDenied("BROKER_STOP_FAILED")
        if (_unit_property(BROKER, "ActiveState") != "inactive"
            or _unit_property(BROKER, "MainPID") != "0"):
            raise StopBridgeDenied("BROKER_STOP_READBACK_FAILED")
    # A stale Unix socket or a foreign replacement must NEVER be reported
    # as a clean transport stop.
    if os.path.lexists(BROKER_SOCKET):
        raise StopBridgeDenied("BROKER_SOCKET_STILL_PRESENT")
    return ACK[1] if state == "not-found" else ACK[0]

def serve_one(connection, *, peer_reader=None, pid_reader=None,
              membership_checker=None, stop_broker=None):
    peer_reader = peer_reader or _peercred
    pid_reader = pid_reader or _watchdog_main_pid
    membership_checker = membership_checker or _watchdog_cgroup
    stop_broker = stop_broker or stop_exact_stage_broker
    connection.settimeout(3.0)
    pid, uid, gid = peer_reader(connection)
    if (type(pid) is not int or pid <= 1 or type(uid) is not int or
        type(gid) is not int or uid <= 0 or gid <= 0):
        raise StopBridgeDenied("PEER_NOT_NONROOT_WATCHDOG")
    if pid != pid_reader() or not membership_checker(pid):
        raise StopBridgeDenied("PEER_NOT_CURRENT_WATCHDOG_MAINPID")
    # Exact single command; no caller-controlled role, host, or service.
    _read_small_command(connection)
    ack = stop_broker()
    if ack not in ACK:
        raise StopBridgeDenied("INVALID_STOP_READBACK")
    # Revalidate process identity if the watchdog restarted mid-command.
    if pid != pid_reader() or not membership_checker(pid):
        raise StopBridgeDenied("WATCHDOG_IDENTITY_CHANGED")
    connection.sendall(ack)
    return ack

def notify_stage_stop(path=SOCKET_PATH):
    """Optional runner callback; missing/failed bridge is NOT success."""
    if path != SOCKET_PATH:
        raise StopBridgeDenied("NONCANONICAL_SOCKET")
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as conn:
            conn.settimeout(3.0)
            conn.connect(path)
            conn.sendall(COMMAND)
            conn.shutdown(socket.SHUT_WR)
            result = _read_bounded_ack(conn)
    except (OSError, socket.timeout):
        raise StopBridgeDenied("BRIDGE_NO_ACK") from None
    if result not in ACK:
        raise StopBridgeDenied("BRIDGE_NO_VERIFIED_STOP_ACK")
    # Matches the existing *independent* Gate A watchdog close-first
    # verification contract; never trust fields supplied by socket clients.
    return {"service":BROKER,"active":False,"socketPresent":False}

def main():
    if len(sys.argv) != 2 or sys.argv[1] != "serve-fd0":
        raise StopBridgeDenied("NO_MANUAL_CONTROL_MODE")
    with socket.socket(fileno=0) as conn:
        serve_one(conn)

if __name__ == "__main__":
    try:
        main()
    except StopBridgeDenied:
        print(DENIED, flush=True)
        raise SystemExit(2)
