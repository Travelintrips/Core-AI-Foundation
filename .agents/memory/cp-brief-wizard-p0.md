---
name: Company Profile Brief Wizard — P0 Frontend Wiring
description: P0 sprint completed — all cp* fields wired into wizard, validateStep, ReviewStep readiness banner, backend test file created.
---

## What was built
All 27 cp* fields are now rendered in the brief wizard, conditioned on `isCompanyProfile = (serviceType === "company_profile")`. Existing non-CP flows are untouched.

## Field distribution across steps
- **Step 1 (Bisnis):** cpLegalName (required), cpBusinessTypeDetail, cpYearEstablished, cpContactEmail (required if no phone), cpContactPhone, cpContactAddress, cpContactWebsite
- **Step 2 (Tujuan):** cpValueProposition (required), cpCompanyHistory, cpVision, cpMission, cpCompanyValues
- **Step 3 (Audiens):** cpProductsServices (required), cpGeographicCoverage, conditional industry fields (logistics→cpFacilities, trading→cpGeographicCoverage, manufacturing→cpProductionCapacity, professional→cpQualityAssurance, medical→cpLegalDocuments), cpKeyPeople, cpClientsPartners, cpProjectExperience
- **Step 4 (Visual):** cpCertifications, cpOrganizationStructure, cpSustainability, cpUploadedLogo, cpUploadedPhotos, cpReferenceDocuments
- **Step 5 (Deliverables):** cpPageTarget

## Key invariants
- `isCompanyProfile` is derived after `serviceConfig` and before any useMemo/useEffect hooks
- `cpIndustryGroup` is memoized from `resolveCpIndustryGroup(brief.cpBusinessTypeDetail || brief.companyIndustry)` — matches backend logic
- `validateStep(step, brief, isCP)` — third param gates cpLegalName + contact validation to Step 1 only
- `handleNext` passes `isCompanyProfile` as the third arg to validateStep
- `ReviewStep` accepts optional `isCompanyProfile` prop — computes `cpMissing` via `getCompanyProfileMissingFields(brief)`, shows amber/green readiness banner before SummaryCard, appends 5 CP section groups to SummaryCard
- Both `resolveCpIndustryGroup` and `getCompanyProfileMissingFields` are **defined locally** in brief.tsx (not imported from an external module)

## Backend tests
`artifacts/api-server/src/services/__tests__/companyProfileBriefIntelligence.test.ts` — 40 tests, 4 describe blocks:
- `computeCompanyProfileBriefScore` — dimension scores (10 tests)
- `computeCompanyProfileBriefScore` — readinessStatus (7 tests)  
- `resolveIndustryQuestionGroup` — conditional questions (10 tests)
- `assertCompanyProfileBriefReady` — production guard (10 tests)
- `isCompanyProfileServiceCode` (3 tests)

All 40 pass in 253ms.

## Production guard (backend — unchanged from before)
`serviceRequestConversionService.ts` calls `assertCompanyProfileBriefReady(briefJson)` before triggering AI workflow; catches `BriefIncompleteError` and returns `skipped: "BRIEF_INCOMPLETE:..."`. Admin can override via `POST /ai/catalog/requests/:id/override-brief-guard`. Admin can check readiness via `GET /ai/catalog/requests/:id/brief-readiness`.

**Why:** Brief guard must run server-side to prevent AI generation with incomplete data; frontend readiness is UX only.
