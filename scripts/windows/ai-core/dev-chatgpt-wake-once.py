"""DEV-only, model-free ChatGPT wake sender with signed assistant attestation."""
import base64
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

PATTERN_V1 = re.compile(
    r"\ADEV_CHATGPT_WAKE_V1 conversation=([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}) "
    r"event=([0-9a-f]{64}) challenge=([0-9a-f]{64})\Z", re.I)
PATTERN_V2 = re.compile(
    r"\ADEV_CHATGPT_WAKE_V2 conversation=([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}) "
    r"event=([0-9a-f]{64}) challenge=([0-9a-f]{64}) task=([A-Za-z0-9_-]{1,4096})\Z", re.I)
BROWSER_PROFILE = os.environ.get("AI_CORE_DEV_WAKE_BROWSER_PROFILE", "chrome")
CLI = [os.environ.get("AI_CORE_OPENCLAW_CMD", "openclaw.cmd" if os.name == "nt" else "openclaw"), "browser", "--browser-profile", BROWSER_PROFILE]
WORKER = os.environ.get("AI_CORE_DEV_WAKE_WORKER_ID", "openclaw-travelintrips-dev")
KEY_ID = os.environ.get("AI_CORE_DEV_WAKE_KEY_ID", "openclaw-travelintrips-dev-ed25519-v1")
ALLOWLIST_FILE = os.environ.get("AI_CORE_DEV_WAKE_ALLOWLIST_FILE", "chatgpt-wake-dev-allowlist.json")
PRIVATE_KEY_FILE = os.environ.get("AI_CORE_DEV_WAKE_PRIVATE_KEY_FILE", "dev-assistant-attestation-ed25519.pem")
DELL_WORKER = "openclaw-dell-chatgpt-wake-dev"
UUID = re.compile(r"[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}")
DIGEST = re.compile(r"[a-f0-9]{64}")
OWNER = re.compile(r"ai-engine-oauth:[a-f0-9]{64}")
PROFILE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}")
ALIAS = re.compile(r"GPT[0-9]{2,4}")


def _matches(pattern, value):
    return isinstance(value, str) and pattern.fullmatch(value) is not None


def binding_fingerprint(binding):
    return hashlib.sha256("|".join([
        "dev-chatgpt-wake-binding/v1", binding["accountAlias"], binding["ownerChannel"],
        binding["targetConversationId"], binding["workerId"], binding["browserProfile"],
    ]).encode("utf-8")).hexdigest()


def _valid_binding(value):
    return (isinstance(value, dict) and value.get("version") == 1 and
            type(value.get("version")) is int and _matches(ALIAS, value.get("accountAlias")) and
            _matches(OWNER, value.get("ownerChannel")) and _matches(UUID, value.get("targetConversationId")) and
            value.get("workerId") == DELL_WORKER and _matches(PROFILE, value.get("browserProfile")) and
            ("bindingFingerprint" not in value or value["bindingFingerprint"] == binding_fingerprint(value)))


def local_bindings(data):
    if not isinstance(data, dict) or data.get("enabled") is not True or not isinstance(data.get("bindings", []), list):
        raise RuntimeError("DEV wake pairing disabled or malformed")
    entries = []
    singular_legacy, plural_legacy = "legacyBinding" in data, "legacyBindings" in data
    if singular_legacy and plural_legacy:
        raise RuntimeError("Ambiguous GPT01 legacy registry")
    legacy_entries = [data["legacyBinding"]] if singular_legacy else data.get("legacyBindings", [])
    if not isinstance(legacy_entries, list) or (plural_legacy and not legacy_entries):
        raise RuntimeError("Explicit GPT01 legacy pairing required")
    for legacy in legacy_entries:
        if (not _valid_binding(legacy) or type(legacy.get("enabled")) is not bool or
                legacy["accountAlias"] != "GPT01" or legacy["browserProfile"] != "openclaw" or
                data.get("allowedConversationIds") != [legacy["targetConversationId"]]):
            raise RuntimeError("Explicit GPT01 legacy pairing required")
        entries.append({**legacy, "legacy": True})
    for value in data.get("bindings", []):
        if not _valid_binding(value) or type(value.get("enabled")) is not bool or value["accountAlias"] == "GPT01":
            raise RuntimeError("Invalid additional DEV wake binding")
        entries.append({**value, "legacy": False})
    # Multiple explicit owners can share only the single legacy destination.
    # Additional accounts remain distinct from every legacy owner and profile.
    destinations = [entry for entry in entries if entry["legacy"]][:1] + [entry for entry in entries if not entry["legacy"]]
    for field in ("accountAlias", "ownerChannel", "targetConversationId", "browserProfile"):
        checked = entries if field == "ownerChannel" else destinations
        values = [entry[field].lower() if field == "browserProfile" else entry[field] for entry in checked]
        if len(set(values)) != len(values):
            raise RuntimeError("Conflicting DEV wake bindings")
    return entries


def assistant_challenge(metadata, fingerprint=None):
    watch, job, revision = (metadata.get("watchCommandId"), metadata.get("jobId"), metadata.get("checkpointRevision"))
    has_watch = any(key in metadata for key in ("watchCommandId", "jobId", "checkpointRevision"))
    if (not _matches(OWNER, metadata.get("conversationId")) or not _matches(UUID, metadata.get("targetConversationId")) or
            not _matches(DIGEST, metadata.get("eventId")) or (has_watch and
            (not isinstance(watch, str) or not _matches(UUID, watch.lower()) or
             not isinstance(job, str) or not _matches(UUID, job.lower()) or type(revision) is not int or
             not 1 <= revision <= 9007199254740991))):
        raise RuntimeError("Invalid DEV wake challenge context")
    fields = [
        "dev-chatgpt-assistant-attestation/v" + ("2" if fingerprint else "1"),
        metadata["conversationId"], metadata["targetConversationId"], metadata["eventId"],
        watch.lower() if watch else "", job.lower() if job else "", "" if revision is None else str(revision),
    ]
    if fingerprint:
        fields.append(fingerprint)
    return hashlib.sha256("|".join(fields).encode("utf-8")).hexdigest()


def resolve_dell_binding(metadata, data, conversation, event, challenge):
    if (not isinstance(metadata, dict) or metadata.get("assignedClientId") != DELL_WORKER or
            metadata.get("targetConversationId") != conversation or metadata.get("eventId") != event or
            metadata.get("assistantAttestationChallenge") != challenge or metadata.get("capability") != "chatgpt:wake" or
            metadata.get("explicitWorkerTarget") is not True or metadata.get("devOnly") is not True or
            metadata.get("source") != "authorized-dev-browser-wake" or not _matches(OWNER, metadata.get("conversationId"))):
        raise RuntimeError("Wake binding mismatch")
    entries = local_bindings(data)
    bound = "wakeBinding" in metadata
    binding = metadata.get("wakeBinding")
    if bound:
        if (not _valid_binding(binding) or not _matches(DIGEST, binding.get("bindingFingerprint")) or
                binding["accountAlias"] == "GPT01" or binding["ownerChannel"] != metadata["conversationId"] or
                binding["targetConversationId"] != conversation):
            raise RuntimeError("Invalid command wake binding")
        selected = next((entry for entry in entries if not entry["legacy"] and entry["enabled"] and
                         all(entry[field] == binding[field] for field in
                             ("accountAlias", "ownerChannel", "targetConversationId", "workerId", "browserProfile"))), None)
    else:
        selected = next((entry for entry in entries if entry["legacy"] and entry["enabled"] and
                         entry["ownerChannel"] == metadata["conversationId"] and entry["targetConversationId"] == conversation), None)
    if selected is None:
        raise RuntimeError("Exact local DEV wake binding not enabled")
    if selected["browserProfile"] != BROWSER_PROFILE:
        raise RuntimeError("Selected browser profile does not match local binding")
    if assistant_challenge(metadata, binding["bindingFingerprint"] if bound else None) != challenge:
        raise RuntimeError("Wake challenge does not match binding")
    return binding if bound else None


def browser(*args, timeout=55):
    read_only = bool(args) and args[0] in {"tabs", "snapshot", "evaluate"}
    attempts = 3 if read_only else 1
    last_error = None
    for attempt in range(attempts):
        try:
            result = subprocess.run(CLI + list(args), capture_output=True, text=True, shell=False, timeout=timeout)
        except subprocess.TimeoutExpired as err:
            last_error = err
            if attempt + 1 < attempts:
                time.sleep(2)
                continue
            raise
        if result.returncode == 0:
            return result.stdout
        last_error = RuntimeError("Browser controller failed (" + args[0] + ")")
        if attempt + 1 < attempts:
            time.sleep(2)
            continue
    raise last_error or RuntimeError("Browser controller failed")


def config(base=None):
    root = Path(base or (Path(os.environ["LOCALAPPDATA"]) / "AI-Core"))
    p = root / ALLOWLIST_FILE
    data = json.loads(p.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or data.get("enabled") is not True:
        raise RuntimeError("DEV ChatGPT wake pairing disabled")
    return root, data


def find_tab(url):
    value = json.loads(browser("tabs", "--json"))
    matching = [t for t in value.get("tabs", []) if t.get("type") == "page" and t.get("url") == url]
    if len(matching) != 1:
        raise RuntimeError("Expected exactly one paired ChatGPT browser tab")
    stable = matching[0].get("suggestedTargetId") or matching[0].get("tabId")
    if not stable:
        raise RuntimeError("Paired ChatGPT tab has no stable OpenClaw handle")
    return stable


def inspect(tab, marker, expected_url):
    # Stable OpenClaw handles are resolved from the exact allowlisted URL.
    # A snapshot may omit the composer value. Omission and a placeholder are
    # unknown state, never proof that the draft is empty.
    if find_tab(expected_url) != tab:
        raise RuntimeError("Exact authenticated browser pairing cannot be verified")
    snapshot = browser("snapshot", "--target-id", tab, timeout=55)
    # Match an exact accessibility role/name, never arbitrary textboxes or a
    # mention of a composer inside conversation text. Both locales share the
    # same pairing and draft checks; ambiguous rows cannot select a first match.
    composers = re.findall(r'^[ \t]*- textbox "(?:Ask ChatGPT|Tanya ChatGPT)"([^\r\n]*)$', snapshot, re.M)
    if not composers:
        raise RuntimeError("Authenticated ChatGPT composer not available")
    if len(composers) != 1:
        raise RuntimeError("Authenticated ChatGPT composer is ambiguous")
    m = re.fullmatch(r'(?: \[(?!ref=)[^\]\r\n]+\])* \[ref=((?:f\d+)?e\d+)\](?: value=("(?:[^"\\]|\\.)*"))?:?', composers[0])
    if not m:
        raise RuntimeError("ChatGPT composer state cannot be verified")
    raw_draft = m.group(2)
    if raw_draft is not None:
        try:
            draft = json.loads(raw_draft)
        except ValueError:
            raise RuntimeError("ChatGPT composer draft cannot be verified") from None
    else:
        raise RuntimeError("ChatGPT composer draft value is unavailable")
    if not isinstance(draft, str):
        raise RuntimeError("ChatGPT composer state invalid")
    responding = bool(re.search(r'button "Stop(?: generating)?"', snapshot, re.I))
    return {"ref": m.group(1), "empty": draft == "",
            "responding": responding, "markerVisible": marker in snapshot}

def _iso_now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _private_key(root):
    path = root / PRIVATE_KEY_FILE
    if not path.is_file():
        return None
    key = serialization.load_pem_private_key(path.read_bytes(), password=None)
    if not isinstance(key, Ed25519PrivateKey):
        raise RuntimeError("DEV assistant attestation key type invalid")
    return key


def _assistant_probe(tab, expected_url, marker, challenge):
    ack = "AI_CORE_ATTEST_ACK:" + challenge
    snapshot = browser("snapshot", "--target-id", tab, timeout=55)
    responding = bool(re.search(r'button "Stop(?: generating)?"', snapshot, re.I))
    user_found = marker in snapshot and ("AI_CORE_ATTEST:" + challenge) in snapshot
    ack_visible = ack in snapshot
    if not user_found or not ack_visible:
        return {"url": expected_url, "responding": responding,
                "userFound": user_found, "assistantFound": False,
                "ackVisible": ack_visible}
    fn = (
        "() => { const ack=" + json.dumps(ack) + "; "
        "const units=Array.from(document.querySelectorAll('[data-chatgpt-search-unit-key]')); "
        "const assistant=units.find(e=>{const key=e.getAttribute('data-chatgpt-search-unit-key')||'';"
        "const text=e.innerText||'';return key.endsWith(':assistant')&&text.includes(ack);}); "
        "if(!assistant)return {url:location.href,found:false}; "
        "const selected=assistant.querySelector('[data-chatgpt-selection-message-id]'); "
        "const selectionId=selected?(selected.getAttribute('data-chatgpt-selection-message-id')||''):''; "
        "const ids=(assistant.getAttribute('data-chatgpt-search-message-ids')||'')+' '+selectionId; "
        "const textNode=assistant.querySelector('[data-markdown-text-style]'); "
        "const text=(textNode?textNode.innerText:(assistant.innerText||'')).trim(); "
        "return {url:location.href,found:true,ids:ids,text:text}; }"
    )
    value = json.loads(browser("evaluate", "--target-id", tab, "--fn", fn, timeout=45))
    if not isinstance(value, dict) or value.get("url") != expected_url:
        raise RuntimeError("Assistant attestation browser pairing lost")
    ids = str(value.get("ids") or "")
    id_match = re.search(r"[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}", ids, re.I)
    text = str(value.get("text") or "").strip()
    return {"url": expected_url, "responding": responding, "userFound": True,
            "assistantFound": bool(value.get("found") and id_match and text),
            "assistantMessageId": id_match.group(0).lower() if id_match else None,
            "assistantText": text, "ackVisible": ack_visible}

def _attestation_payload(conversation, event, challenge, message_id, response_hash, observed_at, binding=None):
    fields = [
        "dev-chatgpt-assistant-attestation/v" + ("2" if binding else "1"),
        "keyId=" + KEY_ID,
        "workerId=" + WORKER,
        "conversationId=" + conversation,
        "eventId=" + event,
        "challenge=" + challenge,
        "assistantMessageId=" + message_id,
        "assistantResponseHash=" + response_hash,
        "observedAt=" + observed_at,
    ]
    if binding:
        fields.extend(["bindingFingerprint=" + binding["bindingFingerprint"], "browserProfile=" + binding["browserProfile"]])
    return "\n".join(fields)


def wait_for_assistant_attestation(root, tab, expected_url, conversation, event, challenge, binding=None):
    key = _private_key(root)
    if key is None:
        return None
    marker = "AI_CORE_WAKE:" + event
    for _ in range(65):
        observed = _assistant_probe(tab, expected_url, marker, challenge)
        if observed.get("assistantFound") and observed.get("ackVisible") and not observed.get("responding"):
            message_id = str(observed["assistantMessageId"]).lower()
            text = str(observed["assistantText"])
            if not re.fullmatch(r"[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}", message_id, re.I) or not text:
                raise RuntimeError("Assistant response identity invalid")
            response_hash = hashlib.sha256(text.encode("utf-8")).hexdigest()
            observed_at = _iso_now()
            payload = _attestation_payload(conversation, event, challenge, message_id, response_hash, observed_at, binding)
            signature = base64.b64encode(key.sign(payload.encode("utf-8"))).decode("ascii")
            return {
                "version": 2 if binding else 1, "algorithm": "Ed25519", "keyId": KEY_ID, "workerId": WORKER,
                "conversationId": conversation, "eventId": event, "challenge": challenge,
                "assistantMessageId": message_id, "assistantResponseHash": response_hash,
                "assistantResponseText": text[:4000],
                "observedAt": observed_at, "signature": signature,
                **({"bindingFingerprint": binding["bindingFingerprint"], "browserProfile": binding["browserProfile"]} if binding else {}),
            }
        time.sleep(2)
    return None


def submit_once(instruction, worker_id, base=None, metadata=None):
    raw = str(instruction).strip()
    match = PATTERN_V2.fullmatch(raw)
    task_instruction = None
    if match:
        encoded = match.group(4)
        try:
            padding = "=" * ((4 - len(encoded) % 4) % 4)
            task_instruction = base64.urlsafe_b64decode(encoded + padding).decode("utf-8")
        except (ValueError, UnicodeDecodeError):
            raise RuntimeError("Invalid DEV wake task encoding") from None
        if not task_instruction or len(task_instruction) > 2000 or any(ord(ch) < 32 or ord(ch) == 127 for ch in task_instruction):
            raise RuntimeError("Invalid DEV wake task instruction")
    else:
        match = PATTERN_V1.fullmatch(raw)
    if not match or worker_id != WORKER:
        raise RuntimeError("Unauthorized DEV browser wake command or worker")
    conversation, event, challenge = (match.group(1).lower(), match.group(2).lower(), match.group(3).lower())
    root, data = config(base)
    binding = None
    if WORKER == DELL_WORKER:
        binding = resolve_dell_binding(metadata, data, conversation, event, challenge)
    else:
        # Preserve the original Travelintrips-only helper; DELL never falls back to this list.
        allowed = data.get("allowedConversationIds")
        if metadata is not None or not isinstance(allowed, list) or not all(
                isinstance(value, str) and re.fullmatch(r"[0-9a-f-]{36}", value, re.I) for value in allowed):
            raise RuntimeError("Invalid DEV wake pairing allowlist")
        if conversation not in {value.lower() for value in allowed}:
            raise RuntimeError("ChatGPT conversation is not paired/allowlisted")
    url = "https://chatgpt.com/c/" + conversation
    marker = "AI_CORE_WAKE:" + event
    tab = find_tab(url)
    state = inspect(tab, marker, url)
    if not state["empty"]:
        raise RuntimeError("ChatGPT has a draft; preserving it")
    if state["responding"]:
        raise RuntimeError("ChatGPT is still responding; cannot wake now")
    receipt_dir = root / "chatgpt-wake-dev-receipts"
    receipt_dir.mkdir(parents=True, exist_ok=True)
    receipt = receipt_dir / ((binding["bindingFingerprint"] + "-" if binding else "") + event + ".json")
    receipt_context = {"conversationId": conversation, "eventId": event, "challenge": challenge,
                       "browserProfile": BROWSER_PROFILE,
                       **({"bindingFingerprint": binding["bindingFingerprint"]} if binding else {})}
    if binding and receipt.exists():
        previous = json.loads(receipt.read_text(encoding="utf-8"))
        if not isinstance(previous, dict) or any(previous.get(key) != value for key, value in receipt_context.items()):
            raise RuntimeError("Wake event receipt context mismatch; reconciliation required")
    if state["markerVisible"]:
        # Reconcile an existing wake without submitting a duplicate message.
        attestation = wait_for_assistant_attestation(root, tab, url, conversation, event, challenge, binding)
        fingerprint = hashlib.sha256((conversation + "|" + event + "|" + challenge + "|" + tab).encode()).hexdigest()
        with receipt.open("w", encoding="utf-8") as f:
            json.dump({**receipt_context, "status": "ASSISTANT_ATTESTED" if attestation else "BROWSER_CONFIRMED",
                       "evidenceFingerprint": fingerprint, "attestation": attestation}, f)
        return {"chatgptSubmitted": True, "browserConfirmed": True,
                "alreadyVisible": True, "browserPairingVerified": True,
                "verifiedAssistantReply": attestation is not None,
                "attestation": attestation, "evidenceFingerprint": fingerprint,
                **receipt_context}
    try:
        with receipt.open("x", encoding="utf-8") as f:
            json.dump({**receipt_context, "status": "ATTEMPTING"}, f)
            f.flush()
            os.fsync(f.fileno())
    except FileExistsError:
        raise RuntimeError("Wake event already attempted; reconciliation required") from None
    attest_marker = "AI_CORE_ATTEST:" + challenge
    ack_marker = "AI_CORE_ATTEST_ACK:" + challenge
    job_text = (
        "Kerjakan job AI Core berikut: " + task_instruction + ". "
        if task_instruction else
        "Lanjutkan pekerjaan sebelumnya. Periksa checkpoint AI Core DEV dan kerjakan sampai hasil terverifikasi. "
    )
    message = (
        "[" + marker + "] [" + attest_marker + "] " + job_text +
        "Jangan melewati persetujuan keamanan, jangan mengubah PROD. "
        "Pada balasan pertama setelah wake ini, sertakan token [" + ack_marker + "] satu kali."
    )
    browser("type", "--target-id", tab, "--submit", state["ref"], message, timeout=65)
    visible = False
    for _ in range(3):
        time.sleep(2)
        checked = inspect(tab, marker, url)
        if checked["markerVisible"] and checked["empty"]:
            visible = True
            break
    if not visible:
        raise RuntimeError("ChatGPT message delivery not visibly verified")
    fingerprint = hashlib.sha256((conversation + "|" + event + "|" + challenge + "|" + tab).encode()).hexdigest()
    attestation = wait_for_assistant_attestation(root, tab, url, conversation, event, challenge, binding)
    with receipt.open("w", encoding="utf-8") as f:
        json.dump({**receipt_context, "status": "ASSISTANT_ATTESTED" if attestation else "BROWSER_CONFIRMED",
                   "evidenceFingerprint": fingerprint, "attestation": attestation}, f)
    return {"chatgptSubmitted": True, "browserConfirmed": True,
            "alreadyVisible": False, "browserPairingVerified": True,
            "verifiedAssistantReply": attestation is not None,
            "attestation": attestation, "evidenceFingerprint": fingerprint,
            "assistantResponseText": attestation.get("assistantResponseText") if isinstance(attestation, dict) else None,
            **receipt_context}


def main():
    try:
        payload = json.load(sys.stdin)
        result = submit_once(payload.get("instruction", ""), payload.get("workerId", ""), metadata=payload.get("metadata"))
        print(json.dumps({"ok": True, **result}, separators=(",", ":")))
    except (KeyError, OSError, ValueError, RuntimeError, subprocess.TimeoutExpired) as err:
        print(json.dumps({"ok": False, "reason": type(err).__name__,
                          "message": str(err)[:160]}, separators=(",", ":")))
        sys.exit(1)


if __name__ == "__main__":
    main()

