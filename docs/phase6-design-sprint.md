# Phase 6 — Design Sprint: Room Design Platform

**Version:** 1.0.0  
**Baseline:** `material-v5.0.1` (`b5fd8edd7a6efe35940c9a09443c3070a2dcf118`)  
**Status:** Architecture only — no implementation  
**Date:** 2026-07-27

---

## 1. Executive Summary

Phase 6 transforms the existing Material Platform into a full-stack **AI-powered Room Design Platform**. The platform enables customers, designers, and interior professionals to compose room designs from a curated library of templates, furniture, decorations, and lighting — orchestrated by a multi-agent AI layer and delivered through a structured rendering pipeline.

This document is the architectural overview. It references the six companion documents for detailed specifications.

---

## 2. Phase 6 Vision

> "A customer describes a room. The platform designs it, populates it with real materials and furniture, renders photorealistic previews, iterates on feedback, and exports a complete specification package — with AI doing the heavy lifting at every step."

### Capability Targets

| Capability | Description |
|---|---|
| Room Template Library | Curated, styleable starting-point room layouts |
| Furniture Library | Searchable catalog with 3D metadata and material assignments |
| Decoration Library | Accent items, art, textiles, plants |
| Lighting Library | Fixture catalog with lumen, color-temp, and placement data |
| AI Design Composer | Orchestrates agents to produce a complete room design from a brief |
| Furniture Placement Engine | Constraint-aware spatial placement of furniture |
| Layout Constraint Engine | Room dimension, clearance, and ergonomic rule enforcement |
| Material Recommendation Engine | Surfaces compatible materials from the existing Material Platform |
| Cost Estimation Engine | Budget modeling from furniture, material, and labor inputs |
| Moodboard Generator | Visual concept board from style/theme inputs |
| Room Specification Generator | Exportable design specification documents |
| Rendering Pipeline Integration | Hooks into the existing `creative_render_sessions` pipeline |

---

## 3. Design Principles

Every module in Phase 6 must adhere to these constraints:

| Principle | Implementation Requirement |
|---|---|
| **Single Responsibility** | Each service owns exactly one bounded context; cross-domain calls via defined ports only |
| **Modular** | Services independently deployable; no circular imports between domains |
| **Extensible** | New room types, furniture categories, or AI agents added without modifying existing services |
| **AI Provider Agnostic** | All AI calls through the existing `aiExecutionService` abstraction; no direct provider SDK imports in domain code |
| **JSON Contract First** | All inter-service and API payloads defined in versioned JSON schemas before implementation |
| **Event Driven** | State transitions publish events to `aiEventBusService` via `publishSafe()`; consumers are decoupled |
| **Dependency Injection** | Services receive dependencies through constructor injection; no module-level singletons |
| **No Duplicated Logic** | Material assignment, rendering, and job dispatch reuse existing Phase 5 infrastructure |
| **Compatible with Material Platform** | Phase 6 tables reference `materials` and `material_categories` by FK; no schema changes to existing tables |

---

## 4. Domain Analysis

### 4.1 Core Domains

#### Room Template
**Responsibilities:** Defines the structural skeleton of a room — dimensions, fixed elements (doors, windows, columns), and a style preset. Acts as the starting canvas for a design session.  
**Relationships:** Has many `Room Style` assignments; referenced by `Design Session` as the origin template.  
**Lifecycle:** `draft → published → archived`. Versioned; older versions retained for sessions referencing them.  
**Ownership:** Platform (admin-created); tenants may fork into private templates.

#### Room
**Responsibilities:** A concrete instance of a room in a design session. Captures actual dimensions, orientation, and confirmed fixed elements derived from the template.  
**Relationships:** Belongs to `Design Session`; has many `Furniture Placement`, `Decoration`, `Lighting`, `Material Assignment`.  
**Lifecycle:** Created when session starts; mutated during design; frozen at session completion.  
**Ownership:** Design session owner (customer or designer).

#### Room Style
**Responsibilities:** Encapsulates aesthetic identity — color palette, material finish preferences, furniture era (contemporary, Scandinavian, industrial, etc.), and texture rules.  
**Relationships:** Applied to `Room Template`; drives `Material Recommendation Engine` filters.  
**Lifecycle:** `draft → active → deprecated`.  
**Ownership:** Platform-managed; extensible by admin.

#### Room Theme
**Responsibilities:** A higher-level aesthetic grouping above style (e.g., "Tropical Resort," "Urban Minimalist"). Bundles compatible styles, decoration sets, and lighting presets.  
**Relationships:** Contains multiple `Room Style` references; applied to `Moodboard`.  
**Lifecycle:** `draft → published`.  
**Ownership:** Platform.

#### Room Type
**Responsibilities:** Categorises the functional purpose of the room (bedroom, living room, dining room, kitchen, bathroom, home office). Controls which furniture categories, layout constraints, and lighting presets are available.  
**Relationships:** Constrains `Room Template`; drives `Layout Constraint Engine` rule set selection.  
**Lifecycle:** Immutable enum-like; new types added by migration only.  
**Ownership:** Platform.

#### Furniture
**Responsibilities:** A physical furniture item with dimensions (W×D×H), 3D model reference, weight, material surface list, and placement rules (clearance, rotation constraints).  
**Relationships:** Belongs to `Furniture Category`; has many `Furniture Variant`; assigned to `Room` via `Furniture Placement`.  
**Lifecycle:** `draft → active → discontinued`.  
**Ownership:** Platform catalog; supplier-linked optional.

#### Furniture Category
**Responsibilities:** Hierarchical taxonomy for furniture (e.g., Seating → Sofa → Sectional). Controls filter UI and recommendation scope.  
**Relationships:** Tree structure (self-referential parent FK); groups `Furniture`.  
**Lifecycle:** Admin-managed.  
**Ownership:** Platform.

#### Furniture Variant
**Responsibilities:** A specific SKU of a furniture item — color/finish combination, size variation, supplier reference. Carries its own price and lead time.  
**Relationships:** Child of `Furniture`; selected during `Furniture Placement`.  
**Lifecycle:** Mirrors `Furniture` lifecycle.  
**Ownership:** Platform/supplier.

#### Furniture Placement
**Responsibilities:** Records the spatial state of a furniture item within a `Room` — position (x, y, z), rotation, variant selected, and placement validation status.  
**Relationships:** Links `Room` ↔ `Furniture Variant`; validated by `Layout Constraint Engine`.  
**Lifecycle:** `pending → valid → constraint_violation → accepted`.  
**Ownership:** Design session.

#### Decoration
**Responsibilities:** Non-structural accent items (art, plants, cushions, rugs) placed in a room. Lighter placement model than furniture — no clearance constraints.  
**Relationships:** Assigned to `Room`; categorised by decoration type.  
**Lifecycle:** `active → archived`.  
**Ownership:** Platform catalog.

#### Lighting
**Responsibilities:** Fixture and ambient lighting configuration. Carries photometric data (lumen output, color temperature, beam angle) used by the rendering pipeline.  
**Relationships:** Assigned to `Room`; references fixture catalog item.  
**Lifecycle:** `active → discontinued`.  
**Ownership:** Platform catalog.

#### Material Assignment
**Responsibilities:** Binds an existing `materials` record (Phase 5) to a surface within a room (floor, wall, ceiling, specific furniture face). Inherits the Phase 5 `materialAssignmentService` pattern.  
**Relationships:** References `materials.id` (Phase 5); scoped to `Room` and surface identifier.  
**Lifecycle:** Created during design; versioned on revision.  
**Ownership:** Design session.

#### Moodboard
**Responsibilities:** A visual concept board — aggregates reference images, palette swatches, selected furniture previews, and style keywords into a shareable snapshot.  
**Relationships:** Belongs to `Design Session`; may reference `Room Theme`, `Furniture`, `Decoration`, and `Material`.  
**Lifecycle:** `generating → ready → approved → rejected`.  
**Ownership:** Design session / customer.

#### Rendering Job
**Responsibilities:** A unit of render work submitted to the existing `creative_render_sessions` pipeline. Carries camera angle, quality level, and output format.  
**Relationships:** Linked to `Design Session`; produces `creative_ai_assets` outputs; dispatched through `ai_jobs`.  
**Lifecycle:** Inherits existing render session state machine: `planning → preview_generating → preview_ready → waiting_customer → concept_selected → final_generating → quality_check → completed`.  
**Ownership:** Platform rendering infrastructure.

#### Design Session
**Responsibilities:** The master aggregate for one customer's design engagement. Holds the customer identity, selected template, room state, revision history, active rendering jobs, and export status.  
**Relationships:** Contains `Room`; has many `Design Revision`, `Rendering Job`, `Moodboard`, `Export Package`.  
**Lifecycle:** `brief_submitted → moodboard_ready → layout_in_progress → render_requested → review → approved → exported → archived`.  
**Ownership:** Customer (or designer on behalf of customer).

#### Design Revision
**Responsibilities:** An immutable snapshot of the room state at a point in time — triggered by customer feedback or designer action. Enables rollback and diff display.  
**Relationships:** Child of `Design Session`; snapshots `Furniture Placement`, `Material Assignment`, `Lighting`.  
**Lifecycle:** Created on every commit; immutable thereafter.  
**Ownership:** Design session.

#### Design Version
**Responsibilities:** A named, promotable milestone within a session (e.g., "Concept A," "After Client Review"). Wraps one or more revisions into a publishable version.  
**Relationships:** Groups `Design Revision` records; may be branched.  
**Lifecycle:** `draft → named → locked`.  
**Ownership:** Designer / admin.

#### Export Package
**Responsibilities:** A compiled, downloadable artifact containing the room specification (PDF), material list (CSV/PDF), furniture list (CSV), moodboard (PNG/PDF), and optional 3D model export.  
**Relationships:** Belongs to `Design Session`; generated by `Export Engine` as an `ai_jobs` task.  
**Lifecycle:** `requested → generating → ready → downloaded → expired`.  
**Ownership:** Customer / designer.

---

## 5. User Workflows

### 5.1 Customer Workflow

```
1. Browse Room Templates → Select template + room type
2. Submit Design Brief (style, theme, budget, dimensions)
3. AI generates Moodboard → Customer reviews / requests revision
4. AI composes Layout (furniture placement + material assignment)
5. Customer reviews room preview → requests changes or approves
6. Render Request submitted → Renders returned
7. Customer selects preferred render concept
8. Final render generated → Quality check
9. Customer downloads Export Package
```

### 5.2 Designer Workflow

```
1. Receive design session assignment
2. Review customer brief and AI-generated moodboard
3. Override or refine furniture placement and material assignments
4. Submit manual revision → triggers AI re-render
5. Annotate revisions for customer review
6. Approve final version → trigger export
```

### 5.3 Reviewer Workflow

```
1. Receive QA assignment for completed render
2. Review rendered output against brief criteria
3. Score quality (0–100) using structured rubric
4. Pass → session advances; Fail → session returns to designer with notes
```

### 5.4 Admin Workflow

```
1. Manage Room Template catalog (create, publish, archive)
2. Manage Furniture, Decoration, Lighting catalogs
3. Configure Layout Constraint rule sets per room type
4. Monitor rendering pipeline health and cost metrics
5. Approve/reject customer design sessions in review state
6. Manage AI agent configuration and prompt versions
```

### 5.5 Rendering Worker Workflow

```
1. Poll ai_jobs for rendering task type
2. Claim job via SELECT FOR UPDATE SKIP LOCKED
3. Build render payload (room state + camera config)
4. Submit to rendering provider (Replicate or configured endpoint)
5. Poll for completion → store output in creative_ai_assets
6. Publish render_completed event
7. Update creative_render_sessions state machine
```

### 5.6 Asset Manager Workflow

```
1. Receive new furniture/decoration asset upload
2. Validate 3D model format and dimension metadata
3. Generate thumbnail and preview images
4. Assign to catalog category
5. Publish for use in design sessions
```

### 5.7 AI Agent Workflow (orchestrated)

```
1. Design Composer Agent receives brief from session
2. Delegates to: Room Planner → Style Advisor → Furniture Selector → Material Advisor → Lighting Consultant
3. Each agent returns structured JSON output
4. Composer merges outputs into unified room state
5. Publishes design_composed event
6. Moodboard Generator Agent produces visual board
7. Prompt Optimizer prepares render prompt
8. QA Reviewer evaluates moodboard quality score
```

---

## 6. Success Metrics (KPIs)

| KPI | Target | Measurement |
|---|---|---|
| Render latency (preview) | < 90 seconds p95 | `creative_render_sessions.preview_generated_at - render_requested_at` |
| Render latency (final) | < 5 minutes p95 | `completed_at - final_requested_at` |
| AI design composition time | < 30 seconds p95 | Agent orchestration duration |
| Recommendation accuracy | ≥ 80% customer acceptance on first recommendation | Accepted placements / total placements |
| AI response quality score | ≥ 80/100 average QA score | QA Reviewer agent output |
| User satisfaction | ≥ 4.2/5 star average | Post-session survey |
| Revision count | ≤ 3 average revisions per session | `design_revisions.count` per session |
| Template reuse rate | ≥ 40% sessions start from a template | Template-origin sessions / total sessions |
| Rendering success rate | ≥ 98% | Completed renders / total render jobs |
| Export success rate | ≥ 99% | Successful exports / total export requests |
| Material recommendation acceptance | ≥ 70% first-pass acceptance | Accepted material assignments / AI-recommended assignments |
| Cost estimate accuracy | ≤ 15% variance from actual | Estimated cost vs. confirmed order cost |

---

## 7. Companion Documents

| Document | Coverage |
|---|---|
| `docs/phase6-domain-model.md` | Entities, aggregates, repositories, events, commands, queries |
| `docs/phase6-api-blueprint.md` | REST API endpoint specifications |
| `docs/phase6-database-blueprint.md` | Table schemas, indexes, RLS strategy |
| `docs/phase6-ai-agent-architecture.md` | AI agent specifications |
| `docs/phase6-work-packages.md` | WP-01 through WP-12 implementation breakdown |
| `docs/phase6-risk-analysis.md` | Risk register with mitigations |
