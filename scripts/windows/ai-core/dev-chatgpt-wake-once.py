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
    result = subprocess.run(CLI + list(args), capture_output=True, text=True, shell=False, timeout=timeout)
    if result.returncode != 0:
        raise RuntimeError("Browser controller failed (" + args[0] + ")")
    return result.stdout


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
    # OpenClaw stable tab handles are supported by snapshots and actions.
    # Avoid selector/limit here because current browser CLI builds can stall
    # that legacy snapshot combination even though a scoped snapshot works.
    snapshot = browser("snapshot", "--target-id", tab, timeout=55)
    m = re.search(r'textbox "Ask ChatGPT" \[ref=(e\d+)\](?: value=("(?:[^"\\]|\\.)*"))?', snapshot)
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
    probe = (
        "() => ({url:location.href,markerVisible:document.body.innerText.includes("
        + json.dumps(marker) +
        "),responding:Array.from(document.querySelectorAll('button')).some(b=>"
        "/^(Stop|Stop generating)$/i.test((b.getAttribute('aria-label')||b.innerText||'').trim()))})"
    )
    observed = json.loads(browser("evaluate", "--target-id", tab, "--fn", probe, timeout=30))
    if (not isinstance(observed, dict) or observed.get("url") != expected_url or
        not isinstance(observed.get("markerVisible"), bool) or
        not isinstance(observed.get("responding"), bool)):
        raise RuntimeError("Exact authenticated browser pairing cannot be verified")
    return {"ref": m.group(1), "empty": draft.strip() == "",
            "responding": observed["responding"], "markerVisible": observed["markerVisible"]}


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
    fn = """() => {
      const expectedUrl = %s;
      const marker = %s;
      const ack = %s;
      const units = Array.from(document.querySelectorAll('[data-chatgpt-search-unit-key]'));
      const user = units.find(e => {
        const key = e.getAttribute('data-chatgpt-search-unit-key') || '';
        const text = e.innerText || '';
        return key.endsWith(':user') && text.includes(marker) && text.includes(ack.replace('_ACK',''));
      });
      const responding = Array.from(document.querySelectorAll('button')).some(b =>
        /^(Stop|Stop generating)$/i.test((b.getAttribute('aria-label') || b.innerText || '').trim()));
      if (!user) return {url:location.href, responding, userFound:false, assistantFound:false};
      const key = user.getAttribute('data-chatgpt-search-unit-key') || '';
      const match = /^(.*):0:user$/.exec(key);
      let assistant = match ? document.querySelector('[data-chatgpt-search-unit-key="' + match[1] + ':2:assistant"]') : null;
      if (!assistant) {
        const index = units.indexOf(user);
        assistant = units.slice(index + 1).find(e => (e.getAttribute('data-chatgpt-search-unit-key') || '').endsWith(':assistant')) || null;
      }
      if (!assistant) return {url:location.href, responding, userFound:true, assistantFound:false};
      const textNode = assistant.querySelector('[data-markdown-text-style="assistant-message"]');
      const text = (textNode ? textNode.innerText : assistant.innerText || '').trim();
      const ids = (assistant.getAttribute('data-chatgpt-search-message-ids') || '') + ' ' +
        (assistant.querySelector('[data-chatgpt-selection-message-id]')?.getAttribute('data-chatgpt-selection-message-id') || '');
      const idMatch = ids.match(/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/i);
      return {url:location.href, responding, userFound:true, assistantFound:Boolean(text && idMatch),
        assistantMessageId:idMatch ? idMatch[0].toLowerCase() : null,
        assistantText:text, ackVisible:text.includes('[' + ack + ']') || text.includes(ack)};
    }""" % (json.dumps(expected_url), json.dumps(marker), json.dumps(ack))
    value = json.loads(browser("evaluate", "--target-id", tab, "--fn", fn, timeout=25))
    if not isinstance(value, dict) or value.get("url") != expected_url:
        raise RuntimeError("Assistant attestation browser pairing lost")
    return value


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
                "observedAt": observed_at, "signature": signature,
            }
        time.sleep(2)
    return None


def submit_once(instruction, worker_id, base=None):
    match = PATTERN.fullmatch(str(instruction).strip())
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
    message = (
        "[" + marker + "] [" + attest_marker + "] Lanjutkan pekerjaan sebelumnya. "
        "Periksa checkpoint AI Core DEV dan kerjakan sampai hasil terverifikasi. "
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
