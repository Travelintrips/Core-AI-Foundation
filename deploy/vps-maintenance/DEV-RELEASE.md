# Isolated VPS development releases

The **DEV** application is built on Hostinger VPS `srv1792369`, Docker container `core-ai-dev`, bound to `127.0.0.1:18082`. Its canonical OAuth issuer and ChatGPT MCP resource are `https://dev.cstlogistic.co.id` and `https://dev.cstlogistic.co.id/api/ai/core-chat/mcp`. The legacy deployment/DNS vhost `dev-aicore.cstlogistic.co.id` still exists for release compatibility; it is **not** the canonical OAuth issuer. DEV HTTPS is terminated by the existing VPS Nginx TLS configuration and serves static files from `/var/www/dev-aicore`. Do not switch an authenticated ChatGPT connection between hostnames: the OAuth issuer and client ID contribute to the event channel identity, and switching hosts cannot recover historical ACKs automatically.

**PROD** at `aicore.cstlogistic.co.id` remains independently deployed from the protected `main` branch on Hostinger's managed application service. The VPS `ai-core-prod-api` container, where deployed, has separate image, credentials, port and database; the DEV release script never changes it.

## Release sequence

1. `develop` passes **CI Verify** and **DEV Fast Verify** at the *same immutable commit*. The on-host `cst-vps-dev-ci-watcher.timer` polls every few minutes.
2. `scripts/vps/dev_ci_watcher.py` rejects unverified SHA or non-green runs; it invokes `scripts/vps/deploy_dev_release.py` only for the verified current develop HEAD.
3. The release script pins the source SHA, builds with dedicated BuildKit resource limits (0.8 CPU, 2GiB buildkit RAM), confirms image-embedded SHA, then starts a **canary** on localhost port 18084 using DEV credentials and a 0.8-CPU/1.5GiB memory limit.
4. The canary must report `200 {"status":"ok"}` and `x-cst-commit-sha` equal to the exact source SHA. Frontend and unauthorized access smoke must pass.
5. Only then does the script replace the DEV runtime on port 18082 and switch static frontend. Prior DEV runtime and static files are retained for rollback; on a failed release the script restores both.
6. GitHub `Hostinger DEV Deploy` verifies exact public revision using an HTTPS **pinned-VPS** request (before altering DNS). It checks frontend assets, anonymous dashboard isolation and unchanged current PROD-main revision. Only then may it validate and update the **single** Hostinger DNS `dev-aicore` A record, and verify authoritative DNS plus public HTTPS exact SHA.
7. Only a successful `Hostinger DEV Deploy` run for the exact live DEV commit is eligible to serve as evidence for `scripts/verify-dev-first-release.mjs` when production is promoted. No release with missing gates or shared-file drift can be promoted.

This workflow does not require adding a new shared-hosting plan or upgrading the current VPS.

## Security

- DEV uses `/opt/core-ai-dev/.env.dev` (mode 600) with **CST-DEV Supabase project** credentials. The DEV database resolver rejects wrong, missing and production project references. Never copy production credentials to DEV.
- Every release snapshots PROD container identity and verifies its health and identity before and after.
- PROD application identity and image are not modified by DEV release.
- DEV candidate exposes only loopback-bound ports; no public Docker port.
- Development image startup explicitly disables PROD workers, on-host Ollama/GCP autostart, background schedulers and provider billing polling.
- `cst-vps-dev-ssh-gate.sh` is an optional restricted SSH forced-command control; its private key **is not** stored in GitHub. Routine releases use pull-based CI monitoring and require no SSH secret.
- Hostinger DNS API credentials are read only by GitHub environment automation. The DNS operation only updates `dev-aicore` A records after all readiness gates, and rejects other record types for that name.
- The existing `cst-docker-image-retention.timer` safely retires unreferenced images and old stopped DEV backups by policy, preserving active versions and volumes.

## On-host service verification

```bash
systemctl is-enabled cst-vps-dev-ci-watcher.timer
systemctl is-active cst-vps-dev-ci-watcher.timer
systemctl show cst-vps-dev-ci-watcher.service -p Result -p ExecMainStatus
journalctl -u cst-vps-dev-ci-watcher.service -n 50 --no-pager
curl -fsSI http://127.0.0.1:18082/api/healthz
curl -fsSI http://127.0.0.1:18088/api/healthz
docker ps --format '{{.Names}} {{.Status}}'
```

**Operational limit:** the VPS has 2 vCPU and 8GiB RAM with high historical swap usage. Never schedule concurrent heavy DEV builds. CI and release are serialized by `flock`; BuildKit has a dedicated resource-constrained builder. Upgrade only if real queue delays or memory pressure justify it.
