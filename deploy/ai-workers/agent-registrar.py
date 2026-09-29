import json
import os
import time
import urllib.error
import urllib.request

AI_CORE_BASE_URL = os.environ.get("AI_CORE_BASE_URL", "https://aicore.cstlogistic.co.id/api").rstrip("/")
TOKEN = os.environ.get("AI_CORE_SCOPED_AGENT_TOKEN", "").strip()
INTERVAL_SECONDS = max(10, min(60, int(os.environ.get("AI_CORE_AGENT_HEARTBEAT_SECONDS", "20"))))
TIMEOUT_SECONDS = max(2, min(15, int(os.environ.get("AI_CORE_AGENT_HEALTH_TIMEOUT_SECONDS", "5"))))
OPENHANDS_KEY = os.environ.get("OPENHANDS_LOCAL_BACKEND_API_KEY", "").strip()

AGENTS = (
    {
        "clientId": "gcp-openclaw-main",
        "url": "http://openclaw:18789/healthz",
        "version": os.environ.get("OPENCLAW_VERSION", ""),
        "headers": {},
    },
    {
        "clientId": "gcp-openhands-coder",
        "url": "http://openhands:8000/server_info",
        "version": os.environ.get("OPENHANDS_VERSION", ""),
        "headers": {"X-Session-API-Key": OPENHANDS_KEY} if OPENHANDS_KEY else {},
    },
    {
        "clientId": "gcp-n8n-automation",
        "url": "http://n8n:5678/healthz",
        "version": os.environ.get("N8N_VERSION", ""),
        "headers": {},
    },
)


def local_health(agent):
    request = urllib.request.Request(agent["url"], headers=agent["headers"])
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            code = int(response.status)
        return ("healthy" if 200 <= code < 300 else "degraded", code, None)
    except urllib.error.HTTPError as exc:
        return ("degraded", int(exc.code), "http_error")
    except Exception as exc:
        return ("degraded", None, exc.__class__.__name__)


def heartbeat(agent):
    health, http_status, error_kind = local_health(agent)
    payload = json.dumps(
        {
            "health": health,
            "version": agent["version"] or None,
            "details": {
                "localHealthHttpStatus": http_status,
                "localHealthError": error_kind,
                "runtimeHost": "ai-coding-worker-01",
            },
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        f"{AI_CORE_BASE_URL}/ai/agent-runtime/presence/{agent['clientId']}/heartbeat",
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS + 10) as response:
        if not 200 <= int(response.status) < 300:
            raise RuntimeError(f"AI Core heartbeat HTTP {response.status}")
    print(f"heartbeat client={agent['clientId']} health={health}", flush=True)


def main():
    if not TOKEN:
        raise RuntimeError("AI_CORE_SCOPED_AGENT_TOKEN is required")
    while True:
        for agent in AGENTS:
            try:
                heartbeat(agent)
            except Exception as exc:
                print(
                    f"heartbeat failed client={agent['clientId']} error={exc.__class__.__name__}: {exc}",
                    flush=True,
                )
        time.sleep(INTERVAL_SECONDS)


if __name__ == "__main__":
    main()
