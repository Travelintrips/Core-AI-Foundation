# ADR-001 — Universal Design Architecture Contracts

**Status:** Accepted — Revision 1 Applied
**Date:** 2026-07-21
**Revision 1 Date:** 2026-07-21
**Team:** Team 01 — Architecture Contracts & Governance
**Package:** `@workspace/design-contracts`

---

## Context

The Creative AI platform supports multiple design domains (Fashion, Interior, Packaging, Branding, and more). Each domain has a distinct workflow, brief schema, and set of deliverables. Prior to this package, domain-specific types lived inside `artifacts/api-server/src/domains/*/` and `lib/db/src/schema/`, creating:

- No shared language between teams.
- Domain-specific fields leaking into core schemas.
- No versioning of cross-team contracts.
- No plugin boundary — every domain extended the same monolithic tables.

---

## Decision

We establish `@workspace/design-contracts` as the **single source of canonical contracts** for the Universal Design Platform. All teams (Team 02–40) import from this package. The package:

1. **Has zero dependencies** on `api-server`, `@workspace/db`, React, AI providers, or renderers.
2. **Only depends on `zod`** for runtime validation.
3. **Wraps `RequestContext` additively** via the structural `DesignActorRef` interface — no second auth model.
4. **Uses integer `contractVersion`** on all envelopes for compatibility tracking.
5. **Reserves `extensions: Record<string, unknown>`** on every core contract for plugin-specific data.

---

## Contract Ownership

| Contract | Owner | Purpose |
|----------|-------|---------|
| `DesignProjectContext` | Team 01 | Project + tenant + actor context for every workflow operation |
| `DesignStageDefinition` | Team 01 | Declarative stage in a plugin workflow DAG |
| `DesignArtifactContract` | Team 01 | Any output produced at a stage (image, PDF, vector, etc.) |
| `ArtifactRelationship` | Team 01 | Directed edge between artifacts for lineage/provenance tracing |
| `DesignPluginManifest` | Team 01 (shape), Team N (content) | Plugin identity, service coverage, capabilities, dependencies |
| `DesignCapabilityContract` | Team 01 (shape), Team N (content) | Discrete unit of work within a plugin |
| `DesignCommand` / `DesignEvent` | Team 01 | Typed message envelopes for all platform events |
| `ValidationResult` / errors | Team 01 | Typed result and error hierarchy |
| `ContractMetadata` | Team 01 | Who/when/what produced a contract object |
| `DeprecationPolicy` | Team 01 | Formal deprecation declaration for any contract |
| `FeatureStability` | Team 01 | Stability tier for plugins, capabilities, and features |
| `PluginDependency` | Team 01 (shape), Team N (declarations) | Inter-plugin dependency declarations |

---

## Extension Mechanism

Domain-specific data **must not** appear as mandatory fields in core contracts. All domain fields go in `extensions: Record<string, unknown>` or in plugin-owned schemas referenced by opaque string IDs.

```typescript
// CORRECT — domain data in extensions
const context: DesignProjectContext = {
  // ... core fields ...
  extensions: {
    fashionSeason: "SS-2026",
    roomType: "living",
  },
};

// WRONG — domain field in core contract
const context: DesignProjectContext = {
  // ... core fields ...
  fashionSeason: "SS-2026",  // ← leaks domain into core
};
```

The `extensions` record is **opaque to the core engine**. The core engine never reads, writes, or validates its contents. Only the owning plugin reads its own extension keys.

---

## Versioning Strategy

### Contract version integer

Every contract envelope carries `contractVersion: number` (a positive integer). The current version is `DESIGN_CONTRACT_VERSION = 1`.

Version semantics:
- `1` is the initial production-ready version.
- Additive changes (new optional fields, new optional enum values) do **not** require a version bump.
- Breaking changes (removing fields, renaming fields, changing required constraints) **must** bump the version.
- The platform supports a range `[MINIMUM_SUPPORTED_CONTRACT_VERSION, DESIGN_CONTRACT_VERSION]`. Contracts outside this range are rejected at load time.

### Compatibility check

```typescript
import { assertCompatibleVersion, checkCompatibility } from "@workspace/design-contracts";

// Throws ArchitectureCompatibilityError if outside supported range
assertCompatibleVersion(manifest.compatibleContractVersion);

// Returns a structured result (never throws)
const { compatible, reason } = checkCompatibility(manifest.compatibleContractVersion);
```

### Plugin semver

Plugins declare their own `version: "MAJOR.MINOR.PATCH"` (semver) independently of the contract version. Plugin-to-plugin dependencies use semver constraints via `PluginDependency.minimumVersion`.

---

## Contract Evolution Strategy

### Additive changes (no version bump required)

- Adding optional fields to existing schemas.
- Adding new enum values that have a natural "default behaviour" when not present.
- Adding new exported types or schemas.
- Adding new utility functions.
- Adding new examples.

### Breaking changes (require version bump + approval)

- Removing any exported type, schema, or function.
- Renaming any exported type, schema, field, or function.
- Making an optional field required.
- Removing or renaming an enum value that existing code may reference.
- Changing field type in a backward-incompatible way.

### Breaking change approval process

1. Open a discussion in the Team 01 governance channel.
2. All teams affected (Team 02–40) must acknowledge within 5 business days.
3. Bump `DESIGN_CONTRACT_VERSION` in `src/version.ts`.
4. Update `MINIMUM_SUPPORTED_CONTRACT_VERSION` only if older versions are being formally dropped.
5. Update `ADR-001` (this document) with the rationale.
6. All teams must migrate before the old version is dropped from the supported range.

---

## Deprecation Policy

Any contract, type, capability, or plugin that is planned for removal must declare a `DeprecationPolicy`:

```typescript
import type { DeprecationPolicy } from "@workspace/design-contracts";

const myCapabilityDeprecation: DeprecationPolicy = {
  isDeprecated: true,
  deprecatedSince: "1.2.0",               // semver or date
  replacement: "fashion:render_v2",        // what to use instead
  removeAfterVersion: 3,                   // removal happens at v3
  reason: "Replaced by unified renderer.",
};
```

**Rules:**
- A deprecation must be declared at least one contract version before removal.
- Teams have `removeAfterVersion - DESIGN_CONTRACT_VERSION` versions to migrate.
- `isDeprecated: false` with no other fields is a valid "not yet deprecated" marker.

---

## Feature Stability

Every plugin and capability declares a `FeatureStability` tier:

| Tier | Meaning |
|------|---------|
| `experimental` | Unstable. API may change without notice. Requires explicit opt-in. |
| `preview` | Approaching stable. Breaking changes announced in advance. |
| `stable` | Production-ready. Breaking changes follow the version bump policy. |
| `deprecated` | Scheduled for removal. Migrate to the replacement. |
| `internal` | Not part of the public contract. May be removed at any time. |

`DesignPluginManifest.stability` defaults to `"stable"`. New plugins should start as `"experimental"` and graduate to `"preview"` → `"stable"` through the review process.

---

## Plugin Dependency

Plugins declare dependencies on other plugins via `DesignPluginManifest.dependencies`:

```typescript
const manifest: DesignPluginManifest = {
  pluginId: "fashion",
  // ...
  dependencies: [
    {
      pluginId: "export-renderer",
      minimumVersion: "1.0.0",
      optional: false,
      reason: "Required for PDF/PPTX export of production specs",
    },
    {
      pluginId: "material-library",
      optional: true,
      reason: "Enables material swatches in technical drawings",
    },
  ],
};
```

**Rules:**
- Circular plugin dependencies are not allowed. The registry validates the dependency DAG at load time.
- Optional dependencies (`optional: true`) only disable the capabilities that require them when missing.
- The registry loads dependencies in topological order before activating the dependent plugin.
- `minimumVersion` is enforced at semver level by the registry; omit it only when version compatibility is guaranteed by platform policy.

---

## Artifact Lineage

Design artifacts are connected via `ArtifactRelationship` edges, forming a directed acyclic graph (DAG) that records the full design lineage:

```
Moodboard ──(derived_from)──► Concept
          ──(depends_on)───► Brand Brief
Concept   ──(derived_from)──► Sketch
Sketch    ──(derived_from)──► Technical Drawing
Technical Drawing ──(presentation_of)──► Production Specification
```

Available relationship types: `depends_on`, `derived_from`, `references`, `variation_of`, `revision_of`, `presentation_of`.

### Graph utilities (pure functions, no database)

```typescript
import {
  validateArtifactGraph,
  detectArtifactCycles,
  findArtifactDependencies,
  findArtifactDependents,
} from "@workspace/design-contracts";

// Fetch edges from DB (caller's responsibility), then:
const result = validateArtifactGraph(edges);    // { valid, cycles, edgeCount, nodeCount }
const cycles = detectArtifactCycles(edges);     // [] if acyclic
const parents = findArtifactDependencies(artifactId, edges);   // direct upstream
const children = findArtifactDependents(artifactId, edges);    // direct downstream

// Filter by relationship type
const derivedFrom = findArtifactDependencies(id, edges, ["derived_from"]);
```

---

## Capability Category

Every `DesignCapabilityContract` carries an optional `category` field from `CAPABILITY_CATEGORIES`:

| Category | Meaning |
|----------|---------|
| `AI` | Invokes an AI model (image generation, text, multimodal) |
| `Rendering` | Produces a rendered file (PDF, PPTX, image composite) |
| `Simulation` | Physics, material, or spatial simulation |
| `Analysis` | Computes quality scores, validates, or inspects content |
| `Export` | Converts or packages artifacts for delivery |
| `Validation` | Enforces constraints without producing new artifacts |
| `Human Review` | Pauses workflow for a human decision or approval |
| `Automation` | Runs a rule-engine or scripted transformation |
| `Transformation` | Format or content conversion (e.g. SVG → PNG) |
| `Storage` | Manages persistence: upload, archive, sign URLs |

The category is used by the plugin registry for filtering and by cost routing to identify AI vs. non-AI workloads.

---

## Execution Metadata

### Execution Priority

`DesignCapabilityContract.executionPriority` gives the dispatcher a scheduling hint:

| Priority | Meaning |
|----------|---------|
| `critical` | Must run immediately; blocks a user-visible operation |
| `high` | Should start within seconds |
| `medium` | Standard (default); processed in arrival order |
| `low` | Deferred; runs when higher-priority slots are free |
| `background` | Best-effort; runs during off-peak periods |

### Execution Estimation

`DesignCapabilityContract.estimation` provides advisory cost and resource estimates:

```typescript
estimation: {
  estimatedRuntimeMs: 5000,         // typical wall-clock time
  estimatedTokenUsage: 2000,         // input+output tokens (AI caps only)
  estimatedCostUsd: 0.04,            // typical per-invocation cost
  estimatedMemoryMb: 512,            // peak memory required
  estimatedOutputSizeBytes: 204800,  // typical output artifact size
}
```

All fields are optional. Teams should provide what is measurable; do not hardcode guesses.

### Input/Output Artifact Types

Capabilities declare the artifact types they consume and produce:

```typescript
{
  capabilityId: "fashion:render_technical_drawing",
  inputArtifactTypes: ["sketch", "vector"],     // what this cap needs
  outputArtifactTypes: ["vector", "pdf"],        // what this cap produces
  // ...
}
```

These are opaque strings resolved by the capability registry. Use them for workflow validation and dependency ordering — not for routing decisions.

---

## Contract Metadata

Any contract object can carry a `ContractMetadata` block to record provenance:

```typescript
import type { ContractMetadata } from "@workspace/design-contracts";

const meta: ContractMetadata = {
  source: "ai",                    // "human" | "ai" | "import" | "migration" | "external-api"
  generator: "creative-ai",        // engine name
  generatorVersion: "2.1.0",       // engine version
  createdAt: "2026-07-21T10:00:00.000Z",
  createdBy: "usr_admin",
};
```

All fields are **optional**. Never make `ContractMetadata` a required field on any existing contract — attach it as an optional `contractMetadata` field.

---

## Event Envelope Design

All cross-team communication uses `DesignEvent<T>` or `DesignCommand<T>`:

```typescript
// Emit an event
const event: DesignEvent<{ stageId: string }> = {
  eventId: crypto.randomUUID(),
  eventType: "STAGE_STARTED",
  occurredAt: new Date().toISOString(),
  projectId: ctx.projectId,
  tenantId: ctx.tenantId,
  actor: ctx.actor,
  correlationId: ctx.correlationId,
  contractVersion: DESIGN_CONTRACT_VERSION,
  payloadVersion: 1,
  payload: { stageId: "fashion:moodboard" },
};
```

**Rules:**
- `correlationId` ties all events in a single workflow run.
- `causationId` points to the event that directly caused this one (null for root events).
- `payloadVersion` starts at 1 and bumps when the payload shape changes.
- Never store raw prompts — use `promptDigest` for reproducibility.

---

## Plugin Boundary Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                   @workspace/design-contracts               │
│                                                             │
│  DesignProjectContext   DesignStageDefinition               │
│  DesignArtifactContract ArtifactRelationship                │
│  DesignPluginManifest   PluginDependency                    │
│  DesignCapabilityContract ContractMetadata                  │
│  DesignCommand/Event    DeprecationPolicy                   │
│  ValidationResult       FeatureStability                    │
│                                                             │
│  ← zero deps on api-server, db, React, AI, renderers →     │
└─────────────────────────────────────────────────────────────┘
         ↑ imported by
┌────────────────┐  ┌────────────────┐  ┌────────────────┐
│  Team 02       │  │  Team 03       │  │  Team N        │
│  (Fashion)     │  │  (Interior)    │  │  (Domain N)    │
│                │  │                │  │                │
│ plugin-fashion │  │ plugin-interior│  │ plugin-N       │
│ workflow-fashion│  │ workflow-int. │  │ workflow-N     │
└────────────────┘  └────────────────┘  └────────────────┘
         ↓ registered in
┌─────────────────────────────────────────────────────────────┐
│               Plugin Registry (api-server)                  │
│  • loads manifests                                          │
│  • calls assertCompatibleVersion()                          │
│  • validates plugin dependency DAG (detectArtifactCycles)   │
│  • routes projects to plugins via serviceType               │
└─────────────────────────────────────────────────────────────┘
```

---

## How Teams 02–40 Use This Package

### Step 1: Install

`@workspace/design-contracts` is already in the workspace. No installation needed.

### Step 2: Import

```typescript
// Always import from the root — never from sub-modules
import {
  type DesignProjectContext,
  type DesignPluginManifest,
  type DesignCapabilityContract,
  type ArtifactRelationship,
  DESIGN_CONTRACT_VERSION,
  assertCompatibleVersion,
  validateArtifactGraph,
  detectArtifactCycles,
  DeprecationPolicySchema,
  FeatureStabilitySchema,
} from "@workspace/design-contracts";

// Examples (for testing and documentation)
import {
  FASHION_PROJECT_CONTEXT,
  FURNITURE_PROJECT_CONTEXT,
  EXAMPLE_ARTIFACT_LINEAGE,
} from "@workspace/design-contracts/examples";
```

### Step 3: Declare your plugin manifest

```typescript
import {
  type DesignPluginManifest,
  DESIGN_CONTRACT_VERSION,
  assertCompatibleVersion,
} from "@workspace/design-contracts";

export const MY_PLUGIN_MANIFEST: DesignPluginManifest = {
  pluginId: "my-domain",           // lowercase-alphanumeric, globally unique
  displayName: "My Domain Plugin",
  version: "1.0.0",               // your plugin's own semver
  compatibleContractVersion: DESIGN_CONTRACT_VERSION,
  stability: "experimental",       // start experimental, graduate to stable
  supportedServices: ["MY_DOMAIN_SERVICE"],
  briefSchemaRef: "@workspace/plugins-my-domain/brief-schema",
  workflowRef: "@workspace/plugins-my-domain/workflow",
  capabilities: [],
  featureFlags: [],
  dependencies: [],
};

// Call this at plugin load time (registry handles it automatically for registered plugins):
assertCompatibleVersion(MY_PLUGIN_MANIFEST.compatibleContractVersion);
```

### Step 4: Put domain data in extensions

```typescript
const ctx: DesignProjectContext = {
  projectId: project.id,
  tenantId: request.tenantId,
  serviceType: "MY_DOMAIN_SERVICE",
  domainPluginId: "my-domain",
  locale: "en-US",
  status: "draft",
  actor: resolvedActor,       // duck-type compatible with DesignActorRef
  correlationId: requestId,
  contractVersion: DESIGN_CONTRACT_VERSION,
  // Domain fields go here — the core engine ignores them
  extensions: {
    myDomainField: "value",
    myDomainConfig: { nested: true },
  },
};
```

### Step 5: Emit events

```typescript
const event: DesignEvent<{ stageId: string }> = {
  eventId: crypto.randomUUID(),
  eventType: "STAGE_STARTED",
  occurredAt: new Date().toISOString(),
  projectId: ctx.projectId,
  tenantId: ctx.tenantId,
  actor: ctx.actor,
  correlationId: ctx.correlationId,
  contractVersion: DESIGN_CONTRACT_VERSION,
  payloadVersion: 1,
  payload: { stageId: "my-domain:concept" },
};
```

---

## Future Compatibility

### Planned additions (non-breaking)

- `ContractRegistry` — a runtime registry type for plugin discovery.
- `WorkflowContext` — enriched context carrying runtime execution state.
- `ArtifactBundle` — a group of artifacts representing a complete deliverable set.
- Additional `RelationshipType` values (additive, backward compatible).

### Stability graduation process

```
experimental → (2 sprints stable API) → preview → (integration audit) → stable
```

Teams consuming `experimental` plugins must opt in explicitly and accept the risk of breaking changes.

### Version N+1 planning

When `DESIGN_CONTRACT_VERSION` is bumped to 2:
1. `MINIMUM_SUPPORTED_CONTRACT_VERSION` remains 1 for at least one release cycle.
2. All new fields added in v2 must be backward-compatible with v1 consumers.
3. Teams have one sprint to migrate before v1 is dropped from the supported range.

---

## Supported Domains (Examples)

| Domain | Plugin ID | Status |
|--------|-----------|--------|
| Fashion | `fashion` | stable |
| Interior | `interior` | stable |
| Packaging | `packaging` | stable |
| Branding | `branding` | stable |
| Furniture | `furniture` | stable |
| Architecture | `architecture` | preview |
| Landscape | `landscape` | experimental |
| Industrial Product | `industrial-product` | stable |
| Jewelry | `jewelry` | experimental |

All examples are in `src/examples/index.ts`. Teams may use them as starting points for their own plugin manifests.

---

## Consequences

**Positive:**
- Single source of truth for cross-team contracts.
- No domain leakage into core schemas (enforced by tests in `C1`, `C2`, `NK6`).
- Explicit versioning with `ArchitectureCompatibilityError` on incompatible plugins.
- Additive extension mechanism keeps teams independent.
- Plugin dependency DAG validated at load time (cycle detection).
- Artifact lineage traceable without database queries.
- All contracts are tree-shakeable (no side-effect imports).
- Backward-compatible: all new fields are optional or have defaults.

**Negative / Risks:**
- Teams must update `compatibleContractVersion` in their manifests when they pull a contract version bump.
- `extensions: Record<string, unknown>` provides no compile-time type safety for domain fields — plugins must validate their own extension keys.
- Plugin registry (runtime enforcement of dependency DAG) is Team 02's responsibility — this package only provides the pure-function `detectArtifactCycles` utility.
