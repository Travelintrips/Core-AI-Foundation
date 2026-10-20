"""Pure validators for an observed OpenClaw conversation response.

No browser, network, operating-system, key, or logging operations occur here.
Only user text and explicit final assistant text may become evidence. Unknown
schemas fail closed; this module does not discover endpoints or synthesize IDs.
"""

from datetime import datetime, timezone
import hashlib
import json
import math
import re
from urllib.parse import parse_qsl, urlsplit


MAX_BODY_UNITS = 200_000
MAX_MESSAGES = 1000
MAX_SNAPSHOT_UNITS = 200_000
UUID = re.compile(r"[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}")
DIGEST = re.compile(r"[0-9a-f]{64}")
UTC_TIME = re.compile(r"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.([0-9]{1,9}))?Z")
STOP_CONTROL = re.compile(r'\bbutton\s+"Stop(?: generating)?"', re.IGNORECASE)


class NativeReaderError(ValueError):
    """A fixed diagnostic code, never a copy of transcript or transport data."""


def _require(condition, code):
    if not condition:
        raise NativeReaderError(code)


def _units(text, maximum, code):
    _require(isinstance(text, str) and len(text) <= maximum, code)
    try:
        size = len(text.encode("utf-16-le")) // 2
    except UnicodeError:
        raise NativeReaderError(code) from None
    _require(size <= maximum, code)
    return size


def _timestamp(value, *, allow_utc=False):
    if allow_utc and isinstance(value, str):
        match = UTC_TIME.fullmatch(value)
        _require(match is not None, "NATIVE_TIMESTAMP_INVALID")
        try:
            seconds = datetime.strptime(match.group(1), "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc).timestamp()
            value = seconds + (float("0." + match.group(2)) if match.group(2) else 0)
        except (ValueError, OverflowError, OSError):
            raise NativeReaderError("NATIVE_TIMESTAMP_INVALID") from None
    _require(type(value) in (int, float), "NATIVE_TIMESTAMP_INVALID")
    _require(0 <= value < 253402300800 and math.isfinite(value), "NATIVE_TIMESTAMP_INVALID")
    return value


def _context(envelope, *, page_url, raw_target_id, conversation_id):
    _require(isinstance(conversation_id, str) and UUID.fullmatch(conversation_id), "NATIVE_CONVERSATION_INVALID")
    _require(page_url == "https://chatgpt.com/c/" + conversation_id, "NATIVE_PAGE_INVALID")
    _require(isinstance(raw_target_id, str) and re.fullmatch(r"[A-Fa-f0-9]{32}", raw_target_id),
             "NATIVE_TARGET_INVALID")
    _require(type(envelope) is dict and envelope.get("ok") is True, "NATIVE_ENVELOPE_INVALID")
    _require(envelope.get("targetId") == raw_target_id and envelope.get("url") == page_url,
             "NATIVE_PAIRING_MISMATCH")


def _observed_url(value, conversation_id):
    _require(isinstance(value, str) and 0 < len(value) <= 2048 and value.isascii() and
             not re.search(r"\s", value), "NATIVE_REQUEST_URL_INVALID")
    try:
        parsed = urlsplit(value)
        pairs = parse_qsl(parsed.query, keep_blank_values=True, strict_parsing=True)
    except ValueError:
        raise NativeReaderError("NATIVE_REQUEST_URL_INVALID") from None
    _require(parsed.scheme == "https" and parsed.netloc == "chatgpt.com" and
             parsed.path == "/backend-api/conversations/" + conversation_id and not parsed.fragment,
             "NATIVE_REQUEST_URL_INVALID")
    # These are the two query fields actually observed by the authorized root.
    # Preserve their original order/value; never construct a replacement URL.
    _require(len(pairs) == 2 and {key for key, _ in pairs} == {"num_turns", "include_has_versions"} and
             "&".join(key + "=" + item for key, item in pairs) == parsed.query,
             "NATIVE_REQUEST_QUERY_INVALID")
    query = dict(pairs)
    _require(re.fullmatch(r"[1-9][0-9]{0,3}", query["num_turns"]) is not None and
             int(query["num_turns"]) <= 1000 and query["include_has_versions"] in ("true", "false"),
             "NATIVE_REQUEST_QUERY_INVALID")
    return value


def select_observed_request(envelope, *, page_url, raw_target_id, conversation_id):
    """Select one URL already observed on the exact tab; differing URLs reject."""
    _context(envelope, page_url=page_url, raw_target_id=raw_target_id, conversation_id=conversation_id)
    rows = envelope.get("requests")
    _require(isinstance(rows, list) and len(rows) <= MAX_MESSAGES, "NATIVE_REQUESTS_INVALID")
    urls = set()
    for row in rows:
        if type(row) is not dict or row.get("method") != "GET" or type(row.get("status")) is not int or row["status"] != 200:
            continue
        if "ok" in row and row["ok"] is not True:
            continue
        try:
            url = _observed_url(row.get("url"), conversation_id)
            _timestamp(row.get("timestamp"), allow_utc=True)
        except NativeReaderError:
            continue
        urls.add(url)
    _require(len(urls) == 1, "NATIVE_OBSERVED_REQUEST_MISSING_OR_AMBIGUOUS")
    return next(iter(urls))


def _json_object(pairs):
    result = {}
    for key, value in pairs:
        _require(key not in result, "NATIVE_BODY_JSON_INVALID")
        result[key] = value
    return result


def _reject_json_constant(_value):
    raise NativeReaderError("NATIVE_BODY_JSON_INVALID")


def _single_text(message):
    content = message.get("content")
    if type(content) is not dict or content.get("content_type") != "text":
        return None
    parts = content.get("parts")
    if not isinstance(parts, list) or len(parts) != 1 or not isinstance(parts[0], str):
        return None
    return parts[0]


def _role(message):
    author = message.get("author")
    return author.get("role") if type(author) is dict else None


def _visible(message):
    # Inspect this boolean flag only, never arbitrary metadata text or reasoning.
    # Missing/null metadata has not been adopted as a verified visible schema.
    metadata = message.get("metadata")
    return type(metadata) is dict and ("is_visually_hidden_from_conversation" not in metadata or
                                      metadata["is_visually_hidden_from_conversation"] is False)


def validate_native_response(envelope, *, page_url, request_url, raw_target_id,
                             conversation_id, event_id, challenge, visible_snapshot,
                             expected_user_text, not_before, captured_at):
    """Return correlated visible FINAL evidence; no signing or E2E status claim.

    not_before is the durable pre-send time; captured_at is observed after capture.
    Both accept finite epoch seconds or a strict UTC RFC3339 Z time.
    There is deliberately no clock-skew tolerance and no whitespace trimming.
    """
    _context(envelope, page_url=page_url, raw_target_id=raw_target_id, conversation_id=conversation_id)
    _observed_url(request_url, conversation_id)
    _require(isinstance(event_id, str) and DIGEST.fullmatch(event_id) and
             isinstance(challenge, str) and DIGEST.fullmatch(challenge), "NATIVE_MARKER_CONTEXT_INVALID")
    lower_bound = _timestamp(not_before, allow_utc=True)
    upper_bound = _timestamp(captured_at, allow_utc=True)
    _require(lower_bound <= upper_bound, "NATIVE_CAPTURE_TIME_INVALID")
    wake_token = "[AI_CORE_WAKE:" + event_id + "]"
    attest_token = "[AI_CORE_ATTEST:" + challenge + "]"
    ack_token = "[AI_CORE_ATTEST_ACK:" + challenge + "]"
    _units(expected_user_text, 4096, "NATIVE_EXPECTED_USER_INVALID")
    _require(all(expected_user_text.count(token) == 1 for token in (wake_token, attest_token, ack_token)),
             "NATIVE_EXPECTED_USER_INVALID")
    _units(visible_snapshot, MAX_SNAPSHOT_UNITS, "NATIVE_SNAPSHOT_INVALID")
    _require(not STOP_CONTROL.search(visible_snapshot), "NATIVE_ASSISTANT_RESPONDING")
    # The user's instruction itself names the ACK. Its sole occurrence cannot
    # establish an assistant-visible reply; require another visible occurrence.
    _require(visible_snapshot.count(expected_user_text) == 1 and
             visible_snapshot.count(wake_token) == 1 and visible_snapshot.count(attest_token) == 1 and
             visible_snapshot.count(ack_token) >= 2, "NATIVE_VISIBLE_CORRELATION_MISSING")
    response = envelope.get("response")
    _require(type(response) is dict and response.get("url") == request_url and
             type(response.get("status")) is int and response["status"] == 200 and
             response.get("truncated", False) is False, "NATIVE_RESPONSE_INVALID")
    raw_body = response.get("body")
    _units(raw_body, MAX_BODY_UNITS, "NATIVE_BODY_SIZE_INVALID")
    try:
        body = json.loads(raw_body, object_pairs_hook=_json_object, parse_constant=_reject_json_constant)
    except (ValueError, RecursionError):
        raise NativeReaderError("NATIVE_BODY_JSON_INVALID") from None
    _require(type(body) is dict and body.get("conversation_id") == conversation_id, "NATIVE_BODY_CONVERSATION_MISMATCH")
    messages = body.get("messages")
    current = body.get("current_node")
    _require(isinstance(messages, list) and 0 < len(messages) <= MAX_MESSAGES and
             all(type(message) is dict for message in messages), "NATIVE_MESSAGES_INVALID")
    _require(isinstance(current, str) and UUID.fullmatch(current) and current != conversation_id and
             sum(message.get("id") == current for message in messages) == 1, "NATIVE_CURRENT_NODE_INVALID")
    users, matching_users, matching_finals = [], [], []
    user_wakes = user_attests = 0
    for index, message in enumerate(messages):
        role = _role(message)
        if role == "user":
            users.append(index)
            text = _single_text(message)
            if text is not None:
                user_wakes += text.count(wake_token)
                user_attests += text.count(attest_token)
                if text == expected_user_text:
                    matching_users.append((index, message))
        elif role == "assistant" and message.get("channel") == "final":
            text = _single_text(message)
            if text is not None and ack_token in text:
                matching_finals.append((index, message, text))
        # Never inspect analysis, system/tool text, or arbitrary metadata.
    _require(len(matching_users) == 1 and user_wakes == 1 and user_attests == 1,
             "NATIVE_USER_MISSING_OR_AMBIGUOUS")
    user_index, user = matching_users[0]
    _require(users[-1] == user_index and "channel" in user and user["channel"] is None and
             user.get("recipient") == "all" and user.get("status") == "finished_successfully" and
             "end_turn" in user and user["end_turn"] is None and _visible(user), "NATIVE_LATEST_USER_INVALID")
    user_id = user.get("id")
    _require(isinstance(user_id, str) and UUID.fullmatch(user_id) and user_id not in (current, conversation_id) and
             sum(message.get("id") == user_id for message in messages) == 1, "NATIVE_USER_ID_INVALID")
    user_time = _timestamp(user.get("create_time"))
    _require(user_time >= lower_bound, "NATIVE_USER_STALE")
    _require(len(matching_finals) == 1, "NATIVE_FINAL_MISSING_OR_AMBIGUOUS")
    final_index, final, final_text = matching_finals[0]
    _require(final.get("id") == current and final_index == len(messages) - 1 and final_index > user_index,
             "NATIVE_FINAL_NOT_CURRENT")
    _require(final.get("recipient") == "all" and final.get("status") == "finished_successfully" and
             final.get("end_turn") is True and _visible(final), "NATIVE_FINAL_INCOMPLETE_OR_HIDDEN")
    final_time = _timestamp(final.get("create_time"))
    _require(lower_bound <= user_time <= final_time <= upper_bound, "NATIVE_FINAL_TIME_INVALID")
    _units(final_text, 4000, "NATIVE_FINAL_TEXT_INVALID")
    _require(final_text.count(ack_token) == 1, "NATIVE_FINAL_ACK_INVALID")
    return {
        "userFound": True, "assistantFound": True, "ackVisible": True, "responding": False,
        "assistantMessageId": current, "assistantText": final_text,
        "assistantResponseHash": hashlib.sha256(final_text.encode("utf-8")).hexdigest(),
        "userMessageId": user_id,
    }
