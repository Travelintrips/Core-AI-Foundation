"""Opt-in Windows transport using native UI and supported OpenClaw commands.

No page evaluation, endpoint replay, session export or assistant ID inference.
All process output stays in memory; failures expose fixed messages only.
"""

from contextlib import contextmanager
import hashlib
import json
import math
import os
from pathlib import Path, PureWindowsPath
import re
import subprocess
import threading
import time

from dev_chatgpt_native_reader import select_observed_request, validate_native_response


MAX_OUTPUT_BYTES = 2 * 1024 * 1024
RAW_TARGET = re.compile(r"[A-Fa-f0-9]{32}")
STOP = re.compile(r'\bbutton\s+"Stop(?: generating)?"', re.I)


def native_options(data, binding):
    """Read activation only from the independently validated local registry."""
    candidates = [entry for entry in data.get("bindings", []) if
                  isinstance(entry, dict) and entry.get("enabled") is True and
                  all(entry.get(field) == binding[field] for field in
                      ("accountAlias", "ownerChannel", "targetConversationId", "workerId", "browserProfile"))]
    options = candidates[0].get("nativeTransport") if len(candidates) == 1 else None
    if not isinstance(options, dict) or options.get("enabled") is not True:
        raise RuntimeError("Native bound ChatGPT transport is not activated")
    if (type(options.get("version")) is not int or options["version"] != 1 or
            options.get("composerName") not in ("Ask ChatGPT", "Tanya ChatGPT") or
            type(options.get("allowProviderLf", False)) is not bool or
            set(options) - {"version", "enabled", "composerName", "allowProviderLf"}):
        raise RuntimeError("Native transport configuration is invalid")
    return {"version": 1, "enabled": True, "composerName": options["composerName"],
            "allowProviderLf": options.get("allowProviderLf", False)}


class _Capture:
    """Bound stdout in memory, discard stderr, and reap each direct child."""
    def __init__(self, argv, input_value=None):
        self.output = bytearray()
        self.failed = False
        self.process = subprocess.Popen(argv, stdin=subprocess.PIPE if input_value is not None else subprocess.DEVNULL,
                                        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        self.threads = []
        for stream, retain in ((self.process.stdout, True), (self.process.stderr, False)):
            thread = threading.Thread(target=self._read, args=(stream, retain), daemon=True)
            thread.start()
            self.threads.append(thread)
        if input_value is not None:
            thread = threading.Thread(target=self._write, args=(input_value,), daemon=True)
            thread.start()
            self.threads.append(thread)

    def _read(self, stream, retain):
        total = 0
        try:
            while True:
                chunk = stream.read(8192)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_OUTPUT_BYTES:
                    self.failed = True
                    self.process.kill()
                    break
                if retain:
                    self.output.extend(chunk)
        except (OSError, ValueError):
            self.failed = True
        finally:
            stream.close()

    def _write(self, value):
        try:
            self.process.stdin.write(value)
            self.process.stdin.close()
        except (OSError, ValueError):
            self.failed = True

    def finish(self, timeout):
        try:
            code = self.process.wait(timeout=timeout)
            for thread in self.threads:
                thread.join(timeout=1)
            if code != 0 or self.failed or any(thread.is_alive() for thread in self.threads):
                raise RuntimeError("Native subprocess failed; raw output withheld")
            try:
                return bytes(self.output).decode("utf-8-sig")
            except UnicodeError:
                raise RuntimeError("Native subprocess returned invalid encoding") from None
        except subprocess.TimeoutExpired:
            raise RuntimeError("Native subprocess timed out; do not replay input") from None
        finally:
            self.close()

    def close(self):
        if self.process.poll() is None:
            self.process.kill()
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            pass
        for thread in self.threads:
            thread.join(timeout=1)
        self.output.clear()


class NativeTransport:
    def __init__(self, root, binding, event, challenge, options, authorize):
        self.root = Path(root)
        self.binding = dict(binding)
        self.event = event
        self.challenge = challenge
        self.options = dict(options)
        self.authorize = authorize
        self.page_url = "https://chatgpt.com/c/" + binding["targetConversationId"]
        self.directory = self.root / "chatgpt-wake-dev-receipts"
        self.marker = self.directory / (binding["bindingFingerprint"] + "-" + event + ".native-input.json")
        # A bound helper is capped at 240s by the executor, within its existing
        # 300s claim. Leave time for key/receipt work and a result callback.
        self.deadline = time.monotonic() + 225
        self.context = None
        self.target = None

    def _remaining(self, cap=30):
        remaining = min(cap, self.deadline - time.monotonic())
        if remaining <= 0:
            raise RuntimeError("Native wake observation deadline exceeded")
        return remaining

    def _runtime(self):
        if os.name != "nt":
            raise RuntimeError("Native bound transport requires Windows")
        local = os.environ.get("LOCALAPPDATA")
        user = os.environ.get("USERPROFILE")
        system = os.environ.get("SystemRoot")
        if not local or not user or not system:
            raise RuntimeError("Native Windows paths are unavailable")
        portable = Path(local) / "OpenClaw" / "deps" / "portable-node"
        self.node = portable / "node.exe"
        self.entry = portable / "node_modules" / "openclaw" / "openclaw.mjs"
        self.powershell = Path(system) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
        self.bridge = Path(__file__).with_name("dev-chatgpt-native-bridge.ps1")
        self.expected_user_data = str(PureWindowsPath(user) / ".openclaw" / "browser" / self.binding["browserProfile"] / "user-data")
        if not all(path.is_file() for path in (self.node, self.entry, self.powershell, self.bridge,
                                               self.bridge.with_name("dev-chatgpt-native-composer.psm1"))):
            raise RuntimeError("Reviewed native transport files are unavailable")

    def _argv(self, action, *args, json_output=True):
        # Direct node argv preserves an observed URL's ampersand as data.
        command = [str(self.node), str(self.entry), "browser", "--browser-profile", self.binding["browserProfile"]]
        if json_output:
            command.append("--json")
        return command + ["--timeout", "60000", action, *args]

    def _cli(self, action, *args, json_output=True):
        timeout = self._remaining(30)
        raw = _Capture(self._argv(action, *args, json_output=json_output)).finish(timeout)
        if not json_output:
            if len(raw) > 200000:
                raise RuntimeError("Native snapshot exceeds the evidence limit")
            return raw
        try:
            value = json.loads(raw)
        except (ValueError, RecursionError):
            raise RuntimeError("Native command returned invalid JSON") from None
        if not isinstance(value, dict):
            raise RuntimeError("Native command returned an invalid envelope")
        return value

    def _bridge(self, action, **data):
        timeout = self._remaining(25)
        raw = _Capture([str(self.powershell), "-NoLogo", "-NoProfile", "-NonInteractive", "-File", str(self.bridge),
                        "-Action", action], json.dumps({"target": self.target, **data}, separators=(",", ":")).encode("utf-8"))
        try:
            value = json.loads(raw.finish(timeout))
        except (ValueError, RecursionError):
            raise RuntimeError("Native bridge returned invalid JSON") from None
        if not isinstance(value, dict) or value.get("ok") is not True or not isinstance(value.get("result"), dict):
            raise RuntimeError("Native UI guard failed; preserve the attempt for reconciliation")
        return value["result"]

    def _session(self):
        self.authorize()
        status = self._cli("status")
        if (status.get("profile") != self.binding["browserProfile"] or status.get("running") is not True or
                type(status.get("pid")) is not int or status["pid"] <= 0 or status.get("userDataDir") != self.expected_user_data):
            raise RuntimeError("OpenClaw managed profile identity is unavailable")
        tabs = self._cli("tabs").get("tabs")
        if not isinstance(tabs, list):
            raise RuntimeError("OpenClaw tab inventory is unavailable")
        matching = [tab for tab in tabs if isinstance(tab, dict) and tab.get("type") == "page" and tab.get("url") == self.page_url]
        if len(matching) != 1 or not isinstance(matching[0].get("targetId"), str) or not RAW_TARGET.fullmatch(matching[0]["targetId"]):
            raise RuntimeError("Expected exactly one native bound ChatGPT tab")
        return {"profile": status["profile"], "pid": status["pid"], "userDataDir": status["userDataDir"],
                "rawTargetId": matching[0]["targetId"], "pageUrl": self.page_url}

    def _guard(self):
        if self._session() != self.context:
            raise RuntimeError("Native OpenClaw target changed")

    def _snapshot(self):
        # This is a read of the already resolved raw target, not input. Avoid
        # launching redundant status/tabs processes for each readiness poll;
        # full context guards fence input, capture and final proof separately.
        self.authorize()
        snapshot = self._cli("snapshot", "--target-id", self.context["rawTargetId"], json_output=False)
        names = re.findall(r'^[ \t]*- textbox "(Ask ChatGPT|Tanya ChatGPT)"[^\r\n]*$', snapshot, re.M)
        if names != [self.options["composerName"]]:
            raise RuntimeError("Native ChatGPT composer role or locale is ambiguous")
        return snapshot

    def _resolve(self):
        self._guard()
        self.target = {"AccountAlias": self.binding["accountAlias"], "OwnerChannel": self.binding["ownerChannel"],
                       "ConversationId": self.binding["targetConversationId"], "BrowserProfile": self.binding["browserProfile"],
                       "BindingFingerprint": self.binding["bindingFingerprint"], "WorkerId": self.binding["workerId"],
                       "EventId": self.event, "Challenge": self.challenge, "ComposerName": self.options["composerName"],
                       "PageUrl": self.page_url, "RawTargetId": self.context["rawTargetId"], "BrowserProcessId": self.context["pid"]}
        resolved = self._bridge("resolve")
        if (type(resolved.get("windowHandle")) is not int or resolved["windowHandle"] <= 0 or
                resolved.get("browserProcessId") != self.context["pid"] or resolved.get("pageUrl") != self.page_url or
                resolved.get("rawTargetId") != self.context["rawTargetId"]):
            raise RuntimeError("Native window resolution does not match OpenClaw")
        self.target["WindowHandle"] = resolved["windowHandle"]

    def _attempt(self, message_hash):
        try:
            if self.marker.stat().st_size > 8192:
                raise RuntimeError("Native input marker exceeds limit")
            record = json.loads(self.marker.read_text(encoding="utf-8"))
        except (ValueError, RecursionError, OSError):
            raise RuntimeError("Native input marker is unavailable; do not replay") from None
        expected = {"version": 1, "eventId": self.event, "challenge": self.challenge,
                    "bindingFingerprint": self.binding["bindingFingerprint"], "browserProfile": self.binding["browserProfile"],
                    "conversationId": self.binding["targetConversationId"], "pageUrl": self.page_url,
                    "rawTargetId": self.context["rawTargetId"], "accountAlias": self.binding["accountAlias"],
                    "ownerChannel": self.binding["ownerChannel"], "workerId": self.binding["workerId"], "messageHash": message_hash,
                    "allowProviderLf": self.options["allowProviderLf"]}
        if (not isinstance(record, dict) or any(record.get(key) != value for key, value in expected.items()) or
                type(record.get("version")) is not int or type(record.get("allowProviderLf")) is not bool or
                record.get("status") not in ("SEND_ATTEMPTING", "SEND_INVOKED", "REFRESH_ATTEMPTING", "REFRESH_INVOKED")):
            raise RuntimeError("Native input marker context mismatch; do not replay")
        for key in ("inputStartedAt", "sendAttemptedAt"):
            value = record.get(key)
            if type(value) not in (int, float) or not math.isfinite(value) or not 0 < value <= time.time():
                raise RuntimeError("Original native input timestamp is unavailable")
        if record["sendAttemptedAt"] < record["inputStartedAt"]:
            raise RuntimeError("Native input timestamps are inconsistent")
        return record

    @contextmanager
    def _exclusive(self):
        # One Windows UI owner for this worker, including different event IDs.
        # The OS releases the byte lock after a crash; input markers still fence
        # retries. This does not create another consumer or process identity.
        import msvcrt
        self.directory.mkdir(parents=True, exist_ok=True)
        with (self.directory / "native-transport.lock").open("a+b") as lock:
            if lock.tell() == 0:
                lock.write(b"0")
                lock.flush()
            lock.seek(0)
            try:
                msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError:
                raise RuntimeError("Another native wake owns the Windows UI") from None
            try:
                yield
            finally:
                lock.seek(0)
                msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)

    def _ready(self, snapshot, message):
        return (not STOP.search(snapshot) and snapshot.count(message) == 1 and
                snapshot.count("[AI_CORE_WAKE:" + self.event + "]") == 1 and
                snapshot.count("[AI_CORE_ATTEST:" + self.challenge + "]") == 1 and
                snapshot.count("[AI_CORE_ATTEST_ACK:" + self.challenge + "]") >= 2)

    def _capture_response(self, request_url, message_hash):
        # One listener and one guarded native refresh. Missing explicit empty
        # draft proof stops in the native adapter; it is not silently inferred
        # from a placeholder. A future transport needs separate live evidence.
        self._guard()
        listener = _Capture(self._argv("responsebody", request_url, "--target-id", self.context["rawTargetId"],
                                      "--max-chars", "200000", "--timeout-ms", "45000"))
        try:
            # The pinned CLI supplies no readiness acknowledgment. This bounded
            # startup interval cannot prove registration; a lost race is a
            # timeout, never grounds for replay or a second refresh.
            time.sleep(min(1, self._remaining(1)))
            # Do not enqueue another same-profile OpenClaw command behind the
            # waiting listener. The native adapter rechecks HWND/PID/address
            # independently; local revocation is still checked immediately.
            self.authorize()
            self._bridge("refresh", messageHash=message_hash, receiptDirectory=str(self.directory))
            raw = listener.finish(self._remaining(60))
            try:
                return json.loads(raw)
            except (ValueError, RecursionError):
                raise RuntimeError("Native response capture returned invalid JSON") from None
        finally:
            listener.close()

    def run(self, message):
        if (not isinstance(message, str) or not message.strip() or len(message) > 4096 or
                re.search(r"[^\x20-\x7e]", message)):
            raise RuntimeError("Native input requires a bounded printable single-line message")
        if any(message.count(token) != 1 for token in ("[AI_CORE_WAKE:" + self.event + "]",
                                                       "[AI_CORE_ATTEST:" + self.challenge + "]",
                                                       "[AI_CORE_ATTEST_ACK:" + self.challenge + "]")):
            raise RuntimeError("Native input contains ambiguous wake markers")
        self.authorize()
        self._runtime()
        message_hash = hashlib.sha256(message.encode("utf-8")).hexdigest()
        with self._exclusive():
            self.context = self._session()
            before = self._snapshot()
            existing = self.marker.exists()
            if existing:
                record = self._attempt(message_hash)
            else:
                if STOP.search(before):
                    raise RuntimeError("ChatGPT is still responding; native input is blocked")
                if ("AI_CORE_WAKE:" + self.event) in before or ("AI_CORE_ATTEST:" + self.challenge) in before:
                    raise RuntimeError("Visible wake has no original input record; do not replay")
            self._resolve()
            if not existing:
                self.authorize()
                result = self._bridge("submit", message=message, receiptDirectory=str(self.directory),
                                      allowProviderLf=self.options["allowProviderLf"])
                if result.get("sendInvoked") is not True:
                    raise RuntimeError("Native Send outcome is unknown; do not replay")
                record = self._attempt(message_hash)
            snapshot = self._snapshot()
            readiness_deadline = min(self.deadline - 55, time.monotonic() + 70)
            while not self._ready(snapshot, message) and time.monotonic() < readiness_deadline:
                time.sleep(min(2, self._remaining(2)))
                snapshot = self._snapshot()
            if not self._ready(snapshot, message):
                raise RuntimeError("Native assistant reply is not visibly ready")
            if "refreshAttemptedAt" in record:
                raise RuntimeError("Native response capture was already attempted; do not refresh again")
            requests = self._cli("requests", "--target-id", self.context["rawTargetId"],
                                 "--filter", self.binding["targetConversationId"])
            request_url = select_observed_request(requests, page_url=self.page_url,
                                                 raw_target_id=self.context["rawTargetId"],
                                                 conversation_id=self.binding["targetConversationId"])
            envelope = self._capture_response(request_url, message_hash)
            captured_at = time.time()
            snapshot = self._snapshot()
            observed = validate_native_response(envelope, page_url=self.page_url, request_url=request_url,
                                                raw_target_id=self.context["rawTargetId"],
                                                conversation_id=self.binding["targetConversationId"], event_id=self.event,
                                                challenge=self.challenge, visible_snapshot=snapshot,
                                                expected_user_text=message, not_before=record["sendAttemptedAt"],
                                                captured_at=captured_at)
            self._guard()
            return {**observed, "alreadyVisible": existing, "rawTargetId": self.context["rawTargetId"],
                    "sendAttemptedAt": record["sendAttemptedAt"]}
