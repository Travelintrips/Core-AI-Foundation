"""Behavioral transport tests with synthetic subprocess/UI evidence only."""
from contextlib import contextmanager
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

from dev_chatgpt_native_transport import (NativeTransport, native_options, native_submit_seconds,
                                         openclaw_runtime_paths,
                                         TRANSPORT_SECONDS, LISTENER_STARTUP_SECONDS,
                                         READER_AFTER_GUARD_SECONDS, POST_READINESS_SECONDS,
                                         READINESS_SECONDS, CLI_SECONDS, NATIVE_SECONDS)


CHAT = "22222222-2222-4222-8222-222222222222"
RAW = "A" * 32
READER = "B" * 32
EVENT = "b" * 64
CHALLENGE = "c" * 64
BINDING = {"version": 1, "accountAlias": "GPT02", "ownerChannel": "ai-engine-oauth:" + "d" * 64,
           "targetConversationId": CHAT, "workerId": "openclaw-dell-chatgpt-wake-dev", "browserProfile": "travelincars-dev",
           "bindingFingerprint": "4da956549aa62bb6e42bdc4ab13390d2b137d29940e2bb6a89134dfc2f0dbec1"}
OPTIONS = {"version": 1, "enabled": True, "composerName": "Ask ChatGPT", "allowProviderLf": False}
MESSAGE = "[AI_CORE_WAKE:" + EVENT + "] [AI_CORE_ATTEST:" + CHALLENGE + "] Reply once with [AI_CORE_ATTEST_ACK:" + CHALLENGE + "]."
FINAL = "  Synthetic final [AI_CORE_ATTEST_ACK:" + CHALLENGE + "]\n"
URL = "https://chatgpt.com/c/" + CHAT
REQUEST = "https://chatgpt.com/backend-api/conversations/" + CHAT + "?num_turns=10&include_has_versions=true"


class FakeTransport(NativeTransport):
    def __init__(self, root):
        self.allowed = True
        self.calls = []
        self.submissions = 0
        self.captures = 0
        self.opens = 0
        self.navigations = 0
        self.reader_tab = None
        self.open_raw_id = READER
        self.open_url = "about:blank"
        self.open_fails = False
        self.extra_blank = False
        self.extra_blank_after_open = False
        self.duplicate_after_capture = False
        self.reader_url_after_capture = URL
        self.reader_response_id = READER
        self.bad_reader_window = False
        self.capture_fails = False
        self.use_real_listener = False
        self.budget_after_requests = None
        self.visible = False
        self.duplicate = False
        self.hide_bound_once_after_reader = False
        self.hidden_bound_inventory_count = 0
        self.wrong_pid = False
        self.focus_ok = True
        self.drift_after_focus = False
        self.drift_after_snapshot = False
        self.truncate_snapshot = False
        self.omit_composer_without_truncation = False
        self.duplicate_composer = False
        self.mixed_locale_composer = False
        self.bad_response = False
        self.revoke_after_capture = False
        self.send_fails = False
        self.original_time = time.time() - 5
        self.fake_user_data = r"C:\Users\fixture\.openclaw\browser\travelincars-dev\user-data"
        super().__init__(root, BINDING, EVENT, CHALLENGE, OPTIONS, self._authorize)

    def _authorize(self):
        if not self.allowed:
            raise RuntimeError("Synthetic binding revoked")

    def _runtime(self):
        self.expected_user_data = self.fake_user_data
        self.node = Path("/synthetic/node.exe")
        self.entry = Path("/synthetic/openclaw.mjs")

    @contextmanager
    def _exclusive(self):
        self.directory.mkdir(parents=True, exist_ok=True)
        yield

    def _cli(self, action, *args, json_output=True):
        self.calls.append((action, args))
        if action == "status":
            return {"profile": BINDING["browserProfile"], "running": True,
                    "pid": 7654 if self.wrong_pid else 1234, "userDataDir": self.fake_user_data}
        if action == "tabs":
            tab = {"type": "page", "url": URL, "targetId": RAW, "tabId": "t1"}
            hide_bound = (self.hide_bound_once_after_reader and self.reader_tab is not None
                          and self.hidden_bound_inventory_count == 0)
            tabs = [] if hide_bound else [tab]
            if hide_bound:
                self.hidden_bound_inventory_count += 1
            if self.duplicate:
                tabs.append({**tab, "targetId": "D" * 32})
            if self.reader_tab is not None:
                tabs.append(dict(self.reader_tab))
            if self.extra_blank:
                tabs.append({"type": "page", "url": "about:blank", "targetId": "E" * 32})
            return {"tabs": tabs}
        if action == "open":
            if args != ("about:blank", "--label", "aicore-reader-" + EVENT[:16]):
                raise AssertionError("Only the owned blank reader may be opened")
            durable = json.loads(self.reader_marker.read_text(encoding="utf-8"))
            if durable["status"] != "OPEN_ATTEMPTING" or durable["preopenTargetIds"] != [RAW]:
                raise AssertionError("Open was not durably fenced by the original inventory")
            self.opens += 1
            self.reader_tab = {"type": "page", "url": self.open_url, "targetId": self.open_raw_id}
            if self.extra_blank_after_open:
                self.extra_blank = True
            if self.open_fails:
                raise RuntimeError("Synthetic uncertain open")
            return dict(self.reader_tab)
        if action == "focus":
            if args not in ((RAW,), (READER,)):
                raise AssertionError("Focus must use an exact owned raw target")
            if self.drift_after_focus:
                self.wrong_pid = True
            return {"ok": self.focus_ok}
        if action == "snapshot":
            if self.omit_composer_without_truncation:
                text = "- paragraph: synthetic conversation"
            elif self.truncate_snapshot:
                text = "- paragraph: synthetic long conversation\n[...TRUNCATED - page too large]"
            else:
                text = '- textbox "Ask ChatGPT" [active] [ref=f239e430]:\n  - paragraph: Ask ChatGPT'
                if self.duplicate_composer:
                    text += '\n- textbox "Ask ChatGPT" [ref=f239e431]:\n  - paragraph: Ask ChatGPT'
                if self.mixed_locale_composer:
                    text += '\n- textbox "Tanya ChatGPT" [ref=f239e432]:\n  - paragraph: Tanya ChatGPT'
            if self.visible:
                text += "\n- paragraph: " + MESSAGE + "\n- paragraph: " + FINAL
            if self.drift_after_snapshot:
                self.wrong_pid = True
            return text
        if action == "requests":
            if self.budget_after_requests is not None:
                self.deadline = time.monotonic() + self.budget_after_requests
            return {"ok": True, "targetId": RAW, "url": URL, "requests": [
                {"method": "GET", "url": REQUEST, "timestamp": self.original_time, "status": 200, "ok": True}]}
        raise AssertionError("Unapproved synthetic CLI action: " + action)

    def _write_attempt(self, status="SEND_INVOKED"):
        record = {"version": 1, "status": status, "eventId": EVENT, "challenge": CHALLENGE,
                  "bindingFingerprint": BINDING["bindingFingerprint"], "browserProfile": BINDING["browserProfile"],
                  "conversationId": CHAT, "pageUrl": URL, "rawTargetId": RAW, "accountAlias": "GPT02",
                  "ownerChannel": BINDING["ownerChannel"], "workerId": BINDING["workerId"],
                  "messageHash": hashlib.sha256(MESSAGE.encode()).hexdigest(), "allowProviderLf": False,
                  "inputStartedAt": self.original_time - 0.01, "sendAttemptedAt": self.original_time}
        self.directory.mkdir(parents=True, exist_ok=True)
        self.marker.write_text(json.dumps(record), encoding="utf-8")
        return record

    def _bridge(self, action, **data):
        self.calls.append(("native:" + action, data))
        if action == "resolve":
            return {"windowHandle": 999, "browserProcessId": 1234, "rawTargetId": RAW, "pageUrl": URL}
        if action == "reader-resolve":
            return {"windowHandle": 999, "browserProcessId": 4321 if self.bad_reader_window else 1234,
                    "rawTargetId": READER, "address": "about:blank"}
        if action == "reader-navigate":
            record = self._reader_record()
            if record["status"] != "BLANK_VERIFIED" or data["reader"] != {"RawTargetId": READER, "WindowHandle": 999}:
                raise AssertionError("Native navigation lost durable reader ownership")
            self.navigations += 1
            record = self._reader_update(record, status="NAVIGATION_ATTEMPTING", navigationAttemptedAt=time.time())
            self.reader_tab["url"] = self.reader_url_after_capture
            self._reader_update(record, status="NAVIGATION_INVOKED")
            return {"navigationInvoked": True, "rawTargetId": READER, "pageUrl": URL}
        if action == "submit":
            self.submissions += 1
            self.assert_message = data["message"]
            self._write_attempt("SEND_ATTEMPTING" if self.send_fails else "SEND_INVOKED")
            self.visible = True
            if self.send_fails:
                raise RuntimeError("Synthetic uncertain Send")
            return {"sendInvoked": True}
        raise AssertionError("Unexpected native action")

    def _listen_reader(self, request_url, message_hash, reader):
        self.captures += 1
        if request_url != REQUEST or message_hash != hashlib.sha256(MESSAGE.encode()).hexdigest():
            raise AssertionError("Capture context changed")
        if self.use_real_listener:
            return super()._listen_reader(request_url, message_hash, reader)
        self._bridge("reader-navigate", reader=reader, messageHash=message_hash, receiptDirectory=str(self.directory))
        if self.capture_fails:
            raise RuntimeError("Synthetic uncertain capture")
        return self._response_envelope()

    def _response_envelope(self):
        if self.duplicate_after_capture:
            self.duplicate = True
        if self.revoke_after_capture:
            self.allowed = False
        body = {"conversation_id": CHAT, "current_node": "44444444-4444-4444-8444-444444444444", "messages": [
            {"id": "33333333-3333-4333-8333-333333333333", "author": {"role": "user"}, "channel": None,
             "recipient": "all", "status": "finished_successfully", "end_turn": None,
             "create_time": self.original_time + 0.033, "content": {"content_type": "text", "parts": [MESSAGE]}, "metadata": {}},
            {"id": "44444444-4444-4444-8444-444444444444", "author": {"role": "assistant"}, "channel": "final",
             "recipient": "all", "status": "finished_successfully", "end_turn": True,
             "create_time": self.original_time + 1, "content": {"content_type": "text", "parts": [FINAL]}, "metadata": {}}
        ]}
        if self.bad_response:
            body["conversation_id"] = "55555555-5555-4555-8555-555555555555"
        return {"ok": True, "targetId": self.reader_response_id, "url": URL, "response": {"url": REQUEST, "status": 200,
                "headers": {"unread-fixture": "must-not-be-output"}, "body": json.dumps(body)}}


class NativeTransportTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.transport = FakeTransport(self.folder.name)

    def test_activation_is_local_explicit_and_disabled_by_default(self):
        entry = {**BINDING, "enabled": True}
        for options in (None, {}, {**OPTIONS, "enabled": False}):
            value = copy.deepcopy(entry)
            if options is not None:
                value["nativeTransport"] = options
            with self.subTest(options=options), self.assertRaisesRegex(RuntimeError, "not activated"):
                native_options({"bindings": [value]}, BINDING)
        entry["nativeTransport"] = dict(OPTIONS)
        self.assertEqual(native_options({"bindings": [entry]}, BINDING), OPTIONS)
        for altered in ({**OPTIONS, "evaluate": True}, {**OPTIONS, "composerName": "Search"},
                        {**OPTIONS, "allowProviderLf": "true"}, {**OPTIONS, "version": True}):
            with self.subTest(options=altered), self.assertRaisesRegex(RuntimeError, "invalid"):
                native_options({"bindings": [{**entry, "nativeTransport": altered}]}, BINDING)

    def test_synthetic_round_trip_is_correlated_once_and_preserves_exact_final_text(self):
        observed = self.transport.run(MESSAGE)
        self.assertEqual(observed["assistantText"], FINAL)
        self.assertEqual(observed["assistantResponseHash"], hashlib.sha256(FINAL.encode()).hexdigest())
        self.assertEqual(observed["sendAttemptedAt"], self.transport.original_time)
        self.assertEqual(self.transport.submissions, 1)
        self.assertEqual(self.transport.captures, 1)
        self.assertFalse(observed["alreadyVisible"])
        self.assertNotIn("headers", observed)
        self.assertNotIn("body", observed)
        self.assertEqual(observed["rawTargetId"], RAW)
        self.assertEqual(observed["captureRawTargetId"], READER)
        self.assertEqual(observed["readerDisposition"], "PRESERVED_RECONCILIATION_REQUIRED")
        self.assertEqual(self.transport.opens, 1)
        self.assertEqual(self.transport.navigations, 1)
        self.assertFalse(any(action in ("evaluate", "type", "navigate", "close", "native:refresh") for action, _ in self.transport.calls))

    def test_original_attempt_is_reconciled_without_reinsertion_or_new_timestamp(self):
        self.transport._write_attempt("SEND_ATTEMPTING")
        self.transport.visible = True
        observed = self.transport.run(MESSAGE)
        self.assertTrue(observed["alreadyVisible"])
        self.assertEqual(observed["sendAttemptedAt"], self.transport.original_time)
        self.assertEqual(self.transport.submissions, 0)

    def test_exact_target_focus_precedes_native_resolution(self):
        self.transport.run(MESSAGE)
        actions = [action for action, _ in self.transport.calls]
        self.assertEqual(actions.count("focus"), 3)
        self.assertLess(actions.index("focus"), actions.index("native:resolve"))
        self.assertEqual(self.transport.calls[actions.index("focus")][1], (RAW,))
        self.assertEqual([args for action, args in self.transport.calls if action == "focus"], [(RAW,), (READER,), (RAW,)])

    def test_failed_focus_or_changed_profile_blocks_native_resolution(self):
        for change in ({"focus_ok": False}, {"drift_after_focus": True}):
            with tempfile.TemporaryDirectory() as root:
                transport = FakeTransport(root)
                for key, value in change.items():
                    setattr(transport, key, value)
                with self.subTest(change=change), self.assertRaises(RuntimeError):
                    transport.run(MESSAGE)
                self.assertFalse(any(action.startswith("native:") for action, _ in transport.calls))
                self.assertEqual(transport.submissions, 0)

    def test_explicit_truncated_snapshot_can_defer_composer_check_to_native_resolver(self):
        self.transport.context = {"rawTargetId": RAW}
        self.transport.truncate_snapshot = True
        snapshot = self.transport._snapshot()
        self.assertTrue(snapshot.rstrip().endswith("[...TRUNCATED - page too large]"))

    def test_missing_composer_without_truncation_remains_fail_closed(self):
        self.transport.context = {"rawTargetId": RAW}
        self.transport.omit_composer_without_truncation = True
        with self.assertRaisesRegex(RuntimeError, "composer role or locale"):
            self.transport._snapshot()

    def test_duplicate_same_locale_composer_rows_are_allowed(self):
        self.transport.context = {"rawTargetId": RAW}
        self.transport.duplicate_composer = True
        snapshot = self.transport._snapshot()
        self.assertEqual(snapshot.count('textbox "Ask ChatGPT"'), 2)

    def test_mixed_locale_composer_rows_remain_fail_closed(self):
        self.transport.context = {"rawTargetId": RAW}
        self.transport.mixed_locale_composer = True
        with self.assertRaisesRegex(RuntimeError, "composer role or locale"):
            self.transport._snapshot()

    def test_visible_marker_without_owned_attempt_never_authorizes_replay(self):
        self.transport.visible = True
        with self.assertRaisesRegex(RuntimeError, "no original input record"):
            self.transport.run(MESSAGE)
        self.assertEqual(self.transport.submissions, 0)
        self.assertFalse(any(action.startswith("native:") for action, _ in self.transport.calls))

    def test_marker_context_timestamp_and_old_refresh_fail_without_send(self):
        original = self.transport._write_attempt()
        for change in ({"challenge": "f" * 64}, {"rawTargetId": "B" * 32}, {"messageHash": "0" * 64},
                       {"sendAttemptedAt": None}, {"sendAttemptedAt": time.time() + 1000},
                       {"sendAttemptedAt": original["inputStartedAt"] - 1}, {"refreshAttemptedAt": time.time() - 1}):
            self.transport.marker.write_text(json.dumps({**original, **change}), encoding="utf-8")
            self.transport.visible = True
            with self.subTest(change=change), self.assertRaises(RuntimeError):
                self.transport.run(MESSAGE)
        self.assertEqual(self.transport.submissions, 0)
        self.assertEqual(self.transport.captures, 0)

    def test_duplicate_destination_and_process_drift_block_native_input(self):
        for field in ("duplicate", "drift_after_snapshot"):
            transport = FakeTransport(self.folder.name)
            setattr(transport, field, True)
            with self.subTest(field=field), self.assertRaises(RuntimeError):
                transport.run(MESSAGE)
            self.assertEqual(transport.submissions, 0)

    def test_transient_bound_tab_omission_after_reader_activation_is_retried(self):
        self.transport.hide_bound_once_after_reader = True
        with patch("dev_chatgpt_native_transport.time.sleep", return_value=None):
            observed = self.transport.run(MESSAGE)
        self.assertEqual(observed["assistantText"], FINAL)
        self.assertEqual(self.transport.hidden_bound_inventory_count, 1)
        self.assertEqual(self.transport.submissions, 1)
        self.assertGreaterEqual(
            sum(1 for action, _ in self.transport.calls if action == "tabs"), 3)

    def test_unknown_native_send_is_not_replayed(self):
        self.transport.send_fails = True
        with self.assertRaisesRegex(RuntimeError, "uncertain Send"):
            self.transport.run(MESSAGE)
        self.assertEqual(self.transport.submissions, 1)
        self.transport.send_fails = False
        result = self.transport.run(MESSAGE)
        self.assertEqual(self.transport.submissions, 1)
        self.assertTrue(result["alreadyVisible"])

    def test_wrong_conversation_response_and_revocation_cannot_return_evidence(self):
        for field in ("bad_response", "revoke_after_capture"):
            with tempfile.TemporaryDirectory() as root:
                transport = FakeTransport(root)
                setattr(transport, field, True)
                with self.subTest(field=field), self.assertRaises((RuntimeError, ValueError)):
                    transport.run(MESSAGE)
                self.assertEqual(transport.submissions, 1)

    def test_unsupported_input_fails_before_context_or_native_access(self):
        for message in ("unsafe\ntext", "é", "\t", "", "x" * 4097):
            with self.subTest(message=message), self.assertRaises(RuntimeError):
                self.transport.run(message)
        self.assertEqual(self.transport.calls, [])

    def test_openclaw_runtime_override_requires_node_and_entry_together(self):
        with patch.dict("os.environ", {
            "AI_CORE_OPENCLAW_NODE": r"C:\Program Files\nodejs\node.exe",
            "AI_CORE_OPENCLAW_ENTRY": r"C:\Users\fixture\AppData\Roaming\npm\node_modules\openclaw\openclaw.mjs",
        }, clear=False):
            node, entry = openclaw_runtime_paths(r"C:\Users\fixture\AppData\Local")
        self.assertEqual(str(node), r"C:\Program Files\nodejs\node.exe")
        self.assertEqual(str(entry), r"C:\Users\fixture\AppData\Roaming\npm\node_modules\openclaw\openclaw.mjs")

        with patch.dict("os.environ", {"AI_CORE_OPENCLAW_NODE": r"C:\node.exe", "AI_CORE_OPENCLAW_ENTRY": ""}, clear=False):
            with self.assertRaisesRegex(RuntimeError, "provide node and entry together"):
                openclaw_runtime_paths(r"C:\Users\fixture\AppData\Local")

    def test_request_url_is_a_direct_node_argument_not_shell_text(self):
        self.transport._runtime()
        argv = self.transport._argv("responsebody", REQUEST, "--target-id", RAW)
        self.assertEqual(argv[0], "/synthetic/node.exe")
        self.assertEqual(argv[1], "/synthetic/openclaw.mjs")
        self.assertEqual(argv.count(REQUEST), 1)
        self.assertNotIn("openclaw.cmd", " ".join(argv))
        self.assertIn("&include_has_versions=true", argv[argv.index("responsebody") + 1])

    def test_success_preserves_reader_and_original_timestamp_with_durable_reconciliation(self):
        self.transport.run(MESSAGE)
        record = json.loads(self.transport.reader_marker.read_text(encoding="utf-8"))
        self.assertEqual(record["status"], "CAPTURE_VERIFIED")
        self.assertEqual(record["disposition"], "PRESERVED_RECONCILIATION_REQUIRED")
        self.assertTrue(record["originalFocusRestored"])
        self.assertEqual(record["originalRawTargetId"], RAW)
        self.assertEqual(record["readerRawTargetId"], READER)
        self.assertEqual(record["preopenTargetIds"], [RAW])
        self.assertEqual(record["sendAttemptedAt"], self.transport.original_time)
        self.assertNotIn(MESSAGE, self.transport.reader_marker.read_text(encoding="utf-8"))
        self.assertNotIn(FINAL, self.transport.reader_marker.read_text(encoding="utf-8"))
        self.assertEqual(self.transport.reader_tab["url"], URL)
        count = len(self.transport.calls)
        with self.assertRaisesRegex(RuntimeError, "reconciliation"):
            self.transport.run(MESSAGE)
        self.assertEqual(len(self.transport.calls), count)

    def test_uncertain_open_is_durable_and_cannot_create_another_reader_on_retry(self):
        self.transport.open_fails = True
        with self.assertRaisesRegex(RuntimeError, "uncertain open"):
            self.transport.run(MESSAGE)
        record = json.loads(self.transport.reader_marker.read_text(encoding="utf-8"))
        self.assertEqual(record["status"], "OPEN_ATTEMPTING")
        self.assertNotIn("readerRawTargetId", record)
        self.assertIsNone(self.transport.reader_id)
        self.transport.open_fails = False
        with self.assertRaisesRegex(RuntimeError, "reconciliation"):
            self.transport.run(MESSAGE)
        self.assertEqual(self.transport.opens, 1)
        self.assertEqual(self.transport.submissions, 1)
        self.assertEqual(self.transport.navigations, 0)

    def test_open_must_return_a_new_raw_id_and_exact_blank_url(self):
        for change in ({"open_raw_id": RAW}, {"open_raw_id": RAW.lower()}, {"open_raw_id": "unknown"},
                       {"open_url": "https://chatgpt.com/"}):
            with tempfile.TemporaryDirectory() as folder:
                transport = FakeTransport(folder)
                for key, value in change.items():
                    setattr(transport, key, value)
                with self.subTest(change=change), self.assertRaisesRegex(RuntimeError, "open outcome"):
                    transport.run(MESSAGE)
                self.assertEqual(transport.opens, 1)
                self.assertEqual(transport.navigations, 0)
                self.assertFalse(any(action.startswith("native:reader") for action, _ in transport.calls))

    def test_preexisting_blank_blocks_send_and_new_blank_ambiguity_blocks_navigation(self):
        self.transport.extra_blank = True
        with self.assertRaisesRegex(RuntimeError, "preexisting blank"):
            self.transport.run(MESSAGE)
        self.assertEqual(self.transport.submissions, 0)
        self.assertEqual(self.transport.opens, 0)
        self.transport.extra_blank = False
        self.transport.extra_blank_after_open = True
        with self.assertRaisesRegex(RuntimeError, "not uniquely identifiable"):
            self.transport.run(MESSAGE)
        self.assertEqual(self.transport.opens, 1)
        self.assertEqual(self.transport.navigations, 0)

    def test_owned_reader_does_not_exclude_an_unowned_duplicate_conversation(self):
        self.transport.duplicate_after_capture = True
        with self.assertRaisesRegex(RuntimeError, "exactly one"):
            self.transport.run(MESSAGE)
        self.assertEqual(self.transport.opens, 1)
        self.assertEqual(self.transport.navigations, 1)
        record = json.loads(self.transport.reader_marker.read_text(encoding="utf-8"))
        self.assertEqual(record["status"], "NAVIGATION_INVOKED")

    def test_reader_authwall_or_changed_conversation_is_preserved_without_proof(self):
        for url in ("https://chatgpt.com/auth/login", "https://chatgpt.com/c/55555555-5555-4555-8555-555555555555"):
            with tempfile.TemporaryDirectory() as folder:
                transport = FakeTransport(folder)
                transport.reader_url_after_capture = url
                with self.subTest(url=url), self.assertRaisesRegex(RuntimeError, "Owned reader changed"):
                    transport.run(MESSAGE)
                self.assertEqual(transport.reader_tab["url"], url)
                self.assertFalse(any(action in ("close", "navigate", "native:refresh") for action, _ in transport.calls))
                self.assertEqual(json.loads(transport.reader_marker.read_text())["status"], "NAVIGATION_INVOKED")

    def test_reader_native_pid_mismatch_blocks_navigation_and_preserves_blank(self):
        self.transport.bad_reader_window = True
        with self.assertRaisesRegex(RuntimeError, "native window is unproven"):
            self.transport.run(MESSAGE)
        self.assertEqual(self.transport.reader_tab["url"], "about:blank")
        self.assertEqual(self.transport.navigations, 0)
        self.assertEqual(json.loads(self.transport.reader_marker.read_text())["status"], "BLANK_CREATED")

    def test_response_must_identify_the_reader_raw_target_not_the_original(self):
        self.transport.reader_response_id = RAW
        with self.assertRaises(ValueError):
            self.transport.run(MESSAGE)
        self.assertEqual(json.loads(self.transport.reader_marker.read_text())["status"], "NAVIGATION_INVOKED")

    def test_capture_failure_cannot_repeat_input_open_or_navigation(self):
        self.transport.capture_fails = True
        with self.assertRaisesRegex(RuntimeError, "uncertain capture"):
            self.transport.run(MESSAGE)
        self.transport.capture_fails = False
        with self.assertRaisesRegex(RuntimeError, "reconciliation"):
            self.transport.run(MESSAGE)
        self.assertEqual((self.transport.submissions, self.transport.opens, self.transport.navigations), (1, 1, 1))
        self.assertFalse(any(action in ("close", "native:refresh") for action, _ in self.transport.calls))

    def test_insufficient_budget_stops_before_send_or_reader_open(self):
        self.transport.deadline = time.monotonic() + 100
        with self.assertRaisesRegex(RuntimeError, "Insufficient"):
            self.transport.run(MESSAGE)
        self.assertEqual((self.transport.submissions, self.transport.opens), (0, 0))
        self.transport.deadline = time.monotonic() + TRANSPORT_SECONDS
        self.transport.budget_after_requests = READER_AFTER_GUARD_SECONDS - 5
        with self.assertRaisesRegex(RuntimeError, "Insufficient"):
            self.transport.run(MESSAGE)
        self.assertEqual((self.transport.submissions, self.transport.opens), (1, 0))
        self.assertFalse(self.transport.reader_marker.exists())

    def test_future_listener_uses_reader_and_exact_observed_url_without_queued_cli_actions(self):
        transport = self.transport
        transport.use_real_listener = True
        class Listener:
            def __init__(self, argv):
                transport.calls.append(("listener:start", argv))
                self.argv = argv
            def finish(self, timeout):
                transport.calls.append(("listener:finish", timeout))
                return json.dumps(transport._response_envelope())
            def close(self):
                transport.calls.append(("listener:close", ()))
        with patch("dev_chatgpt_native_transport._Capture", Listener), \
                patch("dev_chatgpt_native_transport.time.sleep", side_effect=lambda seconds: transport.calls.append(("listener:lead", seconds))):
            observed = transport.run(MESSAGE)
        self.assertEqual(observed["captureRawTargetId"], READER)
        actions = [action for action, _ in transport.calls]
        start, finish = actions.index("listener:start"), actions.index("listener:finish")
        self.assertEqual(actions[start + 1:finish], ["listener:lead", "native:reader-navigate"])
        argv = transport.calls[start][1]
        self.assertEqual(argv[argv.index("--target-id") + 1], READER)
        self.assertEqual(argv[argv.index("responsebody") + 1], REQUEST)
        self.assertEqual(transport.calls[start + 1][1], LISTENER_STARTUP_SECONDS)
        self.assertLess(LISTENER_STARTUP_SECONDS, 30)
        self.assertEqual(argv[argv.index("--timeout-ms") + 1], "180000")
        self.assertEqual(argv[argv.index("--timeout") + 1], "210000")

    def test_same_profile_identity_reads_are_serial_and_do_not_overlap(self):
        import threading
        transport = self.transport
        original = transport._cli
        active = 0
        order = []
        lock = threading.Lock()
        def checked(action, *args, **kwargs):
            nonlocal active
            with lock:
                self.assertEqual(active, 0, "same-profile subprocesses overlapped")
                active += 1
                order.append(action + ":start")
            time.sleep(0.01)
            result = original(action, *args, **kwargs)
            with lock:
                order.append(action + ":end")
                active -= 1
            return result
        transport._runtime()
        with patch.object(transport, "_cli", side_effect=checked):
            context = transport._session()
        self.assertEqual(context["rawTargetId"], RAW)
        self.assertEqual(order, ["status:start", "status:end", "tabs:start", "tabs:end"])

    def test_full_plan_reserve_uses_total_budget_but_calls_use_live_lease(self):
        class Guard:
            def total_remaining(self): return 1800
            def remaining(self, cap): return min(cap, 80)
        self.transport.lease_guard = Guard()
        self.transport._reserve(1000)
        self.assertEqual(self.transport._remaining(120), 80)
        self.transport.phase_deadline = time.monotonic() + 4
        self.assertLessEqual(self.transport._remaining(120), 4)
        self.transport.phase_deadline = time.monotonic() - 1
        with self.assertRaisesRegex(RuntimeError, "deadline"):
            self.transport._remaining(120)

    def test_worst_admitted_input_and_all_phase_caps_fit_fixed_transport(self):
        self.assertEqual(native_submit_seconds("x" * 476), 60)
        self.assertEqual(native_submit_seconds("x" * 4096), 240)
        maximum = (6 * CLI_SECONDS + NATIVE_SECONDS + native_submit_seconds("x" * 4096)
                   + READINESS_SECONDS + POST_READINESS_SECONDS)
        self.assertLessEqual(maximum, TRANSPORT_SECONDS)
        self.assertLess(TRANSPORT_SECONDS, 1980)

    def test_revocation_during_listener_lead_prevents_navigation_and_keeps_marker(self):
        transport = self.transport
        transport.use_real_listener = True
        class Listener:
            def __init__(self, argv): pass
            def close(self): pass
            def finish(self, timeout): raise AssertionError("revoked listener must not finish proof")
        def revoke(_seconds): transport.allowed = False
        with patch("dev_chatgpt_native_transport._Capture", Listener), \
                patch("dev_chatgpt_native_transport.time.sleep", side_effect=revoke):
            with self.assertRaisesRegex(RuntimeError, "revoked"):
                transport.run(MESSAGE)
        self.assertEqual((transport.submissions, transport.opens, transport.navigations), (1, 1, 0))
        self.assertEqual(json.loads(transport.reader_marker.read_text())["status"], "BLANK_VERIFIED")

    def test_slow_native_resolution_cannot_redate_the_sole_blank_inventory(self):
        transport = self.transport
        original = transport._bridge
        observation = []
        def slow_resolve(action, **data):
            result = original(action, **data)
            if action == "reader-resolve":
                transport.last_tabs_observed_at -= 31
                observation.append(transport.last_tabs_observed_at)
            return result
        with patch.object(transport, "_bridge", side_effect=slow_resolve), \
                patch.object(transport, "_listen_reader", side_effect=RuntimeError("stop before listener")):
            with self.assertRaisesRegex(RuntimeError, "stop before listener"):
                transport.run(MESSAGE)
        record = json.loads(transport.reader_marker.read_text())
        self.assertEqual(record["blankVerifiedAt"], observation[0])
        self.assertGreaterEqual(record["blankNativeVerifiedAt"] - record["blankVerifiedAt"], 30)
        self.assertEqual(transport.navigations, 0)


if __name__ == "__main__":
    unittest.main()
