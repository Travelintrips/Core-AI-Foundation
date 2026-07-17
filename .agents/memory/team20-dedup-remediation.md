---
name: Team 20 de-duplication remediation
description: Key decisions and gotchas from the Team 20 (product-design) de-duplication review on feature/20-product-design.
---

## Rule: creative-workflow-v2 belongs to Team 1, not Team 20

Team 20's branch contained an entire `creative-workflow-v2/` DAG workflow engine (cycle detection, topological sort, critical path, retry policy, parallel grouper). This was NOT a Team 20 implementation — it was Team 1's engine accidentally bundled into the wrong branch. Remove entirely, do not refactor or rename. Retrieve from Team 1's branch if needed.

**Why:** The engine duplicates the existing `routes/workflows.ts` + `aiWorkflowsTable` that is already on main. Two parallel workflow engines cannot coexist.

## Rule: three integration files belong to Team 1

`integration/manifests/team-01.json`, `integration/migrations/team-01.sql`, `integration/openapi/team-01.yaml` were all committed into the Team 20 branch. Remove them — they are not Team 20's responsibility.

## What was kept (minimal domain contract)

Five contract types in `types/contracts.ts` (new file added during remediation):
- `ProductDesignRequirements` — concept as engine input
- `ProductDesignBrief` — concept as manufacturer communication
- `ProductDesignCompositionMapping` — concept as Team 12 render target
- `ProductDesignQcProfile` — concept as Team 13 QC criteria
- `ProductDesignDeliverableManifest` — concept as Team 14 asset tracking
- `ExistingEngineAdapter` — interface for Team 24 to inject Teams 11-14 adapters

Plus: 6 pure-logic validators (cmfValidator, dimensionsValidator, componentPlacer, disclaimerService, variantConsistencyChecker, manufacturerBriefBuilder) — zero external deps, safe to call anywhere.

## What was removed

- `creative-workflow-v2/` routes + services + types (Team 1, not Team 20)
- `routes/` dir (concepts, manufacturer, mockups, variants) — CRUD before foundation tables exist
- `mockupComposer.ts` — duplicates `services/design-renderer/` on main
- Null ports (nullBlueprintPort, nullCompositionPort) — only relevant with active engine
- `ai-platform/pages/product-design/` and `customer-portal/pages/product-design/` — premature UI

## Manifest pattern for BLOCKED teams

`routesToMount: []`, `pagesToRegister: []`, `sidebarItems: []` — explicitly empty, not omitted.
`status: "BLOCKED_PENDING_FOUNDATION"` at top level.
`dependsOn: ["07","08","11","12","13","14"]` listing all blocking teams.
`futureIntegrationPoints` array documenting FIP-01..05 (what to do when each blocker clears).

## Test outcome

55/55 tests pass after removing Section 8 (mockup composition, null ports). Section 8 comment preserved in test file explaining why it was removed and when it will return.
