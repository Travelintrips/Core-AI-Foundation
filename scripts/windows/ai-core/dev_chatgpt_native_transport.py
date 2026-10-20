"""Opt-in Windows transport using native UI and supported OpenClaw commands.

No page evaluation, endpoint replay, session export or assistant ID inference.
All process output stays in memory; failures expose fixed messages only.
"""

from contextlib import contextmanager
from concurrent.futures import ThreadPoolExecutor
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
READER_STATES = frozenset(("OPEN_ATTEMPTING", "BLANK_CREATED", "BLANK_VERIFIED",
                           "NAVIGATION_ATTEMPTING", "NAVIGATION_INVOKED", "CAPTURE_VERIFIED"))
LISTENER_STARTUP_SECONDS = 12


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
        self.reader_marker = self.directory / (binding["bindingFingerprint"] + "-" + event + ".native-reader.json")
        # A bound helper is capped at 240s by the executor, within its existing
        # 300s claim. Leave time for key/receipt work and a result callback.
        self.deadline = time.monotonic() + 225
        self.context = None
        self.target = None
        self.reader_id = None
        self.reader_identity = None
        self.last_tabs = None

    def _remaining(self, cap=30):
        remaining = min(cap, self.deadline - time.monotonic())
        if remaining <= 0:
            raise RuntimeError("Native wake observation deadline exceeded")
        return remaining

    def _reserve(self, seconds):
        if self.deadline - time.monotonic() < seconds:
            raise RuntimeError("Insufficient native observation budget; preserve the attempt")

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

    def _session(self, reader_url=None):
        self.authorize()
        # Independent reads share no mutable result. Parallel CLI startup saves
        # about one cold start at each action fence; no browser action or future
        # response listener is running while this pair is requested.
        with ThreadPoolExecutor(max_workers=2) as pool:
            status_future = pool.submit(self._cli, "status")
            tabs_future = pool.submit(self._cli, "tabs")
            status, tab_envelope = status_future.result(), tabs_future.result()
        if (status.get("profile") != self.binding["browserProfile"] or status.get("running") is not True or
                type(status.get("pid")) is not int or status["pid"] <= 0 or status.get("userDataDir") != self.expected_user_data):
            raise RuntimeError("OpenClaw managed profile identity is unavailable")
        tabs = tab_envelope.get("tabs")
        if not isinstance(tabs, list) or not 1 <= len(tabs) <= 128:
            raise RuntimeError("OpenClaw tab inventory is unavailable")
        ids = [tab.get("targetId") if isinstance(tab, dict) else None for tab in tabs]
        if (any(not isinstance(value, str) or not RAW_TARGET.fullmatch(value) for value in ids) or
                len({value.lower() for value in ids}) != len(ids)):
            raise RuntimeError("OpenClaw raw tab inventory is ambiguous")
        if self.reader_id is not None:
            self._reader_record()
            owned = [tab for tab in tabs if tab["targetId"] == self.reader_id]
            if (reader_url not in ("about:blank", self.page_url) or len(owned) != 1 or
                    owned[0].get("type") != "page" or owned[0].get("url") != reader_url):
                raise RuntimeError("Owned reader changed; preserve it for reconciliation")
            if reader_url == "about:blank" and sum(tab.get("type") == "page" and tab.get("url") == "about:blank" for tab in tabs) != 1:
                raise RuntimeError("Owned blank reader is not uniquely identifiable")
        # The exclusion exists only after this invocation creates and durably
        # records its exact new raw ID. Old sidecars never grant an exclusion.
        matching = [tab for tab in tabs if tab.get("type") == "page" and tab.get("url") == self.page_url
                    and tab["targetId"] != self.reader_id]
        if len(matching) != 1 or not isinstance(matching[0].get("targetId"), str) or not RAW_TARGET.fullmatch(matching[0]["targetId"]):
            raise RuntimeError("Expected exactly one native bound ChatGPT tab")
        self.last_tabs = tabs
        return {"profile": status["profile"], "pid": status["pid"], "userDataDir": status["userDataDir"],
                "rawTargetId": matching[0]["targetId"], "pageUrl": self.page_url}

    def _guard(self, reader_url=None):
        if self._session(reader_url) != self.context:
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

    def _resolve(self, reader_url=None):
        # The exact paired tab may be in the background. Use the supported
        # raw-ID focus action, then recheck the managed profile before resolving
        # its native address/composer; never substitute another visible tab.
        self.authorize()
        focused = self._cli("focus", self.context["rawTargetId"])
        if focused.get("ok") is not True:
            raise RuntimeError("Exact native ChatGPT target could not be focused")
        self._guard(reader_url)
        prior_handle = self.target.get("WindowHandle") if self.target is not None else None
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
        if prior_handle is not None and resolved["windowHandle"] != prior_handle:
            raise RuntimeError("Original native window changed; preserve the reader")
        self.target["WindowHandle"] = resolved["windowHandle"]

    def _reader_record(self):
        try:
            if self.reader_marker.stat().st_size > 32768:
                raise RuntimeError("Owned reader record exceeds limit")
            record = json.loads(self.reader_marker.read_text(encoding="utf-8"))
        except (ValueError, RecursionError, OSError):
            raise RuntimeError("Owned reader record is unavailable; do not open or navigate again") from None
        if (self.reader_identity is None or not isinstance(record, dict) or
                any(record.get(key) != value for key, value in self.reader_identity.items()) or
                type(record.get("version")) is not int or type(record.get("browserProcessId")) is not int or
                record.get("status") not in READER_STATES or
                (self.reader_id is not None and (record.get("readerRawTargetId") != self.reader_id or
                    self.reader_id.lower() in [value.lower() for value in record["preopenTargetIds"]] or
                    self.reader_id.lower() == self.context["rawTargetId"].lower()))):
            raise RuntimeError("Owned reader context changed; preserve it for reconciliation")
        return record

    def _reader_update(self, expected, **updates):
        # Compare before replacing bytes. A partial write remains an existing
        # fail-closed record on retry; no recovery path guesses tab ownership.
        with self.reader_marker.open("r+b") as stream:
            try:
                current = json.loads(stream.read(32769).decode("utf-8"))
            except (ValueError, UnicodeError, RecursionError):
                raise RuntimeError("Owned reader record changed; preserve it") from None
            if current != expected:
                raise RuntimeError("Owned reader record changed; preserve it")
            current.update(updates)
            raw = json.dumps(current, separators=(",", ":")).encode("utf-8")
            if len(raw) > 32768:
                raise RuntimeError("Owned reader record exceeds limit")
            stream.seek(0)
            stream.truncate()
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        return current

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
        # An existing marker blocks a second reader even if the prior open or
        # native navigation timed out before returning its outcome.
        if self.reader_marker.exists():
            raise RuntimeError("Owned reader was already attempted; reconcile it before another capture")
        self._guard()
        self._reserve(135)
        if any(tab.get("type") == "page" and tab.get("url") == "about:blank" for tab in self.last_tabs):
            raise RuntimeError("A preexisting blank tab prevents unique native reader ownership")
        original = self._attempt(message_hash)
        self.reader_identity = {"version": 1, "eventId": self.event, "challenge": self.challenge,
            "bindingFingerprint": self.binding["bindingFingerprint"], "browserProfile": self.binding["browserProfile"],
            "conversationId": self.binding["targetConversationId"], "pageUrl": self.page_url,
            "originalRawTargetId": self.context["rawTargetId"], "browserProcessId": self.context["pid"],
            "accountAlias": self.binding["accountAlias"], "ownerChannel": self.binding["ownerChannel"],
            "workerId": self.binding["workerId"], "messageHash": message_hash, "requestUrl": request_url,
            "sendAttemptedAt": original["sendAttemptedAt"],
            "preopenTargetIds": [tab["targetId"] for tab in self.last_tabs]}
        record = {**self.reader_identity, "status": "OPEN_ATTEMPTING", "openAttemptedAt": time.time(),
                  "disposition": "PRESERVED_RECONCILIATION_REQUIRED"}
        self.authorize()
        try:
            with self.reader_marker.open("xb") as stream:
                stream.write(json.dumps(record, separators=(",", ":")).encode("utf-8"))
                stream.flush()
                os.fsync(stream.fileno())
        except FileExistsError:
            raise RuntimeError("Owned reader already exists; do not open again") from None
        opened = self._cli("open", "about:blank", "--label", "aicore-reader-" + self.event[:16])
        raw_id = opened.get("targetId")
        if (not isinstance(raw_id, str) or not RAW_TARGET.fullmatch(raw_id) or
                raw_id.lower() in [value.lower() for value in record["preopenTargetIds"]] or opened.get("url") != "about:blank"):
            raise RuntimeError("Reader open outcome is unproven; preserve all tabs and do not retry")
        record = self._reader_update(record, status="BLANK_CREATED", readerRawTargetId=raw_id)
        self.reader_id = raw_id
        self.authorize()
        focused = self._cli("focus", self.reader_id)
        if focused.get("ok") is not True:
            raise RuntimeError("Owned blank reader could not be focused; preserve it")
        self._guard("about:blank")
        resolved = self._bridge("reader-resolve", reader={"RawTargetId": self.reader_id})
        if (type(resolved.get("windowHandle")) is not int or resolved["windowHandle"] <= 0 or
                resolved.get("browserProcessId") != self.context["pid"] or
                resolved.get("rawTargetId") != self.reader_id or resolved.get("address") != "about:blank"):
            raise RuntimeError("Owned blank native window is unproven; preserve it")
        record = self._reader_update(record, status="BLANK_VERIFIED", readerWindowHandle=resolved["windowHandle"],
                                     blankVerifiedAt=time.time())
        reader = {"RawTargetId": self.reader_id, "WindowHandle": resolved["windowHandle"]}
        return self._listen_reader(request_url, message_hash, reader)

    def _listen_reader(self, request_url, message_hash, reader):
        listener = _Capture(self._argv("responsebody", request_url, "--target-id", self.reader_id,
                                      "--max-chars", "200000", "--timeout-ms", "45000"))
        try:
            # The pinned CLI supplies no readiness acknowledgment. This bounded
            # lead covers the measured ~10s startup but cannot prove listener
            # registration. A lost race is a timeout, never a second navigation.
            self._reserve(LISTENER_STARTUP_SECONDS + 35)
            time.sleep(LISTENER_STARTUP_SECONDS)
            # Do not enqueue another same-profile OpenClaw command behind the
            # waiting listener. The native adapter rechecks HWND/PID/address
            # independently; local revocation is still checked immediately.
            self.authorize()
            navigation = self._bridge("reader-navigate", reader=reader, messageHash=message_hash,
                                      receiptDirectory=str(self.directory))
            if (navigation.get("navigationInvoked") is not True or navigation.get("rawTargetId") != self.reader_id or
                    navigation.get("pageUrl") != self.page_url):
                raise RuntimeError("Owned reader navigation outcome is unknown; do not retry")
            record = self._reader_record()
            if record["status"] != "NAVIGATION_INVOKED":
                raise RuntimeError("Owned reader navigation record is unavailable; do not retry")
            # Leave time for the original snapshot, exact original focus and
            # final identity check. Closing a loaded reader is never attempted.
            capture_budget = self.deadline - time.monotonic() - 35
            if capture_budget <= 0:
                raise RuntimeError("Owned reader capture exhausted its observation budget")
            raw = listener.finish(min(60, capture_budget))
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
            if self.reader_marker.exists():
                raise RuntimeError("Owned reader was already attempted; reconciliation is required")
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
                self._reserve(155)
                if any(tab.get("type") == "page" and tab.get("url") == "about:blank" for tab in self.last_tabs):
                    raise RuntimeError("A preexisting blank tab prevents unique native reader ownership")
                self.authorize()
                result = self._bridge("submit", message=message, receiptDirectory=str(self.directory),
                                      allowProviderLf=self.options["allowProviderLf"])
                if result.get("sendInvoked") is not True:
                    raise RuntimeError("Native Send outcome is unknown; do not replay")
                record = self._attempt(message_hash)
            snapshot = self._snapshot()
            readiness_deadline = min(self.deadline - 155, time.monotonic() + 70)
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
                                                raw_target_id=self.reader_id,
                                                conversation_id=self.binding["targetConversationId"], event_id=self.event,
                                                challenge=self.challenge, visible_snapshot=snapshot,
                                                expected_user_text=message, not_before=record["sendAttemptedAt"],
                                                captured_at=captured_at)
            # Restore only the original exact raw target. The native resolver
            # verifies the same PID/HWND/address; it never edits its composer.
            self._resolve(self.page_url)
            reader_record = self._reader_record()
            if reader_record["status"] != "NAVIGATION_INVOKED":
                raise RuntimeError("Owned reader state changed before proof completion")
            self._reader_update(reader_record, status="CAPTURE_VERIFIED", capturedAt=captured_at,
                                originalFocusRestored=True)
            self.authorize()
            return {**observed, "alreadyVisible": existing, "rawTargetId": self.context["rawTargetId"],
                    "captureRawTargetId": self.reader_id, "readerDisposition": "PRESERVED_RECONCILIATION_REQUIRED",
                    "sendAttemptedAt": record["sendAttemptedAt"]}
