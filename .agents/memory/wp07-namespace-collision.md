---
name: WP-07 namespace collision
description: WP-07 refers to different completed or planned packages across P0 and Phase 6 roadmaps.
---

The repository uses WP-07 for multiple lineages: P0 canonical audit-log schema/immutability, an already-completed SSE tenant-isolation package, and the Phase 6 Layout Constraint Engine. The Phase 6 engine is owner-selected for the current product direction, but it must not be implemented as the next WP until the roadmap/ADR explicitly records that namespace resolution.

**Why:** Repeated autonomous instructions can otherwise choose a same-named branch or merge an obsolete implementation from the wrong roadmap.

**How to apply:** Before starting WP-07 work, verify the authoritative roadmap lineage and treat the existing audit/SSE reports as completion evidence, not as implementation scope. Keep the API typecheck baseline separate.