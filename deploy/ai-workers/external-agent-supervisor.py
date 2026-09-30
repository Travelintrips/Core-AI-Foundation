import json
import os
import time
import urllib.error
import urllib.request

API_BASE = os.environ.get("AI_CORE_BASE_URL", "https://aicore.cstlogistic.co.id/api").rstrip("/")
TOKEN = os.environ.get("AI_CORE_SCOPED_AGENT_TOKEN", "").strip()
CLIENT_ID = os.environ["AI_CORE_EXTERNAL_AGENT_CLIENT_ID"].strip()
RUNTIME = os.environ["AI_CORE_EXTERNAL_AGENT_RUNTIME"].strip().lower()
POLL_SECONDS = max(2, min(60, int(os.environ.get("AI_CORE_AGENT_WORK_POLL_SECONDS", "5"))))
TIMEOUT_SECONDS = max(10, min(300, int(os.environ.get("AI_CORE_AGENT_WORK_TIMEOUT_SECONDS", "120"))))
CONFIGURED_LEASE_SECONDS = max(
    30,
    min(300, int(os.environ.get("AI_CORE_AGENT_WORK_LEASE_SECONDS", "120"))),
)
LEASE_SECONDS = min(300, max(CONFIGURED_LEASE_SECONDS, TIMEOUT_SECONDS + 30))
OPENHANDS_URL = os.environ.get("OPENHANDS_INTERNAL_URL", "http://openhands:8000").rstrip("/")
OPENHANDS_KEY = os.environ.get("OPENHANDS_LOCAL_BACKEND_API_KEY", "").strip()
OPENHANDS_MODEL = os.environ.get("OPENHANDS_LLM_MODEL", "openai/ai-core-agent").strip()
OPENHANDS_LLM_BASE_URL = os.environ.get("OPENHANDS_LLM_BASE_URL", "").strip()
OPENHANDS_LLM_API_KEY = os.environ.get("OPENHANDS_LLM_API_KEY", TOKEN).strip()
OPENHANDS_WORKSPACE = os.environ.get("OPENHANDS_AI_CORE_WORKSPACE", "/projects").strip()
N8N_WORK_URL = os.environ.get(
    "N8N_AGENT_WORK_WEBHOOK_URL",
    "http://n8n:5678/webhook/ai-core-external-work",
).strip()


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
    with urllib.request.urlopen(request, timeout=timeout or TIMEOUT_SECONDS) as response:
        raw = response.read().decode("utf-8", errors="replace")
        payload = json.loads(raw) if raw else {}
        return int(response.status), payload


def _ai_core(method, path, body=None):
    return _request(
        method,
        API_BASE + path,
        body,
        headers={"authorization": "Bearer " + TOKEN},
        timeout=30,
    )


def claim_work():
    status, payload = _ai_core(
        "POST",
        "/ai/agent-runtime/work/claim",
        {"clientId": CLIENT_ID, "leaseSeconds": LEASE_SECONDS},
    )
    return payload if status == 200 else None


def renew_work(work):
    status, _ = _ai_core(
        "POST",
        "/ai/agent-runtime/work/" + str(work["commandId"]) + "/renew",
        {
            "clientId": CLIENT_ID,
            "claimToken": work["claimToken"],
            "leaseSeconds": LEASE_SECONDS,
        },
    )
    if status != 200:
        raise RuntimeError("AI Core work lease renewal failed with HTTP " + str(status))


def report_result(work, ok, message, details):
    _ai_core(
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


def _openhands_headers():
    if not OPENHANDS_KEY:
        raise RuntimeError("OPENHANDS_LOCAL_BACKEND_API_KEY is required")
    return {"X-Session-API-Key": OPENHANDS_KEY}


def _openhands_agent_settings():
    _, settings = _request(
        "GET",
        OPENHANDS_URL + "/api/settings",
        headers=_openhands_headers(),
        timeout=30,
    )
    agent_settings = settings.get("agent_settings") if isinstance(settings, dict) else None
    if not isinstance(agent_settings, dict):
        agent_settings = {
            "schema_version": 6,
            "agent_kind": "openhands",
            "agent": "CodeActAgent",
        }
    else:
        agent_settings = json.loads(json.dumps(agent_settings))

    if not OPENHANDS_MODEL or not OPENHANDS_LLM_API_KEY:
        raise RuntimeError("OpenHands AI Core scoped LLM configuration is incomplete")

    llm = agent_settings.get("llm")
    if not isinstance(llm, dict):
        llm = {}
    llm.update(
        {
            "model": OPENHANDS_MODEL,
            "api_key": OPENHANDS_LLM_API_KEY,
            "base_url": OPENHANDS_LLM_BASE_URL or None,
            "provider_connection_id": None,
            "usage_id": "ai-core-openhands",
            "is_subscription": False,
        }
    )
    agent_settings["llm"] = llm
    agent_settings["enable_sub_agents"] = False
    return agent_settings


def _openhands_instruction(work):
    return "\n".join(
        [
            "You are OpenHands executing a role-scoped repository task assigned by the AI Core control plane.",
            "Use tools inside the isolated worktree to inspect code, run safe build/test commands, and perform code review.",
            "This external-agent path is non-mutating: do not edit files, commit, push, merge, deploy, alter databases/security, or access/print credentials.",
            "If the user asks for a mutation, report that it must run through the AI Core Coding Orchestrator and approval gates.",
            "",
            str(work["instruction"]),
        ]
    )


def _interrupt_openhands(conversation_id):
    try:
        _request(
            "POST",
            OPENHANDS_URL + "/api/conversations/" + conversation_id + "/interrupt",
            headers=_openhands_headers(),
            timeout=15,
        )
    except Exception:
        pass


def run_openhands(work):
    _, conversation = _request(
        "POST",
        OPENHANDS_URL + "/api/conversations",
        {
            "workspace": {
                "working_dir": OPENHANDS_WORKSPACE,
                "kind": "LocalWorkspace",
            },
            "worktree": True,
            "initial_message": {
                "role": "user",
                "content": [{"text": _openhands_instruction(work)}],
                "run": True,
            },
            "max_iterations": 80,
            "stuck_detection": True,
            "autotitle": False,
            "tags": {"aicore": "external-work"},
            "agent_settings": _openhands_agent_settings(),
        },
        headers=_openhands_headers(),
        timeout=45,
    )
    conversation_id = str(conversation.get("id") or "").strip()
    if not conversation_id:
        raise RuntimeError("OpenHands conversation response did not contain an id")

    try:
        _request(
            "POST",
            OPENHANDS_URL + "/api/conversations/" + conversation_id + "/run",
            headers=_openhands_headers(),
            timeout=30,
        )
    except urllib.error.HTTPError as exc:
        if int(exc.code) != 409:
            raise

    deadline = time.monotonic() + TIMEOUT_SECONDS
    next_renewal = time.monotonic() + max(15, LEASE_SECONDS // 2)

    try:
        while time.monotonic() < deadline:
            if time.monotonic() >= next_renewal:
                renew_work(work)
                next_renewal = time.monotonic() + max(15, LEASE_SECONDS // 2)

            _, result = _request(
                "GET",
                OPENHANDS_URL
                + "/api/conversations/"
                + conversation_id
                + "/agent_final_response",
                headers=_openhands_headers(),
                timeout=30,
            )
            text = str(result.get("response") or "").strip() if isinstance(result, dict) else ""
            if text:
                return text[:20000], {
                    "runtime": "openhands-agent-conversation",
                    "conversationId": conversation_id,
                    "isolatedWorktree": True,
                    "mutationAllowed": False,
                }
            time.sleep(2)
    finally:
        if time.monotonic() >= deadline:
            _interrupt_openhands(conversation_id)

    raise RuntimeError("OpenHands bounded execution timed out before a final response was produced")


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
    return message, {
        "runtime": "n8n-webhook",
        "workflow": "AI Core External Work",
    }


def execute(work):
    if RUNTIME == "openhands":
        return run_openhands(work)
    if RUNTIME == "n8n":
        return run_n8n(work)
    raise RuntimeError("Unsupported external agent runtime: " + RUNTIME)


def main():
    if not TOKEN:
        raise RuntimeError("AI_CORE_SCOPED_AGENT_TOKEN is required")

    while True:
        work = None
        try:
            work = claim_work()
            if not work:
                time.sleep(POLL_SECONDS)
                continue
            print(
                "claimed work client="
                + CLIENT_ID
                + " command="
                + str(work.get("commandId")),
                flush=True,
            )
            message, details = execute(work)
            report_result(work, True, message, details)
            print(
                "completed work client="
                + CLIENT_ID
                + " command="
                + str(work.get("commandId")),
                flush=True,
            )
        except Exception as exc:
            print(
                "external-agent worker error client="
                + CLIENT_ID
                + " error="
                + exc.__class__.__name__
                + ": "
                + str(exc)[:1000],
                flush=True,
            )
            if work:
                try:
                    report_result(
                        work,
                        False,
                        "External agent execution failed: " + str(exc)[:3000],
                        {"runtime": RUNTIME, "errorType": exc.__class__.__name__},
                    )
                except Exception:
                    pass
            time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
