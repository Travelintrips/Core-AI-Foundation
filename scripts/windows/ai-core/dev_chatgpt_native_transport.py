"""Opt-in Windows transport using native UI and supported OpenClaw commands.

No page evaluation, endpoint replay, session export or assistant ID inference.
All process output stays in memory; failures expose fixed messages only.
"""

import datetime
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
from urllib.request import Request, urlopen

from dev_chatgpt_native_reader import select_observed_request, validate_native_response
from gpt02_legacy429_quarantine_validator import evaluate_files as evaluate_legacy429_quarantine
from gpt02_ready_capture_stage import ReadyCaptureStage
from gpt02_submit_stream_reader import validate_submit_stream


MAX_OUTPUT_BYTES = 12 * 1024 * 1024
RAW_TARGET = re.compile(r"[A-Fa-f0-9]{32}")
STOP = re.compile(r'\bbutton\s+"Stop(?: generating)?"', re.I)
READER_STATES = frozenset(("OPEN_ATTEMPTING", "BLANK_CREATED", "BLANK_VERIFIED",
                           "NAVIGATION_ATTEMPTING", "NAVIGATION_INVOKED", "CAPTURE_VERIFIED"))
CLI_SECONDS = 75
NATIVE_SECONDS = 45
TRANSPORT_SECONDS = 1950
READINESS_SECONDS = 120  # Isolated candidate: matches proven fixed transport budget; requires native E2E verification.
LISTENER_STARTUP_SECONDS = 25
LISTENER_CAPTURE_SECONDS = 90
# These are sums of bounded remaining phases, not renewed-lease durations.
# Final proof: snapshot, original focus, status, tabs and native resolution.
FINAL_PROOF_SECONDS = 4 * CLI_SECONDS + NATIVE_SECONDS
# After the pre-open guard: open, focus, status, tabs, native blank proof,
# listener lead, native navigation, capture and final proof.
READER_AFTER_GUARD_SECONDS = (4 * CLI_SECONDS + 2 * NATIVE_SECONDS +
                              LISTENER_STARTUP_SECONDS + LISTENER_CAPTURE_SECONDS + FINAL_PROOF_SECONDS)
POST_READINESS_SECONDS = 3 * CLI_SECONDS + READER_AFTER_GUARD_SECONDS


def openclaw_runtime_paths(local):
    node_override = os.environ.get("AI_CORE_OPENCLAW_NODE", "").strip()
    entry_override = os.environ.get("AI_CORE_OPENCLAW_ENTRY", "").strip()
    if bool(node_override) != bool(entry_override):
        raise RuntimeError("OpenClaw runtime override must provide node and entry together")
    if node_override:
        return Path(node_override), Path(entry_override)
    portable = Path(local) / "OpenClaw" / "deps" / "portable-node"
    return portable / "node.exe", portable / "node_modules" / "openclaw" / "openclaw.mjs"


def _unique_rate_log_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate native rate metadata key")
        result[key] = value
    return result


def parse_native_rate_log(raw):
    """Strictly validate entire JSONL before any native provider operation."""
    if not isinstance(raw, str) or not raw.strip() or len(raw.encode("utf-8")) > 4_000_000:
        raise ValueError("missing or oversized native rate metadata")
    lines = raw.splitlines()
    if len(lines) > 10000 or any(not line.strip() for line in lines):
        raise ValueError("invalid native rate metadata rows")
    records = []
    for line in lines:
        record = json.loads(line, object_pairs_hook=_unique_rate_log_pairs)
        status = record.get("responseStatus") if isinstance(record, dict) else None
        if isinstance(status, bool) or not isinstance(status, int) or not 100 <= status <= 599:
            raise ValueError("invalid native rate metadata status")
        records.append(record)
    return records


def has_unverifiable_429(records, now=None):
    """Reject ambiguous legacy 429 metadata before any native provider capture."""
    clock = time.time() if now is None else now
    if not isinstance(records, list) or not math.isfinite(clock):
        return True
    for row in records:
        if not isinstance(row, dict):
            return True
        if row.get("responseStatus") != 429:
            continue
        stamp_text = row.get("capturedAtUtc")
        if not isinstance(stamp_text, str) or not stamp_text:
            return True
        try:
            stamp_dt = datetime.datetime.fromisoformat(stamp_text.replace("Z", "+00:00"))
            if stamp_dt.utcoffset() is None:
                return True
            stamp = stamp_dt.timestamp()
        except (ValueError, TypeError, OverflowError):
            return True
        if not math.isfinite(stamp) or stamp > clock:
            return True
    return False


def has_repeated_recent_429(records, now=None):
    """Fail-closed dispatch policy signal: two recorded 429s within 24 hours."""
    clock = time.time() if now is None else now
    count = 0
    for row in records:
        if not isinstance(row, dict) or row.get("responseStatus") != 429:
            continue
        value = row.get("capturedAtUtc")
        if not isinstance(value, str):
            continue
        try:
            stamp = datetime.datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
        except (ValueError, TypeError, OverflowError):
            continue
        if 0 <= clock - stamp < 86400:
            count += 1
            if count >= 2:
                return True
    return False


def native_submit_seconds(message):
    # Policy allowance from actual 38s/1126-character native input, with a
    # 1.51x per-character margin plus 30s for setup/guards. It is an upper
    # execution bound, never a promise that input or delivery will succeed.
    return min(240, max(60, math.ceil((30 + 0.051 * len(message)) / 5) * 5))


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
                raise RuntimeError("Native subprocess failed; exit_code=" + str(code) + "; stream_failure=" + str(bool(self.failed)) + "; thread_alive=" + str(any(thread.is_alive() for thread in self.threads)) + "; raw output withheld")
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
    def __init__(self, root, binding, event, challenge, options, authorize, lease_guard=None):
        self.root = Path(root)
        self.binding = dict(binding)
        self.event = event
        self.challenge = challenge
        self.options = dict(options)
        self.authorize = authorize
        self.lease_guard = lease_guard
        self.page_url = "https://chatgpt.com/c/" + binding["targetConversationId"]
        self.directory = self.root / "chatgpt-wake-dev-receipts"
        self.marker = self.directory / (binding["bindingFingerprint"] + "-" + event + ".native-input.json")
        self.reader_marker = self.directory / (binding["bindingFingerprint"] + "-" + event + ".native-reader.json")
        self.audit_marker = self.directory / (binding["bindingFingerprint"] + "-" + event + ".stages.jsonl")
        # The parent renews the existing 300s claim while a bounded helper runs.
        # Renewal never extends this fixed total observation deadline.
        self.deadline = time.monotonic() + TRANSPORT_SECONDS
        self.phase_deadline = None
        self.phase = "initializing"
        self.context = None
        self.target = None
        self.reader_id = None
        self.reader_identity = None
        self.last_tabs = None
        self.last_tabs_observed_at = None
        self.composer_geometry = None

    def _audit_stage(self, stage):
        # Evidence-only: bounded stage identifiers, timestamp and event digest.
        # Never persist user input, browser content, challenge or credentials.
        permitted = {"PREFLIGHT", "SEND_ATTEMPTED", "SEND_CONFIRMED", "RESULT_VERIFIED"}
        if stage not in permitted:
            raise ValueError("Invalid native audit stage")
        self.directory.mkdir(parents=True, exist_ok=True)
        record = json.dumps({"stage": stage, "at": time.time(),
                             "eventDigest": hashlib.sha256(self.event.encode("ascii")).hexdigest()},
                            separators=(",", ":")) + "\n"
        data = record.encode("ascii")
        fd = os.open(str(self.audit_marker), os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        try:
            os.write(fd, data)
            os.fsync(fd)
        finally:
            os.close(fd)

    def _remaining(self, cap=CLI_SECONDS):
        remaining = min(cap, self.deadline - time.monotonic())
        if self.phase_deadline is not None:
            remaining = min(remaining, self.phase_deadline - time.monotonic())
        if self.lease_guard is not None:
            remaining = min(remaining, self.lease_guard.remaining(cap))
        if remaining <= 0:
            raise RuntimeError("Native wake observation deadline exceeded")
        return remaining

    def _reserve(self, seconds):
        remaining = self.deadline - time.monotonic()
        if self.lease_guard is not None:
            remaining = min(remaining, self.lease_guard.total_remaining())
        if remaining < seconds:
            raise RuntimeError("Insufficient native observation budget; preserve the attempt")

    def _sleep(self, seconds):
        self.authorize()
        if self.lease_guard is not None:
            self.lease_guard.sleep(seconds)
        else:
            time.sleep(seconds)
        self.authorize()

    def _runtime(self):
        if os.name != "nt":
            raise RuntimeError("Native bound transport requires Windows")
        if self.lease_guard is None:
            raise RuntimeError("Native bound transport requires an active leased process guard")
        self.lease_guard.authorize()
        local = os.environ.get("LOCALAPPDATA")
        user = os.environ.get("USERPROFILE")
        system = os.environ.get("SystemRoot")
        if not local or not user or not system:
            raise RuntimeError("Native Windows paths are unavailable")
        # Prefer the verified authenticated DELL runtime when installed.
        # Explicit paired runtime overrides have priority.
        self.node, self.entry = openclaw_runtime_paths(local)
        if not os.environ.get('AI_CORE_OPENCLAW_NODE') and not os.environ.get('AI_CORE_OPENCLAW_ENTRY'):
            staged_node = Path(local) / 'OpenClaw' / 'deps' / 'node24-compatible' / 'node-v24.22.1-win-x64' / 'node.exe'
            staged_entry = Path(local) / 'OpenClaw' / 'staged-update-2026.10.7' / 'node_modules' / 'openclaw' / 'openclaw.mjs'
            if staged_node.is_file() and staged_entry.is_file():
                self.node, self.entry = staged_node, staged_entry
        cdp_node_override = os.environ.get('AI_CORE_CDP_NODE', '').strip()
        self.cdp_node = Path(cdp_node_override) if cdp_node_override else self.node
        self.powershell = Path(system) / 'System32' / 'WindowsPowerShell' / 'v1.0' / 'powershell.exe'
        self.bridge = Path(__file__).with_name('dev-chatgpt-native-bridge.ps1')
        self.cdp_snapshot = Path(__file__).with_name('dev-chatgpt-cdp-snapshot.js')
        user_dir_override = os.environ.get('AI_CORE_OPENCLAW_EXPECTED_USER_DATA_DIR', '').strip()
        self.expected_user_data = user_dir_override or str(
            PureWindowsPath(local) / 'AI-Core' / 'gateway-stable3-main' / 'browser' / self.binding['browserProfile'] / 'user-data')
        profile_config_path = Path(user) / '.openclaw' / 'openclaw.json'
        try:
            if profile_config_path.stat().st_size > 1024 * 1024:
                raise ValueError('oversized')
            config = json.loads(profile_config_path.read_text(encoding='utf-8-sig'))
            profile_config = config['browser']['profiles'][self.binding['browserProfile']]
            expected_port = profile_config['cdpPort']
        except (OSError, UnicodeError, ValueError, KeyError, TypeError) as error:
            raise RuntimeError('OpenClaw managed profile configuration is unavailable') from error
        if type(expected_port) is not int or not 1024 <= expected_port <= 65535:
            raise RuntimeError('OpenClaw managed profile CDP port is invalid')
        self.expected_cdp_port = expected_port
        if not all(path.is_file() for path in (self.node, self.cdp_node, self.entry, self.powershell, self.bridge, self.cdp_snapshot,
                                               self.bridge.with_name("dev-chatgpt-native-composer.psm1"))):
            raise RuntimeError("Reviewed native transport files are unavailable")

    def _argv(self, action, *args, json_output=True):
        # Direct node argv preserves an observed URL's ampersand as data.
        command = [str(self.node), str(self.entry), "browser", "--browser-profile", self.binding["browserProfile"]]
        if json_output:
            command.append("--json")
        return command + ["--timeout", "60000", action, *args]

    def _cli(self, action, *args, json_output=True):
        self.authorize()
        timeout = self._remaining(CLI_SECONDS)
        started = time.monotonic()
        try:
            raw = _Capture(self._argv(action, *args, json_output=json_output)).finish(timeout)
        except RuntimeError as error:
            elapsed = round(time.monotonic() - started, 1)
            raise RuntimeError("Native " + self.phase + "/" + action + " after " + str(elapsed) + "s: " + str(error)) from None
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

    def _preflight_cli(self, action):
        # Bounded retry for read-only status/tabs only.
        if action not in ("status", "tabs"):
            raise RuntimeError("Preflight action not allowlisted")
        for attempt in range(2):
            try:
                return self._cli(action)
            except RuntimeError:
                if attempt == 1:
                    raise
                self._sleep(2)

    def _cdp_submit(self, message, allow_provider_lf):
        """Single-attempt bound CDP Send; JS owns durable native-input marker."""
        self.authorize()
        if self.lease_guard is None:
            raise RuntimeError("CDP Send requires an active leased process guard")
        remaining = self._remaining(native_submit_seconds(message))
        expiry_ms = int((time.time() + min(remaining, self.lease_guard.total_remaining())) * 1000)
        script = Path(__file__).with_name("dev-chatgpt-ax-identity-readonly.js")
        if not script.is_file() or self.marker.exists():
            raise RuntimeError("CDP Send unavailable or already attempted")
        args = [str(self.cdp_node), str(script), str(self.context["pid"]), str(self.context["cdpPort"]),
                self.context["rawTargetId"], self.page_url, self.expected_user_data,
                self.binding["accountAlias"], self.binding["bindingFingerprint"], "submit"]
        payload = json.dumps({"message": message, "eventId": self.event,
                              "challenge": self.challenge, "allowProviderLf": bool(allow_provider_lf),
                              "leaseDeadlineEpochMs": expiry_ms}, separators=(",", ":")).encode("utf-8")
        try:
            output = _Capture(args, payload).finish(remaining)
            envelope = json.loads(output)
        except (RuntimeError, ValueError, RecursionError):
            raise RuntimeError("Bound CDP Send outcome unknown; do not replay") from None
        result = envelope.get("result") if isinstance(envelope, dict) else None
        if (not isinstance(envelope, dict) or envelope.get("ok") is not True or
                not isinstance(result, dict) or result.get("sendInvoked") is not True or
                result.get("eventId") != self.event or
                result.get("bindingFingerprint") != self.binding["bindingFingerprint"]):
            raise RuntimeError("Bound CDP Send attestation mismatch; do not replay")
        return result
    def _bridge(self, action, **data):
        self.authorize()
        if self.lease_guard is None:
            raise RuntimeError("Native action requires an active leased process guard")
        timeout = self._remaining(native_submit_seconds(data["message"]) if action == "submit" else NATIVE_SECONDS)
        lease_expiry = self.lease_guard.expiry_tick_count64()
        raw = _Capture([str(self.powershell), "-NoLogo", "-NoProfile", "-NonInteractive", "-File", str(self.bridge),
                        "-Action", action], json.dumps({"target": self.target, **data,
                            "leaseExpiresTickCount64": lease_expiry}, separators=(",", ":")).encode("utf-8"))
        try:
            bridge_output = raw.finish(timeout)
        except RuntimeError as error:
            raise RuntimeError("Native " + self.phase + "/" + action + ": " + str(error)) from None
        try:
            value = json.loads(bridge_output)
        except (ValueError, RecursionError):
            raise RuntimeError("Native bridge returned invalid JSON") from None
        if not isinstance(value, dict) or value.get("ok") is not True or not isinstance(value.get("result"), dict):
            raise RuntimeError("Native UI guard failed; preserve the attempt for reconciliation")
        return value["result"]

    def _native_profile_pid(self, cdp_port):
        if type(cdp_port) is not int or not 1024 <= cdp_port <= 65535:
            raise RuntimeError("OpenClaw CDP identity is unavailable")
        expected = self.expected_user_data.replace("'", "''")
        # Match only exact unquoted or quoted user-data argument and CDP port.
        # A prefix wildcard could incorrectly accept a different profile.
        script = (
            "$expected='" + expected + "'; "
            "$escaped=[regex]::Escape($expected); "
            "$profilePattern='(?i)(?:^|\\s)--user-data-dir=(?:\\x22'+$escaped+'\\x22|'+$escaped+')(?=\\s|$)'; "
            "$rows=@(Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { "
            "$_.CommandLine -and $_.CommandLine -notmatch '--type=' -and "
            "$_.CommandLine -match '--remote-debugging-port=" + str(cdp_port) + "(?:\\s|$)' -and "
            "$_.CommandLine -match $profilePattern -and "
            "([regex]::Matches($_.CommandLine,'(?i)--user-data-dir=')).Count -eq 1 -and "
            "([regex]::Matches($_.CommandLine,'(?i)--remote-debugging-port=')).Count -eq 1 "
            "} | Select-Object -ExpandProperty ProcessId); "
            "if($rows.Count -ne 1){exit 41}; @{ProcessId=[int]$rows[0]} | ConvertTo-Json -Compress"
        )
        last_error = None
        for attempt in range(3):
            try:
                raw = _Capture([str(self.powershell), "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script]).finish(NATIVE_SECONDS)
                row = json.loads(raw)
                pid = row.get("ProcessId") if isinstance(row, dict) else None
                if type(pid) is int and pid > 0:
                    return pid
                last_error = RuntimeError("Native profile identity returned invalid JSON")
            except (RuntimeError, ValueError, RecursionError) as error:
                last_error = error
            if attempt < 2:
                self._sleep(1)
        raise RuntimeError("Native profile identity is unavailable") from last_error

    def _cdp_tab_inventory(self, cdp_port):
        if type(cdp_port) is not int or not 1024 <= cdp_port <= 65535:
            raise RuntimeError("OpenClaw CDP identity is unavailable")
        try:
            with urlopen(f"http://127.0.0.1:{cdp_port}/json", timeout=3) as response:
                raw = response.read(512 * 1024)
            inventory = json.loads(raw)
        except Exception as error:
            raise RuntimeError("Native CDP tab inventory is unavailable") from error
        if not isinstance(inventory, list) or not 1 <= len(inventory) <= 256:
            raise RuntimeError("Native CDP tab inventory is unavailable")
        tabs = []
        for item in inventory:
            if not isinstance(item, dict):
                continue
            target_id = item.get("id")
            if not isinstance(target_id, str) or not RAW_TARGET.fullmatch(target_id):
                raise RuntimeError("Native CDP raw tab inventory is ambiguous")
            tabs.append({"targetId": target_id, "type": item.get("type"), "url": item.get("url")})
        if not tabs or len({tab["targetId"].lower() for tab in tabs}) != len(tabs):
            raise RuntimeError("Native CDP raw tab inventory is ambiguous")
        return tabs

    def _cdp_exact_bound_tab(self, cdp_port):
        tabs = self._cdp_tab_inventory(cdp_port)
        matching = [tab for tab in tabs if tab.get("type") == "page" and tab.get("url") == self.page_url]
        if len(matching) != 1:
            raise RuntimeError("Expected exactly one native bound ChatGPT tab")
        return matching[0]["targetId"]

    def _cdp_create_blank_target(self, cdp_port):
        if type(cdp_port) is not int or not 1024 <= cdp_port <= 65535:
            raise RuntimeError("OpenClaw CDP identity is unavailable")
        try:
            request = Request(f"http://127.0.0.1:{cdp_port}/json/new?about:blank", method="PUT")
            with urlopen(request, timeout=3) as response:
                raw = response.read(64 * 1024)
            opened = json.loads(raw)
        except Exception as error:
            raise RuntimeError("Native CDP blank target creation failed") from error
        target_id = opened.get("id") if isinstance(opened, dict) else None
        if (not isinstance(target_id, str) or not RAW_TARGET.fullmatch(target_id)
                or opened.get("url") != "about:blank"):
            raise RuntimeError("Native CDP blank target creation was not confirmed")
        return {"targetId": target_id, "url": "about:blank"}

    def _cdp_activate_target(self, cdp_port, target_id):
        tabs = self._cdp_tab_inventory(cdp_port)
        if sum(tab["targetId"] == target_id for tab in tabs) != 1:
            raise RuntimeError("Native CDP target activation is ambiguous")
        try:
            with urlopen(f"http://127.0.0.1:{cdp_port}/json/activate/{target_id}", timeout=3) as response:
                body = response.read(4096).decode("utf-8", "strict")
        except Exception as error:
            raise RuntimeError("Native CDP target activation failed") from error
        if "activated" not in body.lower():
            raise RuntimeError("Native CDP target activation was not confirmed")

    def _session(self, reader_url=None):
        self.authorize()
        # GPT02 DELL has a separately verified native Chrome identity and CDP
        # endpoint. When the staged CDP capture flag is enabled, prove that
        # exact local profile directly instead of depending on the OpenClaw
        # browser CLI, whose control request may block even while CDP is healthy.
        # This path does not weaken binding: PID, user-data dir, port, exact
        # conversation URL and owned-reader identity remain fail-closed.
        if (os.environ.get("AI_CORE_GPT02_CDP_READY_CAPTURE_DEV") == "1"
                and self.binding.get("workerId") == "openclaw-dell-chatgpt-wake-dev"
                and self.binding.get("browserProfile") == "gpt02-dell-dev"):
            native_pid = self._native_profile_pid(self.expected_cdp_port)
            cdp_tabs = self._cdp_tab_inventory(self.expected_cdp_port)
            if self.reader_id is not None:
                self._reader_record()
                owned = [tab for tab in cdp_tabs if tab.get("targetId") == self.reader_id]
                if (reader_url not in ("about:blank", self.page_url) or len(owned) != 1
                        or owned[0].get("type") != "page" or owned[0].get("url") != reader_url):
                    raise RuntimeError("Owned reader changed; preserve it for reconciliation")
                if (reader_url == "about:blank" and sum(
                        tab.get("type") == "page" and tab.get("url") == "about:blank"
                        for tab in cdp_tabs) != 1):
                    raise RuntimeError("Owned blank reader is not uniquely identifiable")
                matching = [tab for tab in cdp_tabs
                            if tab.get("type") == "page" and tab.get("url") == self.page_url
                            and tab.get("targetId") != self.reader_id]
                if len(matching) != 1:
                    raise RuntimeError("Expected exactly one native bound ChatGPT tab; candidates=" + str(len(matching)))
                raw_target_id = matching[0]["targetId"]
            else:
                from gpt02_bound_cdp_fallback import unique_bound_target
                raw_target_id = unique_bound_target(cdp_tabs, self.page_url)
                if raw_target_id is None:
                    raise RuntimeError("Expected exactly one native bound ChatGPT tab; candidates=0")
            self.last_tabs = cdp_tabs
            self.last_tabs_observed_at = time.time()
            return {"profile": self.binding["browserProfile"], "pid": native_pid,
                    "userDataDir": self.expected_user_data, "cdpPort": self.expected_cdp_port,
                    "rawTargetId": raw_target_id, "pageUrl": self.page_url}
        # Actual same-profile parallel startup exceeded 30s and did not return
        # a usable inventory. Serialized reads preserve both identity fences.
        def _diag(stage, ok, failure="none"):
            # Allowlisted stage/failure strings only; no CLI output or browser data.
            import datetime
            entry = "IDENTITY_DIAG time=%s stage=%s ok=%s failure=%s\n" % (
                datetime.datetime.now(datetime.timezone.utc).isoformat(), stage, ok, failure)
            try:
                with open(Path(__file__).with_name("dev-identity-diagnostic.log"), "a", encoding="utf-8") as log:
                    log.write(entry)
            except OSError:
                pass
        try:
            status = self._preflight_cli("status")
        except Exception:
            _diag("status", False, "cli_exception")
            raise
        _diag("status", isinstance(status, dict), "none" if isinstance(status, dict) else "invalid_type")
        # Shape-only diagnostics: never log profile values, paths, URLs or tokens.
        def _status_shape(stage, value):
            if not isinstance(value, dict):
                _diag(stage, False, "invalid_type")
                return
            for field in ("profile", "running", "pid", "userDataDir", "cdpPort"):
                present = field in value and value[field] is not None
                _diag(stage + "_" + field, present, "none" if present else "missing")
        _status_shape("status_fields", status)
        try:
            tab_envelope = self._preflight_cli("tabs")
        except Exception:
            _diag("tabs", False, "cli_exception")
            raise
        _diag("tabs", isinstance(tab_envelope, dict), "none" if isinstance(tab_envelope, dict) else "invalid_type")
        # Retry only incomplete managed-status observations; never retry a wrong identity.
        def _valid_managed_status(value):
            return (isinstance(value, dict) and
                    value.get("profile") == self.binding["browserProfile"] and
                    value.get("running") is True and
                    type(value.get("pid")) is int and value["pid"] > 0 and
                    value.get("userDataDir") == self.expected_user_data and
                    type(value.get("cdpPort")) is int and
                    value.get("cdpPort") == self.expected_cdp_port)
        if (isinstance(status, dict) and status.get("profile") == self.binding["browserProfile"] and not _valid_managed_status(status) and not (status.get("pid") is None and status.get("userDataDir") is None)):
            for attempt in range(5):
                self.authorize()
                self._sleep(2)
                try:
                    candidate = self._cli("status")
                except Exception:
                    _diag("status_retry", False, "cli_exception")
                    continue
                if not isinstance(candidate, dict) or candidate.get("profile") != self.binding["browserProfile"]:
                    _diag("status_retry", False, "identity_mismatch")
                    break
                _status_shape("retry_fields", candidate)
                _diag("status_retry", _valid_managed_status(candidate),
                      "none" if _valid_managed_status(candidate) else "incomplete")
                status = candidate
                if _valid_managed_status(status):
                    break
        tabs_observed_at = time.time()
        tabs = tab_envelope.get("tabs")
        # Identity diagnostics: local append-only booleans; no browser data or secrets.
        import datetime
        import sys
        checks = (
            status.get("profile") == self.binding["browserProfile"],
            status.get("running") is True,
            type(status.get("pid")) is int and status.get("pid") > 0,
            status.get("userDataDir") == self.expected_user_data,
            type(status.get("cdpPort")) is int and status.get("cdpPort") == self.expected_cdp_port,
        )
        diagnostic = "IDENTITY_DIAG time=%s stage=session profile_ok=%s running_ok=%s pid_ok=%s dir_ok=%s cdp_ok=%s\n" % (
            datetime.datetime.now(datetime.timezone.utc).isoformat(), *checks)
        try:
            with open(Path(__file__).with_name("dev-identity-diagnostic.log"), "a", encoding="utf-8") as log:
                log.write(diagnostic)
        except OSError:
            pass  # Diagnostics must never change identity decisions.
        if (status.get("profile") != self.binding["browserProfile"] or
                status.get("running") is not True or
                type(status.get("cdpPort")) is not int or
                status.get("cdpPort") != self.expected_cdp_port):
            raise RuntimeError("OpenClaw managed profile identity is unavailable")
        pid = status.get("pid")
        user_data = status.get("userDataDir")
        # Independently prove the Chrome parent PID owns this same port and
        # profile data directory. Never substitute an unrelated process.
        native_pid = self._native_profile_pid(self.expected_cdp_port)
        if pid is None and user_data is None:
            pid = native_pid
            user_data = self.expected_user_data
        if (type(pid) is not int or pid <= 0 or pid != native_pid or
                user_data != self.expected_user_data):
            raise RuntimeError("OpenClaw managed profile identity is unavailable")
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
        def bound_candidates(rows):
            return [tab for tab in rows if tab.get("type") == "page" and tab.get("url") == self.page_url
                    and tab['targetId'] != self.reader_id
                    and not (isinstance(tab.get('suggestedTargetId'), str) and
                             re.fullmatch(r'aicore-reader-[a-f0-9]{16}', tab['suggestedTargetId']) and
                             (tab.get('label') is None or tab.get('label') == tab['suggestedTargetId']))]
        matching = bound_candidates(tabs)
        # Retry only zero candidates, with reauthorization on every read.
        if self.reader_id is not None and len(matching) == 0:
            for _ in range(3):
                self._sleep(1)
                retry_envelope = self._preflight_cli("tabs")
                retry_tabs = retry_envelope.get("tabs")
                if not isinstance(retry_tabs, list) or not 1 <= len(retry_tabs) <= 128:
                    continue
                retry_ids = [tab.get("targetId") if isinstance(tab, dict) else None for tab in retry_tabs]
                if (any(not isinstance(value, str) or not RAW_TARGET.fullmatch(value) for value in retry_ids) or
                        len({value.lower() for value in retry_ids}) != len(retry_ids)):
                    raise RuntimeError("OpenClaw raw tab inventory is ambiguous")
                owned = [tab for tab in retry_tabs if tab['targetId'] == self.reader_id]
                if (reader_url not in ('about:blank', self.page_url) or len(owned) != 1 or
                        owned[0].get('type') != 'page' or owned[0].get('url') != reader_url):
                    raise RuntimeError('Owned reader changed; preserve it for reconciliation')
                if reader_url == 'about:blank' and sum(
                        tab.get('type') == 'page' and tab.get('url') == 'about:blank' for tab in retry_tabs) != 1:
                    raise RuntimeError('Owned blank reader is not uniquely identifiable')
                retry_matching = bound_candidates(retry_tabs)
                if len(retry_matching) > 1:
                    raise RuntimeError('Expected exactly one native bound ChatGPT tab')
                if len(retry_matching) == 1:
                    tabs = retry_tabs
                    matching = retry_matching
                    tabs_observed_at = time.time()
                    break
        if self.reader_id is not None and len(matching) == 0:
            # Do not substitute another target for the pinned original.
            # Check the two exact tab IDs through the CDP inventory.
            cdp_tabs = self._cdp_tab_inventory(status.get('cdpPort'))
            original_ok = sum(tab.get('targetId') == self.context['rawTargetId'] and
                              tab.get('type') == 'page' and tab.get('url') == self.page_url
                              for tab in cdp_tabs) == 1
            reader_ok = sum(tab.get('targetId') == self.reader_id and
                            tab.get('type') == 'page' and tab.get('url') == reader_url
                            for tab in cdp_tabs) == 1
            if original_ok and reader_ok:
                return {'profile': status['profile'], 'pid': pid, 'userDataDir': user_data,
                        'cdpPort': status.get('cdpPort'), 'rawTargetId': self.context['rawTargetId'],
                        'pageUrl': self.page_url}
        # OpenClaw can return an incomplete tab snapshot while Chrome's exact
        # profile is already verified by parent PID, user-data dir and CDP port.
        # A rescue is allowed only BEFORE an owned reader exists and only if
        # that same verified CDP inventory contains exactly one exact-URL tab.
        # Never choose between duplicates or replace a previously pinned tab.
        if len(matching) == 0 and self.reader_id is None:
            from gpt02_bound_cdp_fallback import unique_bound_target
            cdp_fallback_tabs = self._cdp_tab_inventory(status.get('cdpPort'))
            unique_id = unique_bound_target(cdp_fallback_tabs, self.page_url)
            if unique_id is not None:
                matching = [{'targetId': unique_id, 'type': 'page', 'url': self.page_url}]
        if len(matching) != 1 or not isinstance(matching[0].get("targetId"), str) or not RAW_TARGET.fullmatch(matching[0]["targetId"]):
            raise RuntimeError("Expected exactly one native bound ChatGPT tab; candidates=" + str(len(matching)))
        raw_target_id = matching[0]["targetId"]
        cdp_tabs = self._cdp_tab_inventory(status.get("cdpPort"))
        if sum(tab.get("targetId") == raw_target_id and tab.get("type") == "page" and
               tab.get("url") == self.page_url for tab in cdp_tabs) != 1:
            raise RuntimeError("Native CDP pairing for the bound ChatGPT tab is unavailable")
        self.last_tabs = tabs
        self.last_tabs_observed_at = tabs_observed_at
        return {"profile": status["profile"], "pid": pid, "userDataDir": user_data,
                "cdpPort": status.get("cdpPort"), "rawTargetId": raw_target_id, "pageUrl": self.page_url}

    def _guard(self, reader_url=None):
        if self._session(reader_url) != self.context:
            raise RuntimeError("Native OpenClaw target changed")

    def _snapshot(self):
        # Read visible text from the exact CDP target. ChatGPT can briefly
        # replace the composer during a post-response rerender, so a read-only
        # snapshot gets a small bounded retry window. Target URL/raw ID and all
        # evidence validation remain exact; no UI action is replayed here.
        last_error = None
        for attempt in range(6):
            self.authorize()
            timeout = self._remaining(CLI_SECONDS)
            try:
                raw = _Capture([str(self.cdp_node), str(self.cdp_snapshot), str(self.context["cdpPort"]),
                                self.context["rawTargetId"], self.page_url]).finish(timeout)
                value = json.loads(raw)
                if not isinstance(value, dict) or value.get("url") != self.page_url:
                    raise RuntimeError("Native CDP snapshot target changed")
                snapshot = value.get("bodyText")
                names = value.get("composerNames")
                bounds = value.get("composerBounds")
                if (not isinstance(snapshot, str) or len(snapshot) > 200000 or
                        not isinstance(names, list) or not isinstance(bounds, list) or len(bounds) != 1):
                    raise RuntimeError("Native CDP snapshot is invalid")
                break
            except (RuntimeError, ValueError, RecursionError) as error:
                last_error = error
                if attempt == 5:
                    raise RuntimeError("Native " + self.phase + "/snapshot: CDP snapshot unavailable") from error
                self._sleep(2)
        else:
            raise RuntimeError("Native " + self.phase + "/snapshot: CDP snapshot unavailable") from last_error
        if (len(names) != 1 or names[0] != self.options["composerName"]):
            raise RuntimeError("Native ChatGPT composer role or locale is ambiguous")
        geometry = bounds[0]
        required_geometry = ("screenX", "screenY", "width", "height")
        if (not isinstance(geometry, dict) or any(type(geometry.get(key)) not in (int, float) for key in required_geometry) or
                geometry.get("name") != self.options["composerName"] or
                geometry["width"] <= 0 or geometry["height"] <= 0):
            raise RuntimeError("Native CDP composer geometry is invalid")
        self.composer_geometry = {key: float(geometry[key]) for key in required_geometry}
        # Preserve the STOP semantic expected by _ready().
        if value.get("stopVisible") is True:
            snapshot += '\nbutton "Stop generating"'
        return snapshot

    def _ax_verify_bound_composer(self):
        """Independently verify the exact bound Chromium AX editor before native actions."""
        script = Path(__file__).with_name("dev-chatgpt-ax-identity-readonly.js")
        if not script.is_file():
            raise RuntimeError("Bound Chromium accessibility adapter missing")
        argv = [str(self.cdp_node), str(script), str(self.context["pid"]),
                str(self.context["cdpPort"]), self.context["rawTargetId"],
                self.page_url, self.expected_user_data,
                self.binding["accountAlias"], self.binding["bindingFingerprint"], "focus"]
        try:
            raw = _Capture(argv).finish(self._remaining(CLI_SECONDS))
            result = json.loads(raw)
        except (RuntimeError, ValueError, RecursionError):
            raise RuntimeError("Bound Chromium accessibility preflight failed") from None
        if (not isinstance(result, dict) or result.get("ok") is not True or
                result.get("mode") != "focus-verified" or
                result.get("pid") != self.context["pid"] or
                result.get("port") != self.context["cdpPort"] or
                result.get("targetId") != self.context["rawTargetId"] or
                result.get("axHits") != 1 or result.get("urlVerified") is not True or
                result.get("domAttributesVerified") is not True):
            raise RuntimeError("Bound Chromium accessibility identity mismatch")
    def _resolve(self, reader_url=None):
        """CDP-only bound composer resolver; no native HWND/UI Automation."""
        self.authorize()
        self._guard(reader_url)
        self._ax_verify_bound_composer()
        self._guard(reader_url)
        self.target = {"AccountAlias": self.binding["accountAlias"],
                       "OwnerChannel": self.binding["ownerChannel"],
                       "ConversationId": self.binding["targetConversationId"],
                       "BrowserProfile": self.binding["browserProfile"],
                       "BindingFingerprint": self.binding["bindingFingerprint"],
                       "WorkerId": self.binding["workerId"], "EventId": self.event,
                       "Challenge": self.challenge, "ComposerName": self.options["composerName"],
                       "PageUrl": self.page_url, "RawTargetId": self.context["rawTargetId"],
                       "BrowserProcessId": self.context["pid"]}
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

    def _ready(self, snapshot, message, require_visible_assistant_ack=True):
        # Browser innerText may introduce layout whitespace. Preserve exact
        # marker counts and require one contiguous message after whitespace
        # canonicalization; never accept missing, duplicated or altered words.
        normalized_snapshot = ' '.join(snapshot.split())
        normalized_message = ' '.join(message.split())
        # Exact assistant identity is enforced by the downstream proof source.
        # Local-cache mode verifies the assistant ACK from the exact IndexedDB
        # user/assistant pair with stable UUIDs and timestamp, so visible ACK
        # duplication is not a prerequisite. Non-cache modes retain >=2.
        ack_count = snapshot.count("[AI_CORE_ATTEST_ACK:" + self.challenge + "]")
        return (not STOP.search(snapshot) and
                normalized_snapshot.count(normalized_message) == 1 and
                snapshot.count("[AI_CORE_WAKE:" + self.event + "]") == 1 and
                snapshot.count("[AI_CORE_ATTEST:" + self.challenge + "]") == 1 and
                (ack_count >= 2 if require_visible_assistant_ack else True))

    def _log_readiness_observation(self, snapshot, message):
        """Log bounded boolean-only evidence; never persist chat text or token values."""
        flags = (
            bool(STOP.search(snapshot)),
            snapshot.count(message) == 1,
            snapshot.count("[AI_CORE_WAKE:" + self.event + "]") == 1,
            snapshot.count("[AI_CORE_ATTEST:" + self.challenge + "]") == 1,
            snapshot.count("[AI_CORE_ATTEST_ACK:" + self.challenge + "]") >= 2,
        )
        result = ("READINESS_DIAG time=%s phase=%s responding=%s user_exact=%s "
                  "wake_exact=%s attest_exact=%s assistant_ack_visible=%s "
                  "user_occurrences=%d snapshot_chars=%d message_chars=%d "
                  "message_lines=%d snapshot_lines=%d "
                  "collapsed_whitespace_occurrences=%d\n" %
                  (time.time(), self.phase, *flags, snapshot.count(message),
                   len(snapshot), len(message), message.count("\n"), snapshot.count("\n"),
                   ' '.join(snapshot.split()).count(' '.join(message.split()))))
        try:
            with open(Path(__file__).with_name("dev-identity-diagnostic.log"), "a", encoding="utf-8") as log:
                log.write(result)
        except OSError:
            pass  # Diagnostics must not change execution or evidence policy.

    def _capture_response(self, request_url, message_hash):
        # An existing marker blocks a second reader even if the prior open or
        # native navigation timed out before returning its outcome.
        if self.reader_marker.exists():
            raise RuntimeError("Owned reader was already attempted; reconcile it before another capture")
        self.phase = "reader_preopen"
        self._guard()
        self._reserve(READER_AFTER_GUARD_SECONDS)
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
        opened = self._cdp_create_blank_target(self.context["cdpPort"])
        raw_id = opened.get("targetId")
        if (not isinstance(raw_id, str) or not RAW_TARGET.fullmatch(raw_id) or
                raw_id.lower() in [value.lower() for value in record["preopenTargetIds"]] or opened.get("url") != "about:blank"):
            raise RuntimeError("Reader open outcome is unproven; preserve all tabs and do not retry")
        record = self._reader_update(record, status="BLANK_CREATED", readerRawTargetId=raw_id)
        self.reader_id = raw_id
        self.authorize()
        self._cdp_activate_target(self.context["cdpPort"], self.reader_id)
        self._guard("about:blank")
        fresh = self._cdp_tab_inventory(self.context["cdpPort"])
        if (sum(tab.get("targetId") == self.reader_id and tab.get("url") == "about:blank"
                for tab in fresh) != 1 or
                sum(tab.get("targetId") == self.context["rawTargetId"] and tab.get("url") == self.page_url
                    for tab in fresh) != 1):
            raise RuntimeError("CDP reader identity is unproven")
        record = self._reader_update(record, status="BLANK_VERIFIED",
                                     blankVerifiedAt=self.last_tabs_observed_at,
                                     blankNativeVerifiedAt=time.time())
        reader = {"RawTargetId": self.reader_id}
        return self._listen_reader(request_url, message_hash, reader)

    def _listen_reader(self, request_url, message_hash, reader):
        # Explicit DEV-only opt-in; default preserves the previous OpenClaw path.
        # This never enables itself or changes any non-GPT02 worker.
        if os.environ.get("AI_CORE_GPT02_CDP_READY_CAPTURE_DEV") == "1":
            from gpt02_reader_integrator_stage import listen_reader_cdp_stage
            return listen_reader_cdp_stage(self, request_url, message_hash, reader)
        self.phase = "reader_listener"
        argv = self._argv("responsebody", "/backend-api/conversations/" + self.binding["targetConversationId"], "--target-id", self.reader_id,
                          "--max-chars", "4000000", "--timeout-ms", "180000")
        argv[argv.index("--timeout") + 1] = "210000"
        listener = _Capture(argv)
        try:
            # The pinned CLI supplies no readiness acknowledgment. This bounded
            # lead accommodates measured 22-24s command startup, but cannot
            # prove registration. Keep the original 30s blank proof freshness;
            # never re-date old inventory after waiting. A lost race fails once.
            self._reserve(LISTENER_STARTUP_SECONDS + NATIVE_SECONDS + LISTENER_CAPTURE_SECONDS + FINAL_PROOF_SECONDS)
            self._sleep(LISTENER_STARTUP_SECONDS)
            # Do not enqueue another same-profile OpenClaw command behind the
            # waiting listener. The native adapter rechecks HWND/PID/address
            # independently; local revocation is still checked immediately.
            self.authorize()
            self._reserve(NATIVE_SECONDS + LISTENER_CAPTURE_SECONDS + FINAL_PROOF_SECONDS)
            self.authorize()
            script = Path(__file__).with_name("dev-chatgpt-cdp-reader-navigate.js")
            if not script.is_file():
                raise RuntimeError("CDP reader navigator missing")
            record = self._reader_record()
            if record["status"] != "BLANK_VERIFIED":
                raise RuntimeError("CDP reader is not blank verified")
            self._reader_update(record, status="NAVIGATION_ATTEMPTING", navigationAttemptedAt=time.time())
            args = [str(self.cdp_node), str(script), str(self.context["pid"]),
                    str(self.context["cdpPort"]), self.context["rawTargetId"], self.reader_id,
                    self.page_url, self.expected_user_data, self.binding["bindingFingerprint"]]
            try:
                navigation = json.loads(_Capture(args).finish(self._remaining(NATIVE_SECONDS)))
            except (RuntimeError, ValueError, RecursionError):
                raise RuntimeError("CDP reader navigation unknown; do not retry") from None
            if (not isinstance(navigation, dict) or navigation.get("ok") is not True or
                    navigation.get("navigationInvoked") is not True or
                    navigation.get("rawTargetId") != self.reader_id or
                    navigation.get("pageUrl") != self.page_url):
                raise RuntimeError("CDP reader outcome unknown")
            record = self._reader_record()
            self._reader_update(record, status="NAVIGATION_INVOKED", navigationInvokedAt=time.time())            # Leave time for the original snapshot, exact original focus and
            # final identity check. Closing a loaded reader is never attempted.
            capture_budget = self.deadline - time.monotonic() - FINAL_PROOF_SECONDS
            if capture_budget <= 0:
                raise RuntimeError("Owned reader capture exhausted its observation budget")
            raw = listener.finish(self._remaining(min(LISTENER_CAPTURE_SECONDS, capture_budget)))
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
        local_cache_mode = (
            os.environ.get("AI_CORE_GPT02_LOCAL_CACHE_READBACK_DEV") == "1" and
            self.binding.get("workerId") == "openclaw-dell-chatgpt-wake-dev" and
            self.binding.get("browserProfile") == "gpt02-dell-dev" and
            self.binding.get("accountAlias") == "GPT02"
        )
        passive_rate_mode = (
            not local_cache_mode and
            os.environ.get("AI_CORE_GPT02_PASSIVE_SUBMIT_CAPTURE_DEV") == "1" and
            self.binding.get("workerId") == "openclaw-dell-chatgpt-wake-dev" and
            self.binding.get("browserProfile") == "gpt02-dell-dev" and
            self.binding.get("accountAlias") == "GPT02"
        )
        if local_cache_mode:
            adapter = Path(__file__).with_name("gpt02-local-cache-readback.js")
            if (not adapter.is_file() or
                    hashlib.sha256(adapter.read_bytes()).hexdigest() !=
                    "d7258da2acc5c7650056da1049463667cabd91f86b5a2d907ec1d112de57aeec"):
                raise RuntimeError("GPT02_LOCAL_CACHE_ARCHITECTURE_UNVERIFIED")
        elif passive_rate_mode:
            expected_passive_hashes = {
                "gpt02-cdp-submit-passive-stage.js": "8c559ece7f024d4bfab226ea34703d5eee89714c77cf24c3efd1bd36700f6797",
                "gpt02_submit_stream_reader.py": "aa5d36512eabb5f5d2e4469cd33ca8681e3b6577e65a78374c1938c4d0726da2",
                "gpt02-passive-submit-rate-gate.cjs": "aa252197049767e38a8e07462419c9f88de2f4cfdc367d25f979c2c91ca3cfad",
                "gpt02_passive_submit_rate_gate.py": "ead7bdd9a7ae882ae0d39a84c125303890141b63840c1bdd1033cb15df2fe127",
            }
            for name, expected_hash in expected_passive_hashes.items():
                candidate = Path(__file__).with_name(name)
                if (not candidate.is_file() or
                        hashlib.sha256(candidate.read_bytes()).hexdigest() != expected_hash):
                    raise RuntimeError("PASSIVE_CAPTURE_ARCHITECTURE_UNVERIFIED")
            from gpt02_passive_submit_rate_gate import evaluate_files as evaluate_passive_submit_rate
            passive_gate = evaluate_passive_submit_rate(
                Path(os.environ["LOCALAPPDATA"]) / "AI-Core", time.time())
            if passive_gate.get("allowed") is not True:
                raise RuntimeError("PASSIVE_SUBMIT_" + str(passive_gate.get("reason") or "RATE_GATE_BLOCKED"))
        else:
            # Fail closed for recent HTTP 429 evidence, including earlier records.
            rate_log = Path(os.environ["LOCALAPPDATA"]) / "AI-Core" / "native-response-metadata.jsonl"
            # Missing audit history must never be interpreted as recovered provider limits.
            if not rate_log.is_file():
                raise RuntimeError("NATIVE_CAPTURE_RATE_LOG_MISSING")
            if rate_log.exists():
                try:
                    records = parse_native_rate_log(rate_log.read_text(encoding="utf-8"))
                    if not records:
                        raise ValueError("empty rate log")
                    # Only immutable, aged historical rows may be excluded from
                    # rate calculations. New 429s and malformed logs still block.
                    legacy = evaluate_legacy429_quarantine(rate_log.parent, time.time())
                    if legacy.get("valid") and legacy.get("reason") == "LEGACY_QUARANTINE_AGED_CONDITIONALLY":
                        excluded = set(legacy["excluded_rows"])
                        records = [row for i, row in enumerate(records, 1) if i not in excluded]
                    if has_unverifiable_429(records):
                        raise RuntimeError("NATIVE_CAPTURE_RATE_LOG_UNVERIFIED")
                    if has_repeated_recent_429(records):
                        raise RuntimeError("NATIVE_CAPTURE_429_REPEAT_REMEDIATION_REQUIRED")
                    # Repeated capture rate limits require architecture remediation,
                    # not another dispatch after an arbitrary cooldown.
                    if len(records) >= 3 and all(row.get("responseStatus") == 429 and isinstance(row.get("capturedAtUtc"), str) and 0 <= time.time() - datetime.datetime.fromisoformat(row["capturedAtUtc"].replace("Z", "+00:00")).timestamp() < 86400 for row in records[-3:]):
                        raise RuntimeError("NATIVE_CAPTURE_429_CIRCUIT_OPEN_REMEDIATION_REQUIRED")
                    latest_429 = next((row for row in reversed(records) if row.get("responseStatus") == 429), None)
                    if latest_429 is not None:
                        stamp = latest_429.get("capturedAtUtc")
                        if stamp:
                            age = time.time() - datetime.datetime.fromisoformat(stamp.replace("Z", "+00:00")).timestamp()
                        elif records[-1] is latest_429:
                            age = time.time() - rate_log.stat().st_mtime
                        else:
                            raise ValueError("historical 429 timestamp missing")
                        retry_after = latest_429.get("retryAfterSeconds")
                        if isinstance(retry_after, bool) or not isinstance(retry_after, (int, float)) or not math.isfinite(retry_after) or retry_after < 0:
                            cooldown_seconds = 3600
                        else:
                            # Honor the provider's explicit Retry-After for a single
                            # rate-limit response. Repeated recent 429s remain blocked
                            # above by the remediation/circuit-breaker guards.
                            cooldown_seconds = min(3600, max(1, float(retry_after) + 5))
                        if age < cooldown_seconds:
                            raise RuntimeError("NATIVE_CAPTURE_429_GLOBAL_COOLDOWN_ACTIVE")
                except (IndexError, ValueError, OSError, AttributeError, TypeError) as error:
                    raise RuntimeError("NATIVE_CAPTURE_RATE_LOG_UNVERIFIED") from error
        self._runtime()
        message_hash = hashlib.sha256(message.encode("utf-8")).hexdigest()
        with self._exclusive():
            if self.reader_marker.exists():
                raise RuntimeError("Owned reader was already attempted; reconciliation is required")
            self.phase = "preflight"
            self._audit_stage("PREFLIGHT")
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
            passive_enabled = passive_rate_mode
            passive_envelope = None
            if passive_enabled and existing:
                raise RuntimeError("PASSIVE_CAPTURE_REQUIRES_FRESH_SEND")
            if not existing:
                self._reserve(native_submit_seconds(message) + READINESS_SECONDS + POST_READINESS_SECONDS)
                if any(tab.get("type") == "page" and tab.get("url") == "about:blank" for tab in self.last_tabs):
                    raise RuntimeError("A preexisting blank tab prevents unique native reader ownership")
                passive_listener = None
                try:
                    if passive_enabled:
                        passive_script = Path(__file__).with_name("gpt02-cdp-submit-passive-stage.js")
                        if not passive_script.is_file():
                            raise RuntimeError("PASSIVE_CAPTURE_SCRIPT_MISSING")
                        passive_argv = [str(self.cdp_node), str(passive_script), "--capture-submit",
                            str(self.context["cdpPort"]), self.context["rawTargetId"], self.page_url,
                            self.binding["targetConversationId"], self.event, self.challenge, "180000"]
                        passive_listener = ReadyCaptureStage(passive_argv, self.context["rawTargetId"])
                        passive_listener.ready(self._remaining(20))
                    self.authorize()
                    self.phase = "native_submit"
                    self._audit_stage("SEND_ATTEMPTED")
                    result = self._cdp_submit(message, self.options["allowProviderLf"])
                    if result.get("sendInvoked") is not True:
                        raise RuntimeError("Native Send outcome is unknown; do not replay")
                    record = self._attempt(message_hash)
                    self._audit_stage("SEND_CONFIRMED")
                    if passive_listener is not None:
                        self.phase = "passive_submit_capture"
                        passive_envelope = passive_listener.finish(self._remaining(180))
                finally:
                    if passive_listener is not None:
                        passive_listener.close()
            self.phase = "assistant_readiness"
            self.phase_deadline = min(self.deadline - POST_READINESS_SECONDS, time.monotonic() + READINESS_SECONDS)
            readiness_samples = 0
            readiness_stop_samples = 0
            try:
                snapshot = self._snapshot()
                readiness_samples += 1
                readiness_stop_samples += bool(STOP.search(snapshot))
                while not self._ready(snapshot, message, not local_cache_mode):
                    # Reserve a small final margin for deterministic, evidence-only
                    # timeout reporting; never start another read at expiry.
                    time_left = self.phase_deadline - time.monotonic()
                    if time_left <= 5:
                        break
                    self._sleep(min(2, time_left - 5))
                    if self.phase_deadline - time.monotonic() <= 5:
                        break
                    snapshot = self._snapshot()
                    readiness_samples += 1
                    readiness_stop_samples += bool(STOP.search(snapshot))
            finally:
                self.phase_deadline = None
            self._log_readiness_observation(snapshot, message)
            try:
                with open(Path(__file__).with_name('dev-identity-diagnostic.log'), 'a', encoding='utf-8') as log:
                    log.write('READINESS_SAMPLES total=%d stop_visible=%d stop_absent=%d\n' %
                              (readiness_samples, readiness_stop_samples, readiness_samples - readiness_stop_samples))
            except OSError:
                pass
            # Local-cache mode is intentionally independent of whether the
            # virtualized ChatGPT transcript is currently mounted in the DOM.
            # The cache branch below still requires exact event/challenge,
            # wake hash, distinct UUID message IDs, one assistant ACK, and
            # a cache timestamp newer than the durable SEND attempt.
            if not self._ready(snapshot, message) and not local_cache_mode:
                raise RuntimeError("Native assistant reply is not visibly ready")
            if local_cache_mode:
                self.phase = "local_cache_readback"
                self.authorize()
                self._guard()
                adapter = Path(__file__).with_name("gpt02-local-cache-readback.js")
                cached = None
                for attempt in range(20):
                    self.authorize()
                    try:
                        raw = _Capture([
                            str(self.cdp_node), str(adapter),
                            str(self.context["cdpPort"]), self.context["rawTargetId"],
                            self.binding["targetConversationId"], self.event, self.challenge
                        ]).finish(self._remaining(10))
                        candidate = json.loads(raw)
                    except (RuntimeError, ValueError, RecursionError):
                        candidate = None
                    if isinstance(candidate, dict) and candidate.get("ok") is True:
                        cached = candidate
                        break
                    if attempt < 19:
                        self._sleep(1)
                if cached is None:
                    raise RuntimeError("GPT02_LOCAL_CACHE_READBACK_FAILED")
                if (cached.get("conversationId") != self.binding["targetConversationId"]
                        or cached.get("eventId") != self.event
                        or cached.get("challenge") != self.challenge
                        or cached.get("source") != "GPT02_LOCAL_INDEXEDDB_CACHE"):
                    raise RuntimeError("GPT02_LOCAL_CACHE_BINDING_INVALID")
                wake_id = cached.get("wakeMessageId")
                assistant_id = cached.get("assistantMessageId")
                wake_text = cached.get("wakeText")
                assistant_text = cached.get("assistantText")
                cached_at = cached.get("cachedAt")
                uuid_pattern = r"[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}"
                if (not isinstance(wake_id, str) or re.fullmatch(uuid_pattern, wake_id, re.I) is None
                        or not isinstance(assistant_id, str) or re.fullmatch(uuid_pattern, assistant_id, re.I) is None
                        or wake_id.lower() == assistant_id.lower()):
                    raise RuntimeError("GPT02_LOCAL_CACHE_MESSAGE_IDS_INVALID")
                if (not isinstance(wake_text, str)
                        or hashlib.sha256(wake_text.encode("utf-8")).hexdigest() != message_hash):
                    raise RuntimeError("GPT02_LOCAL_CACHE_WAKE_HASH_MISMATCH")
                ack = "[AI_CORE_ATTEST_ACK:" + self.challenge + "]"
                if (not isinstance(assistant_text, str) or not assistant_text
                        or len(assistant_text.encode("utf-16-le")) // 2 > 4000
                        or assistant_text.count(ack) != 1
                        or ("[AI_CORE_WAKE:" + self.event + "]") in assistant_text):
                    raise RuntimeError("GPT02_LOCAL_CACHE_ASSISTANT_TEXT_INVALID")
                if (type(cached_at) not in (int, float) or not math.isfinite(cached_at)
                        or cached_at < record["sendAttemptedAt"] * 1000
                        or cached_at > (time.time() + 60) * 1000):
                    raise RuntimeError("GPT02_LOCAL_CACHE_TIMESTAMP_INVALID")
                self.authorize()
                self._audit_stage("RESULT_VERIFIED")
                return {
                    "userFound": True, "assistantFound": True, "ackVisible": True,
                    "responding": False, "assistantMessageId": assistant_id.lower(),
                    "assistantText": assistant_text,
                    "assistantResponseHash": hashlib.sha256(assistant_text.encode("utf-8")).hexdigest(),
                    "userMessageId": wake_id.lower(), "rawTargetId": self.context["rawTargetId"],
                    "sendAttemptedAt": record["sendAttemptedAt"], "alreadyVisible": existing,
                    "source": "GPT02_LOCAL_INDEXEDDB_CACHE", "cacheObservedAtMs": cached_at
                }
            if passive_envelope is not None:
                captured_at = time.time()
                passive_response = passive_envelope.get("response") if isinstance(passive_envelope, dict) else None
                diagnostic = {
                    "capturedAtUtc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                    "eventPrefix": self.event[:16],
                    "captureMode": "PASSIVE_SUBMIT_STREAM",
                    "envelopeOk": passive_envelope.get("ok") if isinstance(passive_envelope, dict) else None,
                    "responsePresent": isinstance(passive_response, dict),
                    "responseStatus": passive_response.get("status") if isinstance(passive_response, dict) else None,
                    "responseTruncated": passive_response.get("truncated") if isinstance(passive_response, dict) else None,
                    "responseUrlMatches": (
                        isinstance(passive_response, dict) and isinstance(passive_envelope.get("request"), dict) and
                        passive_response.get("url") == passive_envelope["request"].get("url")),
                    "responseBodyLength": (
                        len(passive_response.get("body")) if isinstance(passive_response, dict) and
                        isinstance(passive_response.get("body"), str) else None)
                }
                if isinstance(passive_response, dict) and passive_response.get("status") == 429:
                    from gpt02_retry_after_metadata import safe_retry_after
                    diagnostic.update(safe_retry_after(passive_response))
                with (Path(os.environ["LOCALAPPDATA"]) / "AI-Core" / "native-response-metadata.jsonl").open("a", encoding="utf-8") as diagnostic_file:
                    diagnostic_file.write(json.dumps(diagnostic, separators=(",", ":")) + "\n")
                if isinstance(passive_response, dict) and passive_response.get("status") == 429:
                    raise RuntimeError("PASSIVE_SUBMIT_RATE_LIMITED_RECONCILIATION_REQUIRED")
                if not isinstance(passive_response, dict) or passive_response.get("status") != 200:
                    raise RuntimeError("PASSIVE_SUBMIT_RESPONSE_INVALID")
                observed = validate_submit_stream(
                    passive_envelope, page_url=self.page_url,
                    raw_target_id=self.context["rawTargetId"],
                    conversation_id=self.binding["targetConversationId"],
                    event_id=self.event, challenge=self.challenge,
                    visible_snapshot=snapshot, expected_user_text=message,
                    not_before=record["sendAttemptedAt"], captured_at=captured_at)
                self.authorize()
                self._audit_stage("RESULT_VERIFIED")
                return {**observed, "alreadyVisible": False,
                        "rawTargetId": self.context["rawTargetId"],
                        "captureRawTargetId": self.context["rawTargetId"],
                        "readerDisposition": "PASSIVE_ORIGINAL_TARGET_NO_READER",
                        "sendAttemptedAt": record["sendAttemptedAt"]}
            if "refreshAttemptedAt" in record:
                raise RuntimeError("Native response capture was already attempted; do not refresh again")
            self.phase = "observed_requests"
            request_url = None
            try:
                requests = self._cli("requests", "--target-id", self.context["rawTargetId"],
                                     "--filter", self.binding["targetConversationId"])
            except RuntimeError:
                # browser requests is only a best-effort history hint. Some
                # Chrome/Playwright combinations can establish browser-level CDP
                # but fail connectOverCDP while the exact bound tab remains healthy.
                # Never trust a failed history lookup by itself: require a fresh
                # direct-CDP inventory proving the original raw target and URL
                # before falling through to the authoritative owned reader.
                self.authorize()
                fresh = self._cdp_tab_inventory(self.context["cdpPort"])
                exact = [tab for tab in fresh
                         if tab.get("targetId") == self.context["rawTargetId"]
                         and tab.get("url") == self.page_url]
                if len(exact) != 1:
                    raise RuntimeError("Native request history unavailable and original CDP identity is unproven") from None
            else:
                try:
                    request_url = select_observed_request(requests, page_url=self.page_url,
                                                         raw_target_id=self.context["rawTargetId"],
                                                         conversation_id=self.binding["targetConversationId"])
                except ValueError as error:
                    if str(error) != "NATIVE_OBSERVED_REQUEST_MISSING_OR_AMBIGUOUS":
                        raise
                    # The original ChatGPT tab can legitimately have no retained
                    # conversation GET after a long-lived session. Do not invent or
                    # replay a URL. The owned reader listener will observe the exact
                    # navigation response and its strict validator remains authoritative.
                    request_url = None
            envelope = self._capture_response(request_url, message_hash)
            captured_request_url = (envelope.get("response", {}).get("url")
                                    if isinstance(envelope, dict) and isinstance(envelope.get("response"), dict)
                                    else None)
            captured_at = time.time()
            # Diagnostic metadata only: never persist response bodies or credentials.
            response_meta = envelope.get("response") if isinstance(envelope, dict) else None
            diagnostic = {"capturedAtUtc": datetime.datetime.now(datetime.timezone.utc).isoformat(), "eventPrefix": self.event[:16], "envelopeOk": envelope.get("ok") if isinstance(envelope, dict) else None,
                          "responsePresent": isinstance(response_meta, dict),
                          "responseStatus": response_meta.get("status") if isinstance(response_meta, dict) else None,
                          "responseTruncated": response_meta.get("truncated") if isinstance(response_meta, dict) else None,
                          "responseUrlMatches": captured_request_url == request_url if request_url is not None else None,
                          "responseBodyLength": len(response_meta.get("body")) if isinstance(response_meta, dict) and isinstance(response_meta.get("body"), str) else None}
            if isinstance(response_meta, dict) and response_meta.get("status") == 429:
                from gpt02_retry_after_metadata import safe_retry_after
                diagnostic.update(safe_retry_after(response_meta))
            with (Path(os.environ["LOCALAPPDATA"]) / "AI-Core" / "native-response-metadata.jsonl").open("a", encoding="utf-8") as diagnostic_file:
                    diagnostic_file.write(json.dumps(diagnostic, separators=(",", ":")) + "\n")
            if isinstance(response_meta, dict) and response_meta.get("status") == 429:
                raise RuntimeError("NATIVE_CAPTURE_RATE_LIMITED_RECONCILIATION_REQUIRED")
            self.phase = "final_proof"
            self._reserve(FINAL_PROOF_SECONDS)
            snapshot = self._snapshot()
            observed = validate_native_response(envelope, page_url=self.page_url, request_url=captured_request_url,
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
            self._audit_stage("RESULT_VERIFIED")
            return {**observed, "alreadyVisible": existing, "rawTargetId": self.context["rawTargetId"],
                    "captureRawTargetId": self.reader_id, "readerDisposition": "PRESERVED_RECONCILIATION_REQUIRED",
                    "sendAttemptedAt": record["sendAttemptedAt"]}

