"""DEV-only quarantine verifier; never authorizes native provider execution."""
import datetime
import hashlib
import json
import math
from pathlib import Path

BASE_HASH = "9DB41F161FC8261B187D23103AE63D8B3B8D15AC4E91DD2F6B086F71B32B4D74"
HISTORICAL = (15, 17, 18)
LAST_429 = datetime.datetime.fromisoformat("2026-11-05T17:10:15.669643+00:00").timestamp()
UPPER = datetime.datetime.fromisoformat("2026-11-03T20:34:38.170868+00:00").timestamp()
DAY = 86400

def quarantine_check(raw, manifest, now, extra_excluded_rows=()):
    fail = lambda reason: dict(valid=False, reason=reason, worker_resume_authorized=False)
    if not isinstance(raw, str) or not isinstance(manifest, dict) or not math.isfinite(now):
        return fail("INPUT_INVALID")
    expected = {
        "recordType": "GPT02_DEV_HISTORICAL_429_QUARANTINE_MANIFEST",
        "sourceLog": "native-response-metadata.jsonl",
        "sourceSha256": BASE_HASH,
        "preservedInPlace": True, "historicalCount": 3,
        "historicalRows": list(HISTORICAL),
        "historicalUpperBoundUtc": "2026-11-03T20:34:38.170868Z",
        "boundType": "CONDITIONAL_APPEND_ORDER_NOT_PROVIDER_ATTESTATION",
        "verdict": "STAGED_NOT_RELEASED",
        "mayOverrideNativeGate": False, "mayRestartModel": False, "mayAck": False,
    }
    if any(type(manifest.get(k)) is not type(v) or manifest.get(k) != v for k, v in expected.items()):
        return fail("MANIFEST_INVALID")
    lines = raw.rstrip().splitlines()
    if not 27 <= len(lines) <= 10000:
        return fail("ROW_COUNT_INVALID")
    first = lines[:27]
    candidates = (sep.join(first) + tail for sep in ("\n", "\r\n") for tail in ("", sep))
    if not any(hashlib.sha256(s.encode()).hexdigest().upper() == BASE_HASH for s in candidates):
        return fail("SOURCE_PREFIX_HASH_MISMATCH")
    try:
        rows = []
        for line in lines:
            def unique(pairs):
                result = {}
                for k, v in pairs:
                    if k in result: raise ValueError("duplicate key")
                    result[k] = v
                return result
            rows.append(json.loads(line, object_pairs_hook=unique))
        if any(rows[i-1].get("responseStatus") != 429 or rows[i-1].get("capturedAtUtc") for i in HISTORICAL):
            return fail("QUARANTINE_ROW_MISMATCH")
        upper_row = datetime.datetime.fromisoformat(rows[18]["capturedAtUtc"].replace("Z","+00:00")).timestamp()
        if upper_row != UPPER: return fail("UPPER_BOUND_ROW_MISMATCH")
        if now < UPPER + DAY: return fail("HISTORICAL_WINDOW_NOT_AGED")
        if now < LAST_429 + DAY: return fail("LATEST_429_24H_WINDOW_ACTIVE")
        observed_429=[]
        excluded_new=set(HISTORICAL)|set(extra_excluded_rows)
        for i, row in enumerate(rows, 1):
            if row.get("responseStatus") != 429 or i in excluded_new: continue
            stamp = datetime.datetime.fromisoformat(row["capturedAtUtc"].replace("Z","+00:00"))
            if stamp.utcoffset() is None: return fail("NEW_429_TIMESTAMP_INVALID")
            seconds = stamp.timestamp()
            if seconds > now: return fail("NEW_429_TIMESTAMP_INVALID")
            observed_429.append((seconds, row))
        recent = [(t, row) for t, row in observed_429 if now-t < DAY]
        if len(recent) >= 2: return fail("RECENT_REPEAT_429")
        if recent:
            seconds, row = recent[0]
            retry_after = row.get("retryAfterSeconds")
            if isinstance(retry_after, bool) or not isinstance(retry_after, (int, float)) or not math.isfinite(retry_after) or retry_after < 0:
                cooldown_seconds = 3600
            else:
                cooldown_seconds = min(3600, max(1, float(retry_after) + 5))
            if now-seconds < cooldown_seconds: return fail("RECENT_429_COOLDOWN")
    except (ValueError, TypeError, KeyError, AttributeError):
        return fail("JSON_OR_TIMESTAMP_INVALID")
    return dict(valid=True, reason="LEGACY_QUARANTINE_AGED_CONDITIONALLY",
                excluded_rows=list(HISTORICAL), provider_clearance=False,
                worker_resume_authorized=False)

def evaluate_files(root, now):
    try:
        base=Path(root)
        raw=(base/"native-response-metadata.jsonl").read_text(encoding="utf8")
        manifest=json.loads((base/"gpt02-dev-legacy429-quarantine-manifest-20261106.json").read_text(encoding="utf-8-sig"))
        # Former test-row quarantine was intentionally removed. Preserve all 429
        # incidents in Python's conservative rate gate; no unverified exclusions.
        return quarantine_check(raw, manifest, now)
    except (OSError, ValueError):
        return dict(valid=False, reason="FILE_MISSING_OR_INVALID", worker_resume_authorized=False)
