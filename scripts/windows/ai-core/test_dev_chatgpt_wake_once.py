"""Fail-closed model-free Browser Wake tests; no Chrome/ChatGPT needed."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

path = Path(__file__).with_name("dev-chatgpt-wake-once.py")
spec = importlib.util.spec_from_file_location("wake_once", path)
wake = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wake)

CHAT = "6ad3a9a6-97e4-83ec-af32-a0a5d580b649"
EVENT = "b" * 64
CHALLENGE = "c" * 64
COMMAND = f"DEV_CHATGPT_WAKE_V1 conversation={CHAT} event={EVENT} challenge={CHALLENGE}"
URL = f"https://chatgpt.com/c/{CHAT}"
TABS = json.dumps({"tabs": [{"type": "page", "url": URL, "targetId": "t12"}]})
COMPOSER = '- textbox "Ask ChatGPT" [ref=e1] value="\\n"'
COMPOSER_DRAFT = '- textbox "Ask ChatGPT" [ref=e1] value="my draft"'

class BrowserWakeTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name)
        (self.root / "chatgpt-wake-dev-allowlist.json").write_text(json.dumps({
            "enabled": True, "allowedConversationIds": [CHAT],
        }), encoding="utf-8")

    def run_case(self, initial=None, after=None, composer=COMPOSER):
        initial = initial or {"url": URL, "markerVisible": False, "responding": False}
        after = after or {"url": URL, "markerVisible": True, "responding": False}
        side_effect = [TABS, composer, json.dumps(initial), "typed", COMPOSER, json.dumps(after)]
        with patch.object(wake, "browser", side_effect=side_effect) as mock, patch.object(wake.time, "sleep"):
            proof = wake.submit_once(COMMAND, wake.WORKER, self.root)
        return proof, mock

    def test_valid_one_shot_send_and_browser_confirmation(self):
        proof, calls = self.run_case()
        self.assertTrue(proof["chatgptSubmitted"])
        self.assertTrue(proof["browserConfirmed"])
        self.assertFalse(proof["verifiedAssistantReply"])
        self.assertEqual(sum(x.args[0] == "type" for x in calls.call_args_list), 1)
        receipt = json.loads((self.root / "chatgpt-wake-dev-receipts" / (EVENT + ".json")).read_text())
        self.assertEqual(receipt["status"], "BROWSER_CONFIRMED")

    def test_wrong_target_and_worker_never_touch_browser(self):
        with patch.object(wake, "browser") as control:
            for instruction, worker in [
                (COMMAND, "openclaw-pc-worker"),
                (COMMAND + " && delete files", wake.WORKER),
                (COMMAND.replace(CHAT, "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"), wake.WORKER),
            ]:
                with self.assertRaises(RuntimeError):
                    wake.submit_once(instruction, worker, self.root)
            control.assert_not_called()

    def test_unpaired_conversation_refused(self):
        (self.root / "chatgpt-wake-dev-allowlist.json").write_text(json.dumps({
            "enabled": False, "allowedConversationIds": [CHAT],
        }), encoding="utf-8")
        with patch.object(wake, "browser") as control, self.assertRaises(RuntimeError):
            wake.submit_once(COMMAND, wake.WORKER, self.root)
        control.assert_not_called()

    def test_active_chatgpt_generation_blocks_typing(self):
        with patch.object(wake, "browser", side_effect=[
            TABS, COMPOSER, json.dumps({"url": URL, "markerVisible": False, "responding": True}),
        ]) as control, self.assertRaisesRegex(RuntimeError, "still responding"):
            wake.submit_once(COMMAND, wake.WORKER, self.root)
        self.assertFalse(any(c.args[0] == "type" for c in control.call_args_list))

    def test_preserves_existing_composer_draft(self):
        with patch.object(wake, "browser", side_effect=[
            TABS, COMPOSER_DRAFT, json.dumps({"url": URL, "markerVisible": False, "responding": False}),
        ]) as control, self.assertRaisesRegex(RuntimeError, "draft"):
            wake.submit_once(COMMAND, wake.WORKER, self.root)
        self.assertFalse(any(c.args[0] == "type" for c in control.call_args_list))

    def test_wrong_observed_url_blocks(self):
        with patch.object(wake, "browser", side_effect=[
            TABS, COMPOSER, json.dumps({"url": "https://chatgpt.com/", "markerVisible": False, "responding": False}),
        ]) as control, self.assertRaisesRegex(RuntimeError, "pairing"):
            wake.submit_once(COMMAND, wake.WORKER, self.root)
        self.assertFalse(any(c.args[0] == "type" for c in control.call_args_list))

    def test_uncertain_send_does_not_retry(self):
        with patch.object(wake, "browser", side_effect=[
            TABS, COMPOSER, json.dumps({"url": URL, "markerVisible": False, "responding": False}),
            RuntimeError("unknown after submit"),
        ]), self.assertRaises(RuntimeError):
            wake.submit_once(COMMAND, wake.WORKER, self.root)
        with patch.object(wake, "browser", side_effect=[
            TABS, COMPOSER, json.dumps({"url": URL, "markerVisible": False, "responding": False}),
        ]) as control, self.assertRaisesRegex(RuntimeError, "reconciliation required"):
            wake.submit_once(COMMAND, wake.WORKER, self.root)
        self.assertFalse(any(c.args[0] == "type" for c in control.call_args_list))

    def test_existing_marker_does_not_send_duplicate(self):
        with patch.object(wake, "browser", side_effect=[
            TABS, COMPOSER, json.dumps({"url": URL, "markerVisible": True, "responding": False}),
        ]) as control:
            proof = wake.submit_once(COMMAND, wake.WORKER, self.root)
        self.assertTrue(proof["alreadyVisible"])
        self.assertFalse(any(c.args[0] == "type" for c in control.call_args_list))

if __name__ == "__main__":
    unittest.main()
