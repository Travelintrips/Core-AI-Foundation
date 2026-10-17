"""Single-shot DEV-only heartbeat for the VPS OpenClaw worker.

Run from the existing registrar container with AI_CORE_BASE_URL pointing to
core-ai-dev. Designed for a systemd timer; does not change the PROD registrar.
"""
import importlib.util
import os
from pathlib import Path

EXPECTED_URL = "http://core-ai-dev:3000/api"
EXPECTED_CLIENT = "openclaw-vps-main"

def main():
    if os.environ.get("AI_CORE_BASE_URL", "").rstrip("/") != EXPECTED_URL:
        raise SystemExit("Refusing to send DEV heartbeat to a non-DEV endpoint")
    if os.environ.get("AI_CORE_OPENCLAW_CLIENT_ID") != EXPECTED_CLIENT:
        raise SystemExit("Refusing unexpected OpenClaw client ID")
    source = Path(__file__).with_name("agent-registrar.py")
    spec = importlib.util.spec_from_file_location("cst_agent_registrar", source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    agents = [a for a in module.AGENTS if a["clientId"] == EXPECTED_CLIENT]
    if len(agents) != 1:
        raise SystemExit("Expected exactly one DEV OpenClaw agent")
    module.heartbeat(agents[0])

if __name__ == "__main__":
    main()
