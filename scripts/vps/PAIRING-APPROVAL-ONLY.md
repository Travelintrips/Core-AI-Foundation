# Pairing approval host: isolated candidate and explicit promotion

## Why this exists

The AI Engine vhost currently sends the exact MCP paths to the dedicated V2
gateway, while its fallback sends OAuth to an older full application runtime.
Updating the V2 gateway does not update the pairing approval middleware.
PR #1394 already added the narrow opaque-origin navigation exception; this
candidate lets that approval handler run without starting the full application.

This is an identity service, not an operational DEV gateway. Its health response
reports the explicitly configured identity environment. A production identity
database remains production even if the requesting connector forwards jobs to DEV.

This change is preparation only. It does not change Nginx, deploy a container,
copy credentials, alter database grants or approve a pairing. Promotion to the
existing shared production identity store requires explicit owner authorization.

## Boundaries

- Only GET and POST to /api/ai/core-chat/oauth/pair/approve are exposed.
- Only GET /api/healthz is available outside that exact path.
- All other paths and methods, including HEAD, OPTIONS, login, token exchange,
  discovery and operational MCP calls, return 404 before the OAuth router.
- The existing OAuth router verifies the signed session and active internal user,
  then uses the existing pairing service. Those modules are unchanged.
- The existing oauthNavigationCors exception stays limited to a form-urlencoded
  POST with Origin:null, Sec-Fetch-Site:same-origin, Sec-Fetch-Mode:navigate and
  Sec-Fetch-Dest:document. It grants no cross-origin response access.
- app.ts, index.ts, controllers, schedulers and application startup are not imported.
- The build bundles workspace TypeScript using the API workspace's installed
  esbuild and writes a module-input manifest. It does not install dependencies,
  download packages or depend on a root tsx loader.
- No production configuration or credentials may be used for candidate testing.

The pre-existing behavior for an empty approval code is not changed. Never send
an authenticated empty-code probe: the legacy handler can select a pending pairing.

## Build from reviewed GitHub source

Inspect the supplied base image first. It must already be local and independently
validated. Do not use an unverified moving tag or allow a remote image pull.
The API workspace must contain its installed esbuild and runtime dependencies.

The inspected base core-ai-dev:vps-79afa6561221 had image ID
sha256:4a7fd6c5fb4ef3128ae2b763e9d787110c829350f70b5b0062d56ff61922c13d.
The OAuth router, OAuth service, pairing service and internal-session service in
that source match develop b0054c7c585aee33f32ae37af284621bdfe1d241.
Reconfirm those facts for the actual image used; an image name is not provenance.

Set PAIRING_SOURCE_SHA to the exact reviewed overlay commit and PAIRING_BASE_IMAGE
to the already-verified immutable local image ID, then run from that GitHub checkout:

~~~bash
docker image inspect "$PAIRING_BASE_IMAGE" > /dev/null
docker build --pull=false --network=none \
  --build-arg BASE_IMAGE="$PAIRING_BASE_IMAGE" \
  --build-arg SOURCE_SHA="$PAIRING_SOURCE_SHA" \
  -f scripts/vps/Dockerfile.pairing-approval-only \
  -t cst-pairing-approval-candidate:"$PAIRING_SOURCE_SHA" .
~~~

The overlay SHA labels the changed launcher/wrapper, not the complete base image.
Retain both immutable identities and dist-pairing/build-inputs.json as evidence.
The Dockerfile overrides the inherited entrypoint and command. Do not reattach
a broad bootstrap-entry.cjs or start scripts/hostinger-start.cjs.

## Required runtime configuration

Supply all identity configuration explicitly through the approved deployment
mechanism. No credential values belong in GitHub or command output.

- PAIRING_APPROVAL_ENABLED=true
- PAIRING_APPROVAL_IDENTITY_ENV=development or production
- APP_ENV and NODE_ENV must exactly match that identity environment.
- AI_CORE_PUBLIC_BASE_URL must be the explicit canonical HTTPS issuer origin.
- SESSION_SECRET and the database environment must identify the intended existing
  identity store. The normal database resolver and DEV isolation checks still run.
- PORT is normally 3000.
- PAIRING_APPROVAL_BUILD_SHA is set by the reviewed image build.

If the existing approved identity mechanism uses Secret Manager, the launcher
supports its existing GCP_SECRET_MANAGER_BOOTSTRAP_JSON or explicit read-only
GCP_SECRET_MANAGER_BOOTSTRAP_FILE. Bootstrap completes before database imports.
It cannot silently change the selected identity environment or issuer.
Do not reuse a production bootstrap mount for DEV testing.

## Test without a database connection

Focused tests use the real OAuth router with mocked session/database services:

~~~bash
pnpm --filter @workspace/api-server exec vitest run \
  src/middleware/__tests__/oauthNavigationCors.test.ts \
  src/__tests__/pairingApprovalApp.test.ts
pnpm --filter @workspace/api-server run typecheck
~~~

For a compiled runtime smoke, use an isolated container with --network none,
no published ports and no mounts. Supply a task-owned test env file containing
development identity settings, a dummy session secret, the expected CST-DEV
project reference and a synthetic database URL for that reference. Do not supply
GCP bootstrap variables. Use docker exec and loopback HTTP for the checks.

Expected results without any Cookie or Authorization header:

1. GET /api/healthz returns 200, service=mcp-pairing-approval,
   identityEnvironment=development, backgroundControllers=false and exact overlay SHA.
2. Form POST to the approval path with the complete valid opaque-navigation headers
   and a nonempty test code returns the existing 401 session error, with no
   Access-Control-Allow-Origin or Access-Control-Allow-Credentials.
3. Cross-site/JSON/fetch opaque-origin requests are rejected before authentication.
4. Other paths and unsupported methods return 404.
5. There are no startup table writes, bootstrap secrets or database connections.
   Health and unauthenticated approval do not call getInternalUserById or the
   pairing service; unit tests assert those boundaries.

These checks prove routing and the unauthenticated boundary, not authenticated
pairing, token delivery or MCP end-to-end success.

## Reviewable live route, not automatically applied

Only after the target identity store and exact deployment are explicitly
authorized, retain the old OAuth runtime and route only this exact path to the
reviewed candidate on loopback 18117. Keep MCP at 18116 and other OAuth/fallback
routes at 18092. Use the existing vhost's proxy headers and timeouts:

~~~nginx
location = /api/ai/core-chat/oauth/pair/approve {
    proxy_pass http://127.0.0.1:18117;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;
}
~~~

The reviewed target file is
/etc/nginx/sites-available/aiengine.cstlogistic.co.id.
Back up the exact vhost, run nginx -t and only then perform an authorized reload.
Do not remove or rewrite Origin, Sec-Fetch headers, cookies or authentication.
Do not replace the existing fallback or either exact MCP location.

Rollback removes this exact added location or restores the saved vhost, validates
Nginx and reloads after authorization. It returns approval traffic to the original
18092 upstream. No schema, credential, token or pairing-record rollback is part
of this change. Retain the old runtime and immutable candidate for comparison.
