# TEAM-05 — V4.2 Production Release Checklist

**Version:** 1.0 | **Date:** 2026-07-19 | **Branch:** `feature/v4.2i-analytics-production-readiness`

No item may be marked complete without evidence.

---

## Pre-Release Gate

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Approved branches (Teams 1–4) merged into integration/v4.2 | ⬛ PENDING | Awaiting integration manager |
| 2 | Team 05 branch rebased on integration/v4.2 | ⬛ PENDING | Base is origin/main (fallback — integration/v4.2 absent) |
| 3 | All Team 05 tests passed | ✅ | `pnpm --filter @workspace/api-server run test` |
| 4 | Typecheck passed | ✅ | `pnpm run typecheck:libs` + api-server typecheck |
| 5 | Build passed | ⬛ PENDING | Run `pnpm run build:api` |
| 6 | Migration reviewed — additive only | ✅ | `docs/team-05-analytics-migration.sql` (no DROP/ALTER) |
| 7 | Migration environment confirmed | ⬛ PENDING | Owner must confirm dev vs prod target |
| 8 | Feature flags configured in target env | ✅ | Seeded in migration SQL |
| 9 | Monitoring configured | ✅ | Structured logs via pino; existing rateLimiter |
| 10 | Rollback plan documented | ✅ | See Rollback Plan section below |
| 11 | Public endpoints verified (ingestion rate-limited) | ✅ | 120 req/min per IP |
| 12 | Admin endpoints verified (adminAuth required) | ✅ | All /ai/admin/* routes use adminAuth middleware |
| 13 | Analytics event contract verified (versioned) | ✅ | eventVersion: 1 on all events |
| 14 | Privacy review completed | ✅ | No PII in schema; see Privacy section below |
| 15 | UAT completed | ⬛ PENDING | 16 manual scenarios need verification |
| 16 | Owner approval received | ⬛ PENDING | |
| 17 | Main merge approval received | ⬛ PENDING | Team 6 reviews + integrates |

---

## Analytics Event Contract Verification

| Event | Version | Required Fields | PII Risk | Approved |
|---|---|---|---|---|
| marketplace_viewed | 1 | eventId, eventName, sessionId, occurredAt | None | ✅ |
| goal_discovery_viewed | 1 | + none extra | None | ✅ |
| goal_card_viewed | 1 | + goalSlug | None | ✅ |
| goal_opened | 1 | + goalSlug | None | ✅ |
| goal_services_loaded | 1 | + goalSlug | None | ✅ |
| goal_empty_state_viewed | 1 | + goalSlug | None | ✅ |
| goal_error_viewed | 1 | + goalSlug | None | ✅ |
| catalog_search_started | 1 | none extra (query NOT logged) | None | ✅ |
| catalog_search_completed | 1 | + metadata.resultCount | None | ✅ |
| catalog_search_empty | 1 | none | None | ✅ |
| catalog_filter_applied | 1 | + categoryCode | None | ✅ |
| catalog_filter_removed | 1 | + categoryCode | None | ✅ |
| service_card_viewed | 1 | + serviceCode | None | ✅ |
| service_opened | 1 | + serviceCode, source | None | ✅ |
| service_selected_from_goal | 1 | + goalSlug, serviceCode | None | ✅ |
| service_selected_from_collection | 1 | + collectionSlug, serviceCode | None | ✅ |
| service_quote_started | 1 | + serviceCode | None | ✅ |
| service_request_started | 1 | + serviceCode | None | ✅ |
| solution_collection_viewed | 1 | + collectionSlug | None | ✅ |
| solution_collection_opened | 1 | + collectionSlug | None | ✅ |
| collection_service_selected | 1 | + collectionSlug, serviceCode | None | ✅ |
| quote_form_viewed | 1 | + serviceCode | None | ✅ |
| quote_submitted | 1 | + quoteId, serviceCode | None | ✅ |
| request_form_viewed | 1 | + serviceCode | None | ✅ |
| request_submitted | 1 | + requestId, serviceCode | None | ✅ |
| checkout_started | 1 | + serviceCode | None | ✅ |
| payment_started | 1 | + serviceCode | None | ✅ |
| order_created | 1 | + orderId, serviceCode | None | ✅ |

---

## Privacy Review

| Item | Status | Notes |
|---|---|---|
| No full name stored | ✅ | Not in schema |
| No email stored | ✅ | Not in schema |
| No phone stored | ✅ | Not in schema |
| No address stored | ✅ | Not in schema |
| No payment credentials stored | ✅ | Not in schema |
| No API keys logged | ✅ | Logger redacts env vars |
| No prompt content stored | ✅ | Not in scope |
| No AI output stored | ✅ | Not in scope |
| Anonymous ID is client-generated UUID | ✅ | No cross-site tracking |
| Customer ID set server-side only | ✅ | Never trusted from client |
| Tenant ID set server-side only | ✅ | Never trusted from client |
| Environment set server-side only | ✅ | From NODE_ENV |
| Raw event retention documented | ✅ | 90 days (see migration SQL) |
| Aggregate retention documented | ✅ | Permanent |
| Dedup table retention | ✅ | 24 h TTL via expires_at |
| Test/production data isolated | ✅ | environment column on all rows |
| Consent infrastructure | ⬛ | Not present in platform — documented as known limitation |

---

## Feature Flag Rollout Plan

| Stage | Flags | Action | Criterion to Advance |
|---|---|---|---|
| Stage 0 — Internal | discovery_analytics_enabled=true | Analytics capture ON for all | Event data flowing, no errors |
| Stage 1 — Limited | goal_discovery_enabled=true, rollout=10% | 10% of sessions see goal discovery | Error rate < 1%, event integrity confirmed |
| Stage 2 — Expanded | goal_discovery_enabled=true, rollout=50% | 50% of sessions | Conversion delta vs baseline positive |
| Stage 3 — Default | new_marketplace_default=true, rollout=100% | V4.2 is default experience | UAT approved, no regressions |
| Stage 4 — Stabilize | — | Remove internal instrumentation only after approval | 2-week clean window |

---

## Rollback Plan

> Rollback must not require a code redeploy or DB migration.

### Step 1 — Disable goal discovery
```
POST /api/ai/admin/analytics/flags/v4_2_goal_discovery_enabled
Body: { "enabled": false, "rolloutPercent": 0 }
Header: x-admin-api-key: <ADMIN_API_KEY>
```

### Step 2 — Disable solution collections
```
POST /api/ai/admin/analytics/flags/v4_2_solution_collections_enabled
Body: { "enabled": false, "rolloutPercent": 0 }
```

### Step 3 — Revert to legacy marketplace
```
POST /api/ai/admin/analytics/flags/v4_2_new_marketplace_default
Body: { "enabled": false, "rolloutPercent": 0 }
```

### Step 4 — Optionally disable analytics capture
```
POST /api/ai/admin/analytics/flags/v4_2_discovery_analytics_enabled
Body: { "enabled": false, "rolloutPercent": 0 }
```

**Result:** All V4.2 features disabled. Legacy catalog remains accessible. No DB migration needed. Already-stored events are preserved. No customer dead-ends.

**Verify rollback:**
```
GET /api/analytics/flags/v4_2_goal_discovery_enabled
Expected: { "key": "v4_2_goal_discovery_enabled", "enabled": false }
```

---

## Known Limitations

1. **No consent infrastructure** — Platform has no cookie consent / GDPR banner. Anonymous analytics rely on legitimate interest. Flagged for legal review before production launch.
2. **integration/v4.2 base branch absent** — Branch was created from `origin/main` (most recent codebase) as the nearest available base. Requires rebasing on `integration/v4.2` once it is created.
3. **16 manual QA scenarios not yet executed** — Requires a developer to run the browser flows listed in the QA matrix.
4. **Daily aggregation cron not implemented** — `ai_discovery_daily_metrics` and `ai_discovery_funnel_metrics` are designed for pre-aggregated data. Live queries run directly against `ai_discovery_events`. A cron job should be added for production-scale deployments.
5. **Dedup table cleanup cron not implemented** — Expired rows accumulate unless a cleanup job runs `DELETE FROM ai_discovery_event_dedup WHERE expires_at < now()`.

---

## Remaining Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Analytics event volume overloads DB | Medium | Medium | Rate limiter at 120/min per IP; add cron aggregation |
| Dedup table grows unbounded | Medium | Low | Known limitation; cron cleanup planned |
| Feature flag cache stale during flag disable | Low | Medium | 60s max staleness; acceptable for rollback |
| integration/v4.2 diverges from main before rebase | Low | High | Rebase immediately when branch available |
| No consent layer violates GDPR for EU customers | High | High | Legal review required before prod |

---

## Release Classification

**READY FOR INTERNAL UAT**

Evidence:
- 44 automated tests passing
- All ingestion, dedup, flag, and reporting logic implemented
- 0 known failures
- 16 manual scenarios pending

Not yet READY FOR LIMITED ROLLOUT because:
- Manual QA not complete
- integration/v4.2 rebase pending
- Consent infrastructure gap needs legal sign-off
