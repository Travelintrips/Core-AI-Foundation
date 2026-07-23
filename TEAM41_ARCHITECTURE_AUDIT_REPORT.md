# TEAM 41 — ARCHITECTURE AUDIT REPORT
## Universal Creative AI Platform — Canonical Lifecycle Baseline

**Branch:** `audit/team-41-shared-lifecycle`  
**Date:** 2026-07-23  
**Role:** Architecture Auditor & Canonical Lifecycle Engineer  
**Scope:** Read-only. No code changes. No migrations. No commits to main.  
**Status:** ✅ PASS — Audit complete. Baseline established for Teams 42–50.

---

## REPOSITORY BASELINE

```
Commit:  a57cc7c
Branch:  audit/team-41-shared-lifecycle  (from main)
Stack:   Node.js 20, pnpm workspaces, TypeScript 5.9
Runtime: Express 5, Drizzle ORM, Supabase PostgreSQL (ai_platform schema)
DB URL:  dev=SUPABASE_DEV_DATABASE_URL  prod=SUPABASE_PROD_DATABASE_URL
```

Pre-audit git state:
```
git branch --show-current  → audit/team-41-shared-lifecycle
git status --short         → ?? attached_assets/... (only untracked audit files)
git rev-parse --short HEAD → a57cc7c
git log --oneline -10      → a57cc7c Update dependencies and regenerate mockup components
                             76b853d Update Replit configuration
                             40dee65 (grafted) Add resume audit documentation
```

---

## A. ARCHITECTURE SUMMARY

The platform is a **multi-tenant enterprise creative AI studio** operating as a pnpm monorepo with 5 registered artifacts:

| Artifact | Path | Port | Preview | Role |
|---|---|---|---|---|
| API Server | `artifacts/api-server` | 8080 | `/api` | Express 5 backend — single source of truth for all state |
| AI Platform (Admin) | `artifacts/ai-platform` | 20785 | `/admin/` | React + Vite — operator dashboard |
| Customer Portal | `artifacts/customer-portal` | 23434 | `/` | React + Vite — client-facing frontend |
| Cargo Rate Finder | `artifacts/cargo-finder` | 20404 | `/cargo-finder/` | Standalone logistics calculator |
| Mockup Sandbox | `artifacts/mockup-sandbox` | 8081 | `/__mockup` | Design canvas / component preview |

**Global auth pattern:** All API routes mount under `app.use("/api", adminAuthWithExceptions, router)`. Admin key gating is one global mount — never per-route.

**Database:** Supabase PostgreSQL, `ai_platform` schema (not `public`). All raw SQL must set `search_path`. Dev/prod selected via `NODE_ENV`.

**Shared library packages:**
- `@workspace/db` — Drizzle ORM schema + pool (`lib/db/`)
- `@workspace/api-zod` — Zod validation schemas (`lib/api-zod/`)
- `@workspace/api-client-react` — orval-generated React hooks (`lib/api-client-react/`)

---

## B. SERVICE INVENTORY (Phase 1)

### 17 Service Categories — 80+ Services

| # | Category Slug | Count | Typical Output | Billing | Review | Renderer |
|---|---|---|---|---|---|---|
| 1 | `creative` | 19 | Brand assets, PDFs, images | one_time / enterprise | Mixed | creativeAiService + universalRenderWorker |
| 2 | `presentation-document` | 8 | PPTX, PDF | one_time | Mixed | presentationEngine + documentEngine |
| 3 | `marketing` | 6 | Strategy docs, content plans | one_time / subscription | Mixed | creativeAiService |
| 4 | `sales` | 3 | Playbooks, proposals | one_time | Mixed | creativeAiService |
| 5 | `finance` | 7 | Analysis reports | one_time | Mixed | creativeDocumentService |
| 6 | `accounting` | 6 | Ledger reviews | one_time | Mixed | creativeDocumentService |
| 7 | `tax` | 6 | Tax compliance docs | one_time | Mixed | creativeDocumentService |
| 8 | `hr` | 6 | HR docs, payroll | one_time / subscription | Mixed | creativeDocumentService |
| 9 | `legal` | 6 | Contracts, NDAs | one_time / subscription | Mixed | creativeDocumentService |
| 10 | `logistics` | 5 | Freight plans | one_time / subscription | Mixed | creativeDocumentService |
| 11 | `customs` | 6 | HS code, compliance | one_time / subscription | Mixed | creativeDocumentService |
| 12 | `procurement` | 4 | RFQ, vendor docs | one_time / subscription | Mixed | creativeDocumentService |
| 13 | `trading` | 4 | Export readiness | one_time / subscription | Mixed | creativeDocumentService |
| 14 | `data-analytics` | 3 | Reports, dashboards | one_time / subscription | Mixed | creativeDocumentService |
| 15 | `executive` | 2 | Strategic reviews | one_time | TRUE | creativeDocumentService |
| 16 | `customer-service` | 2 | Macro library | subscription | Mixed | creativeDocumentService |
| 17 | `graphic-design` | 10 | Logos, flyers, banners | one_time | FALSE | universalRenderWorker + imagePreviewService |

### Complete Service Slug Registry

**Presentation & Document** (humanReview=TRUE): `pd-pitch-deck`, `pd-business-proposal`, `pd-company-profile-doc`, `pd-annual-report`, `pd-executive-summary`, `pd-training-material`  
**Presentation & Document** (humanReview=FALSE): `pd-product-catalog`, `pd-meeting-deck`

**Creative AI** (humanReview=TRUE): `brand-identity`, `brand-strategy`, `company-profile`, `pitch-deck`, `packaging-design`, `creative-consultation`, `fashion-brand-brief`, `interior-concept-design`, `proposal`, `product-catalog`, `annual-report`, `whitepaper`, `case-study`, `ebook`  
**Creative AI** (humanReview=FALSE): `logo-design`, `social-media-design`, `poster-banner`, `copywriting`, `image-generation`

**Marketing**: `marketing-ai-monthly`(T), `marketing-plan`, `campaign-plan`, `content-calendar`, `competitor-analysis`, `customer-persona`(F)  
**Sales**: `sales-playbook`(T), `lead-qualification`, `proposal-drafting`(F)  
**Finance**: `financial-analysis`, `budget-planning`, `forecasting`, `management-report`(T), `cashflow-analysis`, `profitability-analysis`, `bank-reconciliation`(F)  
**Accounting**: `journal-review`, `trial-balance-review`, `closing-assistance`, `coa-recommendation`(T), `general-ledger-analysis`, `account-reconciliation`(F)  
**Tax**: `vat-review`, `pph-analysis`, `tax-reconciliation`, `tax-planning`, `spt-review`(T), `invoice-validation`(F)  
**HR**: `payroll-review`, `hr-ai-monthly`(T), `cv-screening`, `job-description`, `interview-package`, `performance-summary`(F)  
**Legal**: `contract-review`, `agreement-drafting`, `nda-review`, `vendor-agreement`, `legal-ai-monthly`(T), `contract-summary`(F)  
**Logistics**: `logistics-ai-monthly`(T), `freight-planning`, `vendor-comparison`, `shipment-exception`, `rfq-generation`(F)  
**Customs**: `hs-code-classification`, `import-compliance`, `export-compliance`, `pib-review`, `lartas-checking`, `customs-ai-monthly`(T), `duty-simulation`(F)  
**Procurement**: `spend-analysis`, `procurement-ai-monthly`(T), `rfq-preparation`, `vendor-comparison-proc`, `supplier-scorecard`(F)  
**Trading**: `export-deal-readiness`, `trading-ai-monthly`(T), `commercial-offer`, `buyer-supplier-profile`, `margin-simulation`(F)  
**Data Analytics**: `data-analytics-monthly`(T), `dashboard-setup`, `data-insight-report`(F)  
**Executive**: `strategic-review`, `board-brief`(T)  
**Customer Service**: `customer-service-ai-monthly`, `support-macro-library`(F)  
**Graphic Design**: `GD-LOGO`, `GD-BCARD`, `GD-LTRHEAD`, `GD-FLYER`, `GD-POSTER`, `GD-BANNER`, `GD-BROCHURE`, `GD-SOCIAL`, `GD-CERT`, `GD-STATIONERY`(F)

### Add-on Packages (Seeded)
| Base Slug | Add-ons |
|---|---|
| `logo-design` | `brand-identity`, `brand-strategy` |
| `social-media-design` | `content-monthly` |
| `fashion-brand-brief` | `campaign-copy`, `brand-strategy`, `visual-campaign` |
| `interior-concept-design` | `client-proposal`, `brand-identity`, `mood-visual` |

### Per-Service Detail Fields

| Field | Source | Notes |
|---|---|---|
| Service Name | `ai_services.name` | Seeded via `seedCatalog.ts` |
| Slug | `ai_services.slug` | Unique per tenant |
| Category | `ai_service_categories.slug` | 17 canonical categories |
| Workflow Template | `ai_services.workflowTemplate` | Not explicit in seed — resolved at runtime by service type |
| Pricing Model | `ai_services.pricingModel` | `one_time`, `monthly_subscription`, `yearly_subscription`, `enterprise_custom` |
| AI Agents | `ai_agents` table | Seeded; `Brand Strategist` is the canonical default |
| Renderer | Resolved by `creativeProjectDocumentType.ts` / `creativeProjectImageBatchType.ts` / `creativeProjectPresentationType.ts` | Domain-specific |
| Output Type | Service-dependent | PDF, PPTX, PNG/JPEG, ZIP, JSON |
| Deliverable Type | `ai_zip_deliveries` / `creative_ai_assets` / `cp-document-versions` | Depends on domain |
| Storage | Supabase Storage (`ai-assets` bucket) | Object storage via `supabaseStorageService.ts` |
| Billing Required | All non-free services | `ai_payment_schedule` rows generated at conversion |
| Partial Payment | `deposit` payment policy | First installment required before production starts |
| Review Required | `humanReview` flag in seed | Controls `in_review` gate in production pipeline |
| Customer Portal | Yes — all projects | Token-based dashboard via `customer-dashboard-tokens` |
| Admin Portal | Yes — all projects | Admin dashboard at `/admin/` |
| Owner Module | `artifacts/api-server/src/domains/<domain>/` | 9 domain subdirectories |

---

## C. ARCHETYPE CLASSIFICATION (Phase 2)

| Archetype | Services | Key Trait |
|---|---|---|
| **Image Design** | `logo-design`, `GD-*`, `image-generation`, `poster-banner`, `social-media-design` | Two-stage image pipeline (noText → text overlay via sharp/SVG) |
| **Brand Design** | `brand-identity`, `brand-strategy`, `fashion-brand-brief`, `packaging-design` | Brand DNA extraction + multi-asset output |
| **Interior Design** | `interior-concept-design` | Specialized domain plugin (`domains/interior-design`) with own workflow |
| **Fashion Design** | `fashion-brand-brief` | Specialized domain plugin (`domains/fashion-design`) |
| **Architecture** | `architecture-landscape` | Specialized domain (`domains/architecture-landscape`) |
| **Presentation** | `pd-pitch-deck`, `pd-meeting-deck`, `pitch-deck`, `pd-training-material` | pptxgenjs renderer; PDFKit fallback |
| **Document** | `company-profile`, `pd-company-profile-doc`, `pd-annual-report`, `annual-report`, `whitepaper`, `case-study`, `ebook` | PDFKit + pdf-lib; 4-doc-type registry |
| **Marketing** | `marketing-*`, `campaign-plan`, `content-calendar`, `competitor-analysis` | AI strategy + content calendar output |
| **Strategy** | `brand-strategy`, `strategic-review`, `board-brief`, `customer-persona` | LLM-heavy, no renderer |
| **Copywriting** | `copywriting`, `proposal`, `proposal-drafting` | Text-only output |
| **Rendering** | All image/design services | universalRenderWorker handles all render jobs |
| **Video** | None currently implemented | — |
| **Animation** | None currently implemented | — |
| **Hybrid** | `brand-identity`, `company-profile`, `packaging-design` | Multi-output: PDF + images + brand kit ZIP |
| **Multi-stage** | `company-profile`, `brand-identity`, `interior-concept-design` | creative_project_steps pipeline with multiple sequential jobs |
| **Payment-heavy** | All enterprise/custom services | Quotation → gate → deposit → production → remaining balance |
| **Review-heavy** | All humanReview=TRUE services | `in_review` gate + client review token flow + revision loop |

---

## D. WORKFLOW INVENTORY (Phase 4)

### Workflow Templates Discovered

#### 1. Creative Project Pipeline (Universal)
**Stages:** `waiting_payment` → `deposit_paid` → `active` → `generating` → `in_review` → `approved` → `completed`  
**Substages (creative_project_steps):** `pending` → `running` → `completed` | `failed`  
**Worker:** `universalRenderWorker.ts`  
**Retry:** Job retry via `claimJob` with retry counter; max retries configurable per job type  
**Failure:** `creative_project.status = 'failed'`; `ai_jobs.status = 'failed'`  
**Completion:** All steps `completed` + result aggregated → project status `completed`  
**Rollback:** None — terminal states are not rolled back; admin can requeue via UI  
**Blocking:** `waiting_payment` blocks production start; `in_review` blocks delivery  

#### 2. Design Template Batch Pipeline
**Stages:** `draft` → `brief_in_progress` → `ready` → `active` → `generating` → `in_review` → `revision_requested` → `approved` → `completed`  
**Worker:** `design-batch/batchLifecycle.ts` + `design-renderer/`  
**Retry:** Reconciler re-queues stale `generating` items after timeout  
**Failure:** Batch item fails individually; batch can partial-complete  
**Completion:** All items `completed` or `failed` + no `pending` items  
**Rollback:** None  
**Blocking:** Tenant concurrency cap enforced by dispatcher  

#### 3. Quotation Workflow (Commercial)
**Stages:** `draft` → `issued` → `viewed` → `approved` | `rejected` | `revision_requested`  
**Trigger:** Admin action → customer email/URL with token  
**Retry:** Admin can re-issue (new token); customer gets fresh link  
**Failure:** `rejected` is terminal for that quotation; admin must create new  
**Completion:** `approved` status triggers commercial gate creation  
**Rollback:** None — approved quotations cannot be unapproved  
**Blocking:** Gate must be `verified`/`waived` before project conversion  

#### 4. Client Review Workflow
**Stages:** `not_shared` → `shared` → `viewed` → `approved` | `revision_requested` | `rejected` | `expired` | `revoked`  
**Token:** Time-limited review token in `creative_ai_client_reviews`  
**Retry:** Admin can "resend" — generates new token, resets to `shared`  
**Failure:** `expired` (TTL) or `rejected`; admin must restart  
**Completion:** `approved` — project can proceed to delivery preparation  
**Rollback:** `revoked` by admin; superseded by re-share  
**Blocking:** `in_review` project status blocks delivery until review resolves  

#### 5. Payment Schedule Workflow
**Stages:** `waiting_payment` → (customer submits proof) → `waiting_payment_verification` → (admin verifies) → `deposit_paid` → (production completes) → `waiting_remaining_payment` → `remaining_paid` → `payment_verified`  
**Unlock trigger:** All schedule items paid → `files_unlocked = true`  
**Retry:** Manual admin re-verification  
**Failure:** `failed` on payment schedule row  
**Completion:** All installments `paid` → files unlocked  
**Rollback:** Admin manual unlock bypasses this entirely (risk: see anomalies)  
**Blocking:** `deposit_paid` or `payment_verified` required to start AI production  

#### 6. Human Task (HITL) Workflow
**Stages:** `pending` → `assigned` → `in_progress` → `completed` | `failed` | `escalated`  
**Integration:** Linked to `ai_service_requests` and `ai_execution_plans`  
**SLA:** `slaDeadlineAt` field; `slaStatus`: `on_time`, `warning`, `overdue`, `expired`  
**Retry:** Reassignment to different operator  
**Failure:** `failed` or `escalated` — triggers notification  
**Completion:** `completed` → advances parent service request  
**Blocking:** Service request stays in `draft` until HITL task resolves  

#### 7. Scheduler (Cron/Interval)
**Types:** `cron`, `interval`, `one_time`  
**Target types:** `create_job` (numeric priority), `publish_event`, `webhook` (audit-only), `audit_log`  
**Execution:** `aiSchedulerService.ts` polls `ai_schedules`, runs `executeDueSchedules()`  
**Failure:** Logged to `ai_schedule_runs`; no automatic retry built-in  

#### 8. Event Bus
**Publish:** `publish()` (persists + dispatches) or `publishSafe()` (fire-and-forget, swallows errors)  
**Subscribe:** `ai_event_subscriptions` table; matched by `eventType` pattern  
**Dispatch:** `dispatch()` calls subscriber handlers; outcome recorded  
**Idempotency:** `eventId` unique constraint on `ai_events`  
**Risk:** `publishSafe` silently drops errors — downstream subscribers may not execute  

---

## E. STATE TRANSITION MATRIX (Phase 5)

### ai_service_requests

| From | To | Event | Condition | Side Effect | Failure | Retry |
|---|---|---|---|---|---|---|
| `draft` | `quotation_ready` | Admin issues quotation | None | `ai_quotations` row created, email sent | Quotation creation fails → stays `draft` | Admin re-issues |
| `quotation_ready` | `waiting_customer_approval` | Customer views token link | Token valid + not expired | Status updated | Token expired → stays `quotation_ready` | Admin re-issue |
| `waiting_customer_approval` | `approved` | Customer approves | — | Commercial gate created | DB error | Retry safe |
| `waiting_customer_approval` | `rejected` | Customer rejects | — | Request terminal | — | New request required |
| `waiting_customer_approval` | `revision_requested` | Customer requests change | — | Admin notified | — | Admin issues new quotation |
| `approved` | `converted_to_project` | System conversion | Gate cleared + brief complete | `creative_project` created in `waiting_payment` | Gate not cleared → blocked | Admin clears gate |

### creative_projects

| From | To | Event | Condition | Side Effect | Failure | Retry |
|---|---|---|---|---|---|---|
| `waiting_payment` | `waiting_payment_verification` | Customer submits payment proof | Proof attached | Admin notified | Missing proof | Customer resubmits |
| `waiting_payment_verification` | `deposit_paid` | Admin verifies | Manual review | AI production unlocked | Admin rejects → back to `waiting_payment` | Customer resubmits |
| `deposit_paid` | `active` | Dispatcher picks up | Worker available | Jobs queued | Worker unavailable | Queue retry |
| `active` | `generating` | First job starts | Job claimed | Steps begin executing | Job claim fails | Dispatcher retry |
| `generating` | `in_review` | All steps complete | `humanReview=true` | Review token created, email sent | Token creation fails | Admin creates manually |
| `generating` | `completed` | All steps complete | `humanReview=false` | Deliverables prepared | — | — |
| `in_review` | `revision_requested` | Client requests revision | — | Admin notified | — | Re-enter generation |
| `in_review` | `approved` | Client approves | — | Delivery prep begins | — | — |
| `revision_requested` | `generating` | Admin re-queues | — | New job batch created | — | — |
| `approved` | `completed` | Deliverables ready | All assets stored | `filesUnlocked` if paid | Storage failure | Retry storage |
| `completed` | `waiting_remaining_payment` | System detects unpaid balance | `paymentPolicy=deposit` | Invoice generated | — | — |
| Any non-terminal | `failed` | Worker/system error | — | Admin alerted | — | Admin requeues |
| Any non-terminal | `cancelled` | Admin cancels | — | Jobs cancelled | — | — |

### ai_quotations

| From | To | Event | Condition |
|---|---|---|---|
| `draft` | `issued` | Admin action | None |
| `issued` | `viewed` | Customer opens link | Token valid |
| `viewed` | `approved` | Customer approves | — |
| `viewed` | `rejected` | Customer rejects | — |
| `viewed` | `revision_requested` | Customer requests change | — |
| Any | `deleted` | Admin deletes | Soft delete |

### creative_ai_client_reviews

| From | To | Event | Condition |
|---|---|---|---|
| `not_shared` | `shared` | Admin shares review link | — |
| `shared` | `viewed` | Customer opens link | Token valid + not expired |
| `viewed` | `approved` | Customer approves | — |
| `viewed` | `revision_requested` | Customer requests change | — |
| `viewed` | `rejected` | Customer rejects | — |
| Any | `expired` | TTL exceeded | Auto; no explicit job |
| Any | `revoked` | Admin revokes | — |
| `revision_requested` | `shared` | Admin re-shares | New token generated; old superseded |

### ai_payment_schedule Items

| From | To | Event | Condition |
|---|---|---|---|
| `pending` | `paid` | Admin verifies | Manual verification |
| `pending` | `failed` | Admin rejects | — |
| `pending` | `cancelled` | Project cancelled | Cascade |

### ai_human_tasks

| From | To | Event | SLA |
|---|---|---|---|
| `pending` | `assigned` | Operator claims | — |
| `assigned` | `in_progress` | Work started | SLA clock starts |
| `in_progress` | `completed` | Operator submits | On-time / overdue |
| `in_progress` | `escalated` | SLA breached | Auto or manual |
| Any | `failed` | System error | — |

---

## F. SHARED SERVICES (Phase 6)

| Service | File | Consumers | Description |
|---|---|---|---|
| **Job Dispatcher** | `services/jobDispatcherService.ts` | All renderers, workers | Polls `ai_jobs`, assigns to registered workers |
| **Universal Render Worker** | `workers/universal-renderer/universalRenderWorker.ts` | All image/design services | Single entry point for all render jobs |
| **AI Event Bus** | `services/aiEventBusService.ts` | All services | `publish()` / `publishSafe()` / `subscribe()` / `dispatch()` |
| **AI Scheduler** | `services/aiSchedulerService.ts` | Platform-wide | Cron, interval, one-time job creation |
| **Payment Schedule Service** | `services/paymentScheduleService.ts` | Project conversion, admin routes | Generates schedule, verifies payments, unlocks files |
| **AI Quotation Service** | `services/aiQuotationService.ts` | Service catalog flow | Issues, tracks, and advances quotations |
| **Commercial Gate Service** | `services/commercialGateService.ts` | Conversion service | Creates and verifies/waives gates |
| **Service Request Conversion** | `services/serviceRequestConversionService.ts` | Catalog → project flow | Guards and executes conversion to `creative_project` |
| **Supabase Storage Service** | `services/supabaseStorageService.ts` | All file uploads/deliveries | Bucket management, signed URL generation |
| **Email Service** | `services/emailService.ts` | Quotations, reviews, notifications | Nodemailer via Hostinger SMTP |
| **Audit Log Service** | (via `logAudit()` helper) | All routes | Writes immutable records to `ai_audit_logs` |
| **SSE Manager** | `sseManager.ts` | Customer workspace, admin | Server-Sent Events for real-time status push |
| **Client Review Service** | `services/clientReviewService.ts` | Review routes, project delivery | Token-based review lifecycle |
| **Cost Service** | `services/costService.ts` | AI execution paths | Tracks per-request AI token costs |
| **Intelligent Router** | `services/intelligentRouter.ts` | AI execution | Routes requests to optimal AI provider |
| **Company Profile QC** | `services/companyProfileQcService.ts` | CP domain | Quality gate: score ≥ 80 required |
| **Creative Document Registry** | `services/creativeDocumentRegistry.ts` | Document engine | Maps document types to renderers |
| **Template Matching Service** | `services/templateMatchingService.ts` | Design templates | Matches briefs to templates |
| **ZIP Delivery Service** | `services/zipDeliveryService.ts` | Brand kit, asset delivery | Bundles assets into downloadable ZIPs |
| **Cluster / Worker Manager** | `routes/dispatcher.ts` | Admin panel | Registers/manages worker pool |
| **Repository Layer** | `domains/*/repository.ts` | All domain services | Tenant-scoped DB access pattern |
| **Tenant Resolution** | `security/tenantResolution.ts` | All routes | Resolves tenantId server-side — never from body/query |
| **SSRF Guard** | `middleware/ssrfGuard.ts` | Webhook, URL input routes | Blocks private IPs and cloud metadata endpoints |
| **Rate Limiter** | `middleware/rateLimiter.ts` | All public endpoints | express-rate-limit |
| **Security Hardening** | `middleware/securityHardening.ts` | App startup | Helmet, CORS, additional headers |

---

## G. SOURCE OF TRUTH MATRIX (Phase 7)

| Entity | Canonical Table | Canonical Column(s) | Secondary / Computed |
|---|---|---|---|
| **Order / Service Request** | `ai_service_requests` | `status`, `id` | `ai_quotations.serviceRequestId` |
| **Project** | `creative_projects` | `status`, `projectId`, `filesUnlocked`, `paymentStatus` | `creative_project_steps` (substeps) |
| **Workflow** | `ai_workflows` | `id`, `status` | `ai_workflow_executions` (execution log) |
| **Job** | `ai_jobs` | `status`, `workerId`, `result` | `creative_project_steps.jobId` |
| **Artifact / Asset** | `creative_ai_assets` | `id`, `url`, `render_stage`, `status` | `ai_asset_library`, `ai_portfolio_assets` |
| **Deliverable** | `ai_zip_deliveries` / `cp-document-versions` | `status`, `fileUrl` | `creative_projects.result` (JSONB) |
| **Invoice** | `ai_invoices` | `status`, `amount`, `type` | `ai_payment_schedule.invoiceId` |
| **Payment** | `ai_payment_schedule` | `status`, `paidAt`, `proofUrl` | `creative_projects.paymentStatus` (denormalized) |
| **Review** | `creative_ai_client_reviews` | `status`, `token` | `creative_projects.status = in_review` (derived) |
| **Unlock** | `creative_projects.files_unlocked` | `filesUnlocked` (boolean) | Computed from all `ai_payment_schedule` rows paid |
| **Customer Status (view)** | `customer-dashboard-tokens` → `creative_projects` | `status` | `lifecycleStatusMap.ts` translates to UI labels (Bahasa) |
| **Admin Status (view)** | `creative_projects.status` | `status`, `paymentStatus` | Admin dashboard reads both; NEXT_ACTIONS map for UI |
| **Quotation** | `ai_quotations` | `status`, `token`, `amount` | `ai_quotation_items` (line items) |
| **Commercial Gate** | `ai_commercial_gates` | `status`, `gate_type`, `notes` | Linked to `ai_quotations.serviceRequestId` |
| **Tenant** | Resolved by `tenantResolution.ts` | `tenantId` (per-row on most tables) | Never from HTTP body/query |
| **Brand DNA** | `ai_brand_dna` | `id`, `brandName`, `primaryColors` | `ai_brand_kit_assets` (generated assets) |
| **Design Template** | `design_templates` | `id`, `status`, `slug` | `design_render_batches` (render jobs) |

---

## H. CANONICAL RULES (Phase 8)

These rules are **extracted from code** and must be treated as the authoritative contract for Teams 42–50. Do not implement behavior that contradicts them.

### CR-01: Project Completion
> `creative_project.status = 'completed'` ONLY when ALL `creative_project_steps` for the project reach `completed` status AND the final worker aggregates results into `creative_projects.result`.  
> **Completion is independent of payment.** A project can be `completed` while still having unpaid installments.  
> **Source:** `creativeImageBatchWorkerService.ts`, `creativeWorkflowRunner.ts`

### CR-02: File Unlock
> `creative_projects.files_unlocked = true` ONLY when ALL rows in `ai_payment_schedule` for the project are in a terminal paid state (`paid`), meaning `unpaid.length === 0`.  
> **Exception:** Admin can force-unlock via `POST /api/ai/payments/project/:projectId/unlock` regardless of payment state. This is an intentional bypass with financial risk.  
> **Source:** `paymentScheduleService.ts`

### CR-03: Production Start Gate
> AI production (first job dispatch) ONLY begins after `creative_project.status` reaches `deposit_paid` OR `payment_verified`.  
> For `full_payment` policy: must reach `payment_verified`.  
> For `deposit` policy: `deposit_paid` is sufficient.  
> **Source:** `paymentGate.ts` middleware, `paymentScheduleService.ts`

### CR-04: Service Request → Project Conversion
> Conversion ONLY executes when ALL of:
> 1. `ai_quotations.status = 'approved'`
> 2. `ai_commercial_gates.status IN ('verified', 'waived')`
> 3. `ai_service_requests.createdProjectId IS NULL` (idempotency)
> 4. For `company-profile` slug: `briefIsComplete = true` OR `briefGuardOverrideAt IS NOT NULL`  
> **Source:** `serviceRequestConversionService.ts`

### CR-05: Rendering Complete
> A render job is complete when `ai_jobs.status = 'completed'` AND `ai_jobs.result` contains a non-null output payload.  
> For two-stage image pipeline: `render_stage = 'final'` on `creative_ai_assets` (after SVG/sharp text overlay is applied). The `noText` stage asset must NOT be delivered to customers.  
> **Source:** `imagePreviewService.ts`, `creative-ai-assets.ts` schema

### CR-06: Deliverable Ready
> Customer deliverables are only accessible when BOTH:
> 1. `creative_projects.filesUnlocked = true`
> 2. The deliverable asset exists in Supabase Storage with a valid signed URL  
> **Source:** `customer-workspace.ts`, `supabaseStorageService.ts`

### CR-07: Payment Verification
> Payment is verified ONLY by admin manual action (`POST /api/ai/payments/verify`). Automated verification does NOT exist.  
> Proof submission by customer moves project to `waiting_payment_verification` — this does NOT auto-verify.  
> **Source:** `paymentScheduleService.ts`

### CR-08: Review Required Gate
> If `ai_services.humanReview = true` (mapped to `aiOnly = false` in seed), project MUST pass through `in_review` status. Client must explicitly `approve` the review token before the project can advance to delivery.  
> If `humanReview = false`, project skips directly from `generating` to `completed`.  
> **Source:** `creativeWorkflowRunner.ts`, `clientReviewService.ts`

### CR-09: Quotation Approval Immutability
> Once `ai_quotations.status = 'approved'`, the quotation cannot be un-approved. A new quotation must be issued for changes.  
> **Source:** `aiQuotationService.ts`

### CR-10: Tenant Isolation
> `tenantId` MUST be resolved server-side via `security/tenantResolution.ts`. Never trust `tenantId` from HTTP body, query parameters, or request headers.  
> Repository pattern in `domains/*/repository.ts` enforces per-query tenant scoping.  
> **Source:** `wp00-wp01` canonical context pattern

### CR-11: Admin Auth Model
> All API routes are protected by `adminAuthWithExceptions` mounted once in `app.ts`. Per-route `requireAdminApiKey` middleware does NOT exist (dead import pattern — was removed).  
> Public exceptions (customer-facing, review tokens) are explicitly registered in the exceptions list.  
> **Source:** `app.ts`, `adminAuth.ts`

### CR-12: Event Bus Safety
> Use `publish()` (await) for events where downstream execution is critical.  
> Use `publishSafe()` ONLY for non-critical notifications where silent failure is acceptable.  
> **`publishSafe` swallows all errors** — do not use it for state-advancing events.  
> **Source:** `aiEventBusService.ts`

### CR-13: Zod Import Rule
> Never import `zod` or `zod/v4` directly in `artifacts/api-server/src/routes/*`. All validation schemas must come from `@workspace/api-zod`.  
> **Source:** `api-server-zod-import-rule` memory entry

### CR-14: Job Priority
> When creating jobs via scheduler `create_job` target type, `priority` MUST be a numeric value, not a string label.  
> **Source:** `phase6-ai-scheduler` memory entry

---

## I. GLOBAL DEPENDENCY GRAPH (Phase 9)

```
Customer Order (Web / Customer Portal)
  │
  ▼
ai_service_requests  ←──── ai_service_catalog (service lookup)
  │                         ai_agents (agent assignment)
  │  [Quotation Flow]
  ▼
ai_quotations  ────────────► email (notify customer)
  │  customer approves
  ▼
ai_commercial_gates  ──────► admin review
  │  gate verified/waived
  ▼
serviceRequestConversionService
  │
  ▼
creative_projects  ◄─────── ai_payment_schedule (generated here)
  │  [waiting_payment]        ai_invoices (generated here)
  │  customer submits proof
  ▼
  [waiting_payment_verification]
  │  admin verifies
  ▼
  [deposit_paid]  ──────────► AI production unlocked
  │
  ▼
ai_jobs  ◄───────────────── jobDispatcherService (polling)
  │                          ai_workers (claim/release)
  ▼
creative_project_steps
  │
  ▼
universalRenderWorker  ──────► AI providers (OpenAI, Anthropic, Gemini, Replicate, Mistral)
  │                             supabaseStorageService (store outputs)
  ▼
creative_ai_assets  ─────────► render_stage: 'noText' → SVG overlay → render_stage: 'final'
  │  [humanReview=true]
  ▼
creative_ai_client_reviews  ──► email (review link to client)
  │  client approves
  ▼
  [approved] → delivery preparation
  │
  ▼
ai_zip_deliveries / cp-document-versions  ──► supabaseStorageService (ZIP/PDF stored)
  │
  ▼
  [waiting_remaining_payment]  ──► customer pays balance
  │  all schedule items paid
  ▼
  files_unlocked = true
  │
  ▼
  [completed]  ──────────────► customer_workspace (SSE push, signed URLs)
                                ai_audit_logs (immutable record)
```

### Parallel/Supporting Flows

```
ai_schedules ──► aiSchedulerService ──► ai_jobs (create_job) or ai_events (publish_event)

ai_events ──► aiEventBusService ──► ai_event_subscriptions ──► handler callbacks

ai_human_tasks ──► HITL operator ──► service request advancement

ai_brand_dna ──► creativeBrandIntelligenceService ──► brand kit assets
              ──► ai_brand_kit_assets ──► zipDeliveryService ──► customer
```

---

## J. ARCHITECTURE FINDINGS & RISK MATRIX (Phases 3 + 10 + 11)

### Risk Scoring Legend
- **LOW** — Isolated, well-guarded, low blast radius
- **MEDIUM** — Has edge cases, needs monitoring
- **HIGH** — Cross-service coupling; failure affects multiple domains
- **CRITICAL** — Can silently produce wrong financial/delivery state

---

### ARCHITECTURE

| ID | Finding | Risk | Category |
|---|---|---|---|
| A-01 | `creative_projects.status` and `creative_projects.paymentStatus` are denormalized fields that can desync from `ai_payment_schedule` state | **HIGH** | Architecture |
| A-02 | Dual creation path (legacy direct `sourceType=direct` vs service catalog `sourceType=service_catalog`) produces `creative_projects` rows with different guarantee levels — legacy projects skip quotation, gate, and brief checks | **HIGH** | Architecture |
| A-03 | ~100 DB schema files in `lib/db/src/schema/` with no migration guard — `drizzle-kit push` proposes dropping the entire `ai_platform` schema even for additive changes (known issue — must use hand-written DDL) | **CRITICAL** | Architecture |
| A-04 | `orphan service rows` — `ai_services` table may contain rows seeded by prior runs that are no longer in `seedCatalog.ts` SERVICES array; code does not purge orphans | **MEDIUM** | Architecture |
| A-05 | Service catalog seeds by category slug match — if a category slug changes in seed, orphaned service rows remain active in DB | **MEDIUM** | Architecture |

### WORKFLOW

| ID | Finding | Risk | Category |
|---|---|---|---|
| W-01 | Design batch lifecycle (`batchLifecycle.ts`) has partial-completion semantics — a batch can advance to `completed` even if some items `failed`. No alert fires for partial failures | **HIGH** | Workflow |
| W-02 | No explicit `ALLOWED_TRANSITIONS` guard on `creative_project.status` — transitions are enforced by individual service methods, not a central state machine. Teams adding new transitions may bypass guards | **HIGH** | Workflow |
| W-03 | Scheduler `create_job` target type requires numeric priority — string label silently creates malformed job | **MEDIUM** | Workflow |
| W-04 | `publishSafe` in event bus swallows all errors — if event dispatch fails, no retry, no dead-letter queue, no alert | **HIGH** | Workflow |

### BILLING

| ID | Finding | Risk | Category |
|---|---|---|---|
| B-01 | `creative_project.status = 'completed'` is independent of payment completion. A project can be technically `completed` with an unpaid remaining balance | **CRITICAL** | Billing |
| B-02 | Admin manual unlock (`POST /api/ai/payments/project/:projectId/unlock`) bypasses all payment verification guards — `filesUnlocked = true` without any paid invoice | **CRITICAL** | Billing |
| B-03 | `ai_invoices.amount` (not `total_amount`) — column name non-obvious; teams referencing wrong column will silently read wrong value | **MEDIUM** | Billing |
| B-04 | Legacy direct-submission projects (`sourceType=direct`) skip the quotation flow — they have no `ai_quotations` row, making revenue tracking incomplete for that segment | **HIGH** | Billing |

### STORAGE

| ID | Finding | Risk | Category |
|---|---|---|---|
| S-01 | Customer files served via signed URLs from Supabase Storage — URL expiry not tracked in DB; expired URLs fail silently from customer's perspective | **MEDIUM** | Storage |
| S-02 | Two-stage image pipeline: `render_stage = 'noText'` assets stored alongside `render_stage = 'final'` assets in same bucket/project — no access control prevents `noText` from being served | **HIGH** | Storage |
| S-03 | `pdfkit` must be in esbuild externals list — if removed during a build refactor, `@swc/helpers` dep fails at runtime silently | **MEDIUM** | Storage |

### ARTIFACTS

| ID | Finding | Risk | Category |
|---|---|---|---|
| AR-01 | No enforcement that a `creative_project` in `completed` status has at least one `creative_ai_assets` row — completion can be set without stored artifacts | **CRITICAL** | Artifacts |
| AR-02 | `creative_projects.result` is JSONB — schema is not validated at write time; malformed result JSON silently stored | **MEDIUM** | Artifacts |

### REVIEW

| ID | Finding | Risk | Category |
|---|---|---|---|
| R-01 | Review token expiry (`creative_ai_client_reviews.expiresAt`) is not enforced by a background job — relies on query-time check. Expired reviews may appear `viewed` in admin dashboard | **MEDIUM** | Review |
| R-02 | Client review status has two vocabularies: canonical DB statuses and computed workspace statuses (`lifecycleStatusMap.ts`). Desync between them causes wrong status display | **HIGH** | Review |
| R-03 | `revision_requested` → re-share creates a new token and marks old as `superseded` — but only if the admin explicitly re-shares. If admin re-queues production without re-sharing, the client has no notification | **MEDIUM** | Review |

### NOTIFICATIONS

| ID | Finding | Risk | Category |
|---|---|---|---|
| N-01 | Email via Hostinger SMTP — `535 Authentication Failed` errors documented in memory (`smtp-email-service.md`). SMTP credentials sensitive; failure means no quotation/review emails delivered | **HIGH** | Notifications |
| N-02 | SSE connections managed by `sseManager.ts` — no reconnect guarantee; client-side SSE disconnects will miss status updates | **MEDIUM** | Notifications |
| N-03 | WhatsApp notifications via `FONNTE_TOKEN` — no retry on failure; no dead-letter queue | **MEDIUM** | Notifications |

### PAYMENT

| ID | Finding | Risk | Category |
|---|---|---|---|
| P-01 | Payment verification is entirely manual admin action — no integration with payment gateway. Proof images are uploaded by customers but verified by human eye | **HIGH** | Payment |
| P-02 | `paymentStatus` on `creative_projects` is a denormalized copy — must be kept in sync with `ai_payment_schedule` updates. A missed update creates ghost "paid" or "unpaid" states | **CRITICAL** | Payment |
| P-03 | No payment gateway webhook (Stripe, Midtrans, etc.) — all payments are manual proof-of-payment. Missed proof = stuck project | **HIGH** | Payment |

### PORTAL

| ID | Finding | Risk | Category |
|---|---|---|---|
| PO-01 | `dashboardToken` is hashed and non-recoverable — if customer loses their link, admin must use `POST request-access` to re-issue. No self-service recovery | **MEDIUM** | Portal |
| PO-02 | Customer-facing status labels are in Bahasa Indonesia (`lifecycleStatusMap.ts`) — any new `creative_project.status` value added without a label entry silently shows raw DB string to customer | **HIGH** | Portal |
| PO-03 | Legacy direct-submission flow gives customer a `projectId`-based URL; service catalog flow gives `dashboardToken`-based URL — two different access patterns confuse support | **MEDIUM** | Portal |

### WORKERS

| ID | Finding | Risk | Category |
|---|---|---|---|
| WK-01 | `universalRenderWorker` is a single file handling ALL render types — adding new render types increases blast radius of bugs | **MEDIUM** | Workers |
| WK-02 | Worker cluster (`ai_workers` table) — if a worker crashes mid-job, `ai_jobs.status` stays `running`. Recovery depends on startup reconciler (`startup-resume`) which runs only at process restart | **HIGH** | Workers |
| WK-03 | `claimJob` retry logic — if claim fails, job stays `queued`. No max-age guard; a `queued` job can stay pending indefinitely if all workers are busy | **MEDIUM** | Workers |

### QUEUE

| ID | Finding | Risk | Category |
|---|---|---|---|
| Q-01 | No message queue (Redis/RabbitMQ/SQS) — job queue is the `ai_jobs` PostgreSQL table with polling. Under load, polling interval (5s) creates latency | **MEDIUM** | Queue |
| Q-02 | Dispatcher polls every 5s — high-frequency polling under load may increase DB connection count beyond Supabase pooler limits | **HIGH** | Queue |

### RENDERING

| ID | Finding | Risk | Category |
|---|---|---|---|
| RE-01 | Two-stage image pipeline: `noText` generation → SVG text overlay via sharp — if sharp fails, the `noText` asset is stored without text and may be delivered as final | **CRITICAL** | Rendering |
| RE-02 | Diffusion models cannot render readable text — text baking MUST happen post-generation. Any bypass of the text overlay step produces unusable assets | **CRITICAL** | Rendering |
| RE-03 | QC service (`companyProfileQcService`) scores the FINAL composited image (with text overlay), not the `noText` asset — QC prompt must be overlay-aware | **HIGH** | Rendering |
| RE-04 | PDFKit auto-pagination can silently desync page count near page margins — known risk for long documents | **MEDIUM** | Rendering |
| RE-05 | pptxgenjs default export interop requires specific import pattern — wrong import silently produces empty PPTX | **MEDIUM** | Rendering |

### SECURITY

| ID | Finding | Risk | Category |
|---|---|---|---|
| SE-01 | SSRF guard (`ssrfGuard.ts`) covers webhook/URL inputs — but only routes that explicitly use the middleware. New routes accepting URLs must opt-in | **HIGH** | Security |
| SE-02 | `ADMIN_API_KEY` = `VITE_ADMIN_API_KEY` — same secret exposed to frontend build (Vite `VITE_` prefix = bundled into client JS). This is intentional but means the admin key is visible in source-viewed production builds | **HIGH** | Security |
| SE-03 | Admin manual unlock and gate waive endpoints have no secondary confirmation or audit trail beyond `ai_audit_logs` — no 4-eyes principle | **HIGH** | Security |
| SE-04 | Internal user credentials seeded via env vars (`INITIAL_INTERNAL_ADMIN_EMAIL`, `INITIAL_INTERNAL_ADMIN_PASSWORD`) — these are plaintext in `.replit` config | **CRITICAL** | Security |
| SE-05 | Customer impersonation tokens (`ai-customer-impersonation-tokens.ts` table) exist — scope and expiry of impersonation not audited in this pass | **MEDIUM** | Security |

### TENANT

| ID | Finding | Risk | Category |
|---|---|---|---|
| T-01 | `tenantId` defaults to `"default"` string — all legacy/direct-submission data lands in the same tenant partition. Multi-tenant isolation depends on this default being consistent | **HIGH** | Tenant |
| T-02 | `ai_service_categories` and `ai_services` tables use `tenantId` for visibility but some queries may not filter by tenant — catalog leak possible | **MEDIUM** | Tenant |
| T-03 | `sales_funnel_events` has NO `tenant_id` column — all funnel events are cross-tenant | **HIGH** | Tenant |

### CANONICAL

| ID | Finding | Risk | Category |
|---|---|---|---|
| C-01 | No single canonical status vocabulary document exists in the codebase — status strings are scattered across route files, service files, and schema comments | **HIGH** | Canonical |
| C-02 | `creative_ai_client_reviews` has two status vocabularies (DB canonical vs computed workspace) — divergence documented but not enforced by type system | **HIGH** | Canonical |
| C-03 | `render_stage` column on `creative_ai_assets` distinguishes `noText` from `final` — critical for delivery safety, but no DB constraint prevents wrong stage from being marked deliverable | **CRITICAL** | Canonical |

### LEGACY

| ID | Finding | Risk | Category |
|---|---|---|---|
| L-01 | Legacy direct-submission path (`sourceType=direct`) bypasses quotation, gate, brief guard, and commercial logging — incompatible with revenue analytics | **HIGH** | Legacy |
| L-02 | Legacy quotation routes frozen at 410 — clients on old SDK versions may receive unexpected 410 responses | **MEDIUM** | Legacy |
| L-03 | Concatenated file import bug from prior GitHub imports (5 files had v1+v2 content merged end-to-end) — resolved, but any future re-import must validate file integrity | **MEDIUM** | Legacy |

---

## K. RECOMMENDED TEAM SPLIT (Phase 12)

Based on dependency graph, risk scores, and isolation boundaries:

| Team | Recommended Focus | Depends On | Risk Level |
|---|---|---|---|
| **Team 42** | **Payment Gateway Integration** — replace manual proof-of-payment with automated gateway (Midtrans / Stripe webhook). Fix B-01, B-02, P-01, P-02, P-03. | CR-03, CR-07, ai_payment_schedule | CRITICAL |
| **Team 43** | **Central State Machine** — implement an explicit `ALLOWED_TRANSITIONS` guard for `creative_project.status`. Fix W-02, C-01. Establish canonical status vocabulary document. | CR-01, CR-08 | HIGH |
| **Team 44** | **Render Pipeline Hardening** — enforce render_stage delivery guard (no `noText` to customer), add sharp failure detection, fix QC overlay-aware prompt. Fix RE-01, RE-02, RE-03, C-03, S-02. | CR-05, CR-06 | CRITICAL |
| **Team 45** | **Dual Flow Unification** — deprecate legacy `sourceType=direct` path or add equivalent guards (brief check, commercial logging). Fix A-02, L-01, B-04, PO-03. | CR-04, all quotation services | HIGH |
| **Team 46** | **Tenant Isolation Hardening** — audit all repository queries for missing tenant filter, fix T-01, T-02, T-03 (add tenant_id to sales_funnel_events). | CR-10, tenantResolution.ts | HIGH |
| **Team 47** | **Event Bus Reliability** — replace `publishSafe` fire-and-forget with dead-letter queue or retry pattern for state-advancing events. Fix W-04, N-01, N-02, N-03. | aiEventBusService | HIGH |
| **Team 48** | **Notification Hardening** — add SMTP retry/fallback, SSE reconnect guarantee, WhatsApp retry. Fix N-01, N-02, N-03. | emailService, sseManager | MEDIUM |
| **Team 49** | **Security Audit** — resolve SE-02 (VITE_ADMIN_API_KEY exposure), SE-03 (admin bypass audit trail), SE-04 (seed credentials), SE-01 (SSRF opt-in gap), audit impersonation tokens. | adminAuth.ts, ssrfGuard.ts | CRITICAL |
| **Team 50** | **Observability & Anomaly Detection** — implement runtime checks for: completed-without-artifacts (AR-01), unlocked-without-payment (B-02), paymentStatus desync (A-01, P-02), partial batch failures (W-01). | All tables | HIGH |

---

## L. FILES READ (Phase 13)

### Folders Explored
```
artifacts/api-server/src/routes/         (70+ route files)
artifacts/api-server/src/services/       (50+ service files)
artifacts/api-server/src/services/creative-commercial/
artifacts/api-server/src/domains/        (9 domain subdirectories)
artifacts/api-server/src/workers/
artifacts/api-server/src/middleware/
artifacts/api-server/src/security/
lib/db/src/schema/                        (100 schema files)
lib/db/src/
lib/api-zod/src/
lib/api-client-react/src/
```

### Key Files Directly Referenced
- `artifacts/api-server/src/app.ts` — global route mounting
- `artifacts/api-server/src/services/paymentScheduleService.ts` — payment canonical
- `artifacts/api-server/src/services/aiEventBusService.ts` — event bus
- `artifacts/api-server/src/services/jobDispatcherService.ts` — dispatcher
- `artifacts/api-server/src/services/aiSchedulerService.ts` — scheduler
- `artifacts/api-server/src/services/serviceRequestConversionService.ts` — CR-04
- `artifacts/api-server/src/services/clientReviewService.ts` — review lifecycle
- `artifacts/api-server/src/services/imagePreviewService.ts` — two-stage image
- `artifacts/api-server/src/middleware/paymentGate.ts` — CR-03
- `artifacts/api-server/src/middleware/ssrfGuard.ts` — SSRF
- `artifacts/api-server/src/middleware/adminAuth.ts` — CR-11
- `artifacts/api-server/src/seedCatalog.ts` — service registry
- `artifacts/api-server/src/seed.ts` — base data seed
- `lib/db/src/schema/creative-projects.ts` — project SoT
- `lib/db/src/schema/ai-service-catalog.ts` — service request SoT
- `lib/db/src/schema/ai-payment-schedule.ts` — payment SoT
- `lib/db/src/schema/ai-quotations.ts` — quotation SoT
- `lib/db/src/schema/creative-ai-client-reviews.ts` — review SoT
- `lib/db/src/schema/ai-commercial-gates.ts` — gate SoT
- `lib/db/src/index.ts` — DB export (pool, db, schema)

### Shared / Canonical Modules
- `lib/db` — single DB connection pool for all services
- `lib/api-zod` — all validation schemas (rule: never import zod directly in api-server)
- `lib/api-client-react` — orval-generated hooks; `custom-fetch.ts` for auth header injection
- `artifacts/api-server/src/security/tenantResolution.ts` — tenant canonical
- `artifacts/api-server/src/services/aiEventBusService.ts` — event canonical

### Legacy Modules
- `services/legacyArtifactAdapter.ts` — design migration compatibility shim
- Legacy direct-submission routes in `routes/customer-portal.ts` (`sourceType=direct`)
- Legacy quotation routes (410 frozen)

---

## M. NO-CODE VERIFICATION (Phase 15)

```bash
# Verified: no files modified during audit
git diff --stat    → (empty)
git status --short → ?? attached_assets/... (untracked only)
git stash list     → (empty)

# No migrations created
# No database updates
# No UI updates
# No endpoint updates
# No commits to main
# Branch: audit/team-41-shared-lifecycle (isolated)
```

---

## N. FINAL VERDICT

```
╔══════════════════════════════════════════════════════════════════════╗
║                                                                      ║
║   TEAM 41 AUDIT — FINAL VERDICT:  ✅  PASS                          ║
║                                                                      ║
║   Audit is complete. Baseline established.                           ║
║   This document is the official contract for Teams 42–50.           ║
║                                                                      ║
║   PASS does not mean the implementation is correct.                  ║
║   PASS means the audit is complete and findings are documented.      ║
║                                                                      ║
╚══════════════════════════════════════════════════════════════════════╝
```

### Critical Findings Summary (Must-Fix Before Production Scale)

| ID | Summary | Assigned To |
|---|---|---|
| SE-04 | Plaintext admin credentials in `.replit` config | Team 49 |
| A-03 | drizzle-kit push drops entire schema — hand-write all DDL | ALL teams |
| B-01 | Project can be `completed` with unpaid remaining balance | Team 42 |
| B-02 | Admin manual unlock bypasses all payment guards | Team 42 + 49 |
| RE-01 | `noText` asset can be delivered as final if sharp fails | Team 44 |
| RE-02 | Diffusion text-baking bypass produces unusable assets | Team 44 |
| C-03 | No DB constraint prevents wrong `render_stage` from delivery | Team 44 |
| AR-01 | Project can be `completed` with zero stored artifacts | Team 43 + 50 |
| P-02 | `paymentStatus` desync between `creative_projects` and `ai_payment_schedule` | Team 42 + 50 |
| SE-02 | `VITE_ADMIN_API_KEY` exposed in client JS bundle | Team 49 |

---

*Report generated by Team 41 — Architecture Auditor & Canonical Lifecycle Engineer*  
*Read-only audit. No source files modified. Branch: `audit/team-41-shared-lifecycle`*
