---
name: Team 16 — Presentation & Document Creative Services
description: Domain rules, anti-fabrication patterns, and implementation notes for the presentation-document domain
---

# Team 16 — Presentation & Document Creative Services

## Owned service types
PDF (Document Engine): proposal, product_catalog, annual_report, whitepaper, case_study, ebook
PPTX (Presentation Engine): pitch_deck (existing, not modified)
Untouched: company_profile

## Registration chain
`initPresentationDocumentDomain()` ← called from `initDocumentRegistry()` in `creativeDocumentRegistry.ts`
Type mapping lives in `creativeProjectDocumentType.ts` — SERVICE_CODE_TO_DOCUMENT_TYPE

## briefJson access rule
`briefJson` is on `ai_service_requests`, NOT on `creative_projects`.
- Normalize functions accept `briefJson?: Record<string, unknown>` as a second parameter
- `generateContent` fetches it via DB query on `serviceRequestId` then passes it in
- Tests pass `briefJson` directly as the second arg — no DB mock needed

## Import rules
- `eq` comes from `"drizzle-orm"`, NOT from `"@workspace/db"`
- From `domains/presentation-document/mappers/*.ts` → services/ is `"../../../services/..."`
- From `domains/presentation-document/*.ts` → services/ is `"../../services/..."`

**Why:** Domain directory nesting is 3 levels deep from src/; easy to get relative paths wrong.

## Anti-fabrication rule
Every mapper has a `fabricationGuard` string in its spec report. Sections that require data
not present in `project.result`, passed `briefJson`, or direct project fields are SKIPPED — never
padded with fallback text, positioning strings, or placeholders.

Specific traps:
- Whitepaper `findings` section: must check `content.researchFindings` only, never fall through
  to `content.positioning` as a substitute (that fabricates findings)
- Annual report: `financials` section is ALWAYS skipped (no financial figures ever)
- Proposal: `investment` and `timeline` sections skipped when briefJson fields are absent

## ?? || mixing
TypeScript 5076: `a ?? b || c` must be written `(a ?? b) || c`

## Test pattern
Static imports at top of file (not require() in describe blocks).
68 tests covering: domain init, all 6 mappers, QC profiles, package rules, template compatibility,
Brand DNA adapter, anti-fabrication guard, adapter routing.

## Seed catalog
6 new services added to `seedCatalog.ts` under `creative` category:
  proposal, product-catalog, annual-report, whitepaper, case-study, ebook
These must exist in `ai_services` table for `resolveProjectDocumentType()` to route correctly.
