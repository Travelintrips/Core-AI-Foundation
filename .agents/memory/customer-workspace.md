---
name: Customer Workspace module
description: Design decisions behind the /workspace/:token customer portal area (dashboard, projects, downloads, invoices, brand kit, notifications, profile, support)
---

- Notifications and Recent Activity are **synthesized live** from existing tables (reviews, payments, quotations, assets) at request time, not stored/event-driven. Keeps the feature fully decoupled from the Event Bus / Scheduler (forbidden modules) and avoids a new write path to keep in sync.
  **Why:** avoids touching forbidden modules and avoids a second source of truth for state that already exists elsewhere.
  **How to apply:** if asked to make notifications persistent/push-based later, that's a deliberate scope change — confirm before wiring into the event bus.

- File/asset **lock state must be read from `creativeProjectsTable.filesUnlocked`**, not inferred from `paymentStatus` or asset status. That boolean is the canonical Sprint P0 gate flag.
  **Why:** an early implementation heuristic based on payment/asset status was wrong and would have leaked locked files; caught via live curl testing against real data before shipping.
  **How to apply:** any new surface that gates downloads/assets behind payment must thread `filesUnlocked` through, not re-derive it.

- Public/customer-facing routes in this codebase (confirmed via `quotations.ts`, `customer-portal.ts`, and now `customer-workspace.ts`) intentionally use **manual body validation, not `@workspace/api-zod`**, unlike internal `/ai/*` admin routes.
  **Why:** matches existing convention for the public surface; adding zod there would be inconsistent with precedent, not a security improvement.
  **How to apply:** when adding new public customer endpoints, validate manually and skip api-zod; OpenAPI documentation for these can be retrofitted non-blocking rather than done spec-first.

- Additive versioning on `creative_ai_assets` (nullable `category`, `version` default 1, `parent_asset_id`, `approved_by`, `revision_notes`) was chosen over a new asset-history table to avoid touching the Creative AI pipeline (forbidden module) while still supporting a brand-kit / deliverables view with version numbers.
  **Why:** minimizes blast radius on a forbidden-to-modify module while still surfacing version info to customers.
