# Team 13 — Dynamic Design Composition Engine

## Domain Boundary

### What Team 13 does

Team 13 is a **composition orchestrator**. It combines pre-computed design
elements — produced by upstream teams — into a single deterministic
`DesignCompositionSpec` JSON document.

Specifically, Team 13:

- Accepts a `LayoutPlanInput` from **Team 12** (already solved — not re-solved here)
- Accepts `BlueprintInput`, `ComponentInput[]`, `PatternInput`, `PaletteInput`,
  `TypographyInput`, `DecorationInput`, `MaterialInput`, `MotifInput`
- Accepts optional `BrandDnaInput` for brand-alignment scoring and fallback derivation
- Fills missing inputs with deterministic fallbacks (brand-derived or hard defaults)
- Checks cross-element compatibility (material ↔ pattern, palette ↔ typography WCAG, etc.)
- Scores brand consistency (color, typography, layout, personality dimensions)
- Derives CSS design tokens (spacing scale, font scale, shadow map, z-index layers)
- Produces a full explainability report (why each element was chosen, alternatives rejected)
- Returns `DesignCompositionSpec` — pure JSON, no images, no files, no rendering

### What Team 13 does NOT do

| Prohibited capability | Reason |
|---|---|
| Layout constraint solving | Owned by **Team 12** |
| Grid position computation | Owned by **Team 12** |
| Blueprint constraint planning | Owned by **Team 12** |
| Image generation | Out of domain scope |
| File rendering (PDF, PPTX, ZIP) | Out of domain scope |
| AI model inference | Out of domain scope |
| Persistent database writes | Pure computation — no DB tables |
| External HTTP calls | No SSRF surface |

### Boundary with Team 12

```
Team 12 (static deterministic constraint layout planning)
  ├── Input:  blueprint dimensions, device constraints, content requirements
  ├── Output: LayoutPlanInput { strategy, flow, heroWeight, sectionCount, ... }
  └── Guarantee: fully solved — no further constraint computation needed

Team 13 (composition orchestration)
  ├── Input:  LayoutPlanInput (from Team 12, verbatim) + all other design elements
  ├── Process: combine → fallback → check compatibility → score brand → derive tokens
  └── Output: DesignCompositionSpec (pure JSON)
```

Team 13 **receives** `LayoutPlanInput` and uses it as-is. It does not re-solve
layout constraints, does not call Team 12's solver, and does not produce
layout plans from scratch. The only layout-related logic in Team 13 is:

- Applying a hard-coded **default** `LayoutPlanInput` when none is provided (fallback handler)
- Reading the `strategy` field to derive brand consistency scores and explanations

This is metadata usage, not constraint solving.

---

## Session State Machine

Composition sessions (when `idempotencyKey` is provided) follow this lifecycle:

```
pending ──→ processing ──→ completed  (terminal)
                      └──→ failed     (terminal — retry via allowRetry=true only)
         └──→ cancelled               (terminal)
```

### Terminal state rules

| State | Behaviour |
|---|---|
| `completed` | Return cached `DesignCompositionSpec`. Never reprocess. |
| `failed` | Blocked unless `allowRetry: true` in request. Retry resets to `pending`. |
| `cancelled` | Always blocked. Caller must create a new request with a new key. |
| `processing` | Blocked (concurrent execution guard). |
| `pending` | Allowed — proceed to compose. |

---

## IDOR Protection

Session lookups are scoped strictly by `tenantId`. The compound key is
`SHA-256(tenantId NUL idempotencyKey)` — tenantId cannot be separated
from the key after derivation.

- A request for `tenantId="A"` with `idempotencyKey="k"` will **never** return
  a session owned by `tenantId="B"`, even if both share the same key.
- Cross-tenant lookups return `404 Not Found` (identical to "not found")
  to avoid leaking session existence across tenants.
- `tenantId` is required in the request body when `idempotencyKey` is provided.

---

## API Surface

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/ai/composer/compose` | adminApiKey | Compose a `DesignCompositionSpec` |
| `POST` | `/api/ai/composer/validate` | adminApiKey | Validate inputs + preview fallbacks |
| `POST` | `/api/ai/composer/compatibility` | adminApiKey | Check cross-element compatibility |
| `GET`  | `/api/ai/composer/sessions/:key` | adminApiKey | Get session by idempotency key (tenant-scoped) |
| `GET`  | `/api/ai/composer/health` | none (public) | Health probe |

All admin routes are protected by the global `adminAuth` middleware in `app.ts`.

---

## Files

```
services/dynamic-design-composer/
  types.ts                    — all TypeScript types
  schemas.ts                  — Zod input validation
  composerEngine.ts           — main orchestrator (compose())
  fallbackHandler.ts          — deterministic fallbacks + defaults
  compatibilityChecker.ts     — cross-element compatibility rules
  brandConsistencyChecker.ts  — Brand DNA alignment scoring
  explainabilityEngine.ts     — explainability report builder
  tokenDeriver.ts             — CSS design token derivation
  compositionStateGuard.ts    — terminal state rules + state machine
  compositionSessionStore.ts  — in-memory idempotency + IDOR-safe session store
  index.ts                    — public exports

routes/dynamic-design-composer/
  index.ts                    — Express route handlers

integration/
  openapi/team-13.yaml        — OpenAPI 3.1 spec
  manifests/team-13.json      — team manifest + routesToMount
```
