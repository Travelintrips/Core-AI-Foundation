import json
import os
import random
import pathlib
import sys
import time
import urllib.error
import urllib.request
import urllib.parse

API_BASE = os.environ.get("AI_CORE_BASE_URL", "https://aicore.cstlogistic.co.id/api").rstrip("/")
TOKEN = os.environ.get("AI_CORE_SCOPED_AGENT_TOKEN", "").strip()
CLIENT_ID = os.environ["AI_CORE_EXTERNAL_AGENT_CLIENT_ID"].strip()
RUNTIME = os.environ["AI_CORE_EXTERNAL_AGENT_RUNTIME"].strip().lower()
RECONNECT_BASE_SECONDS = max(2, min(60, int(os.environ.get("AI_CORE_AGENT_RECONNECT_BASE_SECONDS", "5"))))
LEASE_SECONDS = max(30, min(300, int(os.environ.get("AI_CORE_AGENT_WORK_LEASE_SECONDS", "120"))))
TIMEOUT_SECONDS = max(10, min(300, int(os.environ.get("AI_CORE_AGENT_WORK_TIMEOUT_SECONDS", "120"))))
OPENHANDS_URL = os.environ.get("OPENHANDS_INTERNAL_URL", "http://openhands:8000").rstrip("/")
OPENHANDS_KEY = os.environ.get("OPENHANDS_LOCAL_BACKEND_API_KEY", "").strip()
N8N_WORK_URL = os.environ.get(
    "N8N_AGENT_WORK_WEBHOOK_URL",
    "http://n8n:5678/webhook/ai-core-external-work",
).strip()
OPENCLAW_URL = os.environ.get(
    "OPENCLAW_INTERNAL_URL",
    "http://openclaw:18789",
).rstrip("/")
OPENCLAW_TOKEN = os.environ.get("OPENCLAW_GATEWAY_TOKEN", "").strip()
STATE_DIR = os.environ.get("AI_CORE_AGENT_STATE_DIR", "").strip()


def save_state(name, value):
    if not STATE_DIR:
        return
    directory = pathlib.Path(STATE_DIR)
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    target = directory / name
    temporary = directory / (name + ".tmp")
    with open(temporary, "w", encoding="utf-8", opener=lambda p, f: os.open(p, f, 0o600)) as handle:
        json.dump(value, handle)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, target)
    descriptor = os.open(directory, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def load_pending():
    if not STATE_DIR:
        return None
    path = pathlib.Path(STATE_DIR) / "pending-result.json"
    if not path.exists():
        return None
    with path.open(encoding="utf-8") as handle:
        pending = json.load(handle)
    if pending.get("clientId") != CLIENT_ID or pending.get("runtime") != RUNTIME:
        raise RuntimeError("Pending result belongs to a different worker; refusing new claims")
    return pending


def healthcheck():
    if not STATE_DIR:
        return 1
    try:
        with (pathlib.Path(STATE_DIR) / "health.json").open(encoding="utf-8") as handle:
            health = json.load(handle)
        fresh = 0 <= time.time() - health["updatedAt"] <= TIMEOUT_SECONDS + 120
        return 0 if fresh and health["state"] in ("idle", "executing", "ready") else 1
    except (OSError, ValueError, KeyError, TypeError):
        return 1


def mark_health(state):
    save_state("health.json", {"clientId": CLIENT_ID, "state": state, "updatedAt": time.time()})


def work_events():
    """Only ready/work_available wake the queue. Keepalives never cause claims."""
    url = API_BASE + "/ai/agent-runtime/work/stream?" + urllib.parse.urlencode({"clientId": CLIENT_ID})
    request = urllib.request.Request(url, headers={
        "Authorization": "Bearer " + TOKEN, "Accept": "text/event-stream",
    })
    with urllib.request.urlopen(request, timeout=45) as response:
        if "text/event-stream" not in response.headers.get("Content-Type", ""):
            raise RuntimeError("Expected an authenticated work event stream")
        event, data = "", []
        for raw in response:
            if len(raw) > 8192:
                raise RuntimeError("Work event line too large")
            line = raw.decode("utf-8").rstrip("\r\n")
            mark_health("idle")
            if not line:
                if event in ("ready", "work_available"):
                    payload = json.loads("\n".join(data))
                    if payload.get("clientId") != CLIENT_ID:
                        raise RuntimeError("Work event worker mismatch")
                    yield payload
                event, data = "", []
            elif line.startswith("event:"):
                event = line[6:].strip()
            elif line.startswith("data:"):
                data.append(line[5:].strip())
                if sum(map(len, data)) > 16384:
                    raise RuntimeError("Work event data too large")
    raise ConnectionError("Work event stream disconnected; reconnect and reconcile")


def _request(method, url, body=None, headers=None, timeout=None):
    data = None if body is None else json.dumps(body).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "accept": "application/json",
            **({"content-type": "application/json"} if body is not None else {}),
            **(headers or {}),
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout or TIMEOUT_SECONDS) as response:
            raw = response.read().decode("utf-8", errors="replace")
            payload = json.loads(raw) if raw else {}
            return int(response.status), payload
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            payload = {"error": {"message": raw[:4000]}}
        return int(exc.code), payload


def _ai_core(method, path, body=None):
    return _request(
        method,
        API_BASE + path,
        body,
        headers={"authorization": "Bearer " + TOKEN},
        timeout=30,
    )


def claim_work():
    try:
        status, payload = _ai_core(
            "POST",
            "/ai/agent-runtime/work/claim",
            {"clientId": CLIENT_ID, "leaseSeconds": LEASE_SECONDS},
        )
        if status == 204:
            return None
        if status != 200:
            raise RuntimeError("AI Core claim rejected HTTP " + str(status))
        if not isinstance(payload, dict) or not all(payload.get(k) for k in ("commandId", "claimToken", "instruction")):
            raise RuntimeError("AI Core returned an invalid work claim")
        return payload
    except urllib.error.HTTPError as exc:
        if int(exc.code) == 204:
            return None
        raise


class ExternalAgentExecutionError(RuntimeError):
    def __init__(self, message, details=None):
        super().__init__(message)
        self.details = details or {}


def report_result(work, ok, message, details):
    status, _ = _ai_core(
        "POST",
        "/ai/agent-runtime/work/" + str(work["commandId"]) + "/result",
        {
            "clientId": CLIENT_ID,
            "claimToken": work["claimToken"],
            "status": "COMPLETED" if ok else "FAILED",
            "message": str(message)[:50000],
            "details": details,
        },
    )
    if not 200 <= status < 300:
        raise RuntimeError("AI Core result not acknowledged HTTP " + str(status))


def deliver_pending(pending):
    report_result(pending["work"], pending["ok"], pending["message"], pending["details"])
    if STATE_DIR:
        (pathlib.Path(STATE_DIR) / "pending-result.json").unlink()
    print("result accepted client=" + CLIENT_ID + " command=" + str(pending["work"]["commandId"]), flush=True)


def _openhands_headers():
    if not OPENHANDS_KEY:
        raise RuntimeError("OPENHANDS_LOCAL_BACKEND_API_KEY is required")
    return {"X-Session-API-Key": OPENHANDS_KEY}


def run_openhands(work):
    model = "openai/ai-core-agent"
    conversation_payload = {
        "workspace": {
            "working_dir": "/projects",
            "kind": "LocalWorkspace",
        },
        "initial_message": {
            "role": "user",
            "content": [{"type": "text", "text": str(work["instruction"])}],
            "run": True,
        },
        "max_iterations": 25,
        "stuck_detection": True,
        "autotitle": False,
        "agent": {
            "kind": "Agent",
            "llm": {
                "model": model,
                "api_key": TOKEN,
                "base_url": API_BASE + "/ai/agent-runtime/v1",
                "usage_id": "ai-core-openhands-worker",
                "is_subscription": False,
            },
            "tools": [
                {"name": "terminal", "params": {}},
                {"name": "file_editor", "params": {}},
                {"name": "task_tracker", "params": {}},
            ],
            "agent_context": {
                "system_message_suffix": (
                    "You are the OpenHands coding executor managed by AI Core. "
                    "Stay inside the mounted /projects workspace. "
                    "Never deploy to production or bypass AI Core approval gates."
                )
            },
        },
    }

    _, conversation = _request(
        "POST",
        OPENHANDS_URL + "/api/conversations",
        conversation_payload,
        headers=_openhands_headers(),
        timeout=30,
    )
    conversation_id = str(
        conversation.get("id")
        or conversation.get("conversation_id")
        or ""
    ).strip()
    if not conversation_id:
        raise RuntimeError("OpenHands did not return a conversation id")

    deadline = time.monotonic() + TIMEOUT_SECONDS
    last_response = ""
    while time.monotonic() < deadline:
        _, result = _request(
            "GET",
            OPENHANDS_URL
            + "/api/conversations/"
            + conversation_id
            + "/agent_final_response",
            headers=_openhands_headers(),
            timeout=30,
        )
        if isinstance(result, dict):
            last_response = str(result.get("response") or "").strip()
        if last_response:
            return last_response[:20000], {
                "runtime": "openhands-native-conversation",
                "model": model,
                "conversationId": conversation_id,
            }
        time.sleep(2)

    raise RuntimeError(
        "OpenHands conversation timed out before producing a final response"
    )


def run_n8n(work):
    _, result = _request(
        "POST",
        N8N_WORK_URL,
        {
            "commandId": work["commandId"],
            "instruction": work["instruction"],
            "clientId": CLIENT_ID,
        },
        timeout=TIMEOUT_SECONDS,
    )
    if isinstance(result, dict):
        message = str(result.get("message") or result.get("status") or "").strip()
    else:
        message = ""
    if not message:
        message = json.dumps(result, ensure_ascii=False)[:20000]
    return message, {"runtime": "n8n-webhook", "workflow": "AI Core External Work"}


def _openclaw_output_text(payload):
    if not isinstance(payload, dict):
        return ""
    direct = payload.get("output_text")
    if isinstance(direct, str) and direct.strip():
        return direct.strip()
    chunks = []
    for item in payload.get("output") or []:
        if not isinstance(item, dict):
            continue
        for part in item.get("content") or []:
            if not isinstance(part, dict):
                continue
            text = part.get("text")
            if isinstance(text, str) and text.strip():
                chunks.append(text.strip())
    return "\n".join(chunks).strip()


def run_openclaw(work):
    if not OPENCLAW_TOKEN:
        raise RuntimeError("OPENCLAW_GATEWAY_TOKEN is required")
    status, result = _request(
        "POST",
        OPENCLAW_URL + "/v1/responses",
        {
            "model": "openclaw/main",
            "input": str(work["instruction"]),
            "user": "ai-core-external-agent",
        },
        headers={
            "authorization": "Bearer " + OPENCLAW_TOKEN,
            "x-openclaw-agent-id": "main",
        },
        timeout=TIMEOUT_SECONDS,
    )
    if status < 200 or status >= 300:
        error_obj = result.get("error") if isinstance(result, dict) else None
        if isinstance(error_obj, dict):
            detail = str(error_obj.get("message") or error_obj.get("type") or "").strip()
            upstream_error = {
                "message": error_obj.get("message"),
                "type": error_obj.get("type"),
                "code": error_obj.get("code"),
                "param": error_obj.get("param"),
            }
        else:
            detail = str(error_obj or result or "").strip()
            upstream_error = {
                "message": detail or None,
                "type": None,
                "code": None,
                "param": None,
            }
        raise ExternalAgentExecutionError(
            ("OpenClaw returned HTTP " + str(status) + (": " + detail if detail else ""))[:3000],
            {
                "runtime": "openclaw-responses",
                "agentId": "main",
                "httpStatus": status,
                "upstreamError": upstream_error,
            },
        )
    response_status = result.get("status") if isinstance(result, dict) else None
    message = _openclaw_output_text(result)
    if response_status != "completed" or not message:
        raise ExternalAgentExecutionError(
            "OpenClaw did not return a completed text response",
            {"runtime": "openclaw-responses", "responseStatus": response_status},
        )
    return message[:20000], {
        "runtime": "openclaw-responses",
        "agentId": "main",
        "responseId": result.get("id"),
        "responseStatus": response_status,
        "commandId": str(work["commandId"]),
        "evidenceStage": "JOB_COMPLETED",
    }


def execute(work):
    if RUNTIME == "openhands":
        return run_openhands(work)
    if RUNTIME == "n8n":
        return run_n8n(work)
    if RUNTIME == "openclaw":
        return run_openclaw(work)
    raise RuntimeError("Unsupported external agent runtime: " + RUNTIME)


def main():
    if not TOKEN:
        raise RuntimeError("AI_CORE_SCOPED_AGENT_TOKEN is required")

    idle_streak = 0
    pending = load_pending()
    events = None
    draining = False
    while True:
        work = None
        try:
            if pending:
                mark_health("delivery_pending")
                deliver_pending(pending)
                pending = None
                mark_health("ready")
                continue
            if not draining:
                if events is None:
                    events = work_events()
                next(events)
                draining = True
                idle_streak = 0
            mark_health("idle")
            work = claim_work()
            if not work:
                draining = False
                continue
            idle_streak = 0
            print("claimed work client=" + CLIENT_ID + " command=" + str(work.get("commandId")), flush=True)
            mark_health("executing")
            try:
                message, details = execute(work)
                ok = True
            except Exception as exc:
                ok = False
                message = "External agent execution failed: " + str(exc)[:3000]
                details = {
                    "runtime": RUNTIME,
                    "errorType": exc.__class__.__name__,
                    "errorMessage": str(exc)[:3000],
                }
                if isinstance(exc, ExternalAgentExecutionError):
                    details.update(exc.details)
            pending = {"clientId": CLIENT_ID, "runtime": RUNTIME, "work": work,
                       "ok": ok, "message": message, "details": details}
            # Do not claim more work or report success until this exact result is accepted.
            # A crash during execution itself still requires server-side lease fencing.
            try:
                save_state("pending-result.json", pending)
            except Exception:
                mark_health("outbox_write_failed")
                raise SystemExit("Result outbox unavailable; stopping without a new claim")
        except Exception as exc:
            if events is not None:
                events.close()
                events = None
            draining = False
            print(
                "external-agent worker error client="
                + CLIENT_ID
                + " error="
                + exc.__class__.__name__
                + ": "
                + str(exc)[:1000],
                flush=True,
            )
            mark_health("delivery_pending" if pending else "claim_error")
            idle_streak = min(idle_streak + 1, 8)
            time.sleep(min(60, RECONNECT_BASE_SECONDS * (2 ** min(idle_streak - 1, 4))) * random.uniform(0.85, 1.15))


if __name__ == "__main__":
    if "--healthcheck" in sys.argv:
        sys.exit(healthcheck())
    main()
