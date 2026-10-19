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

PATTERN = re.compile(
    r"\ADEV_CHATGPT_WAKE_V1 conversation=([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}) "
    r"event=([0-9a-f]{64}) challenge=([0-9a-f]{64})\Z", re.I)
CLI = [os.environ.get("AI_CORE_OPENCLAW_CMD", "openclaw.cmd" if os.name == "nt" else "openclaw"), "browser", "--browser-profile", os.environ.get("AI_CORE_DEV_WAKE_BROWSER_PROFILE", "chrome")]
WORKER = os.environ.get("AI_CORE_DEV_WAKE_WORKER_ID", "openclaw-travelintrips-dev")
KEY_ID = os.environ.get("AI_CORE_DEV_WAKE_KEY_ID", "openclaw-travelintrips-dev-ed25519-v1")
ALLOWLIST_FILE = os.environ.get("AI_CORE_DEV_WAKE_ALLOWLIST_FILE", "chatgpt-wake-dev-allowlist.json")
PRIVATE_KEY_FILE = os.environ.get("AI_CORE_DEV_WAKE_PRIVATE_KEY_FILE", "dev-assistant-attestation-ed25519.pem")


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
    allowed = data.get("allowedConversationIds")
    if data.get("enabled") is not True or not isinstance(allowed, list):
        raise RuntimeError("DEV ChatGPT wake pairing disabled")
    if not all(isinstance(v, str) and re.fullmatch(r"[0-9a-f-]{36}", v, re.I) for v in allowed):
        raise RuntimeError("Invalid DEV wake pairing allowlist")
    return root, set(v.lower() for v in allowed)


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
    # Use the accessibility snapshot for composer state and delivery state;
    # this avoids a second page.evaluate during the browser preflight.
    if find_tab(expected_url) != tab:
        raise RuntimeError("Exact authenticated browser pairing cannot be verified")
    snapshot = browser("snapshot", "--target-id", tab, timeout=55)
    m = re.search(r'textbox "Ask ChatGPT"(?: \[[^\]]+\])* \[ref=(e\d+)\](?: value=("(?:[^"\\]|\\.)*"))?', snapshot)
    if not m:
        raise RuntimeError("Authenticated ChatGPT composer not available")
    raw_draft = m.group(2)
    if raw_draft:
        try:
            draft = json.loads(raw_draft)
        except ValueError:
            raise RuntimeError("ChatGPT composer draft cannot be verified") from None
    else:
        draft = ""
    if not isinstance(draft, str):
        raise RuntimeError("ChatGPT composer state invalid")
    responding = bool(re.search(r'button "Stop(?: generating)?"', snapshot, re.I))
    return {"ref": m.group(1), "empty": draft.strip() == "",
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

def _attestation_payload(conversation, event, challenge, message_id, response_hash, observed_at):
    return "\n".join([
        "dev-chatgpt-assistant-attestation/v1",
        "keyId=" + KEY_ID,
        "workerId=" + WORKER,
        "conversationId=" + conversation,
        "eventId=" + event,
        "challenge=" + challenge,
        "assistantMessageId=" + message_id,
        "assistantResponseHash=" + response_hash,
        "observedAt=" + observed_at,
    ])


def wait_for_assistant_attestation(root, tab, expected_url, conversation, event, challenge):
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
            payload = _attestation_payload(conversation, event, challenge, message_id, response_hash, observed_at)
            signature = base64.b64encode(key.sign(payload.encode("utf-8"))).decode("ascii")
            return {
                "version": 1, "algorithm": "Ed25519", "keyId": KEY_ID, "workerId": WORKER,
                "conversationId": conversation, "eventId": event, "challenge": challenge,
                "assistantMessageId": message_id, "assistantResponseHash": response_hash,
                "assistantResponseText": text[:4000],
                "observedAt": observed_at, "signature": signature,
            }
        time.sleep(2)
    return None


def submit_once(instruction, worker_id, base=None):
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
    root, allowlist = config(base)
    if conversation not in allowlist:
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
    receipt = receipt_dir / (event + ".json")
    if state["markerVisible"]:
        # Reconcile an existing wake without submitting a duplicate message.
        attestation = wait_for_assistant_attestation(root, tab, url, conversation, event, challenge)
        fingerprint = hashlib.sha256((conversation + "|" + event + "|" + challenge + "|" + tab).encode()).hexdigest()
        with receipt.open("w", encoding="utf-8") as f:
            json.dump({"status": "ASSISTANT_ATTESTED" if attestation else "BROWSER_CONFIRMED",
                       "evidenceFingerprint": fingerprint, "attestation": attestation}, f)
        return {"chatgptSubmitted": True, "browserConfirmed": True,
                "alreadyVisible": True, "browserPairingVerified": True,
                "verifiedAssistantReply": attestation is not None,
                "attestation": attestation, "evidenceFingerprint": fingerprint,
                "conversationId": conversation, "eventId": event, "challenge": challenge}
    try:
        with receipt.open("x", encoding="utf-8") as f:
            json.dump({"status": "ATTEMPTING", "conversationId": conversation, "challenge": challenge}, f)
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
    attestation = wait_for_assistant_attestation(root, tab, url, conversation, event, challenge)
    with receipt.open("w", encoding="utf-8") as f:
        json.dump({"status": "ASSISTANT_ATTESTED" if attestation else "BROWSER_CONFIRMED",
                   "evidenceFingerprint": fingerprint, "attestation": attestation}, f)
    return {"chatgptSubmitted": True, "browserConfirmed": True,
            "alreadyVisible": False, "browserPairingVerified": True,
            "verifiedAssistantReply": attestation is not None,
            "attestation": attestation, "evidenceFingerprint": fingerprint,
            "assistantResponseText": attestation.get("assistantResponseText") if isinstance(attestation, dict) else None,
            "conversationId": conversation, "eventId": event, "challenge": challenge}


def main():
    try:
        payload = json.load(sys.stdin)
        result = submit_once(payload.get("instruction", ""), payload.get("workerId", ""))
        print(json.dumps({"ok": True, **result}, separators=(",", ":")))
    except (KeyError, OSError, ValueError, RuntimeError, subprocess.TimeoutExpired) as err:
        print(json.dumps({"ok": False, "reason": type(err).__name__,
                          "message": str(err)[:160]}, separators=(",", ":")))
        sys.exit(1)


if __name__ == "__main__":
    main()
