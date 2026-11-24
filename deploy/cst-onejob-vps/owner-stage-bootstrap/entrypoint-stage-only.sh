#!/bin/sh
# Source-only, fail-closed. No root trust, signing, QA mint or dispatch.
set -eu
: "${CREDENTIALS_DIRECTORY:?missing systemd credential directory}"
[ "$CREDENTIALS_DIRECTORY" = /run/credentials/cst-onejob-owner-stage.service ] ||
 { echo ONEJOB_STAGE_CREDENTIAL_DIRECTORY_DENIED;exit 77; }
[ "${APP_ENV:-}" = development ] && [ "${NODE_ENV:-}" = development ] ||
 { echo ONEJOB_STAGE_NOT_DEV;exit 77; }
[ "${AI_DISPATCHER_ENABLED:-}" = false ] &&
 [ "${AI_SCHEDULER_ENABLED:-}" = false ] &&
 [ "${OLLAMA_WORKER_RUNTIME_ENABLED:-}" = false ] &&
 [ "${CST_DEV_ONEJOB_BROKER_ENABLED:-}" = false ] &&
 [ "${CST_DEV_ONEJOB_OWNER_APPROVAL_ENABLED:-}" = true ] ||
 { echo ONEJOB_STAGE_UNAPPROVED_FEATURE_OR_DISPATCH_DENIED;exit 77; }
[ -r "$CREDENTIALS_DIRECTORY/database-url" ] &&
 [ -r "$CREDENTIALS_DIRECTORY/session-secret" ] &&
 [ -r /run/cst-onejob-dev-db/ca/prod-ca-2021.crt ] ||
 { echo ONEJOB_STAGE_REQUIRED_CREDENTIALS_OR_CA_MISSING;exit 77; }
[ -r /app/.cst-build-sha ] ||
 { echo ONEJOB_STAGE_SOURCE_STAMP_MISSING;exit 77; }
source_sha="$(cat /app/.cst-build-sha)"
[ "$source_sha" = "${CST_TEAM_DEV_APPROVED_SOURCE_SHA:-}" ] ||
 { echo ONEJOB_STAGE_SOURCE_MISMATCH;exit 77; }
[ "${CST_DEV_ONEJOB_OPERATIONS_CANDIDATE_FINGERPRINT:-}" = 65aa7599c60cc0acc71d72f9f3bd5bd810873aad725fa64856e36639c995f71b ] ||
 { echo ONEJOB_STAGE_PUBLIC_CANDIDATE_MISMATCH;exit 77; }
# Only a protected copy of the EXISTING Core session signing secret is
# valid. Never generate a new issuer or print any private bytes.
SESSION_SECRET="$(cat "$CREDENTIALS_DIRECTORY/session-secret")"
[ "${#SESSION_SECRET}" -ge 32 ] ||
 { echo ONEJOB_STAGE_SESSION_SECRET_INVALID;exit 77; }
export SESSION_SECRET
[ -f /run/cst-stage-http-supervisor.cjs ] &&
[ -d /run/cst-onejob-stage-http ] ||
 { echo ONEJOB_STAGE_HTTP_UNIX_SUPERVISOR_MISSING; exit 77; }
exec node /run/cst-stage-http-supervisor.cjs
