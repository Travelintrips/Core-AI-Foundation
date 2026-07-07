---
name: AI Platform auth design
description: How admin auth is wired between backend and frontend in this platform
---

## Rule
Backend uses `ADMIN_API_KEY` env var (Replit Secret). Frontend uses `VITE_ADMIN_API_KEY` (same value, also set as Replit Secret so it's available to the Vite process). After adding a new secret, the affected workflow MUST be restarted to pick it up.

## How it works
- `artifacts/api-server/src/middleware/adminAuth.ts` — checks `Authorization: Bearer <token>` or `x-admin-key` header against `process.env.ADMIN_API_KEY`. Fail-open if env var is not set (dev convenience).
- Public paths that bypass auth: `/healthz`, `/health`, `/ai/health`, `/ai/healthz`
- `artifacts/ai-platform/src/main.tsx` — calls `setAuthTokenGetter(() => import.meta.env.VITE_ADMIN_API_KEY)` from `@workspace/api-client-react`
- Middleware is applied in `app.ts`: `app.use("/api", adminAuthWithExceptions, router)`

**Why:** User requested "minimal admin API key middleware" before full auth system. This is a temporary measure — proper auth (Clerk/Replit Auth) should replace it eventually.

**How to apply:** When adding new protected routes, no changes needed — all `/api/*` routes except health are automatically protected. To add more public paths, edit `PUBLIC_PATH_PREFIXES` in adminAuth.ts.
