---
name: P0 Production Readiness Sprint
description: All 6 P0 blockers fixed — security hardening, payment gate, file lock, signed URLs, rate limiting, SSRF guard.
---

## What was done

### P0-1 Payment Gate
- `POST /creative-ai/brief` now creates project at `status: "waiting_payment"` — workflow only fires on admin payment verification.
- `POST /public/customer/submit` sets `status: "waiting_payment"`, ignores `autoGenerate` flag.

### P0-2 File Lock (Signed URLs)
- New service: `src/services/signedUrlService.ts` — HMAC-SHA256 signed tokens, in-memory revocation.
- New route `src/routes/files.ts`: `GET /public/files/access/:token` (double-gate: valid token + `filesUnlocked=true`), `POST /ai/files/generate-token`, `POST /ai/files/revoke-token`.
- `GET /public/catalog/requests/:requestId` now returns `filesUnlocked`, `paymentStatus`, `remainingBalance`; `completionLinks` only visible when `filesUnlocked=true`.
- Customer portal `request-results.tsx` shows lock screen + remaining balance when `filesUnlocked=false`.

### P0-3 Rate Limiting
- Middleware: `src/middleware/rateLimiter.ts` — 5 tiers (global 200/15min, payment 20/hr, aiGeneration 10/10min, clientReview 30/10min, upload 10/10min).
- `globalLimiter` applied to all `/api` routes via `app.ts`.
- `aiGenerationLimiter` on `POST /creative-ai/brief`.
- `paymentLimiter` on `POST /public/payments/:scheduleId/submit-proof`.

### P0-4 Helmet + CORS Whitelist
- `helmet()` with custom CSP applied in `app.ts`.
- CORS: permissive in development (`NODE_ENV=development`), `ALLOWED_ORIGINS`-whitelist in production.

### P0-4 SSRF Guard
- Middleware: `src/middleware/ssrfGuard.ts` — blocks RFC-1918, loopback, link-local, cloud metadata (169.254.x).
- Applied to `POST/PATCH /ai/providers` (blocks malicious `baseUrl`).
- Applied to `POST /ai/human-tasks` (blocks malicious `notificationHookUrl`).

### P0-5 Payment Admin: Reject + KPI + Manual Unlock
- `paymentScheduleService.ts`: `rejectPayment(scheduleId, rejectedBy, reason)` added; transitions to `failed`, audit logs, publishes event.
- New routes in `payments.ts`: `GET /ai/payments/kpi`, `POST /ai/payments/:scheduleId/reject`, `POST /ai/payments/project/:projectId/unlock`.
- Admin `payments.tsx` UI: KPI cards (paid revenue, outstanding, pending, locked/unlocked), Reject button with reason input, Manual Unlock button.

## Key rules
- `createdProjectId` in `ai_service_requests` is TEXT storing `creative_projects.project_id` (UUID) — join on `eq(creativeProjectsTable.projectId, row.createdProjectId)` not `.id`.
- `rejectPayment` transitions schedule to `"failed"` (not `"rejected"` — enum only has failed/cancelled/paid/pending/partially_paid).
- In development `NODE_ENV=development`, CORS allows all origins (Replit preview iframe needs this).
- Signed URL SECRET falls back to `SESSION_SECRET` → `ADMIN_API_KEY` → insecure dev string; always set `SESSION_SECRET` in production.
- `pnpm run verify` passes clean after all changes.
