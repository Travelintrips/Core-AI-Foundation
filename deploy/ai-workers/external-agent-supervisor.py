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
LEASE_SECONDS = max(30, min(300, int(os.environ.get("AI_CORE_AGENT_WORK_LEASE_SECONDS", "120"))))
TIMEOUT_SECONDS = max(10, min(300, int(os.environ.get("AI_CORE_AGENT_WORK_TIMEOUT_SECONDS", "120"))))
OPENHANDS_URL = os.environ.get("OPENHANDS_INTERNAL_URL", "http://openhands:8000").rstrip("/")
OPENHANDS_KEY = os.environ.get("OPENHANDS_LOCAL_BACKEND_API_KEY", "").strip()
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
    try:
        status, payload = _ai_core(
            "POST",
            "/ai/agent-runtime/work/claim",
            {"clientId": CLIENT_ID, "leaseSeconds": LEASE_SECONDS},
        )
        return payload if status == 200 else None
    except urllib.error.HTTPError as exc:
        if int(exc.code) == 204:
            return None
        raise


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


def run_openhands(work):
    _, models = _request(
        "GET",
        OPENHANDS_URL + "/v1/models",
        headers=_openhands_headers(),
    )
    entries = models.get("data") if isinstance(models, dict) else None
    if not isinstance(entries, list) or not entries:
        raise RuntimeError("OpenHands returned no available models")
    model = str(entries[0].get("id") or "").strip()
    if not model:
        raise RuntimeError("OpenHands returned an invalid model id")

    _, result = _request(
        "POST",
        OPENHANDS_URL + "/v1/chat/completions",
        {
            "model": model,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You are the OpenHands coding executor managed by AI Core. "
                        "Stay inside the mounted /projects workspace. "
                        "Do not deploy to production or bypass AI Core approval gates."
                    ),
                },
                {"role": "user", "content": str(work["instruction"])},
            ],
            "stream": False,
        },
        headers=_openhands_headers(),
        timeout=TIMEOUT_SECONDS,
    )
    choices = result.get("choices") if isinstance(result, dict) else None
    text = ""
    if isinstance(choices, list) and choices:
        message = choices[0].get("message") if isinstance(choices[0], dict) else None
        if isinstance(message, dict):
            text = str(message.get("content") or "").strip()
    if not text:
        text = json.dumps(result, ensure_ascii=False)[:20000]
    return text, {"runtime": "openhands-agent-server", "model": model}


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
            print("claimed work client=" + CLIENT_ID + " command=" + str(work.get("commandId")), flush=True)
            message, details = execute(work)
            report_result(work, True, message, details)
            print("completed work client=" + CLIENT_ID + " command=" + str(work.get("commandId")), flush=True)
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
