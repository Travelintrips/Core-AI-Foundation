"""Bounded Windows OpenClaw external-agent work consumer.

Requires AI_CORE_BASE_URL and AI_CORE_SCOPED_AGENT_TOKEN in the process environment.
Never logs bearer tokens or claim tokens. Only accepts allowlisted diagnostic tasks.
"""
import json
import os
import subprocess
import time
import urllib.error
import urllib.request

CLIENT_ID = "openclaw-pc-worker"
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


def execute(work):
    instruction = str(work.get("instruction", "")).strip()
    # This is intentionally not a general shell or arbitrary model-command executor.
    # Explicitly allow only safe, read-only diagnostic instructions.
    if instruction not in ("PING", "ping", "STATUS", "status"):
        return False, "Unsupported PC worker instruction", {"reason": "not_allowlisted"}
    if instruction.lower() == "ping":
        return True, "pong from Travelintrips-PC", {"runtime": "openclaw-pc"}
    result = subprocess.run(
        ["openclaw", "node", "status"],
        capture_output=True, text=True, timeout=20, shell=False,
    )
    return result.returncode == 0, (result.stdout or result.stderr)[-3000:], {"runtime": "openclaw-pc"}


def main():
    if not BASE.startswith("https://") or not TOKEN:
        raise SystemExit("HTTPS AI_CORE_BASE_URL and AI_CORE_SCOPED_AGENT_TOKEN required")
    while True:
        work = None
        try:
            work = api("/ai/agent-runtime/work/claim", {"clientId": CLIENT_ID, "leaseSeconds": 120})
            if work and work.get("commandId") and work.get("claimToken"):
                try:
                    ok, message, details = execute(work)
                except Exception as exc:
                    ok, message, details = False, "Worker execution failed", {"errorType": type(exc).__name__}
                api("/ai/agent-runtime/work/" + str(work["commandId"]) + "/result", {
                    "clientId": CLIENT_ID, "claimToken": work["claimToken"],
                    "status": "COMPLETED" if ok else "FAILED",
                    "message": message[:3000], "details": details,
                })
                print("reported command " + str(work["commandId"]), flush=True)
        except Exception as exc:
            print("worker cycle error: " + type(exc).__name__, flush=True)
        time.sleep(POLL)


if __name__ == "__main__":
    main()
