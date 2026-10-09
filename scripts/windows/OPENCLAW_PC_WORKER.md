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

## Three-PC rollout (#1007)

Each PC MUST use a different `AI_CORE_OPENCLAW_CLIENT_ID` environment setting in its
`ai-workers.env` file, and the heartbeat producer must use the **same ID** as its consumer:

- PC 1: `AI_CORE_OPENCLAW_CLIENT_ID=openclaw-pc-worker`
- PC 2: `AI_CORE_OPENCLAW_CLIENT_ID=openclaw-pc-worker-2`
- PC 3: `AI_CORE_OPENCLAW_CLIENT_ID=openclaw-pc-worker-3`

Each PC must have independently scoped credentials issued for its own identity.
Never copy a bearer token between PCs or commit tokens to Git. Set one consumer instance
per client ID and confirm that the corresponding heartbeat reports health and spare
capacity. Suggested heartbeat details: `availableSlots: 1, activeJobs: 0` when idle;
`availableSlots: 0, activeJobs: 1` when busy. Update these values from the actual
running-job state rather than static configuration. The server accepts a lease only while
heartbeat remains valid; stale/absent agents must not receive new work.

This change only selects destinations for *new* jobs. A running job abandoned after a
network outage requires the separately audited, atomic bridge claim/reclaim mechanism
with idempotency keys, to avoid replaying non-idempotent side effects. Do not certify
production failover until 3-PC parallel execution, PC offline reassignment, VPS fallback,
and OpenAI **model-only** fallback are each verified end-to-end. OpenAI cannot substitute
for a Windows desktop tool executor.
