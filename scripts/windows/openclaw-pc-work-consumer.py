"""Bounded Windows OpenClaw external-agent work consumer.

Requires AI_CORE_BASE_URL and AI_CORE_SCOPED_AGENT_TOKEN in the process environment.
Never logs bearer tokens or claim tokens. Runs agent instructions through OpenClaw CLI with bounded timeouts and existing approvals.
"""
import json
import re
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


def verify_execution_result(instruction, output, process_exit_code):
    """Agent process success is not proof a requested remote command succeeded."""
    if process_exit_code != 0:
        return False
    requested_hostinger_probe = (
        "185.124.136.115" in instruction and
        re.search(r"\\bwhoami\\b", instruction, re.I) and
        re.search(r"\\bhostname\\b", instruction, re.I)
    )
    if not requested_hostinger_probe:
        return True
    # Do not accept a model's explanatory success message as SSH stdout.
    # The worker must supply machine-readable stdout + remote exit code.
    try:
        data = json.loads(output)
    except (ValueError, TypeError):
        return False
    result = data.get("sshResult") if isinstance(data, dict) else None
    return (
        isinstance(result, dict)
        and result.get("exitCode") == 0
        and result.get("whoami", "").strip() == "u684045296"
        and result.get("hostname", "").strip() == "id-dci-web1320.main-hosting.eu"
        and result.get("verified", False) is True
    )


def execute(work):
    instruction = str(work.get("instruction", "")).strip()
    if not instruction or len(instruction) > 12000:
        return False, "Invalid instruction length", {"reason": "invalid_instruction"}
    # Exact, user-authorized read-only Hostinger probe. Execute directly on the
    # assigned PC with the existing key: no shell interpolation or passwords.
    if (CLIENT_ID == "openclaw-pc-worker" and
        "185.124.136.115" in instruction and
        re.search(r"\\bwhoami\\b", instruction, re.I) and
        re.search(r"\\bhostname\\b", instruction, re.I) and
        re.search(r"\\b(?:ssh|hostinger)\\b", instruction, re.I)):
        identity = os.path.join(os.path.expanduser("~"), ".ssh", "hostinger_shared_20261010_ed25519")
        if not os.path.isfile(identity):
            return False, "Existing Hostinger SSH identity not found", {"reason": "ssh_identity_missing"}
        result = subprocess.run(
            ["ssh", "-i", identity, "-o", "IdentitiesOnly=yes",
             "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
             "-o", "ConnectTimeout=10", "-p", "65002",
             "u684045296@185.124.136.115", "whoami; hostname"],
            capture_output=True, text=True, timeout=25, shell=False,
        )
        lines = [line.strip() for line in result.stdout.splitlines() if line.strip()]
        verified = result.returncode == 0 and lines == [
            "u684045296", "id-dci-web1320.main-hosting.eu"]
        return verified, (result.stdout if verified else "Read-only SSH probe failed")[:3000], {
            "runtime": "openclaw-pc", "mode": "ssh-readonly-hostinger",
            "exitCode": result.returncode, "workerId": CLIENT_ID,
            "sshVerified": verified,
        }
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
        verified = verify_execution_result(instruction, response, result.returncode)
        return verified, response[-3000:] if verified else "SSH execution evidence missing or failed", {
            "runtime": "openclaw-pc", "mode": "agent",
            "exitCode": result.returncode, "verified": verified,
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
