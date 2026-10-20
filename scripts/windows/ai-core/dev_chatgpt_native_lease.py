"""Bound DEV helper lease fence and private Windows process-tree containment.

The parent is the existing authenticated worker. Frames convey its verified
claim lifetime; they contain no bearer token, claim token, or attestation.
Windows behavior: CreateJobObjectW(NULL, NULL), AssignProcessToJobObject, and
JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE as documented by Microsoft Learn.
"""
import ctypes
import json
import math
import os
import re
import threading
import time

PROTOCOL = "ai-core-native-lease/v1"
BOUND_ARGUMENT = "--bound-lease-v1"
MAX_RUN_MS = 2_000_000
MAX_LEASE_MS = 300_000
MAX_FRAME_AGE_MS = 5_000
CLOCK_DRIFT_TOLERANCE_MS = 1_000
MAX_INITIAL_BYTES = 65_536
MAX_CONTROL_BYTES = 2_048
STARTUP_SECONDS = 10
TICK_MARGIN_MS = 32
WORKER = "openclaw-dell-chatgpt-wake-dev"
UUID = re.compile(r"[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\Z")


class LeaseError(RuntimeError):
    """A sanitized, terminal control failure; no payload is included."""


def _need(condition, reason):
    if not condition:
        raise LeaseError(reason)


def _integer(value, minimum, maximum):
    return type(value) is int and minimum <= value <= maximum


def _keys(value, expected):
    return isinstance(value, dict) and set(value) == set(expected)


def _object(pairs):
    result = {}
    for name, value in pairs:
        _need(name not in result, "NATIVE_LEASE_DUPLICATE_JSON_KEY")
        result[name] = value
    return result


def _constant(_value):
    raise LeaseError("NATIVE_LEASE_NONFINITE_JSON")


def read_frame(stream, limit):
    raw = stream.readline(limit + 1)
    _need(isinstance(raw, bytes) and 0 < len(raw) <= limit and raw.endswith(b"\n"),
          "NATIVE_LEASE_EOF_OR_FRAME_LIMIT")
    try:
        value = json.loads(raw.decode("utf-8", errors="strict"),
                           object_pairs_hook=_object, parse_constant=_constant)
    except (ValueError, UnicodeError, RecursionError):
        raise LeaseError("NATIVE_LEASE_INVALID_JSON") from None
    _need(isinstance(value, dict), "NATIVE_LEASE_INVALID_ENVELOPE")
    return value


class LeaseState:
    """Clock-injected lease arithmetic; callers serialize access."""

    def __init__(self, clock=time):
        self.clock = clock
        self.started = clock.monotonic()
        self.total_deadline = self.started + STARTUP_SECONDS
        self.lease_deadline = self.total_deadline
        self.command_id = None
        self.sequence = -1
        self.cancelled = None
        self.wall_monotonic_offset_ms = None

    def check_clock(self):
        if self.cancelled is not None:
            raise LeaseError(self.cancelled)
        now = self.clock.monotonic()
        _need(now < self.total_deadline and now < self.lease_deadline,
              "NATIVE_LEASE_DEADLINE_EXPIRED")
        return now

    def authorize(self):
        now = self.check_clock()
        _need(self.command_id is not None, "NATIVE_LEASE_INITIAL_FRAME_REQUIRED")
        return now

    def _grant(self, frame, expected_sequence):
        _need(_integer(frame.get("sequence"), 0, 2**53 - 1)
              and frame["sequence"] == expected_sequence,
              "NATIVE_LEASE_SEQUENCE_MISMATCH")
        _need(_integer(frame.get("issuedAtUtcMs"), 0, 2**53 - 1)
              and _integer(frame.get("validForMs"), 1, MAX_LEASE_MS),
              "NATIVE_LEASE_INVALID_LIFETIME")
        # Sample the deadline base first. A scheduling pause during later
        # timestamp parsing can shorten authority, never add that pause to it.
        monotonic_base = self.clock.monotonic()
        wall_ms = math.floor(self.clock.time() * 1000)
        offset_ms = wall_ms - monotonic_base * 1000
        if self.wall_monotonic_offset_ms is not None:
            _need(abs(offset_ms - self.wall_monotonic_offset_ms) <= CLOCK_DRIFT_TOLERANCE_MS,
                  "NATIVE_LEASE_WALL_CLOCK_CHANGED")
        age_ms = wall_ms - frame["issuedAtUtcMs"]
        _need(0 <= age_ms <= MAX_FRAME_AGE_MS, "NATIVE_LEASE_STALE_OR_FUTURE_GRANT")
        remaining_ms = frame["validForMs"] - age_ms
        _need(remaining_ms > 0, "NATIVE_LEASE_GRANT_ALREADY_EXPIRED")
        deadline = monotonic_base + remaining_ms / 1000
        # Recheck the old lease immediately before applying the new one; a
        # pause since apply()'s first check must not revive an expired claim.
        _need(self.check_clock() < deadline, "NATIVE_LEASE_GRANT_ALREADY_EXPIRED")
        self.lease_deadline = deadline
        self.sequence = frame["sequence"]
        if self.wall_monotonic_offset_ms is None:
            self.wall_monotonic_offset_ms = offset_ms

    def initialize(self, payload):
        self.check_clock()
        _need(self.command_id is None and _keys(payload, (
            "protocol", "commandId", "instruction", "workerId", "metadata", "maxRunMs", "lease")),
            "NATIVE_LEASE_INVALID_INITIAL_ENVELOPE")
        _need(payload["protocol"] == PROTOCOL and isinstance(payload["commandId"], str)
              and UUID.fullmatch(payload["commandId"]) is not None,
              "NATIVE_LEASE_INVALID_COMMAND_ID")
        _need(payload["workerId"] == WORKER and isinstance(payload["instruction"], str)
              and 0 < len(payload["instruction"]) <= 8192
              and isinstance(payload["metadata"], dict)
              and "claimToken" not in payload["metadata"]
              and isinstance(payload["metadata"].get("wakeBinding"), dict),
              "NATIVE_LEASE_BOUND_WORK_REQUIRED")
        _need(_integer(payload["maxRunMs"], 1, MAX_RUN_MS)
              and _keys(payload["lease"], ("sequence", "issuedAtUtcMs", "validForMs")),
              "NATIVE_LEASE_INVALID_INITIAL_LIMIT")
        self._grant(payload["lease"], 0)
        self.total_deadline = self.started + payload["maxRunMs"] / 1000
        self.command_id = payload["commandId"]
        self.authorize()

    def apply(self, frame):
        self.authorize()  # A later grant cannot revive an expired claim.
        kind = frame.get("type")
        expected = ("type", "commandId", "sequence", "issuedAtUtcMs", "validForMs") if kind == "lease" else (
            "type", "commandId", "sequence")
        _need(kind in ("lease", "revoke") and _keys(frame, expected)
              and frame["commandId"] == self.command_id,
              "NATIVE_LEASE_CONTROL_CONTEXT_MISMATCH")
        _need(_integer(frame["sequence"], 0, 2**53 - 1) and frame["sequence"] == self.sequence + 1,
              "NATIVE_LEASE_SEQUENCE_MISMATCH")
        if kind == "revoke":
            self.cancelled = "NATIVE_LEASE_REVOKED"
            raise LeaseError(self.cancelled)
        self._grant(frame, self.sequence + 1)

    def remaining(self):
        return min(self.total_deadline, self.lease_deadline) - self.authorize()


class _BasicLimits(ctypes.Structure):
    _fields_ = [("PerProcessUserTimeLimit", ctypes.c_int64), ("PerJobUserTimeLimit", ctypes.c_int64),
                ("LimitFlags", ctypes.c_uint32), ("MinimumWorkingSetSize", ctypes.c_size_t),
                ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", ctypes.c_uint32),
                ("Affinity", ctypes.c_size_t), ("PriorityClass", ctypes.c_uint32),
                ("SchedulingClass", ctypes.c_uint32)]


class _IoCounters(ctypes.Structure):
    _fields_ = [(name, ctypes.c_uint64) for name in (
        "ReadOperationCount", "WriteOperationCount", "OtherOperationCount",
        "ReadTransferCount", "WriteTransferCount", "OtherTransferCount")]


class _ExtendedLimits(ctypes.Structure):
    _fields_ = [("BasicLimitInformation", _BasicLimits), ("IoInfo", _IoCounters),
                ("ProcessMemoryLimit", ctypes.c_size_t), ("JobMemoryLimit", ctypes.c_size_t),
                ("PeakProcessMemoryUsed", ctypes.c_size_t), ("PeakJobMemoryUsed", ctypes.c_size_t)]


class WindowsJob:
    """Assign only this helper; retain the private handle until OS teardown."""

    def __init__(self, _kernel=None):
        _need(_kernel is not None or os.name == "nt", "NATIVE_LEASE_WINDOWS_REQUIRED")
        k = _kernel if _kernel is not None else ctypes.WinDLL("kernel32", use_last_error=True)
        self.kernel = k
        definitions = {
            "CreateJobObjectW": ([ctypes.c_void_p, ctypes.c_wchar_p], ctypes.c_void_p),
            "SetInformationJobObject": ([ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p, ctypes.c_uint32], ctypes.c_int),
            "AssignProcessToJobObject": ([ctypes.c_void_p, ctypes.c_void_p], ctypes.c_int),
            "GetCurrentProcess": ([], ctypes.c_void_p),
            "CloseHandle": ([ctypes.c_void_p], ctypes.c_int),
            "TerminateJobObject": ([ctypes.c_void_p, ctypes.c_uint32], ctypes.c_int),
            "GetTickCount64": ([], ctypes.c_uint64),
        }
        for name, (arguments, result) in definitions.items():
            function = getattr(k, name)
            function.argtypes, function.restype = arguments, result
        # NULL security attributes means the handle cannot be inherited;
        # NULL name prevents another normal caller opening it by name.
        handle = k.CreateJobObjectW(None, None)
        _need(bool(handle), "NATIVE_LEASE_JOB_CREATE_FAILED")
        limits = _ExtendedLimits()
        limits.BasicLimitInformation.LimitFlags = 0x00002000  # KILL_ON_JOB_CLOSE, no breakaway flags.
        if not k.SetInformationJobObject(handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
            k.CloseHandle(handle)
            raise LeaseError("NATIVE_LEASE_JOB_LIMIT_FAILED")
        if not k.AssignProcessToJobObject(handle, k.GetCurrentProcess()):
            k.CloseHandle(handle)
            raise LeaseError("NATIVE_LEASE_JOB_ASSIGN_FAILED")
        self.handle = handle

    def tick_count64(self):
        return int(self.kernel.GetTickCount64())

    def terminate(self):
        self.kernel.TerminateJobObject(self.handle, 70)
        # Closing the process also closes its sole job handle if termination
        # was delayed or the API failed. Never continue after revocation.
        os._exit(70)


class NativeLease:
    """Independent stdin/watchdog threads fence blocked native child calls."""

    def __init__(self, job, clock=time):
        self.job = job
        self.state = LeaseState(clock)
        self._lock = threading.RLock()
        self._cancelled = threading.Event()

    @classmethod
    def from_stdin(cls, stream):
        guard = cls(WindowsJob())  # Must precede every subprocess or native action.
        threading.Thread(target=guard._watchdog, daemon=True, name="native-lease-watchdog").start()
        try:
            payload = read_frame(stream, MAX_INITIAL_BYTES)
            with guard._lock:
                guard.state.initialize(payload)
            threading.Thread(target=guard._consume, args=(stream,), daemon=True,
                             name="native-lease-control").start()
            guard.authorize()
            return guard, payload
        except (LeaseError, OSError):
            guard.cancel("NATIVE_LEASE_INITIAL_CONTROL_FAILED")
            raise

    def cancel(self, reason="NATIVE_LEASE_CANCELLED"):
        with self._lock:
            if self._cancelled.is_set():
                return
            self.state.cancelled = reason
            self._cancelled.set()
        self.job.terminate()

    def _consume(self, stream):
        try:
            while not self._cancelled.is_set():
                frame = read_frame(stream, MAX_CONTROL_BYTES)
                with self._lock:
                    self.state.apply(frame)
        except (LeaseError, OSError):
            self.cancel("NATIVE_LEASE_CONTROL_LOST")

    def _watchdog(self):
        while not self._cancelled.wait(0.05):
            try:
                with self._lock:
                    self.state.check_clock()
            except LeaseError:
                self.cancel("NATIVE_LEASE_DEADLINE_EXPIRED")
                return

    def authorize(self):
        try:
            with self._lock:
                self.state.authorize()
        except LeaseError:
            self.cancel("NATIVE_LEASE_AUTHORIZATION_LOST")
            raise

    def remaining(self, cap_seconds=None):
        self.authorize()
        with self._lock:
            remaining = self.state.remaining()
        if cap_seconds is not None:
            _need(isinstance(cap_seconds, (int, float)) and not isinstance(cap_seconds, bool)
                  and math.isfinite(cap_seconds) and cap_seconds > 0, "NATIVE_LEASE_INVALID_CALL_BUDGET")
            remaining = min(remaining, cap_seconds)
        return remaining

    def total_remaining(self):
        self.authorize()
        with self._lock:
            return self.state.total_deadline - self.state.clock.monotonic()

    def expiry_tick_count64(self):
        # Sample ticks first and round down; the explicit margin covers the
        # documented 10-16ms GetTickCount64 resolution without extending lease.
        ticks = self.job.tick_count64()
        remaining_ms = math.floor(self.remaining() * 1000) - TICK_MARGIN_MS
        _need(remaining_ms > 0, "NATIVE_LEASE_INSUFFICIENT_NATIVE_BUDGET")
        return ticks + remaining_ms

    def sleep(self, seconds):
        _need(isinstance(seconds, (int, float)) and not isinstance(seconds, bool)
              and math.isfinite(seconds) and seconds >= 0, "NATIVE_LEASE_INVALID_SLEEP")
        until = self.state.clock.monotonic() + seconds
        while True:
            self.authorize()
            remaining = until - self.state.clock.monotonic()
            if remaining <= 0:
                return
            self._cancelled.wait(min(remaining, self.remaining(0.05)))
