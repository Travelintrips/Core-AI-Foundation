# VPS Docker image cleanup

This VPS has two distinct policies. Nothing modifies named Docker volumes,
database contents, WhatsApp sessions, or running containers.

## Policy A — AI Core DEV and PROD: only images actively running

Applies only to these image repositories and their exact canonical containers:

- `core-ai-dev` → `core-ai-dev`, health `127.0.0.1:18082/api/healthz`
- `ai-core-prod` → `ai-core-prod-api`, health `127.0.0.1:18088/api/healthz`
- Legacy unused DEV image repositories `ai-core-dev` and `core-ai` may be removed.

Requirements before removal:

1. BOTH canonical DEV and PROD Docker containers are **running and healthy**.
2. BOTH local application health endpoints return HTTP 200, JSON
   `{"status":"ok"}`, and a valid 40-character `X-CST-Commit-SHA` header.
3. There are no additional running DEV/PROD app canaries or duplicate instances.
4. Recheck exact container ID, image ID, health, and Git SHA before EACH removal.
5. Only stopped containers from the four allowlisted repositories can be
   removed. A stopped container with any Docker **volume** mount is retained.
   Bind mount files and named Docker volumes are never deleted.
6. Only unused app image tags older than 2 hours can be removed. Newly built
   images are temporarily protected against collisions with ongoing deploys.
7. Image tags shared with unrelated repositories and images referenced by any
   preserved container are always protected.
8. No `--force`, no `docker system prune`, and no unscoped container pruning.

**No old image or rollback image is intentionally kept for DEV/PROD.** Rollback
must rebuild an image from the source Git commit if needed. This is deliberate
per the administrator's active-image-only directive.

Dry run (prints exact candidates, **does not remove anything**):

    sudo python3 /usr/local/libexec/cst-docker-active-only.py

Run the approved cleanup immediately:

    sudo python3 /usr/local/libexec/cst-docker-active-only.py --apply

The most recent root-only audit summary is written at
`/var/lib/cst-docker-image-retention/active-only-last-run.json`.

## Policy B — other opted-in workers: retain one verified rollback

The existing `docker_image_retention.py` policy still applies to the
Repository Analyzer and OpenClaw after verified deploys. It requires CI
evidence and preserves the running image, one rollback image, and all
images referenced by any running or stopped container.

AI Core DEV and PROD are explicitly **excluded** from that rollback policy.
The AI Workers VPS deployment records OpenClaw evidence only after its full
stack healthcheck passed.

## Install and schedule

    bash deploy/vps-maintenance/install.sh

The installer runs both offline test suites, installs two cleanup executables
and updates the existing `cst-docker-image-retention.service`. The existing
systemd timer runs every day at 04:30 Asia/Jakarta (21:30 UTC) with up to
15 minutes randomized delay.

Installing the timer does NOT delete anything immediately. The active-only
script has dry-run behavior unless explicitly passed `--apply`.

Monitoring:

    systemctl status cst-docker-image-retention.timer --no-pager
    journalctl -u cst-docker-image-retention.service -n 80 --no-pager
    sudo python3 /usr/local/libexec/cst-docker-active-only.py

To disable both automatic policies:

    sudo systemctl disable --now cst-docker-image-retention.timer

## Scope and limitations

This is intentionally **not** a global Docker garbage collector. PostgreSQL,
Redis, n8n, WhatsApp Gateway, OpenHands, Temporal and other application
images must not be treated as unused just because a container is currently
stopped; some jobs are intentionally started only when needed.

No hosting/DEV–PROD isolation or release-gate protections are relaxed.
