# Engineering Roadmap
## Core AI Foundation — Creative Studio Platform

**Repository:** Travelintrips/Core-AI-Foundation
**Current release:** `material-v5.0.0`
**Last updated:** 2026-07-27

---

## Current Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Replit Monorepo (pnpm)                    │
├──────────────────┬──────────────────┬───────────────────────┤
│  customer-portal │   ai-platform    │     api-server        │
│  React/Vite (/)  │  React/Vite      │  Express + Drizzle    │
│  Public-facing   │  (/admin/)       │  Port 8080            │
│  customer UI     │  Internal admin  │                       │
└──────────────────┴──────────────────┴───────────────────────┘
                                              │
                              ┌───────────────┼───────────────┐
                              │               │               │
                    Supabase PostgreSQL   Supabase        AI Providers
                    (ai_platform schema)   Object          OpenAI
                    Dev + Prod pools       Storage         Anthropic
                                          (ai-assets)      Gemini
                                                           Mistral
                                                           Cohere
```

### Core Subsystems (Stable)

| Subsystem | Location | Status |
|---|---|---|
| AI Job Queue & Worker Cluster | `api-server/src/services/queueManagerService.ts` | ✅ Stable (Phase 5.2) |
| Production Pipeline (5-stage) | `api-server/src/services/productionPipelineService.ts` | ✅ Stable |
| Event Bus & Audit Log | `api-server/src/routes/events.ts` | ✅ Stable |
| Quotation & Commercial Flow | `api-server/src/routes/` (quotation, gates) | ✅ Stable |
| AI Provider Registry | `api-server/src/services/` (providers) | ✅ Stable |
| Material Library (CRUD) | `api-server/src/routes/material-library.ts` | ✅ Stable |
| Material Intelligence | `api-server/src/routes/material-intelligence.ts` | ✅ Stable (flag-gated) |
| Material Import Pipeline | `api-server/src/routes/material-import.ts` | ✅ Stable (Phase 5) |
| Interior Design Editor | `ai-platform/src/components/interior-design/` | ✅ Stable |
| Customer Workspace | `api-server/src/routes/customer-portal.ts` | ✅ Stable |
| Session Auth (admin) | `api-server/src/middleware/adminAuth.ts` | ✅ Stable |
| Token Auth (customer portal) | Public routes with token resolution | ✅ Stable |
| Object Storage | `api-server/src/services/supabaseStorage.ts` | ✅ Stable |

---

## Completed Phases

### Phase 1 — Core Material Library
Canonical `materials` + `material_categories` tables. Full CRUD API. Category registry. Material-to-artifact assignment service.

### Phase 2 — Material Intelligence
Full-text search with Indonesian alias resolution. Auto-suggestions. Similarity search. Usage analytics. Cold latency < 200 ms, warm < 1 ms.

### Phase 3 — Foundation Hardening
N+1 elimination. React performance optimisations. Six DB indexes. Feature-flag gating for intelligence layer.

### Phase 4 / 4A — OCR & Asset Processing
OCR extraction pipeline feeding material data into the import staging queue. Automated asset handling and checksum validation.

### Phase 5 — Controlled Import & Human Review ← CURRENT
Human-in-the-loop import pipeline. Four duplicate resolution strategies. Admin review queue UI. Full audit trail. 37 focused tests.

---

## Upcoming Phases

### Phase 6 — Room Design Template Library
**Prerequisite:** Phase 6 entry checklist complete (`docs/phase6-entry-checklist.md`)
**Target:** TBD — awaiting formal approval

| Feature | Complexity | Dependencies |
|---|---|---|
| Room Design Template Library | Large | `material_categories` finalised; Phase 5 stable ✅ |
| Furniture Library | Medium | Phase 5 patterns reusable; Room Template Library |
| Material Recommendation Engine (enable) | Small | Feature flag only; Phase 5 ready ✅ |
| CI: i18n lint check | Small | None |
| CI: router prefix integration test | Small | None |
| PluginManifest consolidation | Medium | None |
| CHANGELOG process | Small | None (back-filled ✅) |

### Phase 7 — AI Design Composer (Planned)
AI agent composing a complete room design (template + materials + furniture + lighting) from a customer brief in a single pipeline step.
- Depends on: Phase 6 (Room Template Library + Furniture Library)
- Depends on: Active production deployment verified (M2 from Phase 6 backlog)

### Phase 8 — Room Rendering Pipeline (Planned)
Photorealistic room renders from composed designs. Extends existing image generation pipeline with room-specific prompting and reference image injection.
- Depends on: Phase 7 (AI Design Composer)
- Extends: `creative_render_sessions` pattern

### Phase 9 — Multi-Room Composition (Planned)
Coordinated design across multiple rooms sharing a coherent material palette. Introduces `room_composition_session` linking multiple concept drafts.
- Depends on: Phase 8

### Long-Term Vision (Future)

| Feature | Notes |
|---|---|
| Customer-facing material explorer | Customers select preferred materials during briefing |
| Supplier integration (live pricing/stock) | Connect to Vivere, IKEA Indonesia, Kayu Lapis APIs |
| AR preview (mobile) | Material/furniture preview in augmented reality |
| Semantic vector search (pgvector) | Replace trigram search when catalog exceeds 100k records |
| Reviewer role separation | Dedicated reviewer role vs general admin |

---

## Dependencies Map

```
Phase 5 (DONE)
    └── Phase 6: Room Template Library
            ├── Phase 6: Furniture Library
            │       └── Phase 7: AI Design Composer
            │               └── Phase 8: Room Rendering Pipeline
            │                       └── Phase 9: Multi-Room Composition
            └── Phase 6: Material Recommendation Engine (enable flag)
```

---

## Architecture Decisions

All major architectural decisions are recorded in `docs/adr/`:

| ADR | Title |
|---|---|
| ADR-001 | Controlled Import Pipeline |
| ADR-002 | Human-in-the-Loop Review Queue |
| ADR-003 | Four-Strategy Duplicate Resolution |
| ADR-004 | Asset Storage via Supabase S3 |
| ADR-005 | Material Intelligence Layer |
| ADR-006 | Migration Strategy — Hand-Written DDL |

---

## Engineering Principles

1. **Human review before production write** — no automated system writes to canonical tables without a human-approved pathway
2. **Additive migrations only** — never drop columns/tables without a dedicated reviewed migration; never use `drizzle-kit push` on seeded databases
3. **Router prefix always explicit** — every Express router is mounted with an explicit path prefix (lesson from Phase 5 `materialImportRouter` bug)
4. **Feature-flag new capabilities** — new AI features default to `false` in production until independently validated
5. **Audit everything** — every state transition in the import pipeline, concept draft, and commercial flow is logged with actor identity and timestamp
6. **Tenant isolation at the query layer** — never trust `tenantId` from request body/query; always resolve server-side
