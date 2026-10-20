"""Behavioral tests for DEV browser wake. No real browser, account, or private key."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

MODULE_PATH = Path(__file__).with_name("dev-chatgpt-wake-once.py")
WORKER = "openclaw-travelintrips-dev"
DELL = "openclaw-dell-chatgpt-wake-dev"
OWNER = "ai-engine-oauth:" + "a" * 64
OWNER_TWO = "ai-engine-oauth:" + "d" * 64
CHAT = "6ad3a9a6-97e4-83ec-af32-a0a5d580b649"
CHAT_TWO = "22222222-2222-4222-8222-222222222222"
EVENT = "b" * 64
CHALLENGE = "c" * 64
COMMAND = f"DEV_CHATGPT_WAKE_V1 conversation={CHAT} event={EVENT} challenge={CHALLENGE}"
TASK_TEXT = "cek pada dell ada berapa worker"


def load_wake(worker=WORKER, profile="chrome"):
    spec = importlib.util.spec_from_file_location("wake_test_module", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    with patch.dict(os.environ, {
        "AI_CORE_DEV_WAKE_WORKER_ID": worker,
        "AI_CORE_DEV_WAKE_BROWSER_PROFILE": profile,
        "AI_CORE_DEV_WAKE_KEY_ID": worker + "-ed25519-v1",
        "AI_CORE_DEV_WAKE_ALLOWLIST_FILE": "pairing.json",
        "AI_CORE_DEV_WAKE_PRIVATE_KEY_FILE": "test-key-not-present.pem",
        "AI_CORE_OPENCLAW_CMD": "openclaw-test-only",
    }):
        spec.loader.exec_module(module)
    return module


wake = load_wake()


class FakeBrowser:
    """Synthetic accessibility state; this is not a captured OpenClaw snapshot."""
    def __init__(self, conversation=CHAT, composer_name="Ask ChatGPT"):
        self.url = "https://chatgpt.com/c/" + conversation
        self.handle = "t12"
        self.marker = False
        self.draft = ""
        self.composer_name = composer_name
        self.composer_override = None
        self.responding = False
        self.duplicate = False
        self.fail_submit = False
        self.lose_pairing = False
        self.tab_reads = 0
        self.calls = []

    def __call__(self, command, *args, **kwargs):
        self.calls.append((command, args))
        if command == "tabs":
            self.tab_reads += 1
            url = self.url if not self.lose_pairing or self.tab_reads == 1 else "https://chatgpt.com/"
            tab = {"type": "page", "url": url, "targetId": "raw-target", "suggestedTargetId": self.handle}
            return json.dumps({"tabs": [tab, dict(tab)] if self.duplicate else [tab]})
        if command == "snapshot":
            snapshot = (self.composer_override if self.composer_override is not None else
                        '- textbox ' + json.dumps(self.composer_name) + ' [ref=e1] value=' + json.dumps(self.draft))
            if self.responding:
                snapshot += '\n- button "Stop generating" [ref=e2]'
            if self.marker:
                snapshot += "\nAI_CORE_WAKE:" + EVENT
            return snapshot
        if command == "type":
            if self.fail_submit:
                raise RuntimeError("unknown after submit")
            self.marker = True
            self.draft = ""
            return "typed"
        raise AssertionError("Unexpected browser command: " + command)

    @property
    def submissions(self):
        return [args for command, args in self.calls if command == "type"]


class WakeTestCase(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.root = Path(folder.name)
        self.config = {"enabled": True, "allowedConversationIds": [CHAT]}
        self.write_config(self.config)

    def write_config(self, data):
        (self.root / "pairing.json").write_text(json.dumps(data), encoding="utf-8")

    def run_browser(self, browser, instruction=COMMAND, module=wake, metadata=None):
        with patch.object(module, "browser", side_effect=browser), patch.object(module.time, "sleep"):
            return module.submit_once(instruction, module.WORKER, self.root, metadata=metadata)


class BrowserWakeTests(WakeTestCase):
    def test_valid_one_shot_requires_observed_marker(self):
        browser = FakeBrowser()
        proof = self.run_browser(browser)
        self.assertTrue(proof["chatgptSubmitted"])
        self.assertTrue(proof["browserConfirmed"])
        self.assertFalse(proof["verifiedAssistantReply"])
        self.assertEqual(len(browser.submissions), 1)
        receipt = json.loads((self.root / "chatgpt-wake-dev-receipts" / (EVENT + ".json")).read_text())
        self.assertEqual(receipt["status"], "BROWSER_CONFIRMED")

    def test_v2_delivers_operator_job_text(self):
        task = wake.base64.urlsafe_b64encode(TASK_TEXT.encode()).decode().rstrip("=")
        command = COMMAND.replace("_V1 ", "_V2 ") + " task=" + task
        browser = FakeBrowser()
        self.run_browser(browser, command)
        self.assertEqual(len(browser.submissions), 1)
        self.assertIn(TASK_TEXT, browser.submissions[0][-1])

    def test_wrong_target_worker_or_shell_suffix_never_touch_browser(self):
        with patch.object(wake, "browser") as browser:
            for command, worker in [
                (COMMAND, "openclaw-pc-worker"),
                (COMMAND + " && delete files", WORKER),
                (COMMAND.replace(CHAT, CHAT_TWO), WORKER),
            ]:
                with self.subTest(command=command, worker=worker), self.assertRaises(RuntimeError):
                    wake.submit_once(command, worker, self.root)
            browser.assert_not_called()

    def test_disabled_pairing_never_touches_browser(self):
        self.write_config({**self.config, "enabled": False})
        with patch.object(wake, "browser") as browser, self.assertRaises(RuntimeError):
            wake.submit_once(COMMAND, WORKER, self.root)
        browser.assert_not_called()

    def test_active_generation_and_draft_are_preserved(self):
        for name in ("Ask ChatGPT", "Tanya ChatGPT"):
            for attr, value, expected in [("responding", True, "still responding"), ("draft", "my draft", "draft")]:
                browser = FakeBrowser(composer_name=name)
                setattr(browser, attr, value)
                with self.subTest(name=name, attr=attr), self.assertRaisesRegex(RuntimeError, expected):
                    self.run_browser(browser)
                self.assertEqual(browser.submissions, [])

    def test_composer_role_and_name_must_match_exactly(self):
        for row in [
            '- textbox "Search" [ref=e1] value=""',
            '- textbox "Tanya ChatGPT tentang perjalanan" [ref=e1] value=""',
            '- textbox "Ask ChatGPT elsewhere" [ref=e1] value=""',
            '- button "Tanya ChatGPT" [ref=e1]',
            '- paragraph: textbox "Tanya ChatGPT" [ref=e1] value=""',
            '- paragraph: textbox "Ask ChatGPT" [ref=e1] value=""',
        ]:
            browser = FakeBrowser()
            browser.composer_override = row
            with self.subTest(row=row), self.assertRaisesRegex(RuntimeError, "composer"):
                self.run_browser(browser)
            self.assertEqual(browser.submissions, [])

    def test_multiple_recognized_composers_never_choose_the_first(self):
        for second_name in ("Ask ChatGPT", "Tanya ChatGPT"):
            browser = FakeBrowser()
            browser.composer_override = ('- textbox "Ask ChatGPT" [ref=e1] value=""\n'
                                         '- textbox ' + json.dumps(second_name) + ' [ref=e2] value="my draft"')
            with self.subTest(name=second_name), self.assertRaisesRegex(RuntimeError, "composer"):
                self.run_browser(browser)
            self.assertEqual(browser.submissions, [])

    def test_unverifiable_draft_never_becomes_an_empty_composer(self):
        for name in ("Ask ChatGPT", "Tanya ChatGPT"):
            for suffix in [' value=null', ' value=42', ' value="unfinished',
                           ' value="\\q"', ':\n  - paragraph: existing draft']:
                browser = FakeBrowser(composer_name=name)
                browser.composer_override = '- textbox ' + json.dumps(name) + ' [ref=e1]' + suffix
                with self.subTest(name=name, suffix=suffix), self.assertRaisesRegex(RuntimeError, "composer"):
                    self.run_browser(browser)
                self.assertEqual(browser.submissions, [])

    def test_lost_pairing_or_duplicate_tabs_block_submission(self):
        for attr in ("lose_pairing", "duplicate"):
            browser = FakeBrowser()
            setattr(browser, attr, True)
            with self.subTest(attr=attr), self.assertRaises(RuntimeError):
                self.run_browser(browser)
            self.assertEqual(browser.submissions, [])

    def test_uncertain_send_is_never_retried(self):
        browser = FakeBrowser()
        browser.fail_submit = True
        with self.assertRaisesRegex(RuntimeError, "unknown after submit"):
            self.run_browser(browser)
        with self.assertRaisesRegex(RuntimeError, "reconciliation required"):
            self.run_browser(browser)
        self.assertEqual(len(browser.submissions), 1)

    def test_existing_marker_reconciles_without_submitting_again(self):
        browser = FakeBrowser()
        browser.marker = True
        fixture = {"version": 1, "testFixture": True}
        with patch.object(wake, "wait_for_assistant_attestation", return_value=fixture) as attest:
            proof = self.run_browser(browser)
        self.assertTrue(proof["alreadyVisible"])
        self.assertTrue(proof["verifiedAssistantReply"])
        self.assertEqual(proof["attestation"], fixture)
        attest.assert_called_once()
        self.assertEqual(browser.submissions, [])

    def test_visible_marker_without_signed_assistant_stays_unverified(self):
        browser = FakeBrowser()
        browser.marker = True
        proof = self.run_browser(browser)
        self.assertFalse(proof["verifiedAssistantReply"])
        self.assertIsNone(proof["attestation"])
        self.assertEqual(browser.submissions, [])

    def test_read_checks_may_retry_but_submission_does_not(self):
        failure = type("Result", (), {"returncode": 1, "stdout": ""})()
        with patch.object(wake.subprocess, "run", return_value=failure) as process, patch.object(wake.time, "sleep"):
            with self.assertRaises(RuntimeError):
                wake.browser("type", "e1", "test")
            self.assertEqual(process.call_count, 1)
            process.reset_mock()
            with self.assertRaises(RuntimeError):
                wake.browser("tabs", "--json")
            self.assertEqual(process.call_count, 3)


class DellBindingTests(WakeTestCase):
    def setUp(self):
        super().setUp()
        self.wake = load_wake(DELL, "travelincars-dev")
        self.legacy = {
            "version": 1, "accountAlias": "GPT01", "ownerChannel": OWNER,
            "targetConversationId": CHAT, "workerId": DELL,
            "browserProfile": "openclaw", "enabled": True,
        }
        self.binding = {
            "version": 1, "accountAlias": "GPT02", "ownerChannel": OWNER_TWO,
            "targetConversationId": CHAT_TWO, "workerId": DELL,
            "browserProfile": "travelincars-dev",
        }
        self.binding["bindingFingerprint"] = self.wake.binding_fingerprint(self.binding)
        self.config = {"enabled": True, "allowedConversationIds": [CHAT],
                       "legacyBinding": self.legacy, "bindings": [{**self.binding, "enabled": True}]}
        self.write_config(self.config)

    def metadata(self, binding=None):
        target = binding or self.binding
        metadata = {
            "assignedClientId": DELL, "conversationId": target["ownerChannel"],
            "targetConversationId": target["targetConversationId"], "eventId": EVENT,
            "capability": "chatgpt:wake", "source": "authorized-dev-browser-wake",
            "explicitWorkerTarget": True, "devOnly": True,
        }
        if target["accountAlias"] != "GPT01":
            metadata["wakeBinding"] = dict(target)
        metadata["assistantAttestationChallenge"] = self.wake.assistant_challenge(
            metadata, metadata.get("wakeBinding", {}).get("bindingFingerprint"))
        return metadata

    def command(self, metadata):
        return ("DEV_CHATGPT_WAKE_V1 conversation=" + metadata["targetConversationId"] +
                " event=" + metadata["eventId"] + " challenge=" + metadata["assistantAttestationChallenge"])

    def assert_denied_before_browser(self, metadata, config=None, module=None):
        self.write_config(config or self.config)
        active = module or self.wake
        with patch.object(active, "browser") as browser, self.assertRaises(RuntimeError):
            active.submit_once(self.command(metadata), DELL, self.root, metadata=metadata)
        browser.assert_not_called()

    def test_canonical_cross_language_fingerprint_and_challenge_vectors(self):
        fingerprint = self.wake.binding_fingerprint(self.binding)
        self.assertEqual(fingerprint, "4da956549aa62bb6e42bdc4ab13390d2b137d29940e2bb6a89134dfc2f0dbec1")
        metadata = self.metadata()
        self.assertEqual(self.wake.assistant_challenge(metadata, fingerprint),
                         "2a4c9bcdf77cb321930750a835f29cd065d70c1ea8b20f8a4c302853b6267a2a")
        metadata.update(watchCommandId="55555555-5555-4555-8555-555555555555",
                        jobId="66666666-6666-4666-8666-666666666666", checkpointRevision=7)
        self.assertEqual(self.wake.assistant_challenge(metadata, fingerprint),
                         "79960f0819bca525e9f2930fc13b4c94b538c06fc0860686b4d051f84d53feec")
        del metadata["jobId"]
        with self.assertRaisesRegex(RuntimeError, "challenge context"):
            self.wake.assistant_challenge(metadata, fingerprint)

    def test_new_binding_routes_only_its_local_profile(self):
        metadata = self.metadata()
        browser = FakeBrowser(CHAT_TWO)
        proof = self.run_browser(browser, self.command(metadata), self.wake, metadata)
        self.assertEqual(proof["browserProfile"], "travelincars-dev")
        self.assertEqual(proof["bindingFingerprint"], self.binding["bindingFingerprint"])
        self.assertFalse(proof["verifiedAssistantReply"])
        self.assertEqual(len(browser.submissions), 1)
        self.assertIn("travelincars-dev", self.wake.CLI)

    def test_indonesian_composer_uses_the_bound_gpt02_destination(self):
        metadata = self.metadata()
        browser = FakeBrowser(CHAT_TWO, composer_name="Tanya ChatGPT")
        proof = self.run_browser(browser, self.command(metadata), self.wake, metadata)
        self.assertEqual(proof["conversationId"], CHAT_TWO)
        self.assertEqual(proof["browserProfile"], self.binding["browserProfile"])
        self.assertEqual(proof["bindingFingerprint"], self.binding["bindingFingerprint"])
        self.assertFalse(proof["verifiedAssistantReply"])
        self.assertEqual(len(browser.submissions), 1)
        self.assertEqual(browser.submissions[0][0:4], ("--target-id", "t12", "--submit", "e1"))

    def test_indonesian_composer_preserves_drafts_and_exact_tab_pairing(self):
        metadata = self.metadata()
        for attr, value in [("draft", 'Pesan saya: "jangan hapus"\nbaris kedua'),
                            ("lose_pairing", True), ("duplicate", True)]:
            browser = FakeBrowser(CHAT_TWO, composer_name="Tanya ChatGPT")
            setattr(browser, attr, value)
            with self.subTest(attr=attr), self.assertRaises(RuntimeError):
                self.run_browser(browser, self.command(metadata), self.wake, metadata)
            self.assertEqual(browser.submissions, [])
            self.assertEqual(getattr(browser, attr), value)

    def test_legacy_gpt01_requires_explicit_owner_tuple(self):
        legacy_wake = load_wake(DELL, "openclaw")
        metadata = self.metadata(self.legacy)
        proof = self.run_browser(FakeBrowser(), self.command(metadata), legacy_wake, metadata)
        self.assertEqual(proof["browserProfile"], "openclaw")
        self.assertNotIn("bindingFingerprint", proof)
        self.assert_denied_before_browser(metadata, {"enabled": True, "allowedConversationIds": [CHAT]}, legacy_wake)

    def test_legacy_list_never_authorizes_second_account(self):
        metadata = self.metadata()
        del metadata["wakeBinding"]
        metadata["assistantAttestationChallenge"] = self.wake.assistant_challenge(metadata)
        self.assert_denied_before_browser(metadata, {"enabled": True, "allowedConversationIds": [CHAT, CHAT_TWO]})

    def test_cross_owner_target_and_profile_mismatches_fail_closed(self):
        for mutate in [
            lambda data: data.update(conversationId=OWNER),
            lambda data: data["wakeBinding"].update(ownerChannel=OWNER),
            lambda data: data["wakeBinding"].update(targetConversationId=CHAT),
            lambda data: data["wakeBinding"].update(browserProfile="openclaw"),
            lambda data: data["wakeBinding"].update(workerId=WORKER),
            lambda data: data.update(wakeBinding=None),
            lambda data: data["wakeBinding"].update(bindingFingerprint="0" * 64),
            lambda data: data.update(assistantAttestationChallenge="c" * 64),
        ]:
            metadata = self.metadata()
            mutate(metadata)
            with self.subTest(metadata=metadata):
                self.assert_denied_before_browser(metadata)

    def test_disabled_changed_and_conflicting_local_bindings_fail_closed(self):
        for field in ["enabled", "browserProfile", "ownerChannel", "targetConversationId"]:
            config = copy.deepcopy(self.config)
            config["bindings"][0].pop("bindingFingerprint", None)
            config["bindings"][0][field] = {
                "enabled": False, "browserProfile": "different-profile",
                "ownerChannel": OWNER, "targetConversationId": CHAT,
            }[field]
            with self.subTest(field=field):
                self.assert_denied_before_browser(self.metadata(), config)
        config = copy.deepcopy(self.config)
        extra = {**self.binding, "accountAlias": "GPT03", "ownerChannel": "ai-engine-oauth:" + "e" * 64,
                 "targetConversationId": "33333333-3333-4333-8333-333333333333",
                 "browserProfile": "TRAVELINCARS-DEV", "enabled": False}
        extra.pop("bindingFingerprint")
        config["bindings"].append(extra)
        self.assert_denied_before_browser(self.metadata(), config)

    def test_runtime_profile_is_independently_checked_by_helper(self):
        wrong_profile = load_wake(DELL, "openclaw")
        self.assert_denied_before_browser(self.metadata(), module=wrong_profile)

    def test_bound_receipt_cannot_reconcile_different_challenge_context(self):
        metadata = self.metadata()
        directory = self.root / "chatgpt-wake-dev-receipts"
        directory.mkdir()
        receipt = directory / (self.binding["bindingFingerprint"] + "-" + EVENT + ".json")
        receipt.write_text(json.dumps({"conversationId": CHAT_TWO, "eventId": EVENT, "challenge": "f" * 64,
                                     "browserProfile": "travelincars-dev",
                                     "bindingFingerprint": self.binding["bindingFingerprint"]}))
        browser = FakeBrowser(CHAT_TWO)
        browser.marker = True
        with self.assertRaisesRegex(RuntimeError, "receipt context mismatch"):
            self.run_browser(browser, self.command(metadata), self.wake, metadata)
        self.assertEqual(browser.submissions, [])

    def test_signature_covers_profile_and_binding_fingerprint(self):
        metadata = self.metadata()
        challenge = metadata["assistantAttestationChallenge"]
        key = Ed25519PrivateKey.generate()
        observed = {"assistantFound": True, "ackVisible": True, "responding": False,
                    "assistantMessageId": "44444444-4444-4444-8444-444444444444",
                    "assistantText": "Test fixture AI_CORE_ATTEST_ACK:" + challenge}
        with patch.object(self.wake, "_private_key", return_value=key), \
             patch.object(self.wake, "_assistant_probe", return_value=observed), \
             patch.object(self.wake, "_iso_now", return_value="2026-10-20T00:00:00.000Z"):
            attestation = self.wake.wait_for_assistant_attestation(
                self.root, "t12", "https://chatgpt.com/c/" + CHAT_TWO, CHAT_TWO, EVENT, challenge, self.binding)
        self.assertEqual(attestation["version"], 2)
        expected = "\n".join([
            "dev-chatgpt-assistant-attestation/v2", "keyId=" + DELL + "-ed25519-v1", "workerId=" + DELL,
            "conversationId=" + CHAT_TWO, "eventId=" + EVENT, "challenge=" + challenge,
            "assistantMessageId=" + observed["assistantMessageId"],
            "assistantResponseHash=" + hashlib.sha256(observed["assistantText"].encode()).hexdigest(),
            "observedAt=2026-10-20T00:00:00.000Z",
            "bindingFingerprint=" + self.binding["bindingFingerprint"], "browserProfile=travelincars-dev",
        ])
        signature = self.wake.base64.b64decode(attestation["signature"])
        key.public_key().verify(signature, expected.encode())
        for altered in [expected.replace("browserProfile=travelincars-dev", "browserProfile=openclaw"),
                        expected.replace(self.binding["bindingFingerprint"], "0" * 64)]:
            with self.assertRaises(InvalidSignature):
                key.public_key().verify(signature, altered.encode())

    def test_v1_payload_stays_compatible_and_has_no_profile_fields(self):
        payload = self.wake._attestation_payload(CHAT, EVENT, CHALLENGE, CHAT_TWO, "f" * 64, "2026-10-20T00:00:00.000Z")
        self.assertTrue(payload.startswith("dev-chatgpt-assistant-attestation/v1\n"))
        self.assertNotIn("bindingFingerprint=", payload)
        self.assertNotIn("browserProfile=", payload)


if __name__ == "__main__":
    unittest.main()

