# Team 04 — Service Normalization & Solution Collections
## Phase 1: Existing Architecture Audit

| Area | File or Table | Current Behavior | Risk | Proposed Reuse | Modification Required |
|---|---|---|---|---|---|
| Service table | `ai_service_catalog.ts` → `ai_services` | Purchasable service records with `service_code`, `status`, `categoryId`, `serviceFlow` | None — read-only from Team 04 | FK target for normalization mappings | None |
| Category table | `ai_service_catalog.ts` → `ai_service_categories` | Hierarchical grouping with `visibility` (public/internal) and `commercialStatus` | None | Commercial eligibility policy source | None |
| Service code conventions | `ai_services.service_code` | Unique TEXT slug per service (e.g. `branding_logo`, `company_profile`) | Renaming would break orders | Reused as stable reference in mappings | None |
| Slug conventions | `ai_service_categories.code` | snake_case, unique | No new service slug changes | Canonical slugs use hyphen format (separate namespace) | None |
| Visibility fields | `ai_service_categories.visibility` | `public | internal | disabled` | Eligibility filter | Reused directly in `listEligibleServicesForCollection` | None |
| Commercial status | `ai_service_categories.commercial_status` | `commercial_ready | internal_only | beta | disabled` | Secondary filter | Not duplicated — category.visibility is the Team 1 canonical gate | None |
| Active/archived status | `ai_services.status` | `active | draft | archived` | Must filter active-only for public collections | Reused in eligibility join (`status = 'active'`) | None |
| Pricing references | `ai_service_packages`, `ai_service_price_rules` | Linked to `ai_services` | FK RESTRICT prevents deleting mapped services | Not changed | None |
| Order references | `ai_service_requests` → `serviceId` | Historical intake linked to service | FK RESTRICT on `ai_services` prevents deletions | Not changed | None |
| Project references | `creative_projects` | Linked to service requests, not directly to services | Not affected | Not changed | None |
| Package/bundle tables | `ai_service_packages` | Per-service packages | Not a "collection" — separate concept | Not changed | None |
| Marketplace collection logic | `artifacts/api-server/src/routes/creative-marketplace.ts` | Creative-specific marketplace | Different scope from solution collections | Coexists | None |
| Related-service logic | None found | No existing related-service table | Low | New via `solution_collection_services` | New table only |
| Search indexing | None found | No search index table | Low | Not in scope | None |
| Service seed scripts | `artifacts/api-server/src/seed.ts` | Seeds providers, models, agents | Not seeding services for normalization | Separate backfill script approach | None |
| Service aliases/synonym logic | `src/utils/canonicalNormalizer.ts` | Style/industry alias maps (knowledge library) | Different domain — design styles, not service names | Not reused (different normalization concern) | None |
| Goal Taxonomy | Team 2 goal tables | Goal → service mappings (Team 2 scope) | Team 04 must not modify | Read-only compatibility — collections coexist with goals | None |
| Commercial Eligibility Policy | `src/services/commercialGateService.ts`, category.visibility check | Gate per quotation; category.visibility='public' is the catalog-level policy | Policy duplication risk | Reused in `listEligibleServicesForCollection` via same DB filter | None |
| Admin APIs | `src/routes/catalog.ts` | CRUD for categories, services, packages | Existing endpoints unchanged | New endpoints in separate file | None |
| Migration conventions | `src/migrations/*.sql` | Hand-written DDL with `SET search_path TO ai_platform,public;` | None | Same convention used | None |

---

## Phase 2: Duplicate and Overlap Audit

Based on code analysis of the service seed script (`src/seed.ts`) and the service catalog schema.

| Candidate Group | Service Codes | Names | Classification | Recommended Canonical Concept | Reason | Risk | Owner Approval Required |
|---|---|---|---|---|---|---|---|
| Company Profile family | `company_profile`, `company_profile_design`, `company_profile_document`, `company_profile_presentation` | Company Profile, Company Profile Design, Company Profile Document, Company Profile Presentation | D — Format variant | `cc_company_profile` | Same business outcome (company introduction document), different output formats (PDF document vs. presentation vs. design-only) | Medium — customers may accidentally order multiple. Normalization does not delete any. | **YES — owner must confirm which code is primary** |
| Pitch Deck family | `pitch_deck`, `investor_pitch_deck`, `business_pitch_deck`, `presentation_design`, `product_presentation` | Pitch Deck, Investor Pitch Deck, Business Pitch Deck, Presentation Design, Product Presentation | G — Unclear | Possibly `cc_pitch_deck` | Names overlap but customer segments differ (investor vs. general business vs. product). Cannot auto-classify. | High — wrong normalization would confuse customers | **YES — requires owner decision before normalization** |
| Branding & Logo family | `branding_logo`, `brand_identity`, `logo_design` | Branding & Logo, Brand Identity, Logo Design | B — Alias or naming variant | `cc_branding_logo` | Same core output (logo + basic brand mark); "brand identity" may include guidelines — unclear | Medium | **YES — confirm if brand identity includes deliverables beyond logo** |
| Social Media Content | `social_media_content`, `social_media_design`, `content_creation` | Social Media Content, Social Media Design, Content Creation | C — Related but distinct | `cc_social_media_content` | Social media content (copywriting + design) vs. design-only vs. general content may differ | Low | Optional — owner may confirm alias |
| AI Image Campaign | `ai_image_campaign`, `marketing_visuals`, `campaign_design` | AI Image Campaign, Marketing Visuals, Campaign Design | G — Unclear | Possibly `cc_marketing_visuals` | "AI Image Campaign" uses AI generation pipeline; others may not. Workflow differs significantly. | High | **YES — do not normalize until workflow reviewed** |

> **Default action for all Unclear (G) and unapproved groups: NO normalization applied.**
> No service rows modified. No automatic mappings created for these groups.
> Owner decisions are required before any mapping is added via the admin API.

---

## Phase 3: Canonical Model — Decisions

### Scope decision: Platform-global
Normalization data is **platform-global**, not tenant-specific. Rationale:
- `ai_services` allows `tenant_id = null` for shared services
- Solution collections are discovery abstractions, not per-tenant catalogs
- Consistent with how `ai_service_categories` handles shared catalog visibility

### FK deletion behavior
All normalization FKs use `ON DELETE RESTRICT`:
- Prevents silent cascade deletion of normalization metadata when a service or concept is removed
- Requires explicit unmapping before deletion — safe, reviewable, auditable
- `ON DELETE CASCADE` was explicitly rejected (spec requirement)

### Migration status
**MIGRATION CREATED BUT NOT APPLIED.**
File: `artifacts/api-server/src/migrations/20260719_service_normalization.sql`
Apply only after owner review and explicit environment confirmation.
Do NOT apply to production without a separate approval step.

---

## Owner Decisions Required

| Decision | Group | Default Action |
|---|---|---|
| Which `company_profile*` code is the primary? | Company Profile family | No normalization applied until confirmed |
| Is "Investor Pitch Deck" the same as "Pitch Deck"? | Pitch Deck family | No normalization applied |
| Does "Brand Identity" include logo-only cases? | Branding & Logo family | Partial normalization held pending answer |
| Does "AI Image Campaign" differ from "Marketing Visuals" in workflow? | AI Image Campaign | No normalization applied |

All unclear groups default to: **no normalization until owner approves**.
