---
name: provider-health-check-slug-baseurl
description: Anthropic/Gemini provider health checks in registry.ts show INACTIVE due to slug/baseUrl mismatches between seed scripts
---

The admin Registry page pings providers via `pingProvider` in `artifacts/api-server/src/routes/registry.ts`, which switches on `provider.slug` and appends paths to `provider.baseUrl`. Two divergent seed scripts exist (`src/seed.ts` vs `src/routes/seed.ts`) with different slugs/baseUrls for the same providers.

Symptom seen: Anthropic health check returns HTTP 404, Google Gemini returns HTTP 401, even though the actual API keys work fine (verified directly with curl).

Root cause: `src/seed.ts` seeded Anthropic's baseUrl as `https://api.anthropic.com` (missing `/v1`) and Google's slug as `"google"` (not `"gemini"`/`"google-gemini"`), so pingProvider's Gemini branch didn't match and fell through to the generic Bearer-auth branch — wrong auth style for Gemini's `?key=` param style.

**Why real LLM calls still worked:** `aiExecutionService.ts` hardcodes full URLs per provider and ignores `provider.baseUrl` entirely, and its slug switch already includes `"google"`, `"google-gemini"`, and `"gemini"`. Only the health-check ping in registry.ts was affected — this is a diagnostics/display bug, not a functional outage.

**Fix applied:** broadened registry.ts's Gemini branch to also match slug `"google"`, fixed `src/seed.ts`'s Anthropic baseUrl to include `/v1`, and patched the already-seeded DB rows directly via PATCH `/api/ai/providers/:id` (no full reseed needed).

**How to apply:** if a provider shows INACTIVE with 401/404 in the Registry but its API key works via direct curl, check for slug/baseUrl mismatches between pingProvider's branch conditions and whatever seeded the DB — don't assume the key itself is bad.
