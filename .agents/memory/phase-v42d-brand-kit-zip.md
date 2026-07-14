---
name: V4.2D Brand Kit, Asset Library, ZIP Delivery
description: Rules and gotchas from the V4.2D implementation — brand kit enterprise, asset library, ZIP delivery, download center upgrade.
---

# V4.2D Implementation Notes

## Tables created (hand-written DDL, never drizzle-kit push)
- `ai_platform.ai_brand_kit_assets` — versioned brand kit slot assets
- `ai_platform.ai_asset_library` — customer enterprise asset library
- `ai_platform.ai_zip_deliveries` — background ZIP delivery queue records

Run via `scripts/ddl-v42d.sql` against dev + prod Supabase.

## Brand kit slot scoring
- 19 scored slots (monogram is the 20th, bonus only)
- Weights sum to 100: logo 15, secondary_logo 5, icon 5, brand_color 10, secondary_color 5, accent_color 5, typography_heading 8, typography_body 7, brand_voice 6, writing_style 4, photography_style 3, illustration_style 2, icon_style 3, do_dont 3, social_style 3, email_signature 2, stationery 2, corporate_pattern 2, brand_guidelines_pdf 10
- `isComplete = score >= 80`

## Customer portal URL pattern
- Use `/api/public/customer/workspace/${token}/...` directly — there is NO `@/lib/api` module in customer-portal. Do not create a getApiUrl helper.
- `use-workspace.ts` uses `const base = (token) => \`/api/public/customer/workspace/${token}\``

## ZIP delivery job
- job_type: `generate_project_zip`
- payloadJson must include `{ projectId, deliveryId }`
- Failure is non-blocking — log warn, don't throw
- `enqueueZipDelivery` is idempotent — skips if already queued/generating/completed

## pdf-lib dependency
- Already in api-server package.json but was never installed in node_modules — had to run `pnpm --filter @workspace/api-server add pdf-lib`
- It IS in esbuild externals list in build.mjs (both external arrays)

## New routes mounted in routes/index.ts
- brandKitEnterpriseRouter → brand-kit-enterprise.ts
- assetLibraryRouter → asset-library.ts
- zipDeliveryRouter → zip-delivery.ts
All inserted before customerWorkspaceSseRouter.

## OpenAPI additions (V4.2D)
- ~25 new paths added before /ai/customer-workspace/{email}/downloads
- New schemas: BrandKitSlotAsset, BrandCompletenessScore, BrandKitEnterpriseDetail, BrandKitEnterpriseList, BrandKitSlotHistory, UpsertBrandKitSlotInput, AssetLibraryItem, AssetLibraryList, CreateAssetLibraryInput, AssetSignedDownload, ZipDeliveryView

## Test files added
- v42d-brand-kit.test.ts — completeness scoring, slot validation, versioning
- v42d-zip-delivery.test.ts — status machine, manifest, retry logic
- v42d-asset-library.test.ts — categories, filter logic, signed download, unlock flow
