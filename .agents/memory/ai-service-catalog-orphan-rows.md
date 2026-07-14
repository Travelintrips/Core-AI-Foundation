---
name: AI service catalog has orphan DB rows outside seedCatalog.ts
description: Some ai_platform.ai_services rows (by service_code) are not present in seedCatalog.ts's SERVICES array, so re-running the seed never touches them — relevant any time you edit/translate/rename catalog service data.
---

`seedCatalog.ts`'s `SERVICES` array is upserted by `service_code`, so it only updates rows whose code is still listed there. The live DB can contain additional `ai_services` rows (e.g. `instagram-content`, `presentation-design`, `financial-dashboard`, `peb-review`, `eta-prediction`, `coretax-assistance`, `legal-due-diligence`, `commitment-fee-agreement`, `quotation-assistant`, `shipment-monitoring` as of 2026-07-14) that were seeded by some other/older process and are still `status: active`, sometimes with real `ai_service_requests` referencing them.

**Why:** When bulk-editing/translating service names in `seedCatalog.ts` and re-running `pnpm seed`, these orphan rows are silently skipped — they keep their old (English) names even though the seed reports success. This looked like a seed failure but was actually a coverage gap.

**How to apply:** Before trusting a re-seed to have fully updated `ai_services`, diff the DB's `service_code` list against `seedCatalog.ts`'s codes (`grep -oP 'svc\("\K[^"]+' src/seedCatalog.ts` vs a DB query) to find orphans. Do not delete orphans blindly — check `ai_service_requests` for references first; if referenced, fix them with a direct, targeted `UPDATE ai_platform.ai_services SET service_name = ...` rather than adding them into `SERVICES` (their origin/category wiring is unknown) unless you confirm where they should live long-term.
