---
name: Customer Portal
description: Customer-facing Creative AI Studio portal at /studio/ — architecture, token handling, dashboard navigation fix
---

## Token handling in customer portal routes

**Rule:** When creating customer-submitted reviews, always set `reviewTokenPlain` in `creative_ai_client_reviews` at insert time — this is the only way the dashboard endpoint can surface a usable review link back to the customer. The hash is used for validation; the plain is used for dashboard navigation.

**Why:** SHA-256 hashes stored in `review_token_hash` are one-way. Without `review_token_plain`, `GET /public/customer/dashboard/:token` can only return empty `reviewToken`/`reviewUrl` fields, breaking dashboard project card navigation.

**How to apply:** In `customer-portal.ts` submit route, include `reviewTokenPlain: reviewToken` in the `creativeAiClientReviewsTable` insert. Admin-created review flows leave `reviewTokenPlain` null.

## Dashboard token flow

`POST /public/customer/request-access` always issues a fresh token (deletes+replaces existing hash in `customer_dashboard_tokens` for that email hash). The plaintext token is returned directly — no email delivery in this environment. This is intentional and documented.

## URL construction

`buildBaseUrl()` in `customer-portal.ts` checks `REPLIT_DEV_DOMAIN` env var first; falls back to `x-forwarded-host` headers. This ensures URLs in API responses point to the real Replit proxy domain, not `localhost:8080`.

## Route mounting

Customer portal routes are in `artifacts/api-server/src/routes/customer-portal.ts`, mounted in `routes/index.ts`. Routes use `/public/customer/*` prefix which is in `PUBLIC_PATH_PREFIXES` in `adminAuth.ts` — no admin key needed.

## autoGenerate must actively trigger the pipeline

**Rule:** The customer submit route's `autoGenerate` flag must actually call `runCreativeBriefWorkflow(project.id)` and, once that resolves, chain `runImageDesignerPipeline(project.id, projectId, N)`. Just recording the flag in the event payload does nothing — the admin-facing `creative-ai.ts` routes call these functions explicitly and customer-portal must mirror that.

**Why:** Originally `autoGenerate` was captured and stored but never used to start generation, so customer-submitted projects sat at `status: "pending"` forever and the review page showed an endless "Generating your assets…" spinner.

**How to apply:** Any new public/customer flow that promises AI generation must explicitly invoke the same service functions the admin routes use (`creativeWorkflowRunner.runCreativeBriefWorkflow`, `imageDesignerService.runImageDesignerPipeline`), fire-and-forget with a `.catch()` that marks the project `failed` and logs an audit entry.

## Never render passthrough AI-output objects directly in JSX

**Rule:** `copyOutput` and `creativeDirection` in the review API are `zod.object({}).passthrough()` — i.e. arbitrary nested objects (tagline, headline, body_copy, cta, creative_concept, color_direction, etc.), not strings. Frontend must destructure specific fields, never `{review.copyOutput}` directly.

**Why:** Rendering the raw object as a React child throws "Objects are not valid as a React child" and crashes the whole review page for every customer.

**How to apply:** When wiring any new consumer of `PublicProjectReview`, type `copyOutput`/`creativeDirection` as the actual nested shape (see `use-customer.ts`) and render named subfields with optional chaining, not the whole object.

## Stale dist/ vs. edited source causes misleading stack traces

**Rule:** If a workflow's dev script only rebuilds `dist/` on workflow *start* (not on file change), editing source without restarting leaves the running process on an old build. Node's `--enable-source-maps` will still map stack traces to *current* source line numbers, which can point at innocuous-looking lines (e.g. a closing `});`) that have nothing to do with the real bug.

**Why:** Wasted significant debugging time chasing a "TypeError: Cannot read properties of undefined (reading 'catch')" on a `publishSafe(...)` call that was actually fine in current source — the deployed code was just stale.

**How to apply:** Whenever a stack trace points at a line that looks obviously correct, compare `dist/index.mjs` mtime against the source file's mtime before debugging further; restart the workflow to rebuild if they've diverged.

## Image pipeline chained after text workflow needs polling to match

**Rule:** If image generation is chained to run *after* project `status` flips to `completed`, the frontend's `refetchInterval` must also poll while any asset `status` is `generating`/`pending`, not just while the project itself is `pending`/`running` — otherwise polling stops before images are ready and the UI looks stuck.

**Why:** `runImageDesignerPipeline` sets each Replicate FLUX generation to `status: "generating"` for 10–120s per asset; this happens strictly after `runCreativeBriefWorkflow` (which sets project `status: "completed"`) resolves.

**How to apply:** Compute a combined "still working" flag (`project pending/running OR any asset generating/pending`) and use it both for the `refetchInterval` predicate and any UI spinner gating.
