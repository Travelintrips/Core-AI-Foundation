"""Behavioral tests for DEV browser wake. No real browser, account, or private key."""
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

MODULE_PATH = Path(__file__).with_name("dev-chatgpt-wake-once.py")
WORKER = "openclaw-travelintrips-dev"
DELL = "openclaw-dell-chatgpt-wake-dev"
PC2 = "openclaw-pc-worker-2"
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

    def test_v2_multiline_sop_and_forbidden_controls(self):
        multiline = "AI CORE — CONTINUE_JOB\r\njobId: job-123\n\tcheckpointId: cp-7"
        encoded = wake.base64.urlsafe_b64encode(multiline.encode()).decode().rstrip("=")
        command = COMMAND.replace("_V1 ", "_V2 ") + " task=" + encoded
        browser = FakeBrowser()
        self.run_browser(browser, command)
        self.assertEqual(len(browser.submissions), 1)
        self.assertIn(multiline, browser.submissions[0][-1])

        for control in ("\x00", "\x1b", "\x7f"):
            unsafe = "CONTINUE_JOB" + control + "test"
            token = wake.base64.urlsafe_b64encode(unsafe.encode()).decode().rstrip("=")
            invalid_command = COMMAND.replace("_V1 ", "_V2 ") + " task=" + token
            with self.subTest(control=ord(control)), patch.object(wake, "browser") as mock_browser:
                with self.assertRaisesRegex(RuntimeError, "Invalid DEV wake task instruction"):
                    wake.submit_once(invalid_command, WORKER, self.root)
                mock_browser.assert_not_called()

    def test_native_wake_prompt_encodes_multiline_unicode_as_safe_ascii(self):
        raw_task = "AI CORE \u2014 CONTINUE_JOB\r\ncheckpointId: cp-7\n\tstepId: step-8"
        message = wake._wake_message(EVENT, CHALLENGE, raw_task)
        self.assertTrue(message.isascii())
        self.assertNotIn("\n", message)
        self.assertNotIn("\r", message)
        self.assertIn(r"\u2014", message)
        self.assertIn(r"\n", message)
        self.assertEqual(message.count("[AI_CORE_WAKE:" + EVENT + "]"), 1)
        self.assertEqual(message.count("[AI_CORE_ATTEST:" + CHALLENGE + "]"), 1)
        self.assertEqual(message.count("[AI_CORE_ATTEST_ACK:" + CHALLENGE + "]"), 1)
        self.assertLessEqual(len(message), 4096)
        self.assertIn(raw_task, __import__("json").loads(message[message.index('"') : message.index('"', message.index('"') + 1) + 1]))

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

    def test_whitespace_draft_is_preserved_exactly(self):
        for name in ("Ask ChatGPT", "Tanya ChatGPT"):
            for draft in (" ", "\t", "\n", "\r\n", "\u00a0"):
                browser = FakeBrowser(composer_name=name)
                browser.draft = draft
                with self.subTest(name=name, draft=repr(draft)), self.assertRaisesRegex(RuntimeError, "draft"):
                    self.run_browser(browser)
                self.assertEqual(browser.draft, draft)
                self.assertEqual(browser.submissions, [])

    def test_role_and_frame_refs_require_an_explicit_empty_value(self):
        # Ref shapes were observed in OpenClaw. The explicit value below is
        # synthetic; the observed native frame snapshot did not expose it.
        for ref in ("e1", "e430", "f239e430", "f244e12"):
            browser = FakeBrowser()
            browser.composer_override = '- textbox "Ask ChatGPT" [active] [ref=' + ref + '] value=""'
            with self.subTest(ref=ref):
                self.run_browser(browser)
            self.assertEqual(len(browser.submissions), 1)
            self.assertEqual(browser.submissions[0][3], ref)
            # Each subcase represents a separate one-shot event.
            (self.root / "chatgpt-wake-dev-receipts" / (EVENT + ".json")).unlink()

    def test_observed_native_placeholder_does_not_prove_an_empty_draft(self):
        browser = FakeBrowser()
        browser.composer_override = ('- textbox "Ask ChatGPT" [active] [ref=f239e430]:\n'
                                     '  - paragraph: Ask ChatGPT')
        with self.assertRaisesRegex(RuntimeError, "composer"):
            self.run_browser(browser)
        self.assertEqual(browser.submissions, [])

    def test_malformed_or_duplicate_reference_never_selects_a_composer(self):
        for ref in ("f239", "f239e", "f-1e2", "f239e430e2", "e1] [ref=e2"):
            browser = FakeBrowser()
            browser.composer_override = '- textbox "Ask ChatGPT" [ref=' + ref + '] value=""'
            with self.subTest(ref=ref), self.assertRaisesRegex(RuntimeError, "composer"):
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
            for suffix in ['', ':', ' value=null', ' value=42', ' value="unfinished',
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


class PortablePc2BindingTests(WakeTestCase):
    def test_pc2_accepts_only_its_exact_bound_session_tuple(self):
        module = load_wake(PC2, "gpt02-vmsc")
        binding = {
            "version": 1, "accountAlias": "GPT02", "ownerChannel": OWNER_TWO,
            "targetConversationId": CHAT_TWO, "workerId": PC2,
            "browserProfile": "gpt02-vmsc",
        }
        binding["bindingFingerprint"] = module.binding_fingerprint(binding)
        config = {"enabled": True, "allowedConversationIds": [CHAT],
                  "bindings": [{**binding, "enabled": True}]}
        metadata = {
            "assignedClientId": PC2, "conversationId": OWNER_TWO,
            "targetConversationId": CHAT_TWO, "eventId": EVENT,
            "capability": "chatgpt:wake", "source": "authorized-dev-browser-wake",
            "explicitWorkerTarget": True, "devOnly": True, "wakeBinding": dict(binding),
        }
        metadata["assistantAttestationChallenge"] = module.assistant_challenge(
            metadata, binding["bindingFingerprint"])
        selected = module.resolve_dell_binding(
            metadata, config, CHAT_TWO, EVENT, metadata["assistantAttestationChallenge"])
        self.assertEqual(selected, binding)
        self.assertIn(PC2, module.BOUND_WORKERS)
        changed = copy.deepcopy(metadata)
        changed["wakeBinding"]["workerId"] = DELL
        with self.assertRaises(RuntimeError):
            module.resolve_dell_binding(
                changed, config, CHAT_TWO, EVENT, changed["assistantAttestationChallenge"])


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

    def test_new_binding_resolves_its_profile_but_transport_stays_inactive(self):
        metadata = self.metadata()
        selected = self.wake.resolve_dell_binding(
            metadata, self.config, CHAT_TWO, EVENT, metadata["assistantAttestationChallenge"])
        self.assertEqual(selected, self.binding)
        self.assertIn("travelincars-dev", self.wake.CLI)
        with patch.object(self.wake, "browser") as browser, patch.object(self.wake, "_private_key") as key:
            with self.assertRaisesRegex(RuntimeError, "Native bound ChatGPT transport is not activated"):
                self.wake.submit_once(self.command(metadata), DELL, self.root, metadata=metadata)
        browser.assert_not_called()
        key.assert_not_called()
        self.assertFalse((self.root / "chatgpt-wake-dev-receipts").exists())

    def test_indonesian_snapshot_uses_only_the_exact_bound_destination(self):
        metadata = self.metadata()
        self.assertEqual(self.wake.resolve_dell_binding(
            metadata, self.config, CHAT_TWO, EVENT, metadata["assistantAttestationChallenge"]), self.binding)
        browser = FakeBrowser(CHAT_TWO, composer_name="Tanya ChatGPT")
        # Parser component only: no native transport or submission is enabled.
        with patch.object(self.wake, "browser", side_effect=browser):
            tab = self.wake.find_tab(browser.url)
            state = self.wake.inspect(tab, "AI_CORE_WAKE:" + EVENT, browser.url)
        self.assertEqual(tab, browser.handle)
        self.assertEqual(state["ref"], "e1")
        self.assertTrue(state["empty"])
        self.assertEqual(browser.submissions, [])

    def test_indonesian_composer_preserves_drafts_and_exact_tab_pairing(self):
        for attr, value in [("draft", 'Pesan saya: "jangan hapus"\nbaris kedua'),
                            ("lose_pairing", True), ("duplicate", True)]:
            browser = FakeBrowser(CHAT_TWO, composer_name="Tanya ChatGPT")
            setattr(browser, attr, value)
            with self.subTest(attr=attr), patch.object(self.wake, "browser", side_effect=browser):
                if attr == "draft":
                    tab = self.wake.find_tab(browser.url)
                    self.assertFalse(self.wake.inspect(tab, "AI_CORE_WAKE:" + EVENT, browser.url)["empty"])
                else:
                    with self.assertRaises(RuntimeError):
                        tab = self.wake.find_tab(browser.url)
                        self.wake.inspect(tab, "AI_CORE_WAKE:" + EVENT, browser.url)
            self.assertEqual(browser.submissions, [])
            self.assertEqual(getattr(browser, attr), value)

    def test_legacy_gpt01_requires_explicit_owner_tuple(self):
        legacy_wake = load_wake(DELL, "openclaw")
        metadata = self.metadata(self.legacy)
        proof = self.run_browser(FakeBrowser(), self.command(metadata), legacy_wake, metadata)
        self.assertEqual(proof["browserProfile"], "openclaw")
        self.assertNotIn("bindingFingerprint", proof)
        self.assert_denied_before_browser(metadata, {"enabled": True, "allowedConversationIds": [CHAT]}, legacy_wake)

    def test_two_legacy_owners_keep_one_destination_with_gpt02_dormant(self):
        legacy_wake = load_wake(DELL, "openclaw")
        second = {**self.legacy, "ownerChannel": "ai-engine-oauth:" + "e" * 64}
        config = copy.deepcopy(self.config)
        del config["legacyBinding"]
        config["legacyBindings"] = [dict(self.legacy), second]
        config["bindings"][0]["enabled"] = False
        challenges = []
        for target in (self.legacy, second):
            metadata = self.metadata(target)
            challenge = metadata["assistantAttestationChallenge"]
            challenges.append(challenge)
            self.assertIsNone(legacy_wake.resolve_dell_binding(metadata, config, CHAT, EVENT, challenge))
        self.assertNotEqual(*challenges)
        unknown = self.metadata({**self.legacy, "ownerChannel": OWNER_TWO})
        self.assert_denied_before_browser(unknown, config, legacy_wake)
        self.assert_denied_before_browser(self.metadata(), config)
        config["legacyBindings"][1]["enabled"] = False
        self.assert_denied_before_browser(self.metadata(second), config, legacy_wake)
        metadata = self.metadata(self.legacy)
        self.assertIsNone(legacy_wake.resolve_dell_binding(
            metadata, config, CHAT, EVENT, metadata["assistantAttestationChallenge"]))

    def test_plural_legacy_registry_rejects_ambiguity_and_cross_account_collisions(self):
        second = {**self.legacy, "ownerChannel": "ai-engine-oauth:" + "e" * 64}
        for entries in ([], None, {}, [self.legacy, self.legacy],
                        [self.legacy, {**second, "targetConversationId": CHAT_TWO}],
                        [self.legacy, {**second, "browserProfile": "another-profile"}],
                        [self.legacy, {**second, "accountAlias": "GPT02"}],
                        [self.legacy, {**second, "ownerChannel": OWNER_TWO}]):
            config = copy.deepcopy(self.config)
            del config["legacyBinding"]
            config["legacyBindings"] = entries
            with self.subTest(entries=entries), self.assertRaises(RuntimeError):
                self.wake.local_bindings(config)
        with self.assertRaisesRegex(RuntimeError, "Ambiguous"):
            self.wake.local_bindings({**self.config, "legacyBindings": [second]})

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

    def test_bound_receipt_is_untouched_while_native_transport_is_inactive(self):
        metadata = self.metadata()
        directory = self.root / "chatgpt-wake-dev-receipts"
        directory.mkdir()
        receipt = directory / (self.binding["bindingFingerprint"] + "-" + EVENT + ".json")
        receipt.write_text(json.dumps({"conversationId": CHAT_TWO, "eventId": EVENT, "challenge": "f" * 64,
                                     "browserProfile": "travelincars-dev",
                                     "bindingFingerprint": self.binding["bindingFingerprint"]}))
        previous = receipt.read_bytes()
        browser = FakeBrowser(CHAT_TWO)
        browser.marker = True
        with self.assertRaisesRegex(RuntimeError, "Native bound ChatGPT transport is not activated"):
            self.run_browser(browser, self.command(metadata), self.wake, metadata)
        self.assertEqual(receipt.read_bytes(), previous)
        self.assertEqual(browser.calls, [])
        self.assertEqual(browser.submissions, [])

    def test_bound_attestation_never_falls_back_to_page_script(self):
        key = Ed25519PrivateKey.generate()
        with patch.object(self.wake, "_private_key", return_value=key) as private_key, \
             patch.object(self.wake, "browser") as browser, \
             patch.object(self.wake, "_assistant_probe") as legacy:
            with self.assertRaisesRegex(RuntimeError, "Native assistant identity reader requires the bound transport context"):
                self.wake.wait_for_assistant_attestation(
                    self.root, "t12", "https://chatgpt.com/c/" + CHAT_TWO, CHAT_TWO, EVENT, CHALLENGE, self.binding)
        browser.assert_not_called()
        legacy.assert_not_called()
        private_key.assert_not_called()

    def test_direct_legacy_probe_is_blocked_for_the_gpt02_profile(self):
        with patch.object(self.wake, "browser") as browser:
            with self.assertRaisesRegex(RuntimeError, "Legacy assistant probe is not permitted"):
                self.wake._assistant_probe("t12", "https://chatgpt.com/c/" + CHAT_TWO, "AI_CORE_WAKE:" + EVENT, CHALLENGE)
        browser.assert_not_called()

    def test_signature_covers_profile_and_binding_fingerprint(self):
        metadata = self.metadata()
        challenge = metadata["assistantAttestationChallenge"]
        key = Ed25519PrivateKey.generate()
        observed = {"userFound": True, "assistantFound": True, "ackVisible": True, "responding": False,
                    "assistantMessageId": "44444444-4444-4444-8444-444444444444",
                    "assistantText": "Test fixture AI_CORE_ATTEST_ACK:" + challenge}
        observed["assistantResponseHash"] = hashlib.sha256(observed["assistantText"].encode()).hexdigest()
        with patch.object(self.wake, "_private_key", return_value=key), \
             patch.object(self.wake, "_iso_now", return_value="2026-10-20T00:00:00.000Z"):
            attestation = self.wake._attest_bound_observation(
                self.root, self.binding, CHAT_TWO, EVENT, challenge, observed)
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

    def test_native_signing_preserves_exact_text_and_rejects_invalid_evidence_before_key(self):
        text = "  Exact final text\n"
        observed = {"userFound": True, "assistantFound": True, "ackVisible": True, "responding": False,
                    "assistantMessageId": "44444444-4444-4444-8444-444444444444", "assistantText": text,
                    "assistantResponseHash": hashlib.sha256(text.encode()).hexdigest()}
        with patch.object(self.wake, "_private_key", return_value=Ed25519PrivateKey.generate()):
            signed = self.wake._attest_bound_observation(self.root, self.binding, CHAT_TWO, EVENT, CHALLENGE, observed)
        self.assertEqual(signed["assistantResponseText"], text)
        self.assertEqual(signed["assistantResponseHash"], hashlib.sha256(text.encode()).hexdigest())
        for change in ({"assistantResponseHash": "0" * 64}, {"userFound": False}, {"responding": True},
                       {"assistantMessageId": "e123"}, {"assistantText": "a" * 4001}, {"assistantText": "🚀" * 2001}):
            with self.subTest(change=change), patch.object(self.wake, "_private_key") as key:
                with self.assertRaises(RuntimeError):
                    self.wake._attest_bound_observation(self.root, self.binding, CHAT_TWO, EVENT, CHALLENGE, {**observed, **change})
                key.assert_not_called()

    def test_local_revocation_after_native_observation_fences_signing(self):
        import dev_chatgpt_native_transport as native
        self.config["bindings"][0]["nativeTransport"] = {
            "version": 1, "enabled": True, "composerName": "Ask ChatGPT", "allowProviderLf": False}
        self.write_config(self.config)
        metadata = self.metadata()

        def revoke(_message):
            self.config["bindings"][0]["enabled"] = False
            self.write_config(self.config)
            return {}

        with patch.object(native.NativeTransport, "run", side_effect=revoke), \
             patch.object(self.wake, "_private_key") as key, patch.object(self.wake, "browser") as legacy:
            with self.assertRaisesRegex(RuntimeError, "not enabled"):
                self.wake.submit_once(self.command(metadata), DELL, self.root, metadata)
        key.assert_not_called()
        legacy.assert_not_called()

    def test_lease_revocation_after_observation_blocks_key_access(self):
        import dev_chatgpt_native_transport as native
        self.config["bindings"][0]["nativeTransport"] = {
            "version": 1, "enabled": True, "composerName": "Ask ChatGPT", "allowProviderLf": False}
        self.write_config(self.config)
        metadata = self.metadata()
        guard = Mock()

        def revoke(_message):
            guard.authorize.side_effect = RuntimeError("lease revoked")
            return {}

        with patch.object(native.NativeTransport, "run", side_effect=revoke), \
             patch.object(self.wake, "_private_key") as key:
            with self.assertRaisesRegex(RuntimeError, "lease revoked"):
                self.wake.submit_once(self.command(metadata), DELL, self.root, metadata, lease_guard=guard)
        key.assert_not_called()

    def test_lease_loss_between_key_read_and_signature_blocks_signing(self):
        text = "synthetic exact reply"
        observed = {"userFound": True, "assistantFound": True, "ackVisible": True, "responding": False,
                    "assistantMessageId": "44444444-4444-4444-8444-444444444444", "assistantText": text,
                    "assistantResponseHash": hashlib.sha256(text.encode()).hexdigest()}
        key = Mock()
        authorize = Mock(side_effect=[None, RuntimeError("lease revoked before sign")])
        with patch.object(self.wake, "_private_key", return_value=key), \
             self.assertRaisesRegex(RuntimeError, "lease revoked before sign"):
            self.wake._attest_bound_observation(self.root, self.binding, CHAT_TWO, EVENT, CHALLENGE, observed, authorize)
        key.sign.assert_not_called()

    def test_v1_payload_stays_compatible_and_has_no_profile_fields(self):
        payload = self.wake._attestation_payload(CHAT, EVENT, CHALLENGE, CHAT_TWO, "f" * 64, "2026-10-20T00:00:00.000Z")
        self.assertTrue(payload.startswith("dev-chatgpt-assistant-attestation/v1\n"))
        self.assertNotIn("bindingFingerprint=", payload)
        self.assertNotIn("browserProfile=", payload)


class HelperLeaseEntrypointTests(unittest.TestCase):
    def test_bound_metadata_cannot_use_legacy_eof_protocol(self):
        payload = {"instruction": "fixture", "workerId": DELL, "metadata": {"wakeBinding": {}}}
        with patch.object(wake.sys, "argv", [str(MODULE_PATH)]), \
             patch.object(wake.sys, "stdin", io.StringIO(json.dumps(payload))), \
             patch.object(wake.sys, "stdout", io.StringIO()) as output, \
             patch.object(wake, "submit_once") as submit:
            with self.assertRaises(SystemExit) as exited:
                wake.main()
        self.assertEqual(exited.exception.code, 1)
        self.assertFalse(json.loads(output.getvalue())["ok"])
        submit.assert_not_called()

    def test_bound_jsonl_uses_guard_and_flushes_result_before_process_exit(self):
        import dev_chatgpt_native_lease as native
        guard = Mock()
        payload = {"instruction": "fixture", "workerId": DELL, "metadata": {"wakeBinding": {}}}
        input_stream = io.TextIOWrapper(io.BytesIO(b"synthetic input only\n"))
        output = io.StringIO()
        exits = []

        def exit_after_flush(status):
            exits.append((status, json.loads(output.getvalue())))

        with patch.object(wake.sys, "argv", [str(MODULE_PATH), native.BOUND_ARGUMENT]), \
             patch.object(wake.sys, "stdin", input_stream), patch.object(wake.sys, "stdout", output), \
             patch.object(native.NativeLease, "from_stdin", return_value=(guard, payload)) as initialize, \
             patch.object(wake, "submit_once", return_value={"synthetic": True}) as submit, \
             patch.object(wake.os, "_exit", side_effect=exit_after_flush):
            wake.main()
        initialize.assert_called_once_with(input_stream.buffer)
        submit.assert_called_once_with("fixture", DELL, metadata=payload["metadata"], lease_guard=guard)
        self.assertEqual(guard.authorize.call_count, 2)
        self.assertEqual(exits, [(0, {"ok": True, "synthetic": True})])
        guard.job.close.assert_not_called()

    def test_expired_guard_blocks_work_before_config_or_browser(self):
        guard = Mock()
        guard.authorize.side_effect = RuntimeError("expired lease")
        with patch.object(wake, "config") as config, patch.object(wake, "browser") as browser:
            with self.assertRaisesRegex(RuntimeError, "expired lease"):
                wake.submit_once(COMMAND, WORKER, lease_guard=guard)
        config.assert_not_called()
        browser.assert_not_called()


class CheckpointPromptTests(unittest.TestCase):
    def test_binds_ids_and_keeps_ack_token_inside_json(self):
        text = wake._wake_message(
            EVENT, CHALLENGE,
            'Return {"kind":"SOP_CHECKPOINT","status":"PAUSED"}',
            "11111111-1111-4111-8111-111111111111", "ai-task:110:1:regression20261028",
        )
        self.assertIn("11111111-1111-4111-8111-111111111111", text)
        self.assertIn("ai-task:110:1:regression20261028", text)
        self.assertIn("attestationAck", text)
        self.assertIn("tanpa Markdown", text)

    def test_normal_wake_remains_unmodified(self):
        text = wake._wake_message(EVENT, CHALLENGE, "hello")
        self.assertNotIn("attestationAck", text)
        self.assertIn("AI_CORE_ATTEST_ACK", text)


if __name__ == "__main__":
    unittest.main()

