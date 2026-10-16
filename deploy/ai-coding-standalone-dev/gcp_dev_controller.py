"""On-demand Compute Engine wakeup for authenticated, explicitly opted-in DEV jobs.

This module never stops a VM. The VM-local shared Ollama/ComfyUI guard owns shutdown.
"""
import base64
import json
import os
import time
import requests
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

PROJECT = "ollama-510011"
ZONE = "asia-northeast1-c"
INSTANCE = "instance-20260928-124118"
CREDENTIAL_PATH = "/opt/core-ai-prod/secrets/gcp-bootstrap.json"
BASE = f"https://compute.googleapis.com/compute/v1/projects/{PROJECT}/zones/{ZONE}/instances/{INSTANCE}"

def _b64(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")

def _token():
    with open(CREDENTIAL_PATH, encoding="utf-8") as f:
        credential = json.load(f)
    if credential.get("type") != "service_account" or credential.get("client_email") != "aicore@aicore-505614.iam.gserviceaccount.com":
        raise RuntimeError("Unexpected Compute service identity")
    now = int(time.time())
    claim = {"iss": credential["client_email"], "scope": "https://www.googleapis.com/auth/cloud-platform",
             "aud": "https://oauth2.googleapis.com/token", "iat": now, "exp": now + 180}
    data = _b64(json.dumps({"alg": "RS256", "typ": "JWT"}, separators=(",", ":")).encode()) + "." + _b64(json.dumps(claim, separators=(",", ":")).encode())
    key = serialization.load_pem_private_key(credential["private_key"].encode(), password=None)
    signature = key.sign(data.encode(), padding.PKCS1v15(), hashes.SHA256())
    response = requests.post("https://oauth2.googleapis.com/token", data={"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": data + "." + _b64(signature)}, timeout=12)
    response.raise_for_status()
    return response.json()["access_token"]

def ensure_for_dev_job(job_id, payload):
    if os.getenv("GCP_OLLAMA_AUTOSTART_DEV_ENABLED") != "true":
        raise RuntimeError("DEV GCP autostart disabled")
    if payload.get("environment") != "DEV" or payload.get("repository") != "Travelintrips/Core-AI-Foundation" or payload.get("ref") != "develop" or payload.get("requires_ollama") is not True:
        raise RuntimeError("Job is not authorized to wake GCP Ollama")
    if not isinstance(job_id, str) or len(job_id) != 36:
        raise RuntimeError("Invalid job identifier")
    headers = {"Authorization": "Bearer " + _token()}
    response = requests.get(BASE, headers=headers, timeout=15)
    response.raise_for_status()
    status = response.json().get("status", "").upper()
    if status in ("RUNNING", "STAGING", "PROVISIONING"):
        return {"gcp_start": "already_active", "status_before": status, "project": PROJECT, "instance": INSTANCE}
    if status != "TERMINATED":
        raise RuntimeError("Refusing to start VM in unexpected state " + status[:50])
    started = requests.post(BASE + "/start", headers=headers, timeout=15)
    started.raise_for_status()
    return {"gcp_start": "requested", "status_before": status, "project": PROJECT, "instance": INSTANCE, "operation": started.json().get("name")}
