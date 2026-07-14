---
name: Phase 3 Multi-Service Document Export
description: Generic PDF export worker + 4 new document types. Registry pattern, mapper locations, test structure.
---

## Architecture

Generic worker: `artifacts/api-server/src/services/creativeDocumentWorkerService.ts`
Registry loader: `artifacts/api-server/src/services/creativeDocumentRegistry.ts`
Document type enum extended: `artifacts/api-server/src/services/creativeProjectDocumentType.ts`

### DocumentDefinition contract
- `documentType`, `filenamePrefix`, `minimumPageCount`, `requiresLogo`, `maxInlineImages`
- `generateContent(project)` — normalizes workflow outputs, no LLM call for new types
- `buildSpec(project, content, coverImageBuffer, inlineImages)` — returns `{ spec, report }`

### Mapper locations
```
services/mappers/
  companyProfileMapperAdapter.ts     ← wraps existing Phase 2 mapper (LLM call, must stay mocked in tests)
  brandStrategyDocumentMapper.ts     ← min 6 pages, no LLM
  copywritingDocumentMapper.ts       ← min 2 pages, no LLM
  creativeConsultationDocumentMapper.ts ← min 3 pages, no LLM
  brandIdentityGuidelineDocumentMapper.ts ← min 6 pages, requiresLogo=true, no LLM
```

### Service code → document type map (creativeProjectDocumentType.ts)
```
company-profile       → company_profile
brand-strategy        → brand_strategy
copywriting           → copywriting
creative-consultation → creative_consultation
brand-identity        → brand_identity_guideline
```

## Rules

**Why:** Company Profile adapter must be mocked in tests (calls LLM via generateCompanyProfileContent). New mappers are pure data transforms — do NOT mock them.

**How to apply:** In vitest tests for the generic worker, only `vi.mock("../mappers/companyProfileMapperAdapter.js")`. The 4 new mapper mocks were the root cause of 15 test failures in the initial run.

**requiresLogo guard:** Enforced in `executeGenericPdfExportJob` — if `definition.requiresLogo && images.length === 0` → throws `DocumentWorkerError(REQUIRED_LOGO_ASSET_MISSING)`. Brand identity needs at least one completed image asset in the project.

**Optional mockups:** Brand identity skips the mockups section if no inline images are passed — never uses placeholders. Section appears in `report.sectionsSkipped`.

**Registry init:** `initDocumentRegistry()` is called at module load in `jobWorkerService.ts` (via import side-effect). Also called in `beforeEach` in tests. Calling it multiple times is safe — `registerDocument` just overwrites.

**Idempotency:** Worker checks for existing document asset by (projectId, assetType="document", category=documentType). If completed + storage object exists → reuse without re-render. If incomplete or storage missing → regenerate at same version number (update row, no duplicate insert).

## Customer portal changes
- `WorkspaceDownload` type in `hooks/use-workspace.ts` extended with `pageCount?`, `fileSizeBytes?`, `documentType?`, `mimeType?`
- `WorkspaceDownloadItem` interface in `customerWorkspaceService.ts` extended with same fields
- `listDownloadsForProjects()` populates metadata from `asset.metadata` JSON for document assets
- `formatDocumentTitle()` helper maps document type → human-readable label
- Downloads page (`pages/workspace/downloads.tsx`) shows PDF badge, page count, file size, document type label

## Test coverage
- `__tests__/creativeDocumentWorkerService.test.ts`: 46 tests covering registry, worker, all 4 mappers, markFailed, 4 smoke tests (real PDFKit render)
- `__tests__/companyProfilePdfWorkerService.test.ts`: 8 tests — shim behavior updated (no longer resolves doc type from DB)
- Total api-server tests: 192 passing

## Fetch mock note
`downloadProjectImages` calls `fetch(imageUrl)` to download image buffers. Tests must `vi.stubGlobal("fetch", ...)` to return a valid image buffer — otherwise network requests fail in test env.
