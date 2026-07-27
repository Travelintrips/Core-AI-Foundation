# Phase 6 — Domain Model

**Version:** 1.0.0  
**Baseline:** `material-v5.0.1`  
**Status:** Architecture only — no implementation

---

## 1. Bounded Contexts

```
┌─────────────────────────────────────────────────────────────────────┐
│  ROOM DESIGN PLATFORM                                               │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │  Catalog     │  │  Session     │  │  AI Orchestration        │  │
│  │  Context     │  │  Context     │  │  Context                 │  │
│  │              │  │              │  │                          │  │
│  │  Templates   │  │  Design      │  │  Composer Agent          │  │
│  │  Furniture   │  │  Session     │  │  Placement Engine        │  │
│  │  Decoration  │  │  Revision    │  │  Material Recommender    │  │
│  │  Lighting    │  │  Version     │  │  Cost Estimator          │  │
│  │  Room Style  │  │  Moodboard   │  │  Moodboard Generator     │  │
│  │  Room Theme  │  │  Export      │  │  Prompt Optimizer        │  │
│  └──────┬───────┘  └──────┬───────┘  └───────────┬──────────────┘  │
│         │                 │                       │                 │
│  ┌──────▼─────────────────▼───────────────────────▼──────────────┐  │
│  │  Shared Kernel                                                 │  │
│  │  (Material Platform Phase 5 · Job Queue · Event Bus ·        │  │
│  │   Render Pipeline · Auth · Tenant Resolution)                 │  │
│  └────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Entities

### 2.1 Catalog Context

#### `RoomTemplate`
```typescript
interface RoomTemplate {
  id: string;                    // UUID
  name: string;
  slug: string;
  roomTypeId: string;            // FK → RoomType
  styleId: string | null;        // FK → RoomStyle (default style)
  dimensions: RoomDimensions;    // Value Object
  fixedElements: FixedElement[]; // Value Object[]
  previewImageUrl: string | null;
  thumbnailUrl: string | null;
  status: 'draft' | 'published' | 'archived';
  version: number;
  tenantId: string | null;       // null = platform-wide
  createdAt: Date;
  updatedAt: Date;
}
```

#### `RoomType`
```typescript
interface RoomType {
  id: string;
  code: 'bedroom' | 'living_room' | 'dining_room' | 'kitchen' | 'bathroom' | 'home_office' | 'study' | 'kids_room';
  label: string;
  constraintSetId: string;       // FK → LayoutConstraintSet
  availableFurnitureCategoryIds: string[];
  lightingPresetIds: string[];
}
```

#### `RoomStyle`
```typescript
interface RoomStyle {
  id: string;
  name: string;                  // "Scandinavian", "Industrial", "Japandi"
  palette: ColorPalette;         // Value Object
  materialFinishPreferences: string[]; // e.g. ["matte", "natural_wood"]
  furnitureEra: string;          // e.g. "contemporary", "mid_century"
  textureRules: TextureRule[];   // Value Object[]
  status: 'draft' | 'active' | 'deprecated';
}
```

#### `RoomTheme`
```typescript
interface RoomTheme {
  id: string;
  name: string;                  // "Tropical Resort", "Urban Minimalist"
  styleIds: string[];            // FK → RoomStyle[]
  decorationSetIds: string[];
  lightingPresetIds: string[];
  status: 'draft' | 'published';
}
```

#### `FurnitureItem`
```typescript
interface FurnitureItem {
  id: string;
  name: string;
  slug: string;
  categoryId: string;            // FK → FurnitureCategory
  dimensions: PhysicalDimensions; // W×D×H in cm
  weight: number | null;         // kg
  modelUrl: string | null;       // 3D model reference
  surfaceList: string[];         // e.g. ["seat", "frame", "legs"]
  placementRules: PlacementRule[]; // Value Object[]
  status: 'draft' | 'active' | 'discontinued';
  createdAt: Date;
}
```

#### `FurnitureCategory`
```typescript
interface FurnitureCategory {
  id: string;
  name: string;
  parentId: string | null;       // self-referential tree
  depth: number;
  roomTypeIds: string[];         // applicable room types
}
```

#### `FurnitureVariant`
```typescript
interface FurnitureVariant {
  id: string;
  furnitureId: string;           // FK → FurnitureItem
  sku: string;
  colorName: string;
  finishCode: string;
  dimensionOverride: PhysicalDimensions | null;
  priceAmount: number;
  priceCurrency: string;
  leadTimeDays: number | null;
  supplierCode: string | null;
  thumbnailUrl: string | null;
  status: 'active' | 'discontinued';
}
```

#### `DecorationItem`
```typescript
interface DecorationItem {
  id: string;
  name: string;
  decorationType: 'art' | 'plant' | 'rug' | 'cushion' | 'curtain' | 'mirror' | 'accessory';
  thumbnailUrl: string;
  styleIds: string[];            // compatible styles
  themeIds: string[];
  status: 'active' | 'archived';
}
```

#### `LightingFixture`
```typescript
interface LightingFixture {
  id: string;
  name: string;
  fixtureType: 'ceiling' | 'pendant' | 'floor' | 'table' | 'wall' | 'recessed' | 'strip';
  lumenOutput: number;
  colorTemperatureK: number;
  beamAngleDeg: number | null;
  mountingType: string;
  dimensions: PhysicalDimensions;
  status: 'active' | 'discontinued';
}
```

---

### 2.2 Session Context

#### `DesignSession` (Aggregate Root)
```typescript
interface DesignSession {
  id: string;
  customerProfileId: string;
  tenantId: string;
  templateId: string | null;     // FK → RoomTemplate
  roomTypeId: string;
  brief: DesignBrief;            // Value Object
  status: DesignSessionStatus;
  currentVersionId: string | null;
  activeRenderJobId: string | null;
  estimatedCost: MoneyAmount | null;
  createdAt: Date;
  updatedAt: Date;
}

type DesignSessionStatus =
  | 'brief_submitted'
  | 'moodboard_generating'
  | 'moodboard_ready'
  | 'layout_in_progress'
  | 'render_requested'
  | 'render_ready'
  | 'in_review'
  | 'approved'
  | 'exporting'
  | 'exported'
  | 'archived';
```

#### `Room`
```typescript
interface Room {
  id: string;
  sessionId: string;
  dimensions: RoomDimensions;
  orientation: 'north' | 'south' | 'east' | 'west' | null;
  fixedElements: FixedElement[];
  floorMaterialId: string | null;   // FK → materials (Phase 5)
  wallMaterialId: string | null;
  ceilingMaterialId: string | null;
  snapshotAt: Date | null;
}
```

#### `FurniturePlacement`
```typescript
interface FurniturePlacement {
  id: string;
  roomId: string;
  variantId: string;             // FK → FurnitureVariant
  position: Vector3D;            // Value Object (x, y, z in cm)
  rotation: number;              // degrees around Y axis
  validationStatus: 'pending' | 'valid' | 'constraint_violation' | 'accepted';
  violationCodes: string[];
  placedBy: 'ai' | 'designer' | 'customer';
  createdAt: Date;
}
```

#### `DesignRevision`
```typescript
interface DesignRevision {
  id: string;
  sessionId: string;
  versionId: string;
  revisionNumber: number;
  roomSnapshot: RoomSnapshot;    // Value Object — immutable copy of room state
  triggeredBy: 'customer_feedback' | 'designer_action' | 'ai_recompose' | 'system';
  notes: string | null;
  createdAt: Date;               // immutable
}
```

#### `DesignVersion`
```typescript
interface DesignVersion {
  id: string;
  sessionId: string;
  label: string;                 // "Concept A", "Post Client Review v2"
  status: 'draft' | 'named' | 'locked';
  revisionIds: string[];
  createdAt: Date;
}
```

#### `Moodboard`
```typescript
interface Moodboard {
  id: string;
  sessionId: string;
  themeId: string | null;
  styleId: string | null;
  referenceImageUrls: string[];
  paletteSwatches: ColorSwatch[]; // Value Object[]
  furniturePreviews: string[];    // thumbnailUrls
  styleKeywords: string[];
  generatedImageUrl: string | null;
  qualityScore: number | null;    // 0–100 from QA agent
  status: 'generating' | 'ready' | 'approved' | 'rejected';
  createdAt: Date;
}
```

#### `ExportPackage`
```typescript
interface ExportPackage {
  id: string;
  sessionId: string;
  includeSpecPdf: boolean;
  includeMaterialList: boolean;
  includeFurnitureList: boolean;
  includeMoodboard: boolean;
  include3dModel: boolean;
  storageObjectKey: string | null;
  downloadUrl: string | null;
  expiresAt: Date | null;
  status: 'requested' | 'generating' | 'ready' | 'downloaded' | 'expired';
  jobId: string | null;          // FK → ai_jobs
  createdAt: Date;
}
```

---

## 3. Value Objects

```typescript
interface RoomDimensions {
  widthCm: number;
  depthCm: number;
  heightCm: number;
  areaSqm: number;              // derived: widthCm * depthCm / 10000
}

interface FixedElement {
  type: 'door' | 'window' | 'column' | 'beam' | 'stair';
  position: Vector2D;
  widthCm: number;
  heightCm: number;
  wallFacing: 'north' | 'south' | 'east' | 'west';
}

interface Vector3D { x: number; y: number; z: number; }
interface Vector2D { x: number; y: number; }

interface PhysicalDimensions {
  widthCm: number;
  depthCm: number;
  heightCm: number;
}

interface ColorPalette {
  primary: string;    // hex
  secondary: string;
  accent: string;
  neutral: string;
  background: string;
}

interface ColorSwatch {
  hex: string;
  name: string;
  role: 'primary' | 'secondary' | 'accent' | 'neutral';
}

interface MoneyAmount {
  amount: number;
  currency: string; // ISO 4217
}

interface TextureRule {
  surface: 'floor' | 'wall' | 'ceiling' | 'upholstery';
  preferredFinish: string[];
  excludedFinish: string[];
}

interface PlacementRule {
  type: 'min_clearance' | 'wall_proximity' | 'anchor_required' | 'rotation_locked';
  value: number | boolean | string;
}

interface DesignBrief {
  description: string;
  stylePreference: string | null;
  themeId: string | null;
  budgetMin: number | null;
  budgetMax: number | null;
  currency: string;
  dimensionOverride: RoomDimensions | null;
  priorityItems: string[];         // e.g. ["king bed", "work desk"]
  constraints: string[];           // e.g. ["no bright colors", "must fit wheelchair"]
  version: string;                 // contract version: "1.0"
}

interface RoomSnapshot {
  roomDimensions: RoomDimensions;
  fixedElements: FixedElement[];
  furniturePlacements: FurniturePlacement[];
  materialAssignments: { surface: string; materialId: string }[];
  lightingAssignments: { fixtureId: string; position: Vector3D }[];
  decorationAssignments: { decorationId: string; position: Vector3D }[];
  snapshotVersion: string;
}
```

---

## 4. Aggregates

| Aggregate Root | Owned Entities |
|---|---|
| `DesignSession` | `Room`, `DesignRevision`, `DesignVersion`, `Moodboard`, `ExportPackage` |
| `RoomTemplate` | `FixedElement[]` (embedded value objects) |
| `FurnitureItem` | `FurnitureVariant[]` |

Cross-aggregate references use IDs only (no direct object references).

---

## 5. Repositories (Interfaces)

```typescript
interface RoomTemplateRepository {
  findById(id: string): Promise<RoomTemplate | null>;
  findByRoomType(roomTypeId: string, status?: string): Promise<RoomTemplate[]>;
  save(template: RoomTemplate): Promise<void>;
  publishVersion(id: string): Promise<void>;
  archive(id: string): Promise<void>;
}

interface DesignSessionRepository {
  findById(id: string): Promise<DesignSession | null>;
  findByCustomer(customerProfileId: string, tenantId: string): Promise<DesignSession[]>;
  save(session: DesignSession): Promise<void>;
  updateStatus(id: string, status: DesignSessionStatus): Promise<void>;
}

interface FurnitureRepository {
  findById(id: string): Promise<FurnitureItem | null>;
  search(query: FurnitureSearchQuery): Promise<FurnitureItem[]>;
  findVariant(variantId: string): Promise<FurnitureVariant | null>;
  findCompatibleForRoom(roomTypeId: string, styleId: string): Promise<FurnitureItem[]>;
}

interface MoodboardRepository {
  findBySession(sessionId: string): Promise<Moodboard[]>;
  save(moodboard: Moodboard): Promise<void>;
  updateStatus(id: string, status: Moodboard['status']): Promise<void>;
}
```

---

## 6. Domain Services

| Service | Responsibility |
|---|---|
| `DesignComposerService` | Orchestrates AI agents to produce a complete room design from a brief |
| `FurniturePlacementService` | Validates and applies furniture placements; enforces clearance rules |
| `LayoutConstraintService` | Loads and evaluates constraint sets for a room type |
| `MaterialRecommendationService` | Queries Phase 5 material library filtered by style/surface compatibility |
| `CostEstimationService` | Aggregates furniture variant prices and material estimates |
| `MoodboardService` | Drives the moodboard agent and stores results |
| `RevisionService` | Creates immutable revision snapshots; manages version boundaries |
| `ExportService` | Compiles and archives export packages via the job queue |
| `RenderRequestService` | Constructs render payloads and submits to the existing render pipeline |

---

## 7. Factories

```typescript
// Creates a new DesignSession from a brief and optional template
DesignSessionFactory.create(brief: DesignBrief, template: RoomTemplate | null, customer: CustomerProfile): DesignSession

// Produces a FurniturePlacement from AI agent output
FurniturePlacementFactory.fromAgentOutput(output: FurnitureSelectorOutput, room: Room): FurniturePlacement

// Creates a new DesignRevision snapshot
RevisionFactory.snapshot(session: DesignSession, triggeredBy: string, notes?: string): DesignRevision

// Constructs render payload for the render pipeline
RenderPayloadFactory.build(session: DesignSession, cameraAngle: string, quality: 'preview' | 'final'): RenderPayload
```

---

## 8. Domain Events

All events published via `aiEventBusService.publishSafe()`.

| Event | Trigger | Payload |
|---|---|---|
| `design.session.created` | New session created | `{ sessionId, customerId, tenantId, roomTypeId }` |
| `design.brief.submitted` | Brief accepted | `{ sessionId, brief }` |
| `design.moodboard.generated` | Moodboard ready | `{ sessionId, moodboardId, qualityScore }` |
| `design.moodboard.approved` | Customer approved moodboard | `{ sessionId, moodboardId }` |
| `design.layout.composed` | AI composed room layout | `{ sessionId, placementCount, recommendationCount }` |
| `design.furniture.placed` | Furniture placement validated | `{ sessionId, placementId, validationStatus }` |
| `design.revision.created` | Revision snapshot saved | `{ sessionId, revisionId, revisionNumber }` |
| `design.render.requested` | Render job submitted | `{ sessionId, renderJobId, quality }` |
| `design.render.completed` | Render output available | `{ sessionId, renderJobId, assetId }` |
| `design.session.approved` | Session approved by reviewer | `{ sessionId, reviewerId }` |
| `design.export.requested` | Export package started | `{ sessionId, exportId, formats }` |
| `design.export.ready` | Export package compiled | `{ sessionId, exportId, downloadUrl }` |
| `design.session.archived` | Session archived | `{ sessionId }` |

---

## 9. Commands

```typescript
// Session lifecycle
CreateDesignSession(brief: DesignBrief, templateId?: string, customerId: string): void
SubmitBrief(sessionId: string, brief: DesignBrief): void
ApproveSession(sessionId: string, reviewerId: string): void
ArchiveSession(sessionId: string, reason: string): void

// Design composition
ComposeMoodboard(sessionId: string, stylePreferences: StyleInput): void
ComposeLayout(sessionId: string, brief: DesignBrief): void
PlaceFurniture(sessionId: string, variantId: string, position: Vector3D, rotation: number): void
RemoveFurnitureFromRoom(sessionId: string, placementId: string): void
AssignMaterial(sessionId: string, surface: string, materialId: string): void

// Revision & versioning
CreateRevision(sessionId: string, triggeredBy: string, notes?: string): void
NameVersion(sessionId: string, versionId: string, label: string): void
LockVersion(sessionId: string, versionId: string): void

// Rendering
RequestPreviewRender(sessionId: string, cameraAngles: string[]): void
RequestFinalRender(sessionId: string, conceptIndex: number): void

// Export
RequestExport(sessionId: string, formats: ExportFormat[]): void
```

---

## 10. Queries

```typescript
// Catalog
GetRoomTemplates(roomTypeId?: string, status?: string): RoomTemplate[]
GetFurnitureCatalog(categoryId?: string, styleId?: string, budget?: BudgetRange): FurnitureItem[]
GetMaterialRecommendations(surface: string, styleId: string, roomTypeId: string): MaterialRecommendation[]

// Session
GetDesignSession(sessionId: string): DesignSession
GetSessionRevisions(sessionId: string): DesignRevision[]
GetSessionVersions(sessionId: string): DesignVersion[]
GetActiveMoodboard(sessionId: string): Moodboard | null
GetCostEstimate(sessionId: string): CostEstimate
GetExportStatus(sessionId: string, exportId: string): ExportPackage

// Admin
GetSessionsByStatus(tenantId: string, status: DesignSessionStatus): DesignSession[]
GetRenderingQueueDepth(): number
GetPlatformDesignMetrics(dateRange: DateRange): PlatformMetrics
```

---

## 11. Entity Relationship Diagram (Text)

```
RoomType ──< RoomTemplate >── RoomStyle
    │                              │
    ▼                              ▼
DesignSession >── Room         RoomTheme
    │              │
    ├── Moodboard  ├── FurniturePlacement >── FurnitureVariant >── FurnitureItem
    │              │                                                    │
    ├── DesignRevision           MaterialAssignment                FurnitureCategory
    │   (snapshot)              (→ materials Phase5)
    │
    ├── DesignVersion
    │
    ├── ExportPackage
    │
    └── RenderingJob (→ creative_render_sessions Phase5)

FurnitureItem ──< FurnitureCategory (tree)

Room ──< LightingAssignment >── LightingFixture
Room ──< DecorationAssignment >── DecorationItem

ai_jobs (Phase5) ◄── ExportPackage.jobId
ai_jobs (Phase5) ◄── RenderingJob.jobId
materials (Phase5) ◄── MaterialAssignment.materialId
```
