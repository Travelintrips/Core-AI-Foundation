# Windows OpenClaw PC worker bootstrap

The existing heartbeat task only updates presence; it does not consume work. This
consumer polls AI Core with the **PC-specific** clientId, claims work, and sends
COMPLETED/FAILED acknowledgements with the returned claim token.

Install from an authenticated user PowerShell session on Travelintrips PC:

```powershell
$envPath = Join-Path $env:USERPROFILE 'aicore-worker-bootstrap\ai-workers.env'
$workerPath = Join-Path $env:LOCALAPPDATA 'AI-Core\openclaw-pc-work-consumer.py'
# Copy scripts/windows/openclaw-pc-work-consumer.py from the verified repository to $workerPath.
# Configure AI_CORE_BASE_URL and AI_CORE_SCOPED_AGENT_TOKEN securely in the worker
# process environment. Do not embed secrets in task arguments or scripts.
python $workerPath
```

Do not run multiple consumer instances for the same clientId. The current
allowlist intentionally supports only PING and STATUS diagnostics; arbitrary
shell execution and browser control are not enabled. Extend the allowlist
with audited, separately authorized actions before production orchestration.

A successful heartbeat alone is **not** evidence of command delivery. Validate
command ID, claim, completion result and acknowledgement against the actual
AI Core control-plane before marking the PC worker E2E-ready.
