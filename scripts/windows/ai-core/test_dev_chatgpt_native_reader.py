"""Synthetic-only validator tests; no real transcript, account or browser."""

import copy
import hashlib
import json
import unittest

from dev_chatgpt_native_reader import NativeReaderError, select_observed_request, validate_native_response


CONVERSATION = "22222222-2222-4222-8222-222222222222"
USER = "33333333-3333-4333-8333-333333333333"
FINAL = "44444444-4444-4444-8444-444444444444"
OTHER = "55555555-5555-4555-8555-555555555555"
PAGE = "https://chatgpt.com/c/" + CONVERSATION
REQUEST = "https://chatgpt.com/backend-api/conversations/" + CONVERSATION + "?num_turns=10&include_has_versions=true"
EVENT, CHALLENGE = "b" * 64, "c" * 64
WAKE, ATTEST, ACK = "[AI_CORE_WAKE:" + EVENT + "]", "[AI_CORE_ATTEST:" + CHALLENGE + "]", "[AI_CORE_ATTEST_ACK:" + CHALLENGE + "]"
EXPECTED = WAKE + " " + ATTEST + " Synthetic bounded task. Reply once with " + ACK
TEXT = "  Synthetic final response. " + ACK + "\n"
SECRET_FIXTURE = "SYNTHETIC_HIDDEN_SENTINEL_NOT_FOR_PROJECTION"


def message(role, identifier, text, timestamp):
    return {"id": identifier, "author": {"role": role}, "channel": "final" if role == "assistant" else None,
            "recipient": "all", "status": "finished_successfully", "end_turn": True if role == "assistant" else None,
            "create_time": timestamp, "metadata": {}, "content": {"content_type": "text", "parts": [text]}}


class NativeReaderTests(unittest.TestCase):
    def setUp(self):
        self.context = dict(page_url=PAGE, raw_target_id="AABBCCDDEEFF00112233445566778899", conversation_id=CONVERSATION)
        self.request_row = {"timestamp": "2026-10-20T11:06:58.006Z", "method": "GET", "url": REQUEST, "status": 200, "ok": True}
        self.requests = {"ok": True, "targetId": self.context["raw_target_id"], "url": PAGE, "requests": [self.request_row]}
        self.body = {"conversation_id": CONVERSATION, "current_node": FINAL,
                     "messages": [message("user", USER, EXPECTED, 1000.033), message("assistant", FINAL, TEXT, 1001.0)]}
        self.envelope = {"ok": True, "targetId": self.context["raw_target_id"], "url": PAGE,
                         "response": {"url": REQUEST, "status": 200, "headers": {"ignored": SECRET_FIXTURE}, "body": ""}}
        self.args = {**self.context, "request_url": REQUEST, "event_id": EVENT, "challenge": CHALLENGE,
                     "visible_snapshot": '- paragraph: ' + EXPECTED + '\n- paragraph: ' + TEXT,
                     "expected_user_text": EXPECTED, "not_before": 1000.0, "captured_at": 1002.0}

    def run_reader(self, body=None, envelope=None, **overrides):
        value = copy.deepcopy(envelope or self.envelope)
        value["response"]["body"] = json.dumps(self.body if body is None else body)
        return validate_native_response(value, **{**self.args, **overrides})

    def assert_invalid(self, call, code=None):
        with self.assertRaises(NativeReaderError) as caught:
            call()
        self.assertNotIn(SECRET_FIXTURE, str(caught.exception))
        if code:
            self.assertEqual(str(caught.exception), code)

    def test_observed_url_is_returned_unchanged_and_identical_repeats_are_ok(self):
        self.requests["requests"].append(dict(self.request_row))
        self.assertEqual(select_observed_request(self.requests, **self.context), REQUEST)

    def test_differing_observed_query_values_are_ambiguous(self):
        self.requests["requests"].append({**self.request_row, "url": REQUEST.replace("num_turns=10", "num_turns=20")})
        self.assert_invalid(lambda: select_observed_request(self.requests, **self.context))

    def test_request_selector_rejects_unobserved_unsafe_or_noncompleted_requests(self):
        variants = [
            {"method": "POST"}, {"status": 201}, {"status": True}, {"ok": False}, {"timestamp": "yesterday"},
            {"url": REQUEST.replace("https:", "http:")}, {"url": REQUEST.replace("chatgpt.com", "evil.example")},
            {"url": REQUEST.replace("chatgpt.com", "chatgpt.com:443")},
            {"url": REQUEST.replace("chatgpt.com", "user@chatgpt.com")},
            {"url": REQUEST.replace(CONVERSATION, OTHER)}, {"url": REQUEST + "#fragment"},
            {"url": REQUEST + "&token=" + SECRET_FIXTURE}, {"url": REQUEST + "&num_turns=10"},
            {"url": REQUEST.replace("num_turns=10", "num_turns=%31%30")},
            {"url": REQUEST.replace("include_has_versions=true", "include_has_versions=1")},
        ]
        for change in variants:
            with self.subTest(change=list(change)):
                env = {**self.requests, "requests": [{**self.request_row, **change}]}
                self.assert_invalid(lambda: select_observed_request(env, **self.context))

    def test_empty_request_list_and_wrong_envelope_cannot_discover_a_url(self):
        for change in ({"requests": []}, {"targetId": "OTHER"}, {"url": PAGE + "/"}, {"ok": 1}):
            with self.subTest(change=change):
                self.assert_invalid(lambda: select_observed_request({**self.requests, **change}, **self.context))

    def test_exact_current_final_and_hash_preserve_whitespace(self):
        result = self.run_reader()
        self.assertEqual(result["assistantMessageId"], FINAL)
        self.assertEqual(result["userMessageId"], USER)
        self.assertEqual(result["assistantText"], TEXT)
        self.assertEqual(result["assistantResponseHash"], hashlib.sha256(TEXT.encode()).hexdigest())
        self.assertTrue(result["assistantFound"] and result["userFound"] and result["ackVisible"])
        self.assertFalse(result["responding"])
        self.assertNotIn(SECRET_FIXTURE, json.dumps(result))

    def test_explicit_false_truncation_and_utc_threshold_are_supported(self):
        self.envelope["response"]["truncated"] = False
        self.assertTrue(self.run_reader(not_before="1970-01-01T00:16:40.0000000Z")["assistantFound"])

    def test_envelope_pairing_response_status_and_truncation_fail_closed(self):
        cases = [("ok", False), ("targetId", "other"), ("url", PAGE.replace("https://", ""))]
        for key, value in cases:
            env = copy.deepcopy(self.envelope); env[key] = value
            self.assert_invalid(lambda: self.run_reader(envelope=env))
        for change in ({"url": REQUEST + "&extra=1"}, {"status": 500}, {"status": 200.0},
                       {"truncated": True}, {"truncated": "false"}, {"truncated": 0}, {"truncated": None}):
            env = copy.deepcopy(self.envelope); env["response"].update(change)
            self.assert_invalid(lambda: self.run_reader(envelope=env))

    def test_body_size_invalid_json_duplicate_keys_and_nan_are_rejected(self):
        values = ["x" * 200001, "not-json", "[]", '{"conversation_id":"one","conversation_id":"two"}',
                  '{"conversation_id":NaN}', '"' + ("😀" * 100001) + '"', "[" * 1100 + "]" * 1100]
        for raw in values:
            env = copy.deepcopy(self.envelope); env["response"]["body"] = raw
            self.assert_invalid(lambda: validate_native_response(env, **self.args))

    def test_wrong_conversation_current_node_or_message_collection_rejected(self):
        for change in ({"conversation_id": OTHER}, {"current_node": OTHER}, {"current_node": "fake"},
                       {"messages": {}}, {"messages": [None]}, {"messages": []}):
            self.assert_invalid(lambda: self.run_reader(body={**self.body, **change}))
        body = copy.deepcopy(self.body); body["messages"].append(dict(body["messages"][-1]))
        self.assert_invalid(lambda: self.run_reader(body=body))

    def test_alias_target_handles_and_conversation_as_message_id_are_rejected(self):
        for target in ("t1", "f239e430", "AABBCCDDEEFF0011", "z" * 32):
            env = copy.deepcopy(self.envelope); env["targetId"] = target
            self.assert_invalid(lambda: self.run_reader(envelope=env, raw_target_id=target))
        body = copy.deepcopy(self.body); body["current_node"] = CONVERSATION; body["messages"][-1]["id"] = CONVERSATION
        self.assert_invalid(lambda: self.run_reader(body=body), "NATIVE_CURRENT_NODE_INVALID")
        body = copy.deepcopy(self.body); body["messages"][0]["id"] = CONVERSATION
        self.assert_invalid(lambda: self.run_reader(body=body), "NATIVE_USER_ID_INVALID")

    def test_latest_user_must_be_unique_exact_complete_and_visible(self):
        changes = [{"channel": "analysis"}, {"recipient": "tool"}, {"status": "in_progress"}, {"end_turn": True},
                   {"id": "not-a-uuid"}, {"metadata": {"is_visually_hidden_from_conversation": True}},
                   {"content": {"content_type": "text", "parts": [EXPECTED + " changed"]}}]
        for change in changes:
            body = copy.deepcopy(self.body); body["messages"][0].update(change)
            self.assert_invalid(lambda: self.run_reader(body=body))
        for field in ("channel", "end_turn"):
            body = copy.deepcopy(self.body); del body["messages"][0][field]
            self.assert_invalid(lambda: self.run_reader(body=body))
        body = copy.deepcopy(self.body); body["messages"].insert(1, message("user", OTHER, "new user task", 1000.5))
        self.assert_invalid(lambda: self.run_reader(body=body))
        body = copy.deepcopy(self.body); body["messages"].insert(0, {**body["messages"][0], "id": OTHER})
        self.assert_invalid(lambda: self.run_reader(body=body))

    def test_final_requires_explicit_channel_end_turn_recipient_and_success(self):
        for change in ({"channel": None}, {"channel": "analysis"}, {"recipient": "tool"}, {"status": "in_progress"},
                       {"end_turn": False}, {"end_turn": 1}, {"metadata": {"is_visually_hidden_from_conversation": True}},
                       {"author": {"role": "tool"}}, {"id": "fake-id"}):
            body = copy.deepcopy(self.body); body["messages"][-1].update(change)
            self.assert_invalid(lambda: self.run_reader(body=body))

    def test_visibility_requires_metadata_object_and_actual_false_when_flag_present(self):
        for index in (0, 1):
            for metadata in (None, False, "visible", [], {"is_visually_hidden_from_conversation": "false"},
                             {"is_visually_hidden_from_conversation": 0}, {"is_visually_hidden_from_conversation": None},
                             {"is_visually_hidden_from_conversation": "true"}, {"is_visually_hidden_from_conversation": True}):
                body = copy.deepcopy(self.body); body["messages"][index]["metadata"] = metadata
                self.assert_invalid(lambda: self.run_reader(body=body))
            body = copy.deepcopy(self.body); del body["messages"][index]["metadata"]
            self.assert_invalid(lambda: self.run_reader(body=body))
            body = copy.deepcopy(self.body); body["messages"][index]["metadata"] = {"is_visually_hidden_from_conversation": False}
            self.assertTrue(self.run_reader(body=body)["assistantFound"])

    def test_single_string_part_is_required_for_final(self):
        for content in ({"content_type": "text", "parts": [TEXT, "extra"]}, {"content_type": "text", "parts": [{"text": TEXT}]},
                        {"content_type": "image", "parts": [TEXT]}, {"content_type": "text", "parts": []}):
            body = copy.deepcopy(self.body); body["messages"][-1]["content"] = content
            self.assert_invalid(lambda: self.run_reader(body=body))

    def test_ack_must_occur_once_in_one_final(self):
        for text in (TEXT.replace(ACK, "no ack"), TEXT + ACK):
            body = copy.deepcopy(self.body); body["messages"][-1]["content"]["parts"] = [text]
            self.assert_invalid(lambda: self.run_reader(body=body))
        body = copy.deepcopy(self.body); body["messages"].insert(1, message("assistant", OTHER, TEXT, 1000.5))
        self.assert_invalid(lambda: self.run_reader(body=body))

    def test_final_must_follow_user_and_be_the_actual_last_current_node(self):
        body = copy.deepcopy(self.body); body["messages"].reverse()
        self.assert_invalid(lambda: self.run_reader(body=body))
        body = copy.deepcopy(self.body); body["messages"].append(message("assistant", OTHER, "different final", 1002))
        self.assert_invalid(lambda: self.run_reader(body=body))

    def test_timestamps_are_finite_ordered_and_strictly_not_older_than_send(self):
        for value in (True, None, "1001", float("inf"), -1, 10 ** 1000):
            self.assert_invalid(lambda: self.run_reader(not_before=value))
        self.assert_invalid(lambda: self.run_reader(not_before=1000.034), "NATIVE_USER_STALE")
        for index, value in ((0, 999.999), (0, None), (0, True), (1, 1000.032), (1, float("nan"))):
            body = copy.deepcopy(self.body); body["messages"][index]["create_time"] = value
            self.assert_invalid(lambda: self.run_reader(body=body))

    def test_capture_timestamp_bounds_future_messages_without_clock_tolerance(self):
        for value in (True, None, "later", float("inf"), float("nan"), 10 ** 1000, 999.9):
            self.assert_invalid(lambda: self.run_reader(captured_at=value))
        self.assert_invalid(lambda: self.run_reader(captured_at=1000.999999), "NATIVE_FINAL_TIME_INVALID")
        self.assertTrue(self.run_reader(captured_at=1001.0)["assistantFound"])
        self.assertTrue(self.run_reader(captured_at="1970-01-01T00:16:41.0000000Z")["assistantFound"])
        body = copy.deepcopy(self.body); body["messages"][0]["create_time"] = 1002.1; body["messages"][1]["create_time"] = 1002.2
        self.assert_invalid(lambda: self.run_reader(body=body), "NATIVE_FINAL_TIME_INVALID")

    def test_visible_user_and_additional_ack_are_both_required(self):
        for snapshot in (EXPECTED, ACK, EXPECTED + "\n" + TEXT + '\n- button "Stop generating" [ref=e1]',
                         EXPECTED + "\n" + TEXT + "\n" + EXPECTED, "snapshot changed"):
            self.assert_invalid(lambda: self.run_reader(visible_snapshot=snapshot))
        self.assert_invalid(lambda: self.run_reader(expected_user_text=EXPECTED + " " + WAKE))

    def test_utf16_limit_and_invalid_surrogates_preserve_exact_hash_semantics(self):
        for prefix, accepted in (("x" * (4000 - len(ACK)), True), ("x" * (4001 - len(ACK)), False),
                                 ("😀" * 2000, False), ("\ud800", False)):
            body = copy.deepcopy(self.body); body["messages"][-1]["content"]["parts"] = [prefix + ACK]
            if accepted:
                result = self.run_reader(body=body)
                self.assertEqual(result["assistantResponseHash"], hashlib.sha256((prefix + ACK).encode()).hexdigest())
            else:
                self.assert_invalid(lambda: self.run_reader(body=body))

    def test_analysis_and_arbitrary_metadata_never_become_output(self):
        hidden = message("assistant", OTHER, SECRET_FIXTURE + ACK, 1000.5)
        hidden["channel"] = "analysis"
        body = copy.deepcopy(self.body); body["messages"].insert(1, hidden)
        body["messages"][-1]["metadata"] = {"untrusted_reasoning": SECRET_FIXTURE}
        result = self.run_reader(body=body)
        self.assertEqual(result["assistantText"], TEXT)
        self.assertNotIn(SECRET_FIXTURE, json.dumps(result))


if __name__ == "__main__":
    unittest.main()
