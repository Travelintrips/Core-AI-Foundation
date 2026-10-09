"""Bounded Windows OpenClaw external-agent work consumer.

Requires AI_CORE_BASE_URL and AI_CORE_SCOPED_AGENT_TOKEN in the process environment.
Never logs bearer tokens or claim tokens. Runs agent instructions through OpenClaw CLI with bounded timeouts and existing approvals.
"""
import json
import os
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

CLIENT_ID = os.environ.get("AI_CORE_OPENCLAW_CLIENT_ID", "openclaw-pc-worker").strip()
ALLOWED_CLIENT_IDS = {"openclaw-pc-worker", "openclaw-pc-worker-2", "openclaw-pc-worker-3"}
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
    if not instruction or len(instruction) > 12000:
        return False, "Invalid instruction length", {"reason": "invalid_instruction"}
    if instruction.lower() == "ping":
        return True, "pong from Travelintrips-PC", {"runtime": "openclaw-pc"}
    if instruction.lower() == "status":
        args = ["openclaw.cmd" if os.name == "nt" else "openclaw", "nodes", "status", "--json"]
        result = subprocess.run(args, capture_output=True, text=True, timeout=30, shell=False)
        return result.returncode == 0, (result.stdout or result.stderr)[-3000:], {"runtime": "openclaw-pc", "mode": "status"}

    # Send arbitrary natural-language instructions only through the existing
    # OpenClaw agent and its configured tool/approval boundaries; never shell.
    # A private temporary message file prevents command-line argument exposure.
    fd, path = tempfile.mkstemp(prefix="ai-core-openclaw-", suffix=".txt")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(instruction)
        result = subprocess.run(
            ["openclaw.cmd" if os.name == "nt" else "openclaw", "agent", "--message-file", path,
             "--session-id", "ai-core-" + CLIENT_ID, "--timeout", "90", "--json"],
            capture_output=True, text=True, timeout=105, shell=False,
        )
        response = (result.stdout or result.stderr)[-10000:]
        return result.returncode == 0, response[-3000:], {
            "runtime": "openclaw-pc", "mode": "agent",
            "exitCode": result.returncode,
        }
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


def main():
    if CLIENT_ID not in ALLOWED_CLIENT_IDS:
        raise SystemExit("Invalid AI_CORE_OPENCLAW_CLIENT_ID")
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
