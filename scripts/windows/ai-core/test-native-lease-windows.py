"""Opt-in real Windows containment proof using only newly created Python sleepers.

No browser, OpenClaw, UI, authenticated server, key, or actual job is used.
The real helper main is imported with only submit_once replaced by a synthetic
sleeper fixture, so JSON flush/exit and the real lease/Job controller are tested.
Run once in a fresh Temp directory with the two exact reviewed source hashes.
"""
import argparse
import ctypes
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

CASE_NAMES = ("normal", "helper-kill", "stdin-eof", "parent-exit", "lease-expiry")
COMMAND = "11111111-2222-4333-8444-555555555555"
SCRIPT = str(Path(__file__).resolve())
KERNEL = None


def need(condition, reason):
    if not condition:
        raise RuntimeError(reason)


def kernel():
    global KERNEL
    if KERNEL is None:
        need(os.name == "nt", "Windows is required")
        KERNEL = ctypes.WinDLL("kernel32", use_last_error=True)
        definitions = {
            "OpenProcess": ([ctypes.c_uint32, ctypes.c_int, ctypes.c_uint32], ctypes.c_void_p),
            "GetProcessTimes": ([ctypes.c_void_p] + [ctypes.POINTER(ctypes.c_uint64)] * 4, ctypes.c_int),
            "WaitForSingleObject": ([ctypes.c_void_p, ctypes.c_uint32], ctypes.c_uint32),
            "GetExitCodeProcess": ([ctypes.c_void_p, ctypes.POINTER(ctypes.c_uint32)], ctypes.c_int),
            "TerminateProcess": ([ctypes.c_void_p, ctypes.c_uint32], ctypes.c_int),
            "CloseHandle": ([ctypes.c_void_p], ctypes.c_int),
            "IsProcessInJob": ([ctypes.c_void_p, ctypes.c_void_p, ctypes.POINTER(ctypes.c_int)], ctypes.c_int),
            "QueryInformationJobObject": ([ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p,
                                           ctypes.c_uint32, ctypes.c_void_p], ctypes.c_int),
        }
        for name, (arguments, result) in definitions.items():
            function = getattr(KERNEL, name)
            function.argtypes, function.restype = arguments, result
    return KERNEL


class ProcessHandle:
    def __init__(self, pid, expected_creation=None):
        self.pid = pid
        # Every PID comes from this proof's own Popen or its authenticated-by-
        # creation-time fixture record. Retain the HANDLE for every later action.
        self.handle = kernel().OpenProcess(0x00100000 | 0x1000 | 0x0001, False, pid)
        need(bool(self.handle), "Cannot retain owned proof process handle")
        times = [ctypes.c_uint64() for _ in range(4)]
        if not kernel().GetProcessTimes(self.handle, *(ctypes.byref(value) for value in times)):
            self.close()
            raise RuntimeError("Cannot read owned proof process creation time")
        self.creation = times[0].value
        if expected_creation is not None and self.creation != expected_creation:
            self.close()
            raise RuntimeError("Owned proof process identity changed")

    def record(self):
        return {"pid": self.pid, "creationTime100ns": self.creation}

    def exited(self):
        result = kernel().WaitForSingleObject(self.handle, 0)
        need(result in (0, 258), "Owned process wait failed")
        return result == 0

    def exit_code(self):
        code = ctypes.c_uint32()
        need(kernel().GetExitCodeProcess(self.handle, ctypes.byref(code)) != 0, "Cannot read owned exit status")
        return code.value

    def in_job(self, job_handle):
        result = ctypes.c_int()
        need(kernel().IsProcessInJob(self.handle, job_handle, ctypes.byref(result)) != 0,
             "Cannot query private Job membership")
        return result.value != 0

    def terminate(self):
        if not self.exited():
            need(kernel().TerminateProcess(self.handle, 71) != 0, "Cannot stop owned proof process")
            need(kernel().WaitForSingleObject(self.handle, 5000) == 0, "Owned proof process did not stop")

    def close(self):
        if self.handle:
            kernel().CloseHandle(self.handle)
            self.handle = None


def own_record(pid=None):
    process = ProcessHandle(os.getpid() if pid is None else pid)
    try:
        return process.record()
    finally:
        process.close()


def retain(record):
    return ProcessHandle(record["pid"], record["creationTime100ns"])


def write_json(path, value):
    with Path(path).open("x", encoding="utf-8") as stream:
        json.dump(value, stream, separators=(",", ":"))
        stream.flush()
        os.fsync(stream.fileno())


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def wait_json(path, seconds=10):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            return read_json(path)
        except (FileNotFoundError, json.JSONDecodeError):
            time.sleep(0.025)
    raise RuntimeError("Proof fixture readiness deadline exceeded")


def fixture_args(mode, case_directory):
    return [sys.executable, SCRIPT, "--fixture", mode, "--case-directory", str(case_directory)]


def spawn_fixture(mode, case_directory, **options):
    return subprocess.Popen(fixture_args(mode, case_directory), stdin=subprocess.DEVNULL,
                            creationflags=subprocess.CREATE_NO_WINDOW, **options)


def fixture_child(case_directory):
    grandchild = spawn_fixture("sleeper", case_directory, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print(json.dumps({"child": own_record(), "grandchild": own_record(grandchild.pid)}), flush=True)
    time.sleep(90)


def fixture_helper(case_directory):
    spec = read_json(case_directory / "spec.json")
    source = Path(spec["moduleDirectory"])
    for name, expected in (("dev_chatgpt_native_lease.py", spec["leaseSha256"]),
                           ("dev-chatgpt-wake-once.py", spec["helperSha256"])):
        need(hashlib.sha256((source / name).read_bytes()).hexdigest() == expected, "Reviewed source hash changed")
    sys.path.insert(0, str(source))
    import dev_chatgpt_native_lease as lease
    module_spec = importlib.util.spec_from_file_location("containment_helper_fixture", source / "dev-chatgpt-wake-once.py")
    helper = importlib.util.module_from_spec(module_spec)
    module_spec.loader.exec_module(helper)
    retained = []

    def synthetic_work(_instruction, _worker, metadata=None, lease_guard=None):
        need(lease_guard is not None, "Real bound guard was not supplied")
        lease_guard.authorize()
        child = spawn_fixture("child", case_directory, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        raw = child.stdout.readline(4097)
        need(0 < len(raw) <= 4096 and raw.endswith(b"\n"), "Invalid owned descendant fixture record")
        children = json.loads(raw)
        for record in (own_record(), children["child"], children["grandchild"], spec["outside"]):
            retained.append(retain(record))
        job_handle = lease_guard.job.handle
        memberships = [process.in_job(job_handle) for process in retained]
        limits = lease._ExtendedLimits()
        need(kernel().QueryInformationJobObject(job_handle, 9, ctypes.byref(limits), ctypes.sizeof(limits), None) != 0,
             "Cannot inspect actual private Job limits")
        flags = limits.BasicLimitInformation.LimitFlags
        breakaway_denied = False
        try:
            escaped = subprocess.Popen(fixture_args("sleeper", case_directory), stdin=subprocess.DEVNULL,
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                       creationflags=subprocess.CREATE_NO_WINDOW | subprocess.CREATE_BREAKAWAY_FROM_JOB)
        except OSError as error:
            breakaway_denied = error.winerror == 5
        else:
            # This Popen retains the exact newly created process HANDLE.
            escaped.terminate()
            escaped.wait(timeout=5)
        write_json(case_directory / "ready.json", {
            **children, "helper": own_record(), "privateMemberships": memberships,
            "killOnClose": bool(flags & 0x2000), "breakawayFlagsAbsent": not bool(flags & (0x800 | 0x1000)),
            "breakawaySpawnDenied": breakaway_denied, "syntheticContainmentOnly": True,
        })
        while not (case_directory / "release.json").exists():
            lease_guard.sleep(0.025)
        if spec["case"] == "normal":
            return {"syntheticContainmentOnly": True, "realE2eVerified": False}
        while True:
            lease_guard.sleep(1)

    helper.submit_once = synthetic_work
    sys.argv = [str(source / "dev-chatgpt-wake-once.py"), lease.BOUND_ARGUMENT]
    helper.main()
    raise RuntimeError("Bound helper returned instead of exiting")


def fixture_parent(case_directory):
    spec = read_json(case_directory / "spec.json")
    with (case_directory / "helper-stdout.json").open("xb") as output, \
         (case_directory / "helper-stderr.txt").open("xb") as error_output:
        child = subprocess.Popen(fixture_args("helper", case_directory), stdin=subprocess.PIPE,
                                 stdout=output, stderr=error_output, creationflags=subprocess.CREATE_NO_WINDOW)
        write_json(case_directory / "parent.json", {"parent": own_record(), "helper": own_record(child.pid)})
        frame = {"protocol": "ai-core-native-lease/v1", "commandId": COMMAND,
                 "instruction": "Synthetic containment fixture; no browser or server work",
                 "workerId": "openclaw-dell-chatgpt-wake-dev", "metadata": {"wakeBinding": {}},
                 "maxRunMs": 25000, "lease": {"sequence": 0, "issuedAtUtcMs": int(time.time() * 1000),
                    "validForMs": 8000 if spec["case"] == "lease-expiry" else 20000}}
        child.stdin.write(json.dumps(frame).encode("utf-8") + b"\n")
        child.stdin.flush()
        deadline = time.monotonic() + 20
        while not (case_directory / "release.json").exists() and child.poll() is None:
            need(time.monotonic() < deadline, "Proof parent release timed out")
            time.sleep(0.025)
        if child.poll() is None:
            if spec["case"] == "parent-exit":
                os._exit(0)  # The sole stdin writer disappears without touching the helper.
            if spec["case"] == "helper-kill":
                child.terminate()
            elif spec["case"] == "stdin-eof":
                child.stdin.close()
        try:
            code = child.wait(timeout=25)
        finally:
            if child.poll() is None:
                child.kill()
                child.wait(timeout=5)
        write_json(case_directory / "parent-result.json", {"helperExitCode": code})


def run_proof(args):
    need(os.name == "nt", "This opt-in proof requires Windows")
    state = Path(args.state_directory).resolve()
    need(state.parent == Path(tempfile.gettempdir()).resolve() and not state.exists(),
         "A fresh direct Temp subdirectory is required")
    source = Path(args.module_directory).resolve()
    for name, expected in (("dev_chatgpt_native_lease.py", args.lease_sha), ("dev-chatgpt-wake-once.py", args.helper_sha)):
        need(hashlib.sha256((source / name).read_bytes()).hexdigest() == expected, "Reviewed source hash changed")
    state.mkdir()
    outside = spawn_fixture("sleeper", state, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    handles, parents, results = [], [], []
    report = {"schema": "native-lease-windows-containment-proof/v1", "syntheticContainmentOnly": True,
              "realE2eVerified": False, "leaseSha256": args.lease_sha, "helperSha256": args.helper_sha,
              "cases": results, "passed": False}
    try:
        outside_handle = ProcessHandle(outside.pid)
        handles.append(outside_handle)
        for name in CASE_NAMES:
            case = state / name
            case.mkdir()
            write_json(case / "spec.json", {"case": name, "moduleDirectory": str(source),
                       "leaseSha256": args.lease_sha, "helperSha256": args.helper_sha, "outside": outside_handle.record()})
            parent = spawn_fixture("parent", case, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            parents.append(parent)
            parent_record = wait_json(case / "parent.json")
            helper_handle = retain(parent_record["helper"])
            handles.append(helper_handle)
            ready = wait_json(case / "ready.json")
            need(ready["helper"] == parent_record["helper"], "Helper identity changed")
            child_handle, grandchild_handle = retain(ready["child"]), retain(ready["grandchild"])
            handles.extend((child_handle, grandchild_handle))
            need(ready["privateMemberships"] == [True, True, True, False]
                 and ready["killOnClose"] is True and ready["breakawayFlagsAbsent"] is True
                 and ready["breakawaySpawnDenied"] is True, "Actual Job containment guard failed")
            need(not any(process.exited() for process in (helper_handle, child_handle, grandchild_handle, outside_handle)),
                 "Fixture exited before cancellation case began")
            write_json(case / "release.json", {"release": True})
            deadline = time.monotonic() + 12
            while not all(process.exited() for process in (helper_handle, child_handle, grandchild_handle)):
                need(time.monotonic() < deadline, "Owned descendants survived helper completion/cancellation")
                time.sleep(0.025)
            need(not outside_handle.exited(), "Separately owned control process was affected")
            parent.wait(timeout=5)
            code = helper_handle.exit_code()
            if name == "normal":
                need(code == 0 and read_json(case / "helper-stdout.json") == {
                    "ok": True, "syntheticContainmentOnly": True, "realE2eVerified": False},
                    "Normal helper result was incomplete or exit was nonzero")
            else:
                need(code != 0, "Cancelled helper reported successful process exit")
            results.append({"case": name, "passed": True, "helperExitCode": code,
                            "allThreeOwnedProcessesExited": True, "outsideControlAlive": True,
                            "privateJobMembershipVerified": True, "breakawayDenied": True})
        report["passed"] = True
    except Exception as error:
        report["failureType"] = type(error).__name__
        report["failure"] = str(error)[:160]
    finally:
        cleanup_ok = True
        # Stop only retained process handles/Popen objects created by this proof.
        for process in parents + [outside]:
            try:
                if process.poll() is None:
                    process.terminate()
                    process.wait(timeout=5)
            except (OSError, RuntimeError, subprocess.TimeoutExpired):
                cleanup_ok = False
        for process in reversed(handles):
            try:
                process.terminate()
            except (OSError, RuntimeError):
                cleanup_ok = False
            finally:
                process.close()
        report["ownedProcessCleanupVerified"] = cleanup_ok
        report["passed"] = report["passed"] and cleanup_ok
        write_json(state / "result.json", report)
    print(json.dumps(report, separators=(",", ":")), flush=True)
    return 0 if report["passed"] else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixture", choices=("sleeper", "child", "helper", "parent"))
    parser.add_argument("--case-directory")
    parser.add_argument("--state-directory")
    parser.add_argument("--module-directory")
    parser.add_argument("--lease-sha")
    parser.add_argument("--helper-sha")
    args = parser.parse_args()
    if args.fixture:
        case = Path(args.case_directory)
        if args.fixture == "sleeper":
            time.sleep(90)
        elif args.fixture == "child":
            fixture_child(case)
        elif args.fixture == "helper":
            fixture_helper(case)
        else:
            fixture_parent(case)
        return 0
    need(all((args.state_directory, args.module_directory, args.lease_sha, args.helper_sha)),
         "State directory, module directory, and both reviewed source hashes are required")
    return run_proof(args)


if __name__ == "__main__":
    sys.exit(main())
