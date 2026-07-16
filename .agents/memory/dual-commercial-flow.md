---
name: Dual Commercial Flow (Standard checkout vs Custom/Enterprise quotation)
description: How the AI Enterprise Platform supports two parallel commercial paths — fixed_price checkout (no quotation) and custom_project/enterprise (quotation-gated) — and the conventions new payment/invoice features must follow.
---

## Shape of the flow
- `ai_services.service_flow` (`fixed_price` | `custom_project` | `enterprise`) decides the path. `fixed_price` skips `ai_quotations` entirely — checkout creates the `creative_projects` row directly (status `waiting_payment`) once the brief is done.
- `ai_service_packages.payment_policy` (`full_payment` | `deposit`, plus `deposit_percentage`) decides whether one `ai_payment_schedule` row (full) or two (deposit + remaining_balance) get generated per project.
- AI production (`runCreativeBriefWorkflow`) is fired fire-and-forget from `verifyPayment()` in `paymentScheduleService.ts` only after the relevant installment is admin-verified — this is the single gate that must stay in place for both flows.
- Found and fixed (2026-07-15): conversion/quotation-approval code paths had grown their own copies of the "if project.status === pending, start workflow" logic, independent of `verifyPayment()`. That's a payment bypass, not a redundant safeguard — any new code that creates or transitions a `creative_projects` row must NEVER call `runCreativeBriefWorkflow` itself; only `verifyPayment()` may. Route/service code should create projects in `waiting_payment` and stop there.

## Why project-creation timing differs from the literal spec
The spec implied "project created after payment", but `ai_payment_schedule` rows have a NOT NULL FK to `creative_projects.id`, so the project must exist first to attach a schedule to it. Chose to create the project at checkout time (status `waiting_payment`) and gate only the *AI build step* on payment verification — this preserves the hard requirement ("Standard flow never creates a quotation") without needing a nullable-FK/orphan-schedule workaround.

## Non-obvious integration points
- `creative_projects.status` was extended additively (comment-only change, no enum/constraint) to add payment lifecycle states like `waiting_payment`, `waiting_payment_verification`, `payment_verified`, etc. Both legacy and new values are valid — never replace the vocabulary, only append, matching the existing `service-request-status-vocabulary` convention.
- The `ai-platform` admin app uses orval-generated hooks from `@workspace/api-client-react` for CRUD (services/categories), but `service-requests.tsx`-style pages use a hand-written `apiFetch` + `x-admin-api-key` header pattern for anything not worth adding to OpenAPI codegen immediately. The new Payments admin page follows the `apiFetch` pattern, not orval.
- `customer-portal` never uses orval — always the hand-written `customFetch` hook pattern in `use-catalog.ts`.
- Manually deleting a `creative_projects` row while its fire-and-forget `runCreativeBriefWorkflow` is still executing throws an FK violation in `creative_project_steps` — this is expected test-cleanup interference, not a product bug; don't chase it as one.
