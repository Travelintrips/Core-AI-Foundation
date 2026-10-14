# Verified Docker image retention on a shared VPS

**Purpose:** After a newer release has passed its deployment checks, retire
old, unreferenced application image tags without harming production, rollback,
databases, WhatsApp sessions or active agents.

## Safety contract

- **No deletion at first install or first enrollment.** The initial record
  establishes an immutable baseline. Only a later image, recorded by a
  successful deployment, can make older versions eligible for retirement.
- The new image must remain the exact running, Docker-healthy image for
  **24 hours** after verification. AI Core app images additionally require the
  exact SHA from the local healthz endpoint.
- Always retain the verified active image and **one previously verified image
  for rollback**. If that rollback is missing, fail closed.
- All running AND stopped containers protect their image IDs. The script
  **never deletes containers**, even historical backup containers.
- Only these opt-in application image repositories are in scope:
  core-ai-dev, ai-core-prod, ai-core-repository-analyzer, and
  ghcr.io/openclaw/openclaw.
- Tags latest, stable, production, and develop are protected; images
  newer than the verified release are protected.
- Maximum five old tags per scheduled execution. Docker can refuse removal;
  no force flag, broad system prune, volume removal, or container removal.
- A failed health check, missing receipt, failed SHA check, or missing
  rollback results in zero removals for that service.
- Deletion is opt-in through post-deploy registration, not inferred from the
  presence of a recently built image.

## Install (authorized VPS root; no immediate cleanup)

    bash deploy/vps-maintenance/install.sh

The installer runs offline Python tests, installs the guarded script, and
enables the cst-docker-image-retention.timer for 04:30 Asia/Jakarta daily
(21:30 UTC, jitter up to 15 minutes). It uses low I/O priority.

## After a verified deployment

Only after all deployment checks/E2E have passed, enroll the new image:

    sudo python3 /usr/local/libexec/cst-docker-image-retention.py record \
      --service openclaw \
      --evidence "verified-deploy:EXACT_RUN_ID"

The VPS worker deployment workflow does this automatically for OpenClaw,
strictly after its full-stack healthcheck succeeds. Failed verifications
cannot enroll a release.

For AI Core DEV/PROD application images, supply the exact commit SHA:

    sudo python3 /usr/local/libexec/cst-docker-image-retention.py record \
      --service core-dev \
      --sha EXACT_40_CHARACTER_GIT_SHA \
      --evidence "dev-e2e:EXACT_RUN_ID"

The local health endpoint must return status ok with exactly the matching
X-CST-Commit-SHA header. This example is documentation, not proof that
currently deployed DEV or PROD passed an E2E test.

## Inspection and recovery

    sudo python3 /usr/local/libexec/cst-docker-image-retention.py sweep
    systemctl list-timers cst-docker-image-retention.timer
    journalctl -u cst-docker-image-retention.service -n 100 --no-pager

Dry run is the CLI default. Only the scheduled service explicitly passes
sweep --apply. Disable safely with:

    sudo systemctl disable --now cst-docker-image-retention.timer

Root-only receipts are stored at /var/lib/cst-docker-image-retention/;
they contain image IDs and CI identifiers but no authentication tokens.

**Limitations:** Old images referenced by stopped rollback/test containers
remain protected. Existing historical images need a separate reviewed cleanup
plan; future automated retirements do not prune stopped containers. This
policy does not replace independent DEV hosting or the DEV-first production
release gate.
