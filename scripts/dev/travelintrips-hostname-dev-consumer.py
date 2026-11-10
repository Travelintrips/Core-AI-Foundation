"""Isolated AI Core DEV hostname-only consumer for PC Travelintrips.
No shell, browser, model execution, repository mutation or PROD endpoints.
"""
import json
import logging
from logging.handlers import RotatingFileHandler
import msvcrt
import os
import re
import socket
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

CLIENT_ID = "openclaw-travelintrips-tools-dev"
BASE = os.environ.get("AI_CORE_BASE_URL", "").rstrip("/")
TOKEN = os.environ.get("AI_CORE_SCOPED_AGENT_TOKEN", "")
HOSTNAME_COMMAND = re.compile(r"^@?\s*cek hostname pc travelintrips$", re.IGNORECASE)
LOG_DIR = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "AI-Core"
LOG_DIR.mkdir(parents=True, exist_ok=True)
logger = logging.getLogger("travelintrips-hostname-dev")
logger.setLevel(logging.INFO)
handler = RotatingFileHandler(LOG_DIR / "travelintrips-hostname-dev.log", maxBytes=262144, backupCount=3, encoding="utf-8")
handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
logger.addHandler(handler)


def api(path, data):
    request = urllib.request.Request(
        BASE + path,
        data=json.dumps(data).encode("utf-8"),
        method="POST",
        headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            if response.status == 204:
                return None
            return json.loads(response.read(65536) or b"{}")
    except urllib.error.HTTPError as error:
        raise RuntimeError("AI_CORE_HTTP_" + str(error.code)) from None


def execute(work):
    metadata = work.get("metadata") or {}
    instruction = str(work.get("instruction") or "")
    if (work.get("commandType") != "EXTERNAL_AGENT_WORK"
        or work.get("source") != "ai-core-chat"
        or not isinstance(metadata, dict)
        or metadata.get("assignedClientId") != CLIENT_ID
        or metadata.get("requiredCapability") != "device:hostname"
        or metadata.get("capability") == "chatgpt:wake"
        or not HOSTNAME_COMMAND.fullmatch(instruction.strip())):
        return "FAILED", "Unsupported or unauthorized DEV command", {"reason": "fixed_grammar_denied", "workerId": CLIENT_ID}
    hostname = socket.gethostname()
    success = hostname.casefold() == "travelintrips"
    return ("COMPLETED" if success else "FAILED",
            hostname if success else "Unexpected hostname for Travelintrips",
            {"workerId": CLIENT_ID, "hostname": hostname, "verified": success, "mode": "read-only-hostname"})


def receipt_verified(receipt, command_id, status):
    return (isinstance(receipt, dict)
        and receipt.get("commandId") == command_id
        and receipt.get("status") == status
        and isinstance(receipt.get("response"), dict)
        and isinstance(receipt["response"].get("id"), str)
        and re.fullmatch(r"[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}", receipt["response"]["id"], re.IGNORECASE))


def main():
    if not BASE.startswith("https://dev.cstlogistic.co.id/api") or not TOKEN:
        raise SystemExit("HTTPS DEV endpoint and scoped agent token required")
    lock = open(LOG_DIR / "travelintrips-hostname-dev.lock", "a+b")
    lock.seek(0, os.SEEK_END)
    if lock.tell() == 0:
        lock.write(b"0")
        lock.flush()
    lock.seek(0)
    try:
        msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
    except OSError:
        raise SystemExit("Another Travelintrips hostname consumer is active")
    last_heartbeat = 0.0
    while True:
        try:
            now = time.monotonic()
            if now - last_heartbeat >= 45:
                api("/ai/agent-runtime/presence/" + CLIENT_ID + "/heartbeat",
                    {"health": "healthy", "version": "travelintrips-hostname-dev-1",
                     "details": {"runtimeHost": socket.gethostname(), "availableSlots": 1}})
                last_heartbeat = now
            work = api("/ai/agent-runtime/work/claim", {"clientId": CLIENT_ID, "leaseSeconds": 90})
            if isinstance(work, dict) and work.get("commandId") and work.get("claimToken"):
                command_id = str(work["commandId"])
                status, message, details = execute(work)
                receipt = api("/ai/agent-runtime/work/" + command_id + "/result",
                              {"clientId": CLIENT_ID, "claimToken": work["claimToken"],
                               "status": status, "message": message, "details": details})
                if not receipt_verified(receipt, command_id, status):
                    raise RuntimeError("AI_CORE_RESULT_RECEIPT_UNVERIFIED")
                logger.info("CALLBACK_VERIFIED commandId=%s status=%s responseId=%s",
                            command_id, status, receipt["response"]["id"])
        except Exception as error:
            logger.warning("cycle_error=%s", type(error).__name__ + (" " + str(error) if isinstance(error, RuntimeError) else ""))
        time.sleep(10)


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        test = {"commandType": "EXTERNAL_AGENT_WORK", "source": "ai-core-chat",
                "instruction": "@cek hostname pc travelintrips",
                "metadata": {"assignedClientId": CLIENT_ID, "requiredCapability": "device:hostname"}}
        result = execute(test)
        assert result[0] == "COMPLETED", result
        test["instruction"] += "; whoami"
        assert execute(test)[0] == "FAILED"
        print("HOSTNAME_DEV_SELF_TEST_PASS " + result[1])
    else:
        main()
