# Phase 6 — AI Agent Architecture

**Version:** 1.0.0  
**Baseline:** `material-v5.0.1`  
**Status:** Architecture only — no implementation

---

## 1. Agent Execution Platform

All agents run on the existing execution infrastructure:

| Layer | Existing Component | Usage |
|---|---|---|
| AI invocation | `aiExecutionService.ts` — `ExecutionInput/Output` | All agent LLM calls |
| Model routing | `aiModelRouter.ts` — `routeToModel()` | Provider/model selection per task type |
| Job queue | `ai_jobs` table + `jobDispatcherService.ts` | Async agent execution |
| Event bus | `aiEventBusService.publishSafe()` | Agent output broadcasting |
| Audit trail | `design_agent_logs` table (new, Phase 6) | Per-invocation record |

**No agent hardcodes an AI provider.** All model selection is delegated to `aiModelRouter` which uses capability matching against the live `ai_models` table.

---

## 2. Dependency Injection Pattern

All agents follow the existing `deps` injection pattern from `services/design-ai/`:

```typescript
interface RoomDesignAgentDeps {
  executeAI: (input: ExecutionInput) => Promise<ExecutionOutput>;
  routeModel: (taskType: TaskType, context: RoutingContext) => Promise<ModelRoute>;
  publishEvent: (event: DomainEvent) => Promise<void>;
  logAgentInvocation: (log: AgentLogEntry) => Promise<void>;
}
```

---

## 3. Agent Catalog

### 3.1 Design Composer Agent

**Role:** Master orchestrator. Receives the design brief and coordinates all specialist agents in sequence. Produces the unified `ComposedDesignOutput`.

**Responsibilities:**
- Parse and validate the design brief
- Determine agent execution order (Room Planner → Style Advisor → Furniture Selector → Material Advisor → Lighting Consultant → Budget Optimizer)
- Merge specialist outputs into a single coherent room state
- Detect and resolve conflicts between agent outputs (e.g., budget overflow vs. furniture selection)
- Publish `design.layout.composed` event on success
- Trigger QA Reviewer if quality gate is configured

**Input Schema:**
```typescript
interface DesignComposerInput {
  _v: "1.0";
  sessionId: string;
  brief: DesignBrief;
  templateSnapshot: RoomSnapshot | null;
  availableMaterials: MaterialSummary[];
  availableFurnitureCategories: string[];
  agentConfig: {
    enableBudgetOptimizer: boolean;
    enableLightingConsultant: boolean;
    qualityGateMinScore: number;   // default 70
  };
}
```

**Output Schema:**
```typescript
interface ComposedDesignOutput {
  _v: "1.0";
  sessionId: string;
  roomState: RoomSnapshot;
  furniturePlacements: ProposedPlacement[];
  materialAssignments: ProposedMaterialAssignment[];
  lightingAssignments: ProposedLightingAssignment[];
  costEstimate: MoneyAmount;
  agentInvocationIds: Record<string, string>;  // agentType → logId
  qualityScore: number | null;
  warnings: string[];
}
```

**Dependencies:** All six specialist agents; `DesignSessionRepository`; `CostEstimationService`

**Failure Handling:**
- If any specialist agent fails with a retryable error → retry once with exponential back-off (2s, 4s)
- If a specialist fails permanently → emit `design.composition.agent_failed` event; mark session status `layout_in_progress` with error annotation; do not advance session
- If budget overflow after optimization → include warning in output; do not block composition
- Timeout: 30 seconds total for full orchestration; individual agent timeout: 10 seconds

---

### 3.2 Room Planner Agent

**Role:** Analyses the room dimensions, fixed elements, and room type to produce a spatial zoning plan — dividing the room into functional zones (seating zone, dining zone, circulation path, etc.).

**Responsibilities:**
- Validate room dimensions against `LayoutConstraintSet` for the given room type
- Identify usable floor area after accounting for fixed elements and door clearances
- Output spatial zones with recommended furniture footprint budgets per zone
- Flag ergonomic constraint violations

**Input Schema:**
```typescript
interface RoomPlannerInput {
  _v: "1.0";
  roomTypeCode: string;
  dimensions: RoomDimensions;
  fixedElements: FixedElement[];
  constraintSetId: string;
  stylePreference: string | null;
  priorityItems: string[];
}
```

**Output Schema:**
```typescript
interface RoomPlannerOutput {
  _v: "1.0";
  zones: RoomZone[];             // { zoneType, bounds: Rect2D, priority: number }
  usableAreaSqm: number;
  circulationPaths: Path2D[];
  constraintViolations: ConstraintViolation[];
  recommendedFurnitureBudgetCm2: Record<string, number>; // zoneType → footprint budget
}
```

**Dependencies:** `LayoutConstraintService`; no AI call required for simple cases (rule-based); LLM call for complex ambiguous layouts

**Failure Handling:** If room dimensions are below minimum for room type → return validation error (no LLM call); LLM timeout → return partial plan with warning

---

### 3.3 Interior Designer Agent

**Role:** Translates style/theme preferences into concrete design decisions — which furniture silhouettes, materials, and decorations best express the desired aesthetic.

**Responsibilities:**
- Map style keywords to furniture era and material finish preferences
- Produce ranked style directives for downstream agents
- Select compatible decorations and accent items from the catalog
- Validate color palette coherence

**Input Schema:**
```typescript
interface InteriorDesignerInput {
  _v: "1.0";
  stylePreference: string | null;
  themeId: string | null;
  roomTypeCode: string;
  brief: string;                 // natural language
  availableStyles: RoomStyle[];
  availableThemes: RoomTheme[];
}
```

**Output Schema:**
```typescript
interface InteriorDesignerOutput {
  _v: "1.0";
  resolvedStyleId: string;
  resolvedThemeId: string | null;
  palette: ColorPalette;
  furnitureDirectives: string[];      // e.g. ["prefer clean lines", "avoid ornate legs"]
  materialFinishPriority: string[];   // ordered finish preferences
  decorationIds: string[];            // selected decoration items
  styleKeywords: string[];
  confidence: number;                 // 0–1
}
```

**Dependencies:** `RoomStyleRepository`; `RoomThemeRepository`; LLM (reasoning model preferred)

**Failure Handling:** If no style match found → default to "contemporary"; low confidence (< 0.5) → include warning; never block composition

---

### 3.4 Furniture Selector Agent

**Role:** Selects specific furniture items and variants from the catalog that fit the room zones, style directives, and budget.

**Responsibilities:**
- Query `FurnitureRepository` filtered by room type, style compatibility, and zone footprint budgets
- Select optimal variants (color/finish) consistent with the resolved palette
- Respect budget constraint; rank by value-fit score
- Output proposed placements with suggested positions per zone

**Input Schema:**
```typescript
interface FurnitureSelectorInput {
  _v: "1.0";
  sessionId: string;
  roomZones: RoomZone[];
  resolvedStyleId: string;
  palette: ColorPalette;
  furnitureDirectives: string[];
  budgetMax: number;
  currency: string;
  priorityItems: string[];
  excludedItems: string[];
}
```

**Output Schema:**
```typescript
interface FurnitureSelectorOutput {
  _v: "1.0";
  selectedItems: SelectedFurnitureItem[];
  totalEstimatedCost: MoneyAmount;
  budgetUtilization: number;     // 0–1
  unfulfilledPriorityItems: string[];
  selectionRationale: string;
}

interface SelectedFurnitureItem {
  furnitureId: string;
  variantId: string;
  zoneType: string;
  suggestedPosition: Vector3D;
  suggestedRotationDeg: number;
  priceAmount: number;
  selectionScore: number;        // 0–1
}
```

**Dependencies:** `FurnitureRepository`; `FurnitureVariant` lookup; LLM for ranking and rationale

**Failure Handling:** If catalog returns zero results for a zone → skip zone and add warning; if budget exceeded after best-effort → flag overflow; never hard-fail composition

---

### 3.5 Material Advisor Agent

**Role:** Surfaces compatible materials from the Phase 5 Material Platform and assigns them to room surfaces.

**Responsibilities:**
- Query Phase 5 `materialRecommendationService` filtered by style, surface type, and finish preference
- Assign materials to floor, wall, ceiling, and key furniture surfaces
- Validate material compatibility across surfaces (no conflicting finishes)
- Record assignments as `ProposedMaterialAssignment`

**Input Schema:**
```typescript
interface MaterialAdvisorInput {
  _v: "1.0";
  sessionId: string;
  resolvedStyleId: string;
  palette: ColorPalette;
  materialFinishPriority: string[];
  surfaces: SurfaceRequest[];   // [{ surfaceId, surfaceType, constraints }]
  budgetTierPreference: 'budget' | 'mid' | 'premium' | 'luxury' | null;
}
```

**Output Schema:**
```typescript
interface MaterialAdvisorOutput {
  _v: "1.0";
  assignments: ProposedMaterialAssignment[];
  unassignedSurfaces: string[];
  compatibilityWarnings: string[];
}

interface ProposedMaterialAssignment {
  surface: string;
  materialId: string;            // FK → Phase 5 materials.id
  materialCode: string;
  confidenceScore: number;       // 0–1
  reasoning: string;
}
```

**Dependencies:** Phase 5 `MaterialRecommendationService`; `MaterialLibraryService`; LLM for rationale

**Failure Handling:** If Phase 5 material service unavailable → return empty assignments with warning; never block; log dependency failure in `design_agent_logs`

---

### 3.6 Lighting Consultant Agent

**Role:** Selects lighting fixtures and configurations for the room based on room type, style, and photometric requirements.

**Responsibilities:**
- Determine ambient, task, and accent lighting requirements for the room type
- Select fixtures from `LightingFixture` catalog matching color temperature and lumen requirements
- Suggest fixture positions relative to room zones
- Validate total lumen output against room area

**Input Schema:**
```typescript
interface LightingConsultantInput {
  _v: "1.0";
  roomTypeCode: string;
  dimensions: RoomDimensions;
  zones: RoomZone[];
  resolvedStyleId: string;
  palette: ColorPalette;
  availableFixtures: LightingFixture[];
}
```

**Output Schema:**
```typescript
interface LightingConsultantOutput {
  _v: "1.0";
  assignments: ProposedLightingAssignment[];
  totalLumens: number;
  lightingRationale: string;
  warnings: string[];
}

interface ProposedLightingAssignment {
  fixtureId: string;
  position: Vector3D;
  intensity: number;
  lightingRole: 'ambient' | 'task' | 'accent';
}
```

**Dependencies:** `LightingFixtureRepository`; rule-based lumen calculation; optional LLM for rationale

**Failure Handling:** If no fixtures match → return minimal ambient suggestion; timeout → return empty with warning

---

### 3.7 Style Advisor Agent

**Alias:** Interior Designer Agent (see §3.3). Style advisory is a sub-task of the Interior Designer Agent; not a separate agent in the orchestration graph.

---

### 3.8 Budget Optimizer Agent

**Role:** Post-composition pass that reduces cost to fit within the customer's stated budget without significantly degrading design quality.

**Responsibilities:**
- Rank selected furniture variants by cost-impact ratio
- Suggest lower-cost variant substitutions for high-cost items
- Re-run cost estimate after substitutions
- Ensure substitutions remain style-compatible

**Input Schema:**
```typescript
interface BudgetOptimizerInput {
  _v: "1.0";
  currentSelection: SelectedFurnitureItem[];
  currentTotalCost: MoneyAmount;
  budgetMax: MoneyAmount;
  resolvedStyleId: string;
  palette: ColorPalette;
}
```

**Output Schema:**
```typescript
interface BudgetOptimizerOutput {
  _v: "1.0";
  optimizedSelection: SelectedFurnitureItem[];
  optimizedTotalCost: MoneyAmount;
  substitutions: SubstitutionRecord[];
  budgetAchieved: boolean;
  savingsAmount: MoneyAmount;
}

interface SubstitutionRecord {
  originalVariantId: string;
  replacementVariantId: string;
  reason: string;
  costSaving: MoneyAmount;
}
```

**Dependencies:** `FurnitureVariant` lookup; LLM optional for substitution rationale

**Failure Handling:** If no substitution achieves budget → return original selection with `budgetAchieved: false`; never remove items without substitution

---

### 3.9 Rendering Coordinator

**Role:** Prepares the render payload and submits it to the existing `creative_render_sessions` pipeline.

**Responsibilities:**
- Build a structured render scene description from the composed room state
- Optimise the prompt using `PromptOptimizer` output
- Submit to `productionPipelineService` via the existing API
- Monitor render job status and publish completion event

**Input Schema:**
```typescript
interface RenderingCoordinatorInput {
  _v: "1.0";
  sessionId: string;
  roomSnapshot: RoomSnapshot;
  cameraAngles: string[];
  quality: 'preview' | 'final';
  styleDirectives: string[];
  palette: ColorPalette;
}
```

**Output Schema:**
```typescript
interface RenderingCoordinatorOutput {
  _v: "1.0";
  renderSessionId: string;       // creative_render_sessions.id
  jobIds: string[];              // ai_jobs.id[]
  estimatedCompletionMs: number;
}
```

**Dependencies:** Existing `productionPipelineService`; `PromptOptimizerAgent`; `creative_render_sessions`

**Failure Handling:** If render submission fails → retry once; on second failure → emit `design.render.failed` event; session remains in `render_requested` status for manual retry

---

### 3.10 Prompt Optimizer Agent

**Role:** Refines natural-language room descriptions into high-quality image generation prompts. Applies style keywords, negative prompts, and rendering-specific guidance.

**Responsibilities:**
- Convert `RoomSnapshot` + style directives into a structured text prompt
- Add lighting, perspective, and quality modifiers
- Generate a negative prompt list
- Version the prompt template (prompt templates stored in DB or config file)

**Input Schema:**
```typescript
interface PromptOptimizerInput {
  _v: "1.0";
  roomDescription: string;
  styleKeywords: string[];
  palette: ColorPalette;
  cameraAngle: string;
  quality: 'preview' | 'final';
  furnitureSummary: string;
  promptTemplateVersion: string;
}
```

**Output Schema:**
```typescript
interface PromptOptimizerOutput {
  _v: "1.0";
  positivePrompt: string;
  negativePrompt: string;
  modelHint: 'image_diffusion' | 'image_xl' | null;
  tokenCount: number;
  promptVersion: string;
}
```

**Dependencies:** LLM (text model); prompt template registry

**Failure Handling:** If LLM times out → use rule-based fallback prompt builder; never block render submission

---

### 3.11 QA Reviewer Agent

**Role:** Evaluates AI-generated outputs (moodboards, render previews) against quality criteria and produces a numeric score.

**Responsibilities:**
- Accept an image URL and evaluation criteria
- Score output on: style consistency (0–30), spatial coherence (0–25), material quality (0–20), lighting quality (0–15), overall appeal (0–10)
- Return pass/fail based on configurable threshold (default: 70)
- Provide structured feedback for rejection cases

**Input Schema:**
```typescript
interface QAReviewerInput {
  _v: "1.0";
  sessionId: string;
  assetType: 'moodboard' | 'render_preview' | 'render_final';
  imageUrl: string;
  brief: DesignBrief;
  styleKeywords: string[];
  scoreThreshold: number;       // default 70
}
```

**Output Schema:**
```typescript
interface QAReviewerOutput {
  _v: "1.0";
  totalScore: number;           // 0–100
  dimensionScores: {
    styleConsistency: number;
    spatialCoherence: number;
    materialQuality: number;
    lightingQuality: number;
    overallAppeal: number;
  };
  passed: boolean;
  feedback: string;
  rejectionReasons: string[];
}
```

**Dependencies:** LLM with vision capability (GPT-4o, Claude 3.5, Gemini Vision); `aiModelRouter` must route to a vision-capable model

**Failure Handling:** If vision model unavailable → skip QA gate and log warning; do not block session progression; score recorded as `null`

---

## 4. Agent Orchestration Sequence

```
DesignComposerAgent orchestrates:

Brief received
    │
    ├─► RoomPlannerAgent ─────────────────────────────► Room zones
    │
    ├─► InteriorDesignerAgent ───────────────────────► Style directives, palette
    │
    ├─► FurnitureSelectorAgent (uses zones + style) ─► Selected variants + positions
    │
    ├─► BudgetOptimizerAgent (if over budget) ───────► Optimised selection
    │
    ├─► MaterialAdvisorAgent ────────────────────────► Surface assignments (→ Phase 5)
    │
    ├─► LightingConsultantAgent ─────────────────────► Fixture assignments
    │
    └─► ComposedDesignOutput ─► publishSafe(design.layout.composed)
                                         │
                              PromptOptimizerAgent
                                         │
                              RenderingCoordinatorAgent
                                         │
                              QAReviewerAgent (on moodboard + renders)
```

---

## 5. Agent Configuration Registry

Agent prompts and parameters are stored in a versioned configuration — not hardcoded:

```typescript
interface AgentConfig {
  agentType: string;
  promptTemplateVersion: string;
  modelHint: string | null;            // preferred model capability key
  timeoutMs: number;
  maxRetries: number;
  qualityThreshold: number | null;
}
```

In implementation: stored in a `design_agent_configs` table or a versioned JSON config file loaded at startup — exact mechanism determined during WP-01.
