"""DEV-only, model-free ChatGPT wake sender for an authorized Travelintrips PC.

The AI Core worker must submit a typed, allowlisted event. A browser account
and exact conversation URL are verified immediately before the keypress.
This does not grant ChatGPT session ownership to an MCP OAuth channel.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time

PATTERN = re.compile(r"\ADEV_CHATGPT_WAKE_V1 conversation=([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}) event=([0-9a-f]{64})\Z", re.I)
CLI = ["openclaw.cmd" if os.name == "nt" else "openclaw", "browser", "--browser-profile", "chrome"]
WORKER = "openclaw-travelintrips-dev"


def browser(*args, timeout=55):
    result = subprocess.run(CLI + list(args), capture_output=True, text=True, shell=False, timeout=timeout)
    if result.returncode != 0:
        raise RuntimeError("Browser controller failed (" + args[0] + ")")
    return result.stdout


def config(base=None):
    root = Path(base or (Path(os.environ["LOCALAPPDATA"]) / "AI-Core"))
    p = root / "chatgpt-wake-dev-allowlist.json"
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
    if len(matching) != 1 or not matching[0].get("targetId"):
        raise RuntimeError("Expected exactly one paired ChatGPT browser tab")
    return matching[0]["targetId"]


def inspect(tab, marker, expected_url):
    # Scope accessibility lookup to composer, avoiding huge chat transcript
    # snapshots that time out on long-lived ChatGPT conversations.
    snapshot = browser("snapshot", "--target-id", tab, "--selector",
                       "[contenteditable]", "--limit", "16", timeout=25)
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
    # Read-only DOM check: same exact page, no duplicate wake marker, and not
    # generating an assistant reply. The marker is regex-validated upstream.
    probe = (
        "() => ({url:location.href,markerVisible:document.body.innerText.includes("
        + json.dumps(marker) +
        "),responding:Array.from(document.querySelectorAll('button')).some(b=>"
        "/^(Stop|Stop generating)$/i.test((b.getAttribute('aria-label')||b.innerText||'').trim()))})"
    )
    observed = json.loads(browser("evaluate", "--target-id", tab, "--fn",
                                  probe, timeout=30))
    if not isinstance(observed, dict) or observed.get("url") != expected_url or not isinstance(observed.get("markerVisible"), bool) or not isinstance(observed.get("responding"), bool):
        raise RuntimeError("Exact authenticated browser pairing cannot be verified")
    return {
        "ref": m.group(1), "empty": draft.strip() == "",
        "responding": observed["responding"],
        "markerVisible": observed["markerVisible"],
    }


def submit_once(instruction, worker_id, base=None):
    match = PATTERN.fullmatch(str(instruction).strip())
    if not match or worker_id != WORKER:
        raise RuntimeError("Unauthorized DEV browser wake command or worker")
    conversation, event = match.group(1).lower(), match.group(2).lower()
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
        # A previous delivery is visible, so never type this marker again.
        return {"chatgptSubmitted": True, "browserConfirmed": True,
                "alreadyVisible": True, "browserPairingVerified": True,
                "verifiedAssistantReply": False, "conversationId": conversation,
                "eventId": event}
    try:
        # Create before the side effect. If browser submission is uncertain,
        # retries fail closed rather than sending a duplicate message.
        with receipt.open("x", encoding="utf-8") as f:
            json.dump({"status": "ATTEMPTING", "conversationId": conversation}, f)
            f.flush()
            os.fsync(f.fileno())
    except FileExistsError:
        raise RuntimeError("Wake event already attempted; reconciliation required") from None
    message = (
        "[" + marker + "] Lanjutkan pekerjaan sebelumnya. "
        "Periksa checkpoint AI Core DEV dan kerjakan sampai hasil terverifikasi. "
        "Jangan melewati persetujuan keamanan, jangan mengubah PROD."
    )
    # Ref must come from the fresh snapshot of this exact authenticated tab.
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
    fingerprint = hashlib.sha256((conversation + "|" + event + "|" + tab).encode()).hexdigest()
    with receipt.open("w", encoding="utf-8") as f:
        json.dump({"status": "BROWSER_CONFIRMED", "evidenceFingerprint": fingerprint}, f)
    return {"chatgptSubmitted": True, "browserConfirmed": True,
            "alreadyVisible": False, "browserPairingVerified": True,
            "verifiedAssistantReply": False, "evidenceFingerprint": fingerprint,
            "conversationId": conversation, "eventId": event}


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
