# Domain Plugin Template — Creative AI Universal Design Platform

**Team 07 Domain Plugin Framework**

Use this guide to create a new domain plugin (e.g. Furniture, Architecture, Textile).  
Teams 31–35 should follow this template when building domain-specific plugins.

---

## 1. Folder structure

```
artifacts/api-server/src/domains/design-plugins/plugins/
└── your-domain.ts       ← plugin module (this file)
```

Or if your domain is large, create a full domain folder:

```
artifacts/api-server/src/domains/your-domain/
├── index.ts             ← domain implementation
├── schema.ts            ← domain DB schema (if needed)
└── plugin.ts            ← plugin manifest (import into loader)
```

---

## 2. Required exports

Every plugin module MUST export:

| Export | Type | Required |
|---|---|---|
| `manifest` | `DesignPluginManifest` | ✅ Yes |
| `healthCheck` | `() => Promise<{ healthy: boolean; notes?: string[] }>` | ❌ Optional |

---

## 3. Manifest example

```typescript
import type { DesignPluginManifest } from "../types.js";
import { PLUGIN_CONTRACT_VERSION } from "../types.js";

export const manifest: DesignPluginManifest = {
  // Required fields
  id: "furniture",                     // kebab-case, unique, stable
  version: "1.0.0",                    // semver
  name: "Furniture Design",
  description: "Furniture and interior furnishings domain plugin",
  contractVersion: PLUGIN_CONTRACT_VERSION,  // always use the constant

  contributions: {
    // All contributions are optional — include only what your domain supports

    briefSchemas: [
      {
        schemaId: "furniture-brief-v1",
        version: "1",
        shape: {
          roomType: { type: "string", enum: ["living", "bedroom", "office"] },
          style: { type: "string" },
          budget: { type: "number" },
        },
      },
    ],

    workflowDefinitions: [
      {
        workflowId: "furniture-standard",
        name: "Standard Furniture Workflow",
        steps: ["brief", "moodboard", "concept", "technical", "render", "export"],
      },
    ],

    capabilityRefs: [
      "furniture-render-3d",
      "furniture-material-selector",
    ],

    materialCategories: [
      { categoryId: "wood", name: "Wood Types", subCategories: ["teak", "oak", "pine"] },
      { categoryId: "fabric", name: "Upholstery Fabrics" },
      { categoryId: "metal", name: "Metal Hardware" },
    ],

    componentCategories: [
      { categoryId: "seating", name: "Seating" },
      { categoryId: "storage", name: "Storage & Shelving" },
    ],

    exportProfiles: [
      { profileId: "furniture-pdf", name: "Furniture Spec PDF", format: "pdf" },
      { profileId: "furniture-dwg", name: "Technical Drawing", format: "dwg" },
    ],

    localizationMetadata: {
      defaultLocale: "id",
      supportedLocales: ["id", "en"],
    },

    validationRules: [
      {
        ruleId: "furniture-dimension-check",
        description: "Validates room dimensions are within buildable limits",
        config: { maxWidthCm: 1000, maxHeightCm: 400 },
      },
    ],
  },

  // Optional: restrict to specific tenants or service tiers
  tenantPolicy: {
    // allowedTenantIds: ["enterprise-client-1"],
    // allowedServiceCodes: ["PREMIUM", "ENTERPRISE"],
    // requiresPlatformScope: false,
  },

  // Optional: gate behind a feature flag (PLUGIN_FLAGS env var or setFlagOverride())
  // featureFlag: "furniture-plugin",
};
```

---

## 4. Registration call

In `artifacts/api-server/src/index.ts` (or a dedicated plugin bootstrap file),
import your plugin and pass it to `loadPlugins()`:

```typescript
import { loadPlugins } from "./domains/design-plugins/loader.js";
import * as furniturePlugin from "./domains/design-plugins/plugins/furniture.js";

// At server startup, before routes are ready:
await loadPlugins([furniturePlugin]);
```

---

## 5. Test harness

Copy this base test and fill in your domain specifics:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { registerPlugin, resolvePlugin, _resetRegistry } from
  "../registry.js";
import { evaluateTenantPolicy } from "../tenantPolicy.js";
import { toSafeManifest } from "../clientProjection.js";
import { PLUGIN_CONTRACT_VERSION } from "../types.js";
import * as furniturePlugin from "../plugins/furniture.js";

beforeEach(() => _resetRegistry());

describe("Furniture Plugin", () => {
  it("registers successfully", async () => {
    const result = await registerPlugin(furniturePlugin.manifest);
    expect(result.ok).toBe(true);
  });

  it("has the correct contract version", () => {
    expect(furniturePlugin.manifest.contractVersion).toBe(PLUGIN_CONTRACT_VERSION);
  });

  it("safe projection does not expose tenantPolicy", async () => {
    await registerPlugin(furniturePlugin.manifest);
    const safe = toSafeManifest(resolvePlugin("furniture")!);
    expect((safe as Record<string, unknown>)["tenantPolicy"]).toBeUndefined();
  });
});
```

---

## 6. Prohibited imports

Your plugin manifest file MUST NOT import:

- `../../lib/db` — no direct DB access from plugin modules
- `../../middleware/*` — no middleware from the plugin declaration
- `express` — no route handlers in the manifest file
- Any URL-loaded or dynamically `require()`d module

The core engine has **no direct imports** from domain plugin files.
Communication is through the registry API only.

---

## 7. Compatibility checklist

Before submitting your plugin for integration:

- [ ] `manifest.contractVersion === PLUGIN_CONTRACT_VERSION`
- [ ] `manifest.id` is kebab-case, unique, stable (matches `LEGACY_SERVICE_ALIAS_MAP` if applicable)
- [ ] `manifest.version` is valid semver (X.Y.Z)
- [ ] All contribution IDs are namespaced with your domain prefix (e.g. `furniture-*`)
- [ ] No DB imports in the manifest file
- [ ] No eval, no dynamic require, no URL-sourced code
- [ ] `healthCheck()` exported if your domain has external dependencies to validate
- [ ] Tests cover: valid registration, safe projection, tenant policy (if used)
- [ ] Legacy slug added to `LEGACY_SERVICE_ALIAS_MAP` in `legacyAdapter.ts` (if applicable)

---

## 8. Merge order guidance (for Teams 31–35)

Team 07 (this framework) must merge **before** any domain plugin team merges.

After Team 07 merges:
1. Add your plugin manifest file.
2. Add your legacy alias entry (if applicable) via PR to `legacyAdapter.ts`.
3. Add your `loadPlugins()` call to the server startup.
4. Verify with `pnpm --filter @workspace/api-server run test`.

**Breaking changes**: Do not change `manifest.id` after it has been used in production.
Changing the ID is equivalent to removing the plugin — coordinate with Team 07 first.
