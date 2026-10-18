"""Install a separate DEV ChatGPT wake worker on DELL without modifying existing workers.

Run only after provisioning the new scoped AI Core worker credentials and its own
Ed25519 attestation identity. This bootstrap deliberately fails closed otherwise.
"""
import json
import os
from pathlib import Path

WORKER_ID = "openclaw-dell-chatgpt-wake-dev"
CONVERSATION_ID = "6ad4e0a7-9964-83ec-81a6-9db5eb8457ae"
BASE_URL = "https://dev.cstlogistic.co.id/api"


def validate_environment(root: Path) -> dict:
    env = root / "dell-chatgpt-wake-dev.env"
    if not env.is_file():
        raise RuntimeError("Dedicated DELL DEV credentials not provisioned")
    config = {}
    for line in env.read_text(encoding="utf-8").splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        key, sep, value = line.partition("=")
        if not sep or key in config:
            raise RuntimeError("Malformed or duplicate DEV worker configuration")
        config[key] = value.strip().strip('"').strip("'")
    if config.get("AI_CORE_OPENCLAW_CLIENT_ID") != WORKER_ID:
        raise RuntimeError("Dedicated DELL worker identity mismatch")
    if config.get("AI_CORE_BASE_URL", "").rstrip("/") != BASE_URL:
        raise RuntimeError("DEV endpoint mismatch")
    if not config.get("AI_CORE_SCOPED_AGENT_TOKEN"):
        raise RuntimeError("Dedicated DEV scoped credential missing")
    key = root / "dell-chatgpt-wake-attestation-ed25519.pem"
    if not key.is_file():
        raise RuntimeError("Dedicated DELL attestation key missing")
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    identity = serialization.load_pem_private_key(key.read_bytes(), password=None)
    if not isinstance(identity, Ed25519PrivateKey):
        raise RuntimeError("Wrong attestation key type")
    allowlist = root / "dell-chatgpt-wake-allowlist.json"
    data = json.loads(allowlist.read_text(encoding="utf-8"))
    if data != {"enabled": True, "allowedConversationIds": [CONVERSATION_ID]}:
        raise RuntimeError("Conversation binding mismatch")
    return {"workerId": WORKER_ID, "endpoint": BASE_URL, "conversationId": CONVERSATION_ID}


if __name__ == "__main__":
    base = Path(os.environ["LOCALAPPDATA"]) / "AI-Core"
    print(json.dumps(validate_environment(base), sort_keys=True))
