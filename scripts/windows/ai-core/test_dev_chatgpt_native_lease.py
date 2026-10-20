"""Synthetic lease/control tests; these do not prove real Windows containment."""
import ctypes
import io
import json
import threading
import time
import unittest
from unittest.mock import patch

import dev_chatgpt_native_lease as native

COMMAND = "11111111-2222-4333-8444-555555555555"


class Clock:
    def __init__(self):
        self.mono = 100.0
        self.wall = 1_700_000_000.0

    def monotonic(self):
        return self.mono

    def time(self):
        return self.wall

    def advance(self, seconds):
        self.mono += seconds
        self.wall += seconds


def initial(clock, max_run=1_980_000, valid_for=280_000, age=0):
    return {"protocol": native.PROTOCOL, "commandId": COMMAND,
            "instruction": "synthetic bounded instruction", "workerId": native.WORKER,
            "metadata": {"wakeBinding": {}}, "maxRunMs": max_run,
            "lease": {"sequence": 0, "issuedAtUtcMs": int(clock.time() * 1000) - age,
                      "validForMs": valid_for}}


def renewal(clock, sequence=1, valid_for=280_000, age=0):
    return {"type": "lease", "commandId": COMMAND, "sequence": sequence,
            "issuedAtUtcMs": int(clock.time() * 1000) - age, "validForMs": valid_for}


class FakeJob:
    def __init__(self):
        self.terminated = threading.Event()
        self.calls = 0

    def terminate(self):
        self.calls += 1
        self.terminated.set()

    def tick_count64(self):
        return 123_000


class LeaseArithmeticTests(unittest.TestCase):
    def setUp(self):
        self.clock = Clock()
        self.state = native.LeaseState(self.clock)

    def test_transit_age_is_subtracted_and_wall_clock_changes_do_not_extend_grant(self):
        self.state.initialize(initial(self.clock, age=2000))
        self.assertEqual(self.state.remaining(), 278)
        self.clock.wall -= 3600
        self.clock.mono += 10
        self.assertEqual(self.state.remaining(), 268)

    def test_renewal_extends_only_current_lease_and_never_fixed_total(self):
        self.state.initialize(initial(self.clock, max_run=400_000))
        original_total = self.state.total_deadline
        self.clock.advance(250)
        self.state.apply(renewal(self.clock, age=1000))
        self.assertEqual(self.state.total_deadline, original_total)
        self.assertEqual(self.state.remaining(), 150)

    def test_late_success_cannot_revive_the_expired_lease(self):
        self.state.initialize(initial(self.clock, valid_for=1000))
        self.clock.advance(1)
        with self.assertRaisesRegex(native.LeaseError, "DEADLINE_EXPIRED"):
            self.state.apply(renewal(self.clock))
        self.assertEqual(self.state.sequence, 0)

    def test_fixed_total_expires_even_with_recent_valid_renewal(self):
        self.state.initialize(initial(self.clock, max_run=1000))
        self.clock.advance(0.8)
        self.state.apply(renewal(self.clock))
        self.clock.advance(0.2)
        with self.assertRaisesRegex(native.LeaseError, "DEADLINE_EXPIRED"):
            self.state.authorize()

    def test_revoke_is_terminal_and_later_valid_frames_cannot_revive(self):
        self.state.initialize(initial(self.clock))
        with self.assertRaisesRegex(native.LeaseError, "REVOKED"):
            self.state.apply({"type": "revoke", "commandId": COMMAND, "sequence": 1})
        with self.assertRaisesRegex(native.LeaseError, "REVOKED"):
            self.state.apply(renewal(self.clock, sequence=2))

    def test_wrong_id_sequence_stale_and_extra_fields_are_rejected(self):
        changes = [{"commandId": "wrong"}, {"sequence": 0}, {"sequence": 2}, {"sequence": True},
                   {"validForMs": 300_001}, {"validForMs": float("inf")}, {"validForMs": False},
                   {"issuedAtUtcMs": int(self.clock.wall * 1000) - 5001},
                   {"issuedAtUtcMs": int(self.clock.wall * 1000) + 1}, {"claimToken": "forbidden"}]
        for change in changes:
            with self.subTest(change=change):
                state = native.LeaseState(self.clock)
                state.initialize(initial(self.clock))
                before = state.lease_deadline
                with self.assertRaises(native.LeaseError):
                    state.apply({**renewal(self.clock), **change})
                self.assertEqual(state.lease_deadline, before)

    def test_initial_bound_schema_and_ceiling_fail_before_work(self):
        changes = [{"maxRunMs": 2_000_001}, {"maxRunMs": True}, {"workerId": "legacy-worker"},
                   {"metadata": {}}, {"metadata": {"wakeBinding": {}, "claimToken": "forbidden"}},
                   {"protocol": "other"}, {"claimToken": "forbidden"},
                   {"lease": {"sequence": 1, "issuedAtUtcMs": int(self.clock.wall * 1000), "validForMs": 5000}}]
        for change in changes:
            with self.subTest(change=change), self.assertRaises(native.LeaseError):
                native.LeaseState(self.clock).initialize({**initial(self.clock), **change})

    def test_startup_deadline_is_not_reset_by_a_late_first_frame(self):
        self.clock.advance(native.STARTUP_SECONDS)
        with self.assertRaises(native.LeaseError):
            self.state.initialize(initial(self.clock))

    def test_deschedule_during_timestamp_read_does_not_extend_granted_lifetime(self):
        payload = initial(self.clock)
        original_time = self.clock.time

        def paused_time():
            sampled = original_time()
            self.clock.advance(3)
            return sampled

        with patch.object(self.clock, "time", side_effect=paused_time):
            self.state.initialize(payload)
        self.assertEqual(self.state.remaining(), 277)

    def test_old_lease_expiring_during_grant_parse_cannot_be_revived(self):
        self.state.initialize(initial(self.clock, valid_for=1000))
        self.clock.advance(0.8)
        frame = renewal(self.clock)
        original_time = self.clock.time

        def paused_time():
            sampled = original_time()
            self.clock.advance(0.3)
            return sampled

        with patch.object(self.clock, "time", side_effect=paused_time):
            with self.assertRaisesRegex(native.LeaseError, "DEADLINE_EXPIRED"):
                self.state.apply(frame)
        self.assertEqual(self.state.sequence, 0)

    def test_backward_wall_step_cannot_make_buffered_old_grant_fresh(self):
        self.state.initialize(initial(self.clock))
        buffered = renewal(self.clock)
        self.clock.advance(100)
        self.clock.wall -= 100
        with self.assertRaisesRegex(native.LeaseError, "WALL_CLOCK_CHANGED"):
            self.state.apply(buffered)
        self.assertEqual(self.state.sequence, 0)


class FrameAndCancellationTests(unittest.TestCase):
    def test_bounded_json_rejects_partial_eof_duplicates_nonfinite_and_oversize(self):
        for raw in (b"", b'{}', b'[]\n', b'{"x":1,"x":2}\n', b'{"x":NaN}\n', b'"\xff"\n', b" " * 65 + b"\n"):
            with self.subTest(raw=raw), self.assertRaises(native.LeaseError):
                native.read_frame(io.BytesIO(raw), 64)
        self.assertEqual(native.read_frame(io.BytesIO(b'{"ok":true}\n'), 64), {"ok": True})

    def test_parent_eof_malformed_or_revoke_terminates_owned_job_once(self):
        clock = Clock()
        frames = [b"", b'{}\n', json.dumps({"type": "revoke", "commandId": COMMAND, "sequence": 1}).encode() + b"\n",
                  json.dumps(renewal(clock, age=5001)).encode() + b"\n"]
        for raw in frames:
            with self.subTest(raw=raw):
                job = FakeJob()
                guard = native.NativeLease(job, clock)
                guard.state.initialize(initial(clock))
                guard._consume(io.BytesIO(raw))
                self.assertTrue(job.terminated.is_set())
                self.assertEqual(job.calls, 1)
                with self.assertRaises(native.LeaseError):
                    guard.authorize()
                self.assertEqual(job.calls, 1)

    def test_deadline_watchdog_cancels_while_main_work_is_blocked(self):
        clock = Clock()
        job = FakeJob()
        guard = native.NativeLease(job, clock)
        guard.state.initialize(initial(clock, valid_for=100))
        thread = threading.Thread(target=guard._watchdog)
        thread.start()
        clock.advance(0.1)
        self.assertTrue(job.terminated.wait(1))
        thread.join(1)
        self.assertFalse(thread.is_alive())

    def test_native_tick_snapshot_rounds_down_with_safety_margin(self):
        clock = Clock()
        guard = native.NativeLease(FakeJob(), clock)
        guard.state.initialize(initial(clock, valid_for=1000))
        self.assertEqual(guard.expiry_tick_count64(), 123_968)
        clock.advance(0.8)
        self.assertLessEqual(guard.expiry_tick_count64(), 123_168)

    def test_overall_plan_budget_is_distinct_from_current_call_lease(self):
        clock = Clock()
        guard = native.NativeLease(FakeJob(), clock)
        guard.state.initialize(initial(clock))
        self.assertEqual(guard.total_remaining(), 1980)
        self.assertEqual(guard.remaining(), 280)
        self.assertEqual(guard.remaining(45), 45)

    def test_sleep_is_cancelled_without_waiting_out_requested_delay(self):
        job = FakeJob()
        guard = native.NativeLease(job)
        guard.state.initialize(initial(time))
        seen = threading.Event()

        def sleeper():
            try:
                guard.sleep(10)
            except native.LeaseError:
                seen.set()

        thread = threading.Thread(target=sleeper)
        thread.start()
        guard.cancel()
        self.assertTrue(seen.wait(1))
        thread.join(1)
        self.assertFalse(thread.is_alive())


class FakeFunction:
    def __init__(self, name, kernel):
        self.name, self.kernel = name, kernel

    def __call__(self, *args):
        self.kernel.calls.append((self.name, args))
        if self.name == "SetInformationJobObject":
            limits = ctypes.cast(args[2], ctypes.POINTER(native._ExtendedLimits)).contents
            self.kernel.flags = limits.BasicLimitInformation.LimitFlags
        if self.name == self.kernel.fail:
            return 0
        return {"CreateJobObjectW": 444, "GetCurrentProcess": -1, "GetTickCount64": 123}.get(self.name, 1)


class FakeKernel:
    def __init__(self, fail=None):
        self.calls, self.fail, self.flags = [], fail, None
        for name in ("CreateJobObjectW", "SetInformationJobObject", "AssignProcessToJobObject", "GetCurrentProcess",
                     "CloseHandle", "TerminateJobObject", "GetTickCount64"):
            setattr(self, name, FakeFunction(name, self))


class WindowsBoundaryTests(unittest.TestCase):
    def test_unnamed_noninheritable_job_is_limited_before_only_self_assignment(self):
        kernel = FakeKernel()
        job = native.WindowsJob(_kernel=kernel)
        self.assertEqual([name for name, _ in kernel.calls], [
            "CreateJobObjectW", "SetInformationJobObject", "GetCurrentProcess", "AssignProcessToJobObject"])
        self.assertEqual(kernel.calls[0][1], (None, None))
        self.assertEqual(kernel.flags, 0x2000)
        self.assertEqual(kernel.calls[-1][1], (444, -1))
        self.assertEqual(job.handle, 444)
        self.assertEqual(kernel.CreateJobObjectW.restype, ctypes.c_void_p)
        self.assertEqual(kernel.GetTickCount64.restype, ctypes.c_uint64)

    def test_limit_and_assignment_failure_close_unused_handle_and_fail_closed(self):
        for failure in ("CreateJobObjectW", "SetInformationJobObject", "AssignProcessToJobObject"):
            with self.subTest(failure=failure):
                kernel = FakeKernel(fail=failure)
                with self.assertRaises(native.LeaseError):
                    native.WindowsJob(_kernel=kernel)
                names = [name for name, _ in kernel.calls]
                self.assertEqual(names.count("CloseHandle"), 0 if failure == "CreateJobObjectW" else 1)
                if failure != "AssignProcessToJobObject":
                    self.assertNotIn("AssignProcessToJobObject", names)

    def test_termination_always_exits_even_if_win32_call_fails(self):
        kernel = FakeKernel(fail="TerminateJobObject")
        job = native.WindowsJob(_kernel=kernel)
        with patch.object(native.os, "_exit") as exit_process:
            job.terminate()
        self.assertEqual(kernel.calls[-1][0], "TerminateJobObject")
        exit_process.assert_called_once_with(70)

    def test_job_setup_failure_precedes_stdin_consumption(self):
        stream = io.BytesIO(b"must not be read")
        with patch.object(native, "WindowsJob", side_effect=native.LeaseError("assignment failed")):
            with self.assertRaises(native.LeaseError):
                native.NativeLease.from_stdin(stream)
        self.assertEqual(stream.tell(), 0)


if __name__ == "__main__":
    unittest.main()
