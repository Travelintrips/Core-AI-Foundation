# ADR-001 — Universal Design Architecture Contracts

**Status:** Accepted  
**Date:** 2026-07-21  
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
| `DesignPluginManifest` | Team 01 (shape), Team N (content) | Plugin identity, service coverage, capabilities |
| `DesignCapabilityContract` | Team 01 (shape), Team N (content) | Discrete unit of work within a plugin |
| `DesignCommand` / `DesignEvent` | Team 01 | Typed message envelopes for all platform events |
| `ValidationResult` / errors | Team 01 | Typed result and error hierarchy |

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
// interface DesignProjectContext {
//   fashionSeason?: string;  // ← PROHIBITED
// }
```

Plugin-owned schemas (brief schema, workflow definition, capability input/output) are referenced by opaque string IDs in the manifest and resolved at runtime by the plugin registry. The core engine never imports or parses these schemas.

---

## Event Envelope

All messages use one of two envelopes:

- **`DesignCommand<T>`** — consumer → platform ("please do X")
- **`DesignEvent<T>`** — platform → consumers ("X happened")

Both carry: `eventId`, `occurredAt`, `projectId`, `tenantId`, `actor`, `correlationId`, `causationId`, `contractVersion`, `payloadVersion`, typed `payload`.

`correlationId` spans the entire request chain. `causationId` links a downstream event to its upstream command.

---

## Compatibility / Versioning Policy

| Scenario | Action |
|----------|--------|
| Add optional field to any contract | **No version bump** — forward-compatible |
| Add new enum member to extension registry | **No version bump** |
| Rename or remove a required field | **Bump `DESIGN_CONTRACT_VERSION`** |
| Retire support for an old version | **Bump `MINIMUM_SUPPORTED_CONTRACT_VERSION`** (with 2-sprint notice) |

`assertCompatibleVersion(v)` must be called at every plugin load boundary and every deserialization of an inbound envelope. It throws `ArchitectureCompatibilityError` — never a silent fallback.

---

## Plugin Boundary

```
Core Engine
  └── reads: DesignProjectContext, DesignArtifactContract, DesignCommand/Event envelopes
  └── reads: DesignPluginManifest.pluginId, .supportedServices, .capabilities
  └── does NOT read: brief schemas, workflow step implementations, capability payloads

Plugin (e.g. "fashion")
  └── implements: DesignStageDefinition[] (declares its workflow)
  └── implements: DesignCapabilityContract[] (declares its capabilities)
  └── owns: brief schema, rendering logic, AI prompts, domain tables
  └── exports: plugin manifest via plugin registry
```

The core engine **never imports** a plugin package at build time. Plugins are loaded dynamically by the plugin registry.

---

## Package Dependency Direction

```
@workspace/design-contracts
    ↑ (imports)
@workspace/plugins-fashion
@workspace/plugins-interior
@workspace/plugins-packaging
@workspace/plugins-branding
artifacts/api-server  (plugin registry, workflow engine)
artifacts/customer-portal  (uses types for UI state)
```

`@workspace/design-contracts` must never import from any of the above.

---

## Prohibition: Domain Leakage into Core

The following are **permanently prohibited** in `@workspace/design-contracts`:

- Field names referencing specific domains: `fashionSeason`, `roomType`, `dielineSize`, `logoVariants`, etc.
- Import of domain schemas or plugin packages.
- Hard-coded stage names (e.g. `"moodboard"`, `"technical_drawing"`) as enum values in core contracts.
- References to specific AI models, renderer libraries, or storage providers.

Violations are caught by unit tests in `contracts.test.ts` (test group C1/C2).

---

## How Teams 02–40 Use This Package

### 1. Import types

```typescript
import {
  DesignProjectContext,
  DesignProjectContextSchema,
  DesignArtifactContractSchema,
  assertCompatibleVersion,
  DESIGN_CONTRACT_VERSION,
} from "@workspace/design-contracts";
```

### 2. Declare a plugin manifest

```typescript
// artifacts/api-server/src/plugins/my-domain/manifest.ts
import type { DesignPluginManifest } from "@workspace/design-contracts";
import { DESIGN_CONTRACT_VERSION } from "@workspace/design-contracts";

export const MY_DOMAIN_MANIFEST: DesignPluginManifest = {
  pluginId: "my-domain",
  displayName: "My Domain Plugin",
  version: "1.0.0",
  compatibleContractVersion: DESIGN_CONTRACT_VERSION,
  supportedServices: ["MY_SERVICE_CODE"],
  briefSchemaRef: "@workspace/plugins-my-domain/brief-schema",
  workflowRef: "@workspace/plugins-my-domain/workflow",
  capabilities: [
    { capabilityId: "my-domain:generate_concept", requiresAi: true, producesDeliverable: true },
  ],
  featureFlags: [],
};
```

### 3. Validate at plugin load time

```typescript
import { assertCompatibleVersion } from "@workspace/design-contracts";

function registerPlugin(manifest: DesignPluginManifest) {
  // Throws ArchitectureCompatibilityError if incompatible
  assertCompatibleVersion(manifest.compatibleContractVersion);
  // ... register ...
}
```

### 4. Add domain data via extensions

```typescript
const context: DesignProjectContext = {
  // ... required core fields ...
  extensions: {
    // ALL domain-specific data goes here
    myDomainField: "value",
  },
};
```

### 5. Emit events using the envelope

```typescript
import { WELL_KNOWN_DESIGN_EVENTS, DESIGN_CONTRACT_VERSION } from "@workspace/design-contracts";
import type { GenericDesignEvent } from "@workspace/design-contracts";

const event: GenericDesignEvent = {
  eventId: crypto.randomUUID(),
  eventType: WELL_KNOWN_DESIGN_EVENTS.STAGE_COMPLETED,
  occurredAt: new Date().toISOString(),
  projectId: ctx.projectId,
  tenantId: ctx.tenantId,
  actor: { actorId: ctx.actor.actorId, actorType: ctx.actor.actorType },
  correlationId: ctx.correlationId,
  contractVersion: DESIGN_CONTRACT_VERSION,
  payloadVersion: 1,
  payload: { stageId: "my-domain:concept", artifactId: artifact.artifactId },
};
```

---

## Breaking-Change Approval Process

1. Raise a proposal in the team channel with: changed field, migration path, affected teams.
2. All affected teams (any that import the changed contract) must acknowledge.
3. `DESIGN_CONTRACT_VERSION` bump + `MINIMUM_SUPPORTED_CONTRACT_VERSION` update (if retiring) requires sign-off from Team 01 lead.
4. Old version must remain supported for at least 2 sprints after the bump unless a critical security issue is involved.

---

## Consequences

**Positive:**
- Single import path for all design platform contracts.
- Domain isolation enforced at the type system level.
- Contract version compatibility checked at load time, not runtime failures.
- Teams can evolve their plugins independently within the plugin boundary.

**Negative / Trade-offs:**
- Adding a new required core field is now a coordinated breaking change.
- Plugin-specific types live outside this package, requiring teams to define and own their brief schemas.
- The `extensions` escape hatch reduces type safety for domain data; plugins must validate their own extension data using their own schemas.
