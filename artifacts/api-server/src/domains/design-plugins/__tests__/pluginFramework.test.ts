/**
 * Domain Plugin Framework — Comprehensive Test Suite (Team 07)
 *
 * Covers all 10 required test scenarios:
 *   1. valid plugin
 *   2. invalid manifest
 *   3. duplicate plugin
 *   4. incompatible contract version
 *   5. disabled plugin (feature flag)
 *   6. tenant unavailable
 *   7. service alias
 *   8. contribution registration
 *   9. optional plugin failure isolation
 *  10. safe client projection
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  registerPlugin,
  resolvePlugin,
  listPlugins,
  disablePlugin,
  enablePlugin,
  _resetRegistry,
} from "../registry.js";
import { checkCompatibility } from "../compatibility.js";
import { evaluateTenantPolicy } from "../tenantPolicy.js";
import { resolveAlias, getSlugsForPluginId } from "../legacyAdapter.js";
import { toSafeManifest } from "../clientProjection.js";
import { setFlagOverride, clearFlagOverrides } from "../featureFlags.js";
import { loadPlugins } from "../loader.js";
import { onPluginEvent, _clearHooks } from "../hooks.js";
import { PLUGIN_CONTRACT_VERSION } from "../types.js";
import type { DesignPluginManifest } from "../types.js";
import * as testPlugin from "../plugins/test-plugin.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

const VALID_MANIFEST: DesignPluginManifest = {
  id: "fashion",
  version: "1.0.0",
  name: "Fashion Design",
  description: "Apparel and fashion domain plugin",
  contractVersion: PLUGIN_CONTRACT_VERSION,
  contributions: {
    capabilityRefs: ["fashion-brief", "fashion-render"],
    briefSchemas: [
      {
        schemaId: "fashion-brief-v1",
        version: "1",
        shape: { serviceType: { type: "string" } },
      },
    ],
    materialCategories: [
      { categoryId: "fabric", name: "Fabric Types" },
    ],
    exportProfiles: [
      { profileId: "fashion-pdf", name: "Fashion PDF", format: "pdf" },
    ],
    localizationMetadata: {
      defaultLocale: "id",
      supportedLocales: ["id", "en"],
    },
  },
};

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  _resetRegistry();
  clearFlagOverrides();
  _clearHooks();
});

afterEach(() => {
  _resetRegistry();
  clearFlagOverrides();
  _clearHooks();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Valid plugin — registers and resolves
// ─────────────────────────────────────────────────────────────────────────────
describe("1. Valid plugin registration", () => {
  it("registers a valid manifest and resolves it from the registry", async () => {
    const result = await registerPlugin(VALID_MANIFEST);

    expect(result.ok).toBe(true);
    expect(result.pluginId).toBe("fashion");

    const entry = resolvePlugin("fashion");
    expect(entry).toBeDefined();
    expect(entry!.manifest.id).toBe("fashion");
    expect(entry!.manifest.version).toBe("1.0.0");
    expect(["registered", "enabled"]).toContain(entry!.status);
  });

  it("appears in listPlugins() after registration", async () => {
    await registerPlugin(VALID_MANIFEST);
    const all = listPlugins();
    expect(all.some((e) => e.manifest.id === "fashion")).toBe(true);
  });

  it("registers the built-in test-plugin correctly", async () => {
    const result = await registerPlugin(testPlugin.manifest, testPlugin.healthCheck);
    expect(result.ok).toBe(true);
    expect(result.pluginId).toBe("test-plugin");
    const entry = resolvePlugin("test-plugin");
    expect(entry).toBeDefined();
    expect(entry!.status).toBe("enabled");
    expect(entry!.diagnostics.healthy).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Invalid manifest — rejected without global crash
// ─────────────────────────────────────────────────────────────────────────────
describe("2. Invalid manifest rejection", () => {
  it("rejects a manifest with missing required id field", async () => {
    const bad = { ...VALID_MANIFEST, id: "" };
    const result = await registerPlugin(bad);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reason).toMatch(/id/i);
  });

  it("rejects a manifest with invalid id format (spaces)", async () => {
    const bad = { ...VALID_MANIFEST, id: "my plugin" };
    const result = await registerPlugin(bad);
    expect(result.ok).toBe(false);
  });

  it("rejects a manifest with malformed semver", async () => {
    const bad = { ...VALID_MANIFEST, id: "test-bad-ver", version: "1.0" };
    const result = await registerPlugin(bad);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reason).toMatch(/version/i);
  });

  it("rejects a non-object manifest without crashing", async () => {
    const result = await registerPlugin("not-a-manifest");
    expect(result.ok).toBe(false);
  });

  it("rejects a null manifest without crashing", async () => {
    const result = await registerPlugin(null);
    expect(result.ok).toBe(false);
  });

  it("rejects a manifest with unknown extra fields (strict schema)", async () => {
    const bad = { ...VALID_MANIFEST, id: "test-strict", unknownField: true };
    const result = await registerPlugin(bad);
    expect(result.ok).toBe(false);
  });

  it("does not store a rejected plugin in the registry", async () => {
    await registerPlugin({ id: "will-fail", version: "bad" });
    expect(resolvePlugin("will-fail")).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Duplicate plugin — handled gracefully
// ─────────────────────────────────────────────────────────────────────────────
describe("3. Duplicate plugin handling", () => {
  it("rejects a second registration of the same id@version", async () => {
    await registerPlugin(VALID_MANIFEST);
    const second = await registerPlugin(VALID_MANIFEST);
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error("expected failure");
    expect(second.reason).toMatch(/duplicate/i);
  });

  it("allows a registration with the same id but a different version (upgrade)", async () => {
    await registerPlugin(VALID_MANIFEST);
    const upgraded = { ...VALID_MANIFEST, version: "2.0.0" };
    const result = await registerPlugin(upgraded);
    expect(result.ok).toBe(true);
    // Registry should now hold the newer version
    const entry = resolvePlugin("fashion");
    expect(entry!.manifest.version).toBe("2.0.0");
  });

  it("does not add a second entry to the list for duplicates", async () => {
    await registerPlugin(VALID_MANIFEST);
    await registerPlugin(VALID_MANIFEST); // duplicate
    const all = listPlugins().filter((e) => e.manifest.id === "fashion");
    expect(all.length).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Incompatible contract version — rejected, stored as incompatible
// ─────────────────────────────────────────────────────────────────────────────
describe("4. Incompatible contract version", () => {
  it("checkCompatibility returns false for wrong version", () => {
    const result = checkCompatibility("99");
    expect(result.compatible).toBe(false);
    expect(result.reason).toMatch(/contract/i);
  });

  it("checkCompatibility returns true for the current version", () => {
    const result = checkCompatibility(PLUGIN_CONTRACT_VERSION);
    expect(result.compatible).toBe(true);
  });

  it("stores incompatible plugin with status 'incompatible'", async () => {
    const incompatible = { ...VALID_MANIFEST, id: "old-plugin", contractVersion: "99" };
    const result = await registerPlugin(incompatible);
    expect(result.ok).toBe(false);

    const entry = resolvePlugin("old-plugin");
    expect(entry).toBeDefined();
    expect(entry!.status).toBe("incompatible");
  });

  it("cannot enable an incompatible plugin", async () => {
    const incompatible = { ...VALID_MANIFEST, id: "old2", contractVersion: "0" };
    await registerPlugin(incompatible);
    const ok = enablePlugin("old2");
    expect(ok).toBe(false);
    expect(resolvePlugin("old2")!.status).toBe("incompatible");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Disabled plugin — feature flag gating
// ─────────────────────────────────────────────────────────────────────────────
describe("5. Disabled plugin via feature flag", () => {
  it("registers as disabled when its feature flag is off", async () => {
    setFlagOverride("furniture-plugin", false);
    const manifest: DesignPluginManifest = {
      ...VALID_MANIFEST,
      id: "furniture",
      featureFlag: "furniture-plugin",
    };
    const result = await registerPlugin(manifest);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.status).toBe("disabled");

    const entry = resolvePlugin("furniture");
    expect(entry!.status).toBe("disabled");
  });

  it("registers as enabled when its feature flag is on", async () => {
    setFlagOverride("furniture-plugin", true);
    const manifest: DesignPluginManifest = {
      ...VALID_MANIFEST,
      id: "furniture",
      featureFlag: "furniture-plugin",
    };
    const result = await registerPlugin(manifest);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.status).toBe("enabled");
  });

  it("can be disabled post-registration via disablePlugin()", async () => {
    await registerPlugin(VALID_MANIFEST);
    const ok = disablePlugin("fashion");
    expect(ok).toBe(true);
    expect(resolvePlugin("fashion")!.status).toBe("disabled");
  });

  it("can be re-enabled after being disabled", async () => {
    await registerPlugin(VALID_MANIFEST);
    disablePlugin("fashion");
    const ok = enablePlugin("fashion");
    expect(ok).toBe(true);
    expect(resolvePlugin("fashion")!.status).toBe("enabled");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Tenant unavailable — policy enforcement
// ─────────────────────────────────────────────────────────────────────────────
describe("6. Tenant availability policy", () => {
  it("allows access when no tenantPolicy is set", () => {
    const result = evaluateTenantPolicy(undefined, {
      tenantId: "any-tenant",
    });
    expect(result.allowed).toBe(true);
  });

  it("allows access for an explicitly whitelisted tenant", () => {
    const result = evaluateTenantPolicy(
      { allowedTenantIds: ["tenant-A", "tenant-B"] },
      { tenantId: "tenant-A" },
    );
    expect(result.allowed).toBe(true);
  });

  it("denies access for a non-whitelisted tenant", () => {
    const result = evaluateTenantPolicy(
      { allowedTenantIds: ["tenant-A"] },
      { tenantId: "tenant-X" },
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/tenant/i);
  });

  it("denies access when platformScope is required but caller lacks it", () => {
    const result = evaluateTenantPolicy(
      { requiresPlatformScope: true },
      { tenantId: "tenant-A", isPlatformScope: false },
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/platform/i);
  });

  it("allows access when platformScope is required and caller has it", () => {
    const result = evaluateTenantPolicy(
      { requiresPlatformScope: true },
      { tenantId: "any", isPlatformScope: true },
    );
    expect(result.allowed).toBe(true);
  });

  it("denies access for a non-allowed service code", () => {
    const result = evaluateTenantPolicy(
      { allowedServiceCodes: ["PREMIUM"] },
      { tenantId: "any", serviceCode: "FREE" },
    );
    expect(result.allowed).toBe(false);
  });

  it("registers a tenant-restricted plugin and stores its policy", async () => {
    const manifest: DesignPluginManifest = {
      ...VALID_MANIFEST,
      id: "restricted",
      tenantPolicy: { allowedTenantIds: ["enterprise-1"] },
    };
    const result = await registerPlugin(manifest);
    expect(result.ok).toBe(true);
    const entry = resolvePlugin("restricted")!;
    expect(entry.manifest.tenantPolicy?.allowedTenantIds).toContain("enterprise-1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Service alias — legacy slug mapping
// ─────────────────────────────────────────────────────────────────────────────
describe("7. Legacy service alias mapping", () => {
  it("resolves fashion_design slug to plugin ID 'fashion'", () => {
    expect(resolveAlias("fashion_design")).toBe("fashion");
  });

  it("resolves interior_design slug to 'interior'", () => {
    expect(resolveAlias("interior_design")).toBe("interior");
  });

  it("resolves packaging_design slug to 'packaging'", () => {
    expect(resolveAlias("packaging_design")).toBe("packaging");
  });

  it("resolves brand_identity slug to 'branding'", () => {
    expect(resolveAlias("brand_identity")).toBe("branding");
  });

  it("resolves kebab-case variants", () => {
    expect(resolveAlias("fashion-design")).toBe("fashion");
    expect(resolveAlias("interior-design")).toBe("interior");
  });

  it("returns undefined for an unknown slug", () => {
    expect(resolveAlias("totally-unknown-service")).toBeUndefined();
  });

  it("reverse-resolves slugs from plugin ID", () => {
    const slugs = getSlugsForPluginId("fashion");
    expect(slugs).toContain("fashion_design");
    expect(slugs).toContain("fashion-design");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Contribution registration — stored and retrievable
// ─────────────────────────────────────────────────────────────────────────────
describe("8. Contribution registration", () => {
  it("stores briefSchemas in the registry entry", async () => {
    await registerPlugin(VALID_MANIFEST);
    const entry = resolvePlugin("fashion")!;
    expect(entry.manifest.contributions?.briefSchemas).toHaveLength(1);
    expect(entry.manifest.contributions?.briefSchemas![0].schemaId).toBe(
      "fashion-brief-v1",
    );
  });

  it("stores capabilityRefs in the registry entry", async () => {
    await registerPlugin(VALID_MANIFEST);
    const entry = resolvePlugin("fashion")!;
    expect(entry.manifest.contributions?.capabilityRefs).toContain("fashion-brief");
  });

  it("stores materialCategories in the registry entry", async () => {
    await registerPlugin(VALID_MANIFEST);
    const entry = resolvePlugin("fashion")!;
    expect(entry.manifest.contributions?.materialCategories?.[0].categoryId).toBe(
      "fabric",
    );
  });

  it("stores exportProfiles in the registry entry", async () => {
    await registerPlugin(VALID_MANIFEST);
    const entry = resolvePlugin("fashion")!;
    expect(entry.manifest.contributions?.exportProfiles?.[0].profileId).toBe(
      "fashion-pdf",
    );
  });

  it("accepts a plugin with no contributions (contributions is optional)", async () => {
    const minimal: DesignPluginManifest = {
      id: "minimal",
      version: "1.0.0",
      name: "Minimal Plugin",
      contractVersion: PLUGIN_CONTRACT_VERSION,
    };
    const result = await registerPlugin(minimal);
    expect(result.ok).toBe(true);
    const entry = resolvePlugin("minimal")!;
    expect(entry.manifest.contributions).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Optional plugin failure isolation
// ─────────────────────────────────────────────────────────────────────────────
describe("9. Optional plugin failure isolation", () => {
  it("loadPlugins() continues loading when one plugin has an invalid manifest", async () => {
    const good = { manifest: VALID_MANIFEST };
    const bad = { manifest: { id: "bad", version: "not-semver" } };
    const report = await loadPlugins([good, bad] as Parameters<typeof loadPlugins>[0]);

    // good plugin loaded
    expect(report.loaded).toBe(1);
    expect(report.failed).toBe(1);
    expect(resolvePlugin("fashion")).toBeDefined();
  });

  it("loadPlugins() catches thrown errors from individual plugins", async () => {
    const throwing = {
      manifest: VALID_MANIFEST,
      healthCheck: async () => {
        throw new Error("health check exploded");
      },
    };
    // Should not throw; plugin is marked unhealthy instead
    const report = await loadPlugins([throwing]);
    // Registration itself succeeds (error in healthCheck marks as unhealthy, not rejected)
    expect(report.results[0]?.pluginId).toBe("fashion");
  });

  it("a failing plugin does not remove already-registered plugins", async () => {
    await registerPlugin(VALID_MANIFEST);
    await registerPlugin({ id: "garbage" }); // invalid — should be rejected cleanly

    const fashion = resolvePlugin("fashion");
    expect(fashion).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. Safe client projection
// ─────────────────────────────────────────────────────────────────────────────
describe("10. Safe client projection", () => {
  it("does not include tenantPolicy in the client projection", async () => {
    const manifest: DesignPluginManifest = {
      ...VALID_MANIFEST,
      id: "projected",
      tenantPolicy: { allowedTenantIds: ["secret-tenant"] },
    };
    await registerPlugin(manifest);
    const entry = resolvePlugin("projected")!;
    const safe = toSafeManifest(entry);

    expect((safe as unknown as Record<string, unknown>)["tenantPolicy"]).toBeUndefined();
    expect(JSON.stringify(safe)).not.toContain("secret-tenant");
  });

  it("does not include featureFlag in the client projection", async () => {
    setFlagOverride("internal-flag", true);
    const manifest: DesignPluginManifest = {
      ...VALID_MANIFEST,
      id: "flagged",
      featureFlag: "internal-flag",
    };
    await registerPlugin(manifest);
    const entry = resolvePlugin("flagged")!;
    const safe = toSafeManifest(entry);

    expect((safe as unknown as Record<string, unknown>)["featureFlag"]).toBeUndefined();
    expect(JSON.stringify(safe)).not.toContain("internal-flag");
  });

  it("exposes only boolean for briefSchemas presence, not the schema itself", async () => {
    await registerPlugin(VALID_MANIFEST);
    const entry = resolvePlugin("fashion")!;
    const safe = toSafeManifest(entry);

    expect(typeof safe.contributions.briefSchemas).toBe("boolean");
    expect(safe.contributions.briefSchemas).toBe(true);
    // The actual schema shape must not appear
    expect(JSON.stringify(safe)).not.toContain("fashion-brief-v1");
  });

  it("exposes materialCategory IDs (not full category objects)", async () => {
    await registerPlugin(VALID_MANIFEST);
    const entry = resolvePlugin("fashion")!;
    const safe = toSafeManifest(entry);

    expect(safe.contributions.materialCategories).toContain("fabric");
    // Full category object must not appear
    expect(JSON.stringify(safe)).not.toContain("Fabric Types");
  });

  it("exposes supported locales", async () => {
    await registerPlugin(VALID_MANIFEST);
    const entry = resolvePlugin("fashion")!;
    const safe = toSafeManifest(entry);

    expect(safe.contributions.supportedLocales).toContain("id");
    expect(safe.contributions.supportedLocales).toContain("en");
  });

  it("registeredAt is an ISO string (never a Date object)", async () => {
    await registerPlugin(VALID_MANIFEST);
    const entry = resolvePlugin("fashion")!;
    const safe = toSafeManifest(entry);

    expect(typeof safe.registeredAt).toBe("string");
    expect(() => new Date(safe.registeredAt)).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bonus: Hooks
// ─────────────────────────────────────────────────────────────────────────────
describe("Registration hooks", () => {
  it("dispatchPluginEvent calls registered handlers", async () => {
    const { dispatchPluginEvent } = await import("../hooks.js");
    const events: string[] = [];
    onPluginEvent((ev) => { events.push(ev.type); });

    await dispatchPluginEvent({ type: "enabled", pluginId: "fashion" });
    await dispatchPluginEvent({ type: "disabled", pluginId: "fashion" });

    expect(events).toEqual(["enabled", "disabled"]);
  });

  it("a throwing hook does not crash the dispatcher", async () => {
    const { dispatchPluginEvent } = await import("../hooks.js");
    onPluginEvent(() => { throw new Error("bad hook"); });
    // Should not throw
    await expect(
      dispatchPluginEvent({ type: "enabled", pluginId: "x" }),
    ).resolves.toBeUndefined();
  });
});
