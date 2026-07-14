---
name: Brief Intelligence Engine (customer-portal)
description: Deterministic rule-based recommendation engine for the brief wizard — field-mapping and apply-mode decisions to stay consistent with.
---

Lives at `artifacts/customer-portal/src/features/brief-intelligence/`. Pure, rule-based (no LLM) — recomputed on every render from live `BriefData`, safe to call cheaply.

**Field-mapping decision:** `BriefData` only has direct fields for style/color/audience (chip fields) and a free-text deliverable field. Categories with no schema field of their own (personality, tone of voice, photography/visual/content direction) are "advisory-only" and can only be applied by appending a labeled bullet into `specialRequirements`, and only when that field is still empty.
**Why:** the schema is frozen for this task (no schema changes allowed); silently overwriting a user's own free text is worse than not offering the suggestion inline.
**How to apply:** when adding a new recommendation category, decide up front whether it maps to a real chip field (mergeable, respects existing per-field max-selection limits, never removes a user pick) or is advisory-only (empty-field-only, additive bullet). Don't invent a third pattern.

**Apply modes** (`apply-single` / `apply-category` / `apply-all-empty-only`) all funnel through `applyRecommendations()` in `apply-adapter.ts`, which returns `{updatedBrief, applied, skipped (with human reasons), warnings}`. The panel only ever calls this + the existing `onApply(updatedBrief)` callback that already flows into the wizard's autosave — no new API calls were introduced.

Industry resolution is index-first: direct `INDUSTRY_OPTIONS` key match → keyword-alias fallback (`industry-fallback.ts`) against free-text → generic fallback profile. Conflicts (e.g. luxury+playful) are detected but only produce non-blocking warnings, never filtering.
