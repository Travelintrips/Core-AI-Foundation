# Team 36 — Design Platform Security: Threat Model and Audit

**Scope:** V4.5 AI Design Studio (design projects, canvas, versions, export, AI regeneration)
**Branch:** `feature/team-36-design-security`
**Date:** 2026-07-22
**Status:** Verified

---

## Assets

| Asset | Sensitivity | Description |
|---|---|---|
| `ai_design_projects` (DB table) | High | Tenant-owned design projects with canvas state |
| `ai_design_versions` (DB table) | High | Full canvas snapshots — can contain PII via text elements |
| AI provider key (`OPENAI_API_KEY`) | Critical | Backend secret — never exposed to frontend or logs |
| SVG export output | Medium | User-controlled content rendered by browsers/PDF engines |
| Canvas state (JSONB) | High | Element tree; may contain PII in text nodes |
| Admin API key (`ADMIN_API_KEY`) | Critical | Global auth gate for all admin routes |

---

## Trust Boundaries

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser / Admin Portal (UNTRUSTED)                             │
│  - No tenantId authority                                        │
│  - No provider key access                                       │
│  - SVG output must be consumed as <img>, not <object>/<iframe>  │
└────────────────────────┬────────────────────────────────────────┘
                         │ HTTPS + x-admin-api-key header
┌────────────────────────▼────────────────────────────────────────┐
│  API Server (TRUSTED)                                           │
│  - resolveAuthenticatedTenantContext() enforces tenant scope    │
│  - tenantId always from session/key, never from request body    │
│  - SVG generated with full attribute sanitization               │
│  - AI key read from process.env only                            │
└────────────────────────┬────────────────────────────────────────┘
                         │ Drizzle ORM (parameterized queries)
┌────────────────────────▼────────────────────────────────────────┐
│  Database / Supabase (TRUSTED)                                  │
│  - tenant_id column on ai_design_projects                       │
│  - All queries include AND tenant_id = ?                        │
└─────────────────────────────────────────────────────────────────┘
```

---

## Actors

| Actor | Scope | Trust Level |
|---|---|---|
| Platform Admin | Cross-tenant read; all operations | High (system-internal) |
| Tenant Admin | Own-tenant projects only | Medium |
| System / API key | Same as Platform Admin | High |
| Plugin | Declared capabilities only; never remote load | Low |
| AI Agent | Scoped to one project; never direct DB access | Low |
| Anonymous | No access to any design routes | None |

---

## Attack Surfaces

1. **Project ID in URL path** — numeric ID predictable; IDOR if tenant not enforced
2. **tenantId in request body** — client can supply any string
3. **SVG export output** — user-controlled element properties injected into SVG
4. **AI prompt input** — prompt injection / model manipulation
5. **Plugin manifest** — path traversal, remote module loading, capability escalation
6. **Export signed URL** — expiry not checked by client; replay after expiry
7. **Canvas state JSONB** — oversized payloads (DoS), deeply nested elements
8. **Font-family attribute** — CSS injection via SVG `font-family` attribute

---

## Threats and Mitigations

| # | Threat | Likelihood | Impact | Mitigation | Status |
|---|---|---|---|---|---|
| T1 | Tenant A reads Tenant B's project by guessing ID | High | High | `getDesignProject(id, tenantId)` — AND clause; returns null → 404 | ✅ Fixed |
| T2 | tenantId body injection to spoof tenant | High | High | `ctx.tenantId` overrides `req.body.tenantId` unconditionally | ✅ Fixed |
| T3 | SVG XSS via fill/stroke color url() | Medium | High | `safeCssColor()` allowlist regex rejects url() | ✅ Fixed |
| T4 | SVG XSS via font-family CSS injection | Medium | Medium | `safeFontFamily()` allowlist; falls back to "sans-serif" | ✅ Fixed |
| T5 | SVG SSRF via image href data: / javascript: | Medium | High | `safeHttpsUrl()` — only https:// accepted | ✅ Fixed |
| T6 | Remote plugin module loading | Low | Critical | `validatePluginModulePath()` rejects URL schemes and traversal | ✅ Fixed |
| T7 | Plugin capability escalation | Low | High | `validatePluginManifest()` checks declared vs. requested caps | ✅ Fixed |
| T8 | AI key leaked in response | Medium | Critical | `aiRegenerateElement()` only reads key from env; never serialized | ✅ Verified |
| T9 | Cross-version IDOR (versions of another tenant's project) | Medium | High | Version functions call `getDesignProject(id, tenantId)` first | ✅ Fixed |
| T10 | Oversized canvas payload (DoS) | Low | Medium | `validateCanvasResourceLimits()` + policy limits | ✅ Added |
| T11 | Platform-scope bypass by tenant actor | Low | High | `evaluateDesignPolicy()` checks `isPlatformActor` | ✅ Added |
| T12 | Audit log failure opening authorization | Low | Medium | Decision made before audit; audit failure swallowed | ✅ Verified |

---

## Residual Risks

| Risk | Severity | Notes |
|---|---|---|
| `DEFAULT_TENANT_ID = "default"` — all existing rows share one tenant | Medium | By design: platform is currently single-tenant. Multi-tenancy requires WP-02+ migration. |
| AI provider key rotation requires service restart | Low | No dynamic key refresh; acceptable for current scale. |
| Rate limiting is IP-based via `express-rate-limit` (globalLimiter) | Low | Design-specific policies key by tenantId but global limiter is IP-based. Acceptable until Redis store added. |
| SVG export as base64 data URL — browser may render directly | Low | Consumers (admin UI, customer portal) must use `<img>` not `<object>`. Not enforced server-side. |
| Plugin registry is currently empty — all plugins denied | None | Intended secure-by-default state. Add plugins via PR only. |

---

## Assumptions

- Admin API key is never exposed in frontend JavaScript bundles.
- `resolveAuthenticatedTenantContext()` is called before every design route handler.
- The database's parameterized query interface prevents SQL injection.
- SVG output is consumed by `<img>` tag only — never via `<object>`, `<embed>`, or `dangerouslySetInnerHTML`.
- The Supabase RLS layer (rls-v12.sql) provides defense-in-depth at the DB level.

---

## Out of Scope

- Other teams' routes (this audit covers design studio only).
- Full multi-tenancy membership (deferred to WP-02+).
- Real-time collaboration / WebSocket security.
- Plugin runtime sandboxing (no plugins currently registered).
- Customer Portal design-related routes (separate audit needed).

---

## Verification Mapping

| Requirement | Test |
|---|---|
| Tenant A cannot read B | Tests 1–3, design-studio.security-matrix.test.ts |
| tenantId injection rejected | Test 4, design-studio.security-matrix.test.ts |
| Null tenant fail-closed | Test 5, design-studio.security-matrix.test.ts |
| Platform actor allowed | Test 6 |
| Tenant actor blocked from platform | Test 7 |
| Actor spoof rejected | Test 8 |
| Unsafe plugin path | Tests 9–10 |
| Raw HTML blocked | Test 11 |
| Unsafe SVG sanitized | Test 12, design-studio.tenant-security.test.ts |
| Signed URL expiry | Test 13 |
| Rate limiting | Test 15 |
| Resource limits | Test 16 |
| Provider secret redacted | Test 18 |
| Audit event recorded | Test 19 |
| Cross-project rejected | Test 20 |
| Plugin version mismatch | Test 21 |
| Capability escalation | Test 22 |
| Config fail-closed | Test 23 |
| Rate limiter key isolation | Test 24 |
| Audit failure = no allow change | Test 25 |

---

## Team 39 Integration Notes

Team 39 inherits these guarantees when integrating:

- **Route mounting**: All `/api/ai/design/*` routes are behind `adminAuthWithExceptions` global middleware — no per-route auth needed.
- **RequestContext**: Use `resolveAuthenticatedTenantContext(req)` to get `ctx.tenantId`; never read `req.body.tenantId`.
- **Repository scope**: All DB calls include `AND tenant_id = ctx.tenantId`.
- **Plugin registry**: Call `validatePluginManifest()` before loading any plugin. Registry is currently empty (all plugins denied).
- **AI adapter**: Read provider key from `process.env["OPENAI_API_KEY"]` only — never pass to client.
- **Signed URL**: `exportDesign()` returns `expiresAt` — consumers must check before use.
- **Rate limiting**: `DESIGN_RATE_LIMIT_POLICIES` is importable for middleware configuration.
- **Resource limits**: Call `validateCanvasResourceLimits()` before saving large canvas payloads.
- **Audit events**: Use `buildDesignAuditEvent()` + pass to audit logger; handle throws — never let them affect the HTTP response.
- **Regression tests**: Import from `design-studio.security-matrix.test.ts` for integration regression.

> **Disclaimer**: This threat model covers the design studio scope only. It does not claim the broader platform is secure. Each team is responsible for its own threat surface.
