"""DEV-only verified ChatGPT session auto-registration for trusted OpenClaw workers."""
import base64
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

ALLOWED_WORKERS = {
    "openclaw-dell-chatgpt-wake-dev": "openclaw-dell-chatgpt-wake-dev-ed25519-v1",
    "openclaw-travelintrips-dev": "openclaw-travelintrips-dev-ed25519-v1",
    "openclaw-pc-worker-2": "openclaw-pc-worker-2-ed25519-v1",
    "openclaw-vmsc-chatgpt-wake-dev": "openclaw-vmsc-chatgpt-wake-dev-ed25519-v1",
}
UUID = re.compile(r"[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}", re.I)
OWNER = re.compile(r"ai-engine-oauth:[a-f0-9]{64}")
ALIAS = re.compile(r"GPT[0-9]{2,4}")
PROFILE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}")


def env(name):
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError("Missing " + name)
    return value


def load_worker_env_file():
    path = os.environ.get("AI_CORE_DEV_WORKER_ENV_FILE", "").strip()
    if not path:
        return
    allowed = {"AI_CORE_SCOPED_AGENT_TOKEN", "AI_CORE_OPENCLAW_CLIENT_ID"}
    for raw in Path(path).read_text(encoding="utf-8").splitlines():
        match = re.fullmatch(r"\s*([A-Z][A-Z0-9_]*)=(.*)\s*", raw)
        if not match or match.group(1) not in allowed:
            continue
        value = match.group(2).strip().strip('"').strip("'")
        if value and not os.environ.get(match.group(1)):
            os.environ[match.group(1)] = value


def post(base, path, body):
    token = env("AI_CORE_SCOPED_AGENT_TOKEN")
    request = urllib.request.Request(
        base.rstrip("/") + path,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Authorization": "Bearer " + token,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        payload = error.read().decode("utf-8", "replace")
        raise RuntimeError("AI Core HTTP %s %s" % (error.code, payload[:300])) from None


def browser(profile, *args, timeout=45):
    executable = os.environ.get("AI_CORE_OPENCLAW_CMD", "openclaw.cmd" if os.name == "nt" else "openclaw")
    command = [executable, "browser", "--browser-profile", profile, *args]
    result = subprocess.run(command, capture_output=True, text=True, timeout=timeout, shell=False)
    if result.returncode != 0:
        raise RuntimeError("OpenClaw browser command failed")
    return result.stdout


def verify_exact_session(profile, conversation_id):
    expected_url = "https://chatgpt.com/c/" + conversation_id
    tabs = json.loads(browser(profile, "tabs", "--json"))
    matching = [tab for tab in tabs.get("tabs", [])
                if tab.get("type") == "page" and tab.get("url") == expected_url]
    if len(matching) != 1:
        raise RuntimeError("Expected exactly one authenticated ChatGPT conversation tab")
    target = matching[0].get("suggestedTargetId") or matching[0].get("tabId")
    if not target:
        raise RuntimeError("ChatGPT tab has no stable OpenClaw target")
    snapshot = browser(profile, "snapshot", "--target-id", str(target))
    if not re.search(r'^\s*- textbox "(?:Ask ChatGPT|Tanya ChatGPT)"', snapshot, re.M):
        raise RuntimeError("Authenticated ChatGPT composer is unavailable")
    return expected_url


def private_key(path):
    key = serialization.load_pem_private_key(Path(path).read_bytes(), password=None)
    if not isinstance(key, Ed25519PrivateKey):
        raise RuntimeError("Session registration key must be Ed25519")
    return key


def payload(challenge, observed_at):
    return "\n".join([
        "dev-chatgpt-session-registration/v1",
        "challengeId=" + challenge["challengeId"],
        "nonce=" + challenge["nonce"],
        "accountAlias=" + challenge["accountAlias"],
        "ownerChannel=" + challenge["ownerChannel"],
        "targetConversationId=" + challenge["targetConversationId"],
        "workerId=" + challenge["workerId"],
        "browserProfile=" + challenge["browserProfile"],
        "bindingFingerprint=" + challenge["bindingFingerprint"],
        "observedAt=" + observed_at,
    ])


def register_once():
    load_worker_env_file()
    base = env("AI_CORE_BASE_URL")
    if base.rstrip("/") != "https://dev.cstlogistic.co.id/api":
        raise RuntimeError("Refusing non-canonical DEV AI Core base URL")
    alias = env("AI_CORE_DEV_CHATGPT_ACCOUNT_ALIAS").upper()
    owner = env("AI_CORE_DEV_CHATGPT_OWNER_CHANNEL")
    conversation = env("AI_CORE_DEV_CHATGPT_CONVERSATION_ID").lower()
    worker = env("AI_CORE_DEV_WAKE_WORKER_ID")
    if env("AI_CORE_OPENCLAW_CLIENT_ID") != worker:
        raise RuntimeError("Worker env identity mismatch")
    profile = env("AI_CORE_DEV_WAKE_BROWSER_PROFILE")
    key_file = env("AI_CORE_DEV_WAKE_PRIVATE_KEY_FILE")
    if not ALIAS.fullmatch(alias) or alias == "GPT01":
        raise RuntimeError("Invalid additional account alias")
    if not OWNER.fullmatch(owner) or not UUID.fullmatch(conversation) or not PROFILE.fullmatch(profile):
        raise RuntimeError("Invalid session identity")
    if worker not in ALLOWED_WORKERS:
        raise RuntimeError("Worker is not trusted for automatic session registration")

    verify_exact_session(profile, conversation)

    _, staged = post(base, "/ai/core-chat/dev/accounts/stage", {
        "accountAlias": alias,
        "ownerChannel": owner,
        "targetConversationId": conversation,
        "workerId": worker,
        "browserProfile": profile,
    })
    fingerprint = staged.get("bindingFingerprint")
    if not isinstance(fingerprint, str) or not re.fullmatch(r"[a-f0-9]{64}", fingerprint):
        raise RuntimeError("AI Core did not return a valid binding fingerprint")

    _, challenge = post(base, "/ai/core-chat/dev/accounts/session/challenge", {
        "bindingFingerprint": fingerprint,
    })
    for name, expected in (
        ("accountAlias", alias), ("ownerChannel", owner),
        ("targetConversationId", conversation), ("workerId", worker),
        ("browserProfile", profile), ("bindingFingerprint", fingerprint),
    ):
        if challenge.get(name) != expected:
            raise RuntimeError("Session challenge identity mismatch")

    observed_at = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    signature = base64.b64encode(private_key(key_file).sign(
        payload(challenge, observed_at).encode("utf-8"))).decode("ascii")
    _, activated = post(base, "/ai/core-chat/dev/accounts/session/activate", {
        "challengeId": challenge["challengeId"],
        "nonce": challenge["nonce"],
        "observedAt": observed_at,
        "signature": signature,
        "keyId": ALLOWED_WORKERS[worker],
    })
    if activated.get("status") != "SESSION_ACTIVE" or activated.get("bindingFingerprint") != fingerprint:
        raise RuntimeError("AI Core session activation receipt invalid")
    print(json.dumps({
        "ok": True,
        "status": activated["status"],
        "accountAlias": alias,
        "workerId": worker,
        "browserProfile": profile,
        "bindingFingerprint": fingerprint,
        "receiptFingerprint": activated.get("receiptFingerprint"),
    }, separators=(",", ":")))


if __name__ == "__main__":
    retry_seconds = max(0, int(os.environ.get("AI_CORE_DEV_SESSION_REGISTRATION_RETRY_SECONDS", "0") or "0"))
    max_wait_seconds = max(0, int(os.environ.get("AI_CORE_DEV_SESSION_REGISTRATION_MAX_WAIT_SECONDS", "0") or "0"))
    started = time.monotonic() if retry_seconds else 0.0
    while True:
        try:
            register_once()
            sys.exit(0)
        except Exception as error:
            if not retry_seconds or (max_wait_seconds and time.monotonic() - started >= max_wait_seconds):
                print(json.dumps({"ok": False, "error": str(error)[:300]}, separators=(",", ":")))
                sys.exit(1)
            print(json.dumps({"ok": False, "waiting": True, "error": str(error)[:180]}, separators=(",", ":")), flush=True)
            time.sleep(retry_seconds)
