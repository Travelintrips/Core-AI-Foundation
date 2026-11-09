"""Synthetic-only native readiness classification regressions."""
import unittest
from dev_gpt02_readiness_proof import classify_visible_readiness

EVENT = "a" * 64
CHALLENGE = "b" * 64
WAKE = "[AI_CORE_WAKE:" + EVENT + "]"
ATTEST = "[AI_CORE_ATTEST:" + CHALLENGE + "]"
ACK = "[AI_CORE_ATTEST_ACK:" + CHALLENGE + "]"
PROMPT = WAKE + " " + ATTEST + " Please respond with " + ACK


class ReadinessProofTests(unittest.TestCase):
    def classify(self, snapshot, prompt=PROMPT, event=EVENT, challenge=CHALLENGE):
        value = classify_visible_readiness(snapshot, prompt, event, challenge)
        self.assertFalse(value["nativeFinalVerified"])
        self.assertFalse(value["mayReplay"])
        self.assertFalse(value["mayDispatch"])
        self.assertFalse(value["mayCloseJob"])
        self.assertNotIn(EVENT, repr(value))
        self.assertNotIn(CHALLENGE, repr(value))
        self.assertNotIn(PROMPT, repr(value))
        return value

    def test_original_prompt_only_is_not_final_ack(self):
        self.assertEqual(self.classify(PROMPT)["reason"], "ONLY_USER_PROMPT_ACK_VISIBLE")

    def test_exact_prompt_and_final_ack_only_ready_for_reader(self):
        result = self.classify(PROMPT + "\nassistant: completed " + ACK)
        self.assertTrue(result["readyForReader"])
        self.assertEqual(result["reason"], "READY_FOR_AUTHORITATIVE_READER_ONLY")

    def test_stop_button_blocks_even_with_ack(self):
        result = self.classify(PROMPT + ACK + '\nbutton "Stop generating"')
        self.assertEqual(result["reason"], "UI_STILL_RESPONDING")

    def test_multiple_prompt_copies_fail_closed(self):
        self.assertEqual(self.classify(PROMPT + PROMPT)["reason"], "USER_NOT_UNIQUELY_VISIBLE")

    def test_missing_user_fails_closed(self):
        self.assertEqual(self.classify(ACK)["reason"], "USER_NOT_UNIQUELY_VISIBLE")

    def test_duplicate_wake_fails_closed(self):
        self.assertEqual(self.classify(PROMPT + WAKE)["reason"], "WAKE_ATTEST_NOT_UNIQUE")

    def test_duplicate_attest_fails_closed(self):
        self.assertEqual(self.classify(PROMPT + ATTEST)["reason"], "WAKE_ATTEST_NOT_UNIQUE")

    def test_invalid_challenge_rejected(self):
        self.assertEqual(self.classify(PROMPT, challenge="bad")["reason"], "READINESS_INPUT_INVALID")

    def test_wrong_expected_marker_rejected(self):
        self.assertEqual(self.classify(PROMPT, prompt=PROMPT+WAKE)["reason"], "EXPECTED_USER_MARKERS_INVALID")

    def test_bounded_snapshot(self):
        self.assertEqual(self.classify("x"*200001)["reason"], "READINESS_INPUT_INVALID")

    def test_exact_user_text_required(self):
        result = self.classify(PROMPT.replace("Please", "Do") + ACK)
        self.assertEqual(result["reason"], "USER_NOT_UNIQUELY_VISIBLE")

    def test_unchanged_ack_not_accepted_as_completed_final(self):
        self.assertFalse(self.classify(PROMPT+ACK)["nativeFinalVerified"])

    def test_no_raw_user_text_in_result_even_if_invalid(self):
        result = self.classify({"hidden":PROMPT})
        self.assertNotIn("hidden", str(result))
        self.assertEqual(result["reason"], "READINESS_INPUT_INVALID")

if __name__ == "__main__":
    unittest.main()
