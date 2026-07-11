---
name: Phase 2.6 Commercial Automation Layer
description: Key constraints and gotchas for the P2.6 automation/segmentation sprint
---

## Tables added
- `ai_customer_segments` — one row per customer (customerProfileId unique), segment + score
- `ai_automation_rules` — rule engine table (ruleCode unique, triggerEvent, actionType)
- `ai_automation_executions` — execution log per rule firing

## Seed automation rules
Call `POST /api/ai/automation/seed` to insert 6 default rules. Already ran — rules are live.

## Key constraint: no customerProfileId on service_requests
`aiServiceRequestsTable` uses `customerEmail` (text), NOT `customerProfileId`. 
- To count completed orders for segmentation: use raw SQL joining `ai_platform.customer_profiles` by email.
- `calculateCustomerSegment(profileId)` first fetches email via `SELECT client_email FROM ai_platform.customer_profiles WHERE id = $profileId`.

## customerId in sales_funnel_events is integer
`salesFunnelEventsTable.customerId` is `integer("customer_id")` — NOT a string. Handlers that track funnel events must pass `number | undefined`, not `string`.

## Event handler pattern
New handlers added to `eventHandlerRegistry.ts`: `automation_trigger`, `recalculate_health`, `resegment_customer`, `track_funnel_event`. All use dynamic `import()` to avoid circular deps.

## Schema import fix
New schema files must use `import { appSchema } from "./_pg-schema"` NOT `"./app-schema.js"`.

## Workspace affiliate/referral
- Affiliate: looked up by `session.clientEmail` (aiAffiliatesTable.email)
- Referral: requires `customer_profiles.id` via raw SQL: `SELECT id FROM ai_platform.customer_profiles WHERE client_email = $email`
- Routes at `/public/customer/workspace/:token/affiliate` and `/referral`

## Pre-existing build errors (not my code)
`helmet` and `express-rate-limit` were missing packages — installed during this sprint via `pnpm add helmet express-rate-limit` in `artifacts/api-server`. `pdfkit`, `nodemailer` type errors are pre-existing but packages are installed at runtime.

**Why:** aiServiceRequestsTable was designed for the catalog flow before the customer_profiles table was added; the two tables are only linked via email, not a FK.
