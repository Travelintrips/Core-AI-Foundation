# API Typecheck Baseline

Status: **frozen baseline; no remediation included**

## Run metadata

| Field | Value |
|---|---|
| Captured | 2026-08-10 |
| Branch | `main` |
| Main SHA | `3e6ccc1893a1c5ba047c29428d01059682727a11` |
| Exact command | `pnpm --filter @workspace/api-server run typecheck` |
| Result | Exit code 2 |
| Error count | 127 |
| Affected file count | 40 |
| Relation to WP-06B | Pre-existing baseline; no WP-06B implementation files were changed |
| Build status | PASS (`pnpm --filter @workspace/api-server run build`) |
| Regression status | PASS (6103/6103 tests) |

This inventory is intentionally separate from feature work. It is a reference
for future technical-debt packages, not a request to fix the errors in the
current WP-07 disambiguation task.

## Error-code distribution

| TypeScript code | Count | Suggested family |
|---|---:|---|
| TS2345 | 39 | Route/service DTO and contract typing |
| TS2322 | 16 | Stale service/shared interfaces and literal shapes |
| TS2749 | 13 | PptxGenJS namespace/value typing |
| TS2709 | 12 | PptxGenJS namespace typing |
| TS2339 | 11 | Missing or stale properties |
| TS2554 | 9 | Function signature drift |
| TS2367 | 7 | Test-only impossible union comparisons |
| TS2694 | 3 | PptxGenJS missing exported types |
| TS2353 | 3 | Object literal shape mismatch |
| TS2307 | 3 | Missing module or generated/shared dependency |
| TS7030 | 2 | Missing return paths |
| TS2352 | 2 | Unsafe/incompatible casts |
| TS2304 | 2 | Missing names |
| TS7016 | 1 | Missing declaration file |
| TS7006 | 1 | Implicit `any` parameter |
| TS2739 | 1 | Incomplete object shape |
| TS2348 | 1 | Vitest mock call signature |
| TS2347 | 1 | Untyped generic call |
| **Total** | **127** | |

## Per-file inventory

All rows below are part of the captured baseline and are marked
`PRE_EXISTING_WP06B`. The last column is the recommended technical-debt
group, not a claim that the file has already been fixed or fully root-caused.

| Errors | File | TypeScript codes | Baseline status | Recommended group |
|---:|---|---|---|---|
| 21 | `src/services/presentation/presentationRenderService.ts` | TS2749×6, TS2709×12, TS2694×3 | PRE_EXISTING_WP06B | TD-04 presentation/render typing |
| 18 | `src/routes/creative-marketplace.ts` | TS2345×18 | PRE_EXISTING_WP06B | TD-02 route/service typing |
| 10 | `src/services/design-tokens/industryRecommendationService.ts` | TS2322×10 | PRE_EXISTING_WP06B | TD-02 route/service typing |
| 9 | `src/services/design-tokens/__tests__/fontUrlGuard.test.ts` | TS2339×9 | PRE_EXISTING_WP06B | TD-03 test typing |
| 7 | `src/routes/design-tokens/fontPairsRouter.ts` | TS2345×7 | PRE_EXISTING_WP06B | TD-02 route/service typing |
| 7 | `src/scripts/migrateSchemaToProd.ts` | TS2749×7 | PRE_EXISTING_WP06B | TD-01 shared/third-party type generation |
| 6 | `src/services/assetLibraryService.ts` | TS2554×6 | PRE_EXISTING_WP06B | TD-02 route/service typing |
| 6 | `src/__tests__/v42d-zip-delivery.test.ts` | TS2367×6 | PRE_EXISTING_WP06B | TD-03 test typing |
| 5 | `src/routes/design-tokens/colorPalettesRouter.ts` | TS2345×5 | PRE_EXISTING_WP06B | TD-02 route/service typing |
| 3 | `src/routes/asset-intelligence-v2/index.ts` | TS2345×3 | PRE_EXISTING_WP06B | TD-02 route/service typing |
| 2 | `src/routes/customs.ts` | TS7030×2 | PRE_EXISTING_WP06B | TD-02 route/service typing |
| 2 | `src/routes/room-templates.ts` | TS2554×2 | PRE_EXISTING_WP06B | TD-02 route/service typing |
| 2 | `src/scripts/fixMissingTables.ts` | TS7016, TS2347 | PRE_EXISTING_WP06B | TD-01 shared/third-party type generation |
| 2 | `src/scripts/generateMigrationDDL.ts` | TS2307, TS7006 | PRE_EXISTING_WP06B | TD-01 shared/third-party type generation |
| 2 | `src/services/creativeWorkflowRunner.ts` | TS2353×2 | PRE_EXISTING_WP06B | TD-02 route/service typing |
| 1 | `src/domains/graphic-design/service.ts` | TS2345 | PRE_EXISTING_WP06B | TD-02 route/service typing |
| 1 | `src/routes/asset-intelligence.ts` | TS2345 | PRE_EXISTING_WP06B | TD-02 route/service typing |
| 1 | `src/routes/dynamic-design-composer/index.ts` | TS2345 | PRE_EXISTING_WP06B | TD-02 route/service typing |
| 1 | `src/routes/__tests__/def-004-notifications.test.ts` | TS2353 | PRE_EXISTING_WP06B | TD-03 test typing |
| 1 | `src/routes/__tests__/dev-payment-adapter.test.ts` | TS2307 | PRE_EXISTING_WP06B | TD-03 test typing |
| 1 | `src/routes/__tests__/health.test.ts` | TS2352 | PRE_EXISTING_WP06B | TD-03 test typing |
| 1 | `src/scripts/checkProdCategories.ts` | TS2307 | PRE_EXISTING_WP06B | TD-01 shared/third-party type generation |
| 1 | `src/scripts/generate-all-portfolio-svgs.ts` | TS2345 | PRE_EXISTING_WP06B | TD-01 shared/third-party type generation |
| 1 | `src/scripts/smokeTestPitchDeck.ts` | TS2739 | PRE_EXISTING_WP06B | TD-04 presentation/render typing |
| 1 | `src/security/tenantResolution.ts` | TS2339 | PRE_EXISTING_WP06B | TD-02 route/service typing |
| 1 | `src/seedBuiltinTemplates.ts` | TS2352 | PRE_EXISTING_WP06B | TD-01 shared/third-party type generation |
| 1 | `src/services/asset-intelligence-v2/orchestrator.ts` | TS2322 | PRE_EXISTING_WP06B | TD-02 route/service typing |
| 1 | `src/services/brandKitEnterpriseService.ts` | TS2554 | PRE_EXISTING_WP06B | TD-02 route/service typing |
| 1 | `src/services/creativeBrandIntelligenceService.ts` | TS2322 | PRE_EXISTING_WP06B | TD-02 route/service typing |
| 1 | `src/services/designObservabilityService.ts` | TS2339 | PRE_EXISTING_WP06B | TD-02 route/service typing |
| 1 | `src/services/dynamic-design-composer/compatibilityChecker.ts` | TS2322 | PRE_EXISTING_WP06B | TD-02 route/service typing |
| 1 | `src/services/paymentScheduleService.ts` | TS2345 | PRE_EXISTING_WP06B | TD-02 route/service typing |
| 1 | `src/services/serviceRequestConversionService.ts` | TS2345 | PRE_EXISTING_WP06B | TD-02 route/service typing |
| 1 | `src/services/__tests__/brandIntelligenceIsolation.test.ts` | TS2322 | PRE_EXISTING_WP06B | TD-03 test typing |
| 1 | `src/services/__tests__/designStudioPerf.test.ts` | TS2304 | PRE_EXISTING_WP06B | TD-03 test typing |
| 1 | `src/__tests__/collision-engine-routes.test.ts` | TS2304 | PRE_EXISTING_WP06B | TD-03 test typing |
| 1 | `src/__tests__/design-compatibility-adapter.test.ts` | TS2322 | PRE_EXISTING_WP06B | TD-03 test typing |
| 1 | `src/__tests__/goal-taxonomy.test.ts` | TS2322 | PRE_EXISTING_WP06B | TD-03 test typing |
| 1 | `src/__tests__/room-templates.test.ts` | TS2348 | PRE_EXISTING_WP06B | TD-03 test typing |
| 1 | `src/__tests__/team06-asset-intelligence-v2.test.ts` | TS2367 | PRE_EXISTING_WP06B | TD-03 test typing |

> Note: `migrateSchemaToProd.ts` is represented once in the per-file table with
> its 7 errors. The inventory is normalized to 40 files and 127 compiler
> errors.

## Recommended remediation packages

| Package | Focus | Candidate scope |
|---|---|---|
| TD-01 | Shared contract and third-party type generation | Missing modules/declarations, migration scripts, generated/shared contract drift |
| TD-02 | Route and service typing | DTO mismatches, function signature drift, stale service interfaces, missing return paths |
| TD-03 | Test typing | Vitest mocks, impossible union comparisons, missing test helpers, fixture shape drift |
| TD-04 | Presentation/render typing | PptxGenJS namespace/type declarations and pitch-deck script shapes |

## Guardrail

Any future feature branch must compare its API typecheck output with this
baseline. A count or file outside this inventory is a **new** error and must
be investigated in that feature branch. This debt must not be silently fixed
inside WP-07 or another unrelated feature.