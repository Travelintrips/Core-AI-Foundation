"""Pure, bounded DEV-only readiness evidence classifier.

Does NOT inspect browser/network, navigate, retry, issue, dispatch or grant ACK.
Only fixed boolean/count fields are returned; no transcript or marker bytes.
The authoritative native final verifier remains mandatory and unchanged.
"""
import re

MAX_SNAPSHOT = 200_000
MAX_USER = 4_096
STOP = re.compile(r'\bbutton\s+"Stop(?: generating)?"', re.IGNORECASE)


def classify_visible_readiness(snapshot, expected_user_text, event_id, challenge):
    # Never expose raw inputs in errors, logs or results.
    denied = {"readyForReader": False, "nativeFinalVerified": False,
              "mayReplay": False, "mayDispatch": False, "mayCloseJob": False}
    if (type(snapshot) is not str or type(expected_user_text) is not str or
            len(snapshot) > MAX_SNAPSHOT or len(expected_user_text) > MAX_USER or
            type(event_id) is not str or type(challenge) is not str or
            not re.fullmatch(r"[0-9a-f]{64}", event_id) or
            not re.fullmatch(r"[0-9a-f]{64}", challenge)):
        return {**denied, "reason": "READINESS_INPUT_INVALID"}
    wake = "[AI_CORE_WAKE:" + event_id + "]"
    attest = "[AI_CORE_ATTEST:" + challenge + "]"
    ack = "[AI_CORE_ATTEST_ACK:" + challenge + "]"
    if (expected_user_text.count(wake) != 1 or
            expected_user_text.count(attest) != 1 or
            expected_user_text.count(ack) != 1):
        return {**denied, "reason": "EXPECTED_USER_MARKERS_INVALID"}
    # Current live readiness sees body.innerText and a synthesized Stop button.
    # Do not treat Stop absence as proof of completion or ACK.
    stop = bool(STOP.search(snapshot))
    user_count = snapshot.count(expected_user_text)
    wake_count = snapshot.count(wake)
    attest_count = snapshot.count(attest)
    ack_count = snapshot.count(ack)
    counts = {"userOccurrences": min(user_count, 2), "wakeOccurrences": min(wake_count, 2),
              "attestOccurrences": min(attest_count, 2), "ackOccurrences": min(ack_count, 3),
              "stopVisible": stop}
    if stop:
        reason = "UI_STILL_RESPONDING"
    elif user_count != 1:
        reason = "USER_NOT_UNIQUELY_VISIBLE"
    elif wake_count != 1 or attest_count != 1:
        reason = "WAKE_ATTEST_NOT_UNIQUE"
    elif ack_count == 1:
        reason = "ONLY_USER_PROMPT_ACK_VISIBLE"
    elif ack_count == 0:
        reason = "ACK_NOT_VISIBLE"
    else:
        reason = "READY_FOR_AUTHORITATIVE_READER_ONLY"
    return {**denied, "readyForReader": reason == "READY_FOR_AUTHORITATIVE_READER_ONLY",
            "reason": reason, "counts": counts}
