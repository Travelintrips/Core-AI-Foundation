# OpenClaw DEV consumer result recovery

The isolated DEV consumer now keeps a single durable pending result on its own Docker volume. After a completed execution, it saves the exact result with a private claim token before calling AI Core. On a transport failure or non-2xx result response, it retries result delivery and does not claim or execute another task. On restart, it loads that outbox before taking work. Pending files are mode 0600 and must never be logged or committed.

The healthcheck detects stale loops, claim errors and pending delivery. Docker restart policy recovers process exits; an unhealthy status alone does not restart a container. No autonomous restart of other services is installed.

OpenClaw HTTP 200 responses must include status `completed` and nonempty text. Failed, incomplete and empty responses become failed work results. Accepted execution results retain command ID and OpenClaw response ID with evidence stage `JOB_COMPLETED`. AI Core HTTP acceptance is not ChatGPT delivery or E2E verification.

The DEV lease is 300 seconds and the execution timeout is 180 seconds, leaving time for result submission. This does not implement lease renewal. A crash during execution before the result is durably saved still requires server-side fencing and reconciliation; never replay side effects automatically. Permanent result rejection (including an expired lease or a lost successful acknowledgment followed by 409) leaves the result pending and health degraded for reconciliation, without executing the job again.

Validation: `python -m unittest discover -s deploy/ai-workers -p 'test_external_agent_supervisor.py' -v`.

Deploy only the `dev-openclaw-work-consumer` service from `docker-compose.openclaw-dev-consumer.yml`, with the existing approved DEV credentials. Keep its Compose project name stable so the same outbox volume is reused. Do not recreate or modify the production registrar, gateway, WA services or production databases. Before replacing the running consumer, verify it has no active work claim. After deployment verify Docker health, source SHA, persistent volume, and a bounded read-only DEV command with matching result acknowledgment. Review the volume before rollback; never discard an undelivered result.
