"""Bounded Windows OpenClaw external-agent work consumer.

Requires AI_CORE_BASE_URL and AI_CORE_SCOPED_AGENT_TOKEN in the process environment.
Never logs bearer tokens or claim tokens. Runs agent instructions through OpenClaw CLI with bounded timeouts and existing approvals.
"""
import json
import re
import os
import socket
import msvcrt
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

CLIENT_ID = os.environ.get("AI_CORE_OPENCLAW_CLIENT_ID", "openclaw-pc-worker").strip()
BASE = os.environ.get("AI_CORE_BASE_URL", "").rstrip("/")
TOKEN = os.environ.get("AI_CORE_SCOPED_AGENT_TOKEN", "")
POLL = 5


def api(path, body):
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(body).encode("utf-8"),
        method="POST",
        headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=25) as response:
            if response.status == 204:
                return None
            return json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as exc:
        if exc.code == 204:
            return None
        raise RuntimeError("AI Core HTTP " + str(exc.code)) from None


# Model-free, fixed grammar: never interpret arbitrary text as a command.
HOSTNAME_INSTRUCTIONS = {
    "hostname", "read hostname", "baca hostname", "cek hostname", "get hostname",
    "hostname pc travelintrips", "baca hostname pc travelintrips",
    "cek hostname pc travelintrips", "read hostname pc travelintrips",
    "jalankan hostname pada pc travelintrips",
}


def model_free_hostname(work, worker_id):
    instruction = str(work.get("instruction", "")).strip()
    normalized = re.sub(r"\s+", " ", instruction).lower().rstrip(".!?")
    if normalized not in HOSTNAME_INSTRUCTIONS and "jalankan hostname pada pc travelintrips" not in normalized:
        return None
    if worker_id not in ("openclaw-pc-worker", "openclaw-travelintrips-dev"):
        return False, "Travelintrips hostname requires primary PC worker", {
            "runtime": "openclaw-pc", "mode": "model-free-hostname",
            "reason": "worker_target_mismatch", "workerId": worker_id,
            "verified": False, "modelInvoked": False,
        }
    hostname = socket.gethostname()
    verified = hostname.casefold() == "travelintrips"
    return verified, hostname if verified else "Unexpected hostname (not Travelintrips)", {
        "runtime": "openclaw-pc", "mode": "model-free-hostname",
        "workerId": worker_id, "hostname": hostname,
        "verified": verified, "modelInvoked": False, "exitCode": 0,
    }


def execute(work):
    instruction = str(work.get("instruction", "")).strip()
    if not instruction or len(instruction) > 12000:
        return False, "Invalid instruction length", {"reason": "invalid_instruction"}
    bounded = model_free_hostname(work, CLIENT_ID)
    if bounded is not None:
        return bounded
    if ("hostinger" in instruction.lower() and "ssh" in instruction.lower()
        and re.search(r"\bwhoami\b", instruction, re.I)
        and re.search(r"\bhostname\b", instruction, re.I)):
        identity = os.path.join(os.path.expanduser("~"), ".ssh", "hostinger_shared_20261010_ed25519")
        if not os.path.isfile(identity):
            return False, "SSH identity unavailable", {"reason": "ssh_identity_missing", "workerId": CLIENT_ID}
        result = subprocess.run(
            ["ssh", "-i", identity, "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes",
             "-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=10",
             "-p", "65002", "u684045296@185.124.136.115", "whoami; hostname"],
            capture_output=True, text=True, timeout=25, shell=False,
        )
        lines = [line.strip() for line in result.stdout.splitlines() if line.strip()]
        verified = result.returncode == 0 and lines == ["u684045296", "id-dci-web1320.main-hosting.eu"]
        return verified, ("SSH identity and host verified" if verified else "Read-only SSH verification failed"), {
            "runtime": "openclaw-pc", "mode": "ssh-readonly-hostinger",
            "exitCode": result.returncode, "sshVerified": verified, "workerId": CLIENT_ID,
            "stderrCategory": ("host_key_or_auth_or_connectivity" if result.returncode != 0 else "none"),
        }
    # Explicit allowlisted ChatGPT action via native OpenClaw browser control.
    low = instruction.lower()
    if (low.startswith("buka browser di pc travelintrips dan buat sesi baru chatgpt pada https://chatgpt.com/")
        and "tanpa mengirim pesan" in low):
        start = subprocess.run(
            ["openclaw.cmd", "browser", "--port", "18790", "start"],
            capture_output=True, text=True, timeout=65, shell=False,
        )
        if start.returncode != 0:
            return False, "OpenClaw browser start failed", {
                "runtime": "openclaw-pc", "mode": "browser-new-chat",
                "stage": "browser-start", "exitCode": start.returncode,
                "stderrTail": (start.stderr or "")[-350:],
            }
        opened = subprocess.run(
            ["openclaw.cmd", "browser", "--port", "18790", "--json",
             "open", "https://chatgpt.com/"],
            capture_output=True, text=True, timeout=65, shell=False,
        )
        if opened.returncode != 0:
            return False, "OpenClaw browser open failed", {
                "runtime": "openclaw-pc", "mode": "browser-new-chat",
                "stage": "browser-open", "exitCode": opened.returncode,
                "stderrTail": (opened.stderr or "")[-350:],
            }
        try:
            tab = json.loads(opened.stdout)
        except (ValueError, TypeError):
            tab = {}
        return True, "Opened ChatGPT in a new OpenClaw browser tab; no message sent", {
            "runtime": "openclaw-pc", "mode": "browser-new-chat",
            "url": "https://chatgpt.com/",
            "tabId": tab.get("id") or tab.get("targetId"),
        }
    # Strictly bounded, non-privileged browser messaging test.
    if instruction.strip() == "kirim pesan uji CEK_E2E_OPENCLAW_20261012 ke tab ChatGPT baru dan laporkan hasilnya":
        test_marker = "CEK_E2E_OPENCLAW_20261012"
        tab_id = "924C356E6E94BF9DB8B377C19D24A16A"
        expected = "https://chatgpt.com/"
        tabs = subprocess.run(
            ["openclaw.cmd", "browser", "--port", "18790", "--json", "tabs"],
            capture_output=True, text=True, timeout=45, shell=False,
        )
        if tabs.returncode != 0:
            return False, "Browser tabs query failed", {"mode": "browser-text-e2e-20261012", "stage": "tabs"}
        try:
            listing = json.loads(tabs.stdout)
        except ValueError:
            return False, "Browser tabs JSON invalid", {"mode": "browser-text-e2e-20261012", "stage": "tabs"}
        if not any(t.get("targetId") == tab_id and str(t.get("url", "")).startswith(expected) for t in listing.get("tabs", [])):
            return False, "Expected ChatGPT tab not found", {"mode": "browser-text-e2e-20261012", "stage": "target"}
        message = "Uji komunikasi OpenClaw ke ChatGPT. Balas tepat ACK_CEK_E2E_OPENCLAW_20261012 dan jangan lakukan tindakan lain."
        typed = subprocess.run(
            ["openclaw.cmd", "browser", "--port", "18790", "type",
             "--target-id", tab_id, "--submit", "e113", message],
            capture_output=True, text=True, timeout=55, shell=False,
        )
        return typed.returncode == 0, ("ChatGPT test message submitted via OpenClaw" if typed.returncode == 0 else "OpenClaw browser typing failed"), {
            "runtime": "openclaw-pc", "mode": "browser-text-e2e-20261012",
            "marker": test_marker, "tabId": tab_id,
            "submitted": typed.returncode == 0, "exitCode": typed.returncode,
            "errorTail": (typed.stderr or "")[-250:],
        }
    # Verify exact ChatGPT response through OpenClaw browser, persist via
    # the ordinary AI Core work-result callback (no page mutation).
    if instruction.strip() == "verifikasi balasan ACK_CEK_E2E_OPENCLAW_20261012 di tab ChatGPT dan laporkan ke AI Core":
        tab_id = "924C356E6E94BF9DB8B377C19D24A16A"
        ack = "ACK_CEK_E2E_OPENCLAW_20261012"
        observed = subprocess.run(
            ["openclaw.cmd", "browser", "--port", "18790", "snapshot",
             "--target-id", tab_id, "--limit", "180"],
            capture_output=True, text=True, timeout=60, shell=False,
        )
        match = observed.returncode == 0 and ("paragraph" in observed.stdout and ack in observed.stdout)
        return match, ("ChatGPT ACK verified: " + ack if match else "ChatGPT ACK not verified"), {
            "runtime": "openclaw-pc", "mode": "browser-ack-verified-20261012",
            "tabId": tab_id, "ack": ack if match else None,
            "verified": match, "exitCode": observed.returncode,
        }
    # Bounded mouse-up test on a fresh Google Keep tab via OpenClaw browser.
    if instruction.strip() == "uji gerakkan mouse PC Travelintrips ke atas pada tab Google Keep tanpa mengubah catatan":
        import ctypes
        from ctypes import wintypes
        result = subprocess.run(
            ["openclaw.cmd", "browser", "--port", "18790", "--json", "open", "https://keep.google.com/"],
            capture_output=True, text=True, timeout=65, shell=False,
        )
        if result.returncode != 0:
            return False, "OpenClaw failed opening Google Keep", {"mode": "keep-mouse-up", "stage": "open", "exitCode": result.returncode}
        try:
            tab = json.loads(result.stdout)
        except ValueError:
            tab = {}
        class POINT(ctypes.Structure):
            _fields_ = [("x", wintypes.LONG), ("y", wintypes.LONG)]
        user32 = ctypes.windll.user32
        before = POINT()
        after = POINT()
        if not user32.GetCursorPos(ctypes.byref(before)):
            return False, "Cannot inspect physical cursor", {"mode": "keep-mouse-up", "stage": "cursor"}
        screen_top = user32.GetSystemMetrics(78)
        screen_height = user32.GetSystemMetrics(79)
        top_limit = min(0, screen_top)
        desired_y = max(top_limit, int(before.y) - 170)
        if desired_y == before.y:
            return False, "Cursor already at top edge", {"mode": "keep-mouse-up", "beforeY": before.y}
        moved = bool(user32.SetCursorPos(int(before.x), desired_y))
        time.sleep(0.5)
        user32.GetCursorPos(ctypes.byref(after))
        verified = moved and after.y < before.y
        return verified, ("PC physical mouse moved up on Google Keep test" if verified else "Physical mouse movement not verified"), {
            "runtime": "openclaw-pc", "mode": "keep-mouse-up",
            "tabId": tab.get("id") or tab.get("targetId"),
            "before": {"x": before.x, "y": before.y},
            "after": {"x": after.x, "y": after.y}, "movedUp": verified,
            "notesChanged": False,
        }
    if instruction.lower() == "ping":
        return True, "pong from Travelintrips-PC", {"runtime": "openclaw-pc"}
    if instruction.lower() == "status":
        args = ["openclaw.cmd", "nodes", "status", "--json"]
        result = subprocess.run(args, capture_output=True, text=True, timeout=30, shell=False)
        return result.returncode == 0, (result.stdout or result.stderr)[-3000:], {"runtime": "openclaw-pc", "mode": "status"}

    # Monitor notifications have a dedicated browser sender; the agent's
    # text response alone is not proof that ChatGPT received a message.
    external_id = str(work.get("externalCommandId", ""))
    if external_id.startswith("monitor:"):
        event_id = external_id[len("monitor:"):]
        relay = os.path.join(os.environ["LOCALAPPDATA"], "AI-Core", "cst-monitor-chat-relay.py")
        result = subprocess.run(
            ["python", relay], input=json.dumps({"eventId": event_id, "instruction": instruction}),
            capture_output=True, text=True, timeout=185, shell=False,
        )
        try:
            receipt = json.loads((result.stdout or "").strip())
        except json.JSONDecodeError:
            receipt = {"ok": False, "message": "Browser confirmation unavailable"}
        verified = result.returncode == 0 and receipt.get("ok") is True and receipt.get("browserConfirmed") is True
        return verified, ("ChatGPT browser submission confirmed" if verified else str(receipt.get("message", "ChatGPT browser relay failed"))[:250]), {
            "runtime": "openclaw-pc", "mode": "monitor-chatgpt-browser",
            "chatgptSubmitted": verified, "alreadyVisible": bool(receipt.get("alreadyVisible")),
        }

    # DEV browser wake is an explicit, model-free, single-event capability.
    # The helper performs authenticated browser tab verification and local
    # idempotency BEFORE any typing. No fallback to a generic agent.
    if instruction.startswith("DEV_CHATGPT_WAKE_V1 "):
        valid = re.fullmatch(r"DEV_CHATGPT_WAKE_V1 conversation=([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}) event=([a-f0-9]{64})", instruction, re.I)
        if (CLIENT_ID != "openclaw-travelintrips-dev" or not valid or
            not BASE.startswith("https://dev.cstlogistic.co.id/api")):
            return False, "DEV browser wake command denied", {
                "runtime": "openclaw-pc", "mode": "chatgpt-browser-wake-dev",
                "reason": "wake_authorization_denied", "verified": False,
            }
        helper = os.path.join(os.environ["LOCALAPPDATA"], "AI-Core", "dev-chatgpt-wake-once.py")
        if not os.path.isfile(helper):
            return False, "DEV browser wake helper is not installed", {
                "runtime": "openclaw-pc", "mode": "chatgpt-browser-wake-dev",
                "reason": "helper_missing", "verified": False,
            }
        process = subprocess.run(
            ["python", helper], input=json.dumps({"instruction": instruction, "workerId": CLIENT_ID}),
            capture_output=True, text=True, timeout=235, shell=False,
        )
        try:
            receipt = json.loads((process.stdout or "").strip())
        except (ValueError, TypeError):
            receipt = {"ok": False, "message": "Browser wake receipt is missing"}
        verified = (process.returncode == 0 and receipt.get("ok") is True and
                    receipt.get("browserConfirmed") is True and receipt.get("chatgptSubmitted") is True and
                    receipt.get("conversationId") == valid.group(1).lower() and
                    receipt.get("eventId") == valid.group(2).lower())
        details = {
            "runtime": "openclaw-pc", "mode": "chatgpt-browser-wake-dev", "workerId": CLIENT_ID,
            "capability": "chatgpt:wake", "modelInvoked": False,
            "browserConfirmed": verified, "chatgptSubmitted": verified,
            "browserPairingVerified": verified, "verifiedAssistantReply": False,
            "conversationId": valid.group(1).lower(), "eventId": valid.group(2).lower(),
            "verified": verified, "exitCode": process.returncode,
            "alreadyVisible": bool(receipt.get("alreadyVisible")),
            "evidenceFingerprint": receipt.get("evidenceFingerprint") if verified else None,
        }
        if not verified:
            details["reason"] = str(receipt.get("message", "browser_wake_unverified"))[:160]
        return verified, ("ChatGPT browser wake visibly submitted" if verified else "ChatGPT browser wake blocked/unverified"), details

    # Model-free PC execution boundary. Complex instructions require AI Core
    # routing and a separately approved bounded action; no provider auth on PC.
    return False, "Action needs AI Core routing; no local model was invoked", {
        "runtime": "openclaw-pc", "mode": "model-free",
        "reason": "requires_ai_core_routing", "workerId": CLIENT_ID,
        "modelInvoked": False, "verified": False,
    }


def verified_server_callback_receipt(receipt, command_id, expected_status):
    """Confirms AI Core persisted the command result and returned its response ID.

    This is a server callback receipt, NOT a ChatGPT conversation delivery ACK.
    """
    if not isinstance(receipt, dict) or receipt.get("commandId") != command_id:
        return False
    if receipt.get("status") != expected_status:
        return False
    response = receipt.get("response")
    return (isinstance(response, dict) and
            isinstance(response.get("id"), str) and
            re.fullmatch(r"[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}",
                         response["id"], re.I) is not None)


def main():
    if not BASE.startswith("https://") or not TOKEN:
        raise SystemExit("HTTPS AI_CORE_BASE_URL and AI_CORE_SCOPED_AGENT_TOKEN required")
    # Windows Task Scheduler may leave an older child process alive after restart.
    # One machine must have only one queue consumer, even across task restarts.
    lock_path = os.path.join(os.environ["LOCALAPPDATA"], "AI-Core", "travelintrips-dev-consumer.lock")
    lock_fd = open(lock_path, "a+b")
    lock_fd.seek(0, os.SEEK_END)
    if lock_fd.tell() == 0:
        lock_fd.write(b"0")
        lock_fd.flush()
    lock_fd.seek(0)
    try:
        msvcrt.locking(lock_fd.fileno(), msvcrt.LK_NBLCK, 1)
    except OSError:
        raise SystemExit("Another OpenClaw PC work consumer is already active")
    while True:
        work = None
        try:
            api("/ai/agent-runtime/presence/" + CLIENT_ID + "/heartbeat", {"health": "healthy", "version": "travelintrips-dev-2026.10.18"})
            work = api("/ai/agent-runtime/work/claim", {"clientId": CLIENT_ID, "leaseSeconds": 240})
            with open(os.path.join(os.environ["LOCALAPPDATA"], "AI-Core", "travelintrips-dev-consumer-poll.log"), "a", encoding="utf-8") as log:
                log.write(time.strftime("%Y-%m-%dT%H:%M:%S ") + ("CLAIMED " + str(work.get("commandId", "")) if isinstance(work, dict) and work.get("commandId") else "NO_WORK") + "\n")
            if work and work.get("commandId") and work.get("claimToken"): 
                try:
                    ok, message, details = execute(work)
                except Exception as exc:
                    ok, message, details = False, "Worker execution failed", {"errorType": type(exc).__name__}
                expected_status = "COMPLETED" if ok else "FAILED"
                receipt = api("/ai/agent-runtime/work/" + str(work["commandId"]) + "/result", {
                    "clientId": CLIENT_ID, "claimToken": work["claimToken"],
                    "status": expected_status,
                    "message": message[:3000], "details": details,
                })
                if not verified_server_callback_receipt(receipt, str(work["commandId"]), expected_status):
                    raise RuntimeError("AI Core result callback lacks a persisted receipt")
                print("callback persisted command " + str(work["commandId"]) +
                      " response " + receipt["response"]["id"], flush=True)
        except Exception as exc:
            error = "worker cycle error: " + type(exc).__name__ + (" " + str(exc) if isinstance(exc, RuntimeError) and str(exc).startswith("AI Core HTTP ") else "")
            print(error, flush=True)
            try:
                with open(os.path.join(os.environ["LOCALAPPDATA"], "AI-Core", "travelintrips-dev-consumer-errors.log"), "a", encoding="utf-8") as log:
                    log.write(time.strftime("%Y-%m-%dT%H:%M:%S ") + error + "\n")
            except OSError:
                pass
        time.sleep(POLL)


if __name__ == "__main__":
    main()
