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

from dev_chatgpt_native_transport import NativeTransport, native_options


CHAT = "22222222-2222-4222-8222-222222222222"
RAW = "A" * 32
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
        self.visible = False
        self.duplicate = False
        self.wrong_pid = False
        self.drift_after_snapshot = False
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
            return {"tabs": [tab, dict(tab)] if self.duplicate else [tab]}
        if action == "snapshot":
            text = '- textbox "Ask ChatGPT" [active] [ref=f239e430]:\n  - paragraph: Ask ChatGPT'
            if self.visible:
                text += "\n- paragraph: " + MESSAGE + "\n- paragraph: " + FINAL
            if self.drift_after_snapshot:
                self.wrong_pid = True
            return text
        if action == "requests":
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
        if action == "submit":
            self.submissions += 1
            self.assert_message = data["message"]
            self._write_attempt("SEND_ATTEMPTING" if self.send_fails else "SEND_INVOKED")
            self.visible = True
            if self.send_fails:
                raise RuntimeError("Synthetic uncertain Send")
            return {"sendInvoked": True}
        raise AssertionError("Unexpected native action")

    def _capture_response(self, request_url, message_hash):
        self.captures += 1
        if request_url != REQUEST or message_hash != hashlib.sha256(MESSAGE.encode()).hexdigest():
            raise AssertionError("Capture context changed")
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
        return {"ok": True, "targetId": RAW, "url": URL, "response": {"url": REQUEST, "status": 200,
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
        self.assertFalse(any(action in ("evaluate", "type", "open", "navigate") for action, _ in self.transport.calls))

    def test_original_attempt_is_reconciled_without_reinsertion_or_new_timestamp(self):
        self.transport._write_attempt("SEND_ATTEMPTING")
        self.transport.visible = True
        observed = self.transport.run(MESSAGE)
        self.assertTrue(observed["alreadyVisible"])
        self.assertEqual(observed["sendAttemptedAt"], self.transport.original_time)
        self.assertEqual(self.transport.submissions, 0)

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

    def test_request_url_is_a_direct_node_argument_not_shell_text(self):
        self.transport._runtime()
        argv = self.transport._argv("responsebody", REQUEST, "--target-id", RAW)
        self.assertEqual(argv[0], "/synthetic/node.exe")
        self.assertEqual(argv[1], "/synthetic/openclaw.mjs")
        self.assertEqual(argv.count(REQUEST), 1)
        self.assertNotIn("openclaw.cmd", " ".join(argv))
        self.assertIn("&include_has_versions=true", argv[argv.index("responsebody") + 1])


if __name__ == "__main__":
    unittest.main()
