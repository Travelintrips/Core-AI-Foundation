---
name: Company Profile P1 — Document Engine & QC
description: P1 sprint: mapper uses cp* fields, package enforcement, QC service, deliverable manifest
---

## What was built

### P1.1 Document Sections
- `companyProfileDocumentMapper.ts` fully updated — `CompanyProfileBrief` now includes all 27 cp* fields
- Prompt uses cp* fields verbatim (cpVision, cpMission, cpValueProposition) with fallback to generic columns for legacy projects
- Spec builder prefers `brief.cpContact*` over LLM contactInfo (customer-provided, more reliable)
- Company name uses `cpLegalName` over `brandName`; cpCompanyValues + cpCertifications override LLM output

### P1.2 Package Enforcement
- `companyProfileMapperAdapter.ts` loads `ai_service_requests.brief_json` + package via `serviceRequestId`
- Section gating: professional+→key-people/org-structure/clients-partners, business+→QA, enterprise+→sustainability
- Milestone threshold lowered to 1 for business/enterprise (was 2 for all)
- Brief stashed as `_brief` in rawContent so buildSpec reconstructs it without a second DB round-trip

### P1.3 QC Score
- New `companyProfileQcService.ts` — pure function, no LLM/DB
- 4 dimensions: sectionCoverage 40%, contactCompleteness 30%, contentDepth 20%, pageCountMet 10%
- QC gate: qcScore >= 60 → passed; `scoreFromAssetMetadata()` wraps it for route use

### P1.4 Deliverable Manifest
- New route `GET /public/catalog/requests/:requestId/deliverable-manifest`
- Returns all completed assets, per-document QC scores (CP only), package info, summary

## Key invariants
- Legacy projects (no serviceRequestId) fall back to packageLevel="starter" with no cp* fields
- Contact section uses `brief.cpContact*` OR `content.contactInfo` — never fabricates
- `_brief` stash pattern avoids second DB round-trip between generateContent and buildSpec

## Test counts
322 total tests passing (0 failures): 40 P0 (unchanged) + 19 mapper + 22 QC + existing suite

**Why:** Brief data lives in ai_service_requests.brief_json, not on creative_projects columns — adapter must fetch it at generation time.
