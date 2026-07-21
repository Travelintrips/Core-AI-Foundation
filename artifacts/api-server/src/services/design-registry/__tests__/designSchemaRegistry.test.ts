/**
 * designSchemaRegistry.test.ts
 *
 * Covers:
 *  - register schema (success)
 *  - duplicate registration collision
 *  - get by id (latest version)
 *  - get by id + exact version
 *  - get via alias
 *  - list all
 *  - listByCategory
 *  - validate — valid data
 *  - validate — invalid data
 *  - validate — missing schema
 *  - version compatibility checks via CapabilityResolver
 *  - serialization stability (JSON roundtrip of non-function fields)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod/v4";
import {
  DesignSchemaRegistry,
  SchemaRegistrationCollisionError,
} from "../index.js";
import type { DesignSchemaEntry } from "../index.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSchema(overrides: Partial<DesignSchemaEntry> = {}): DesignSchemaEntry {
  return {
    id: "test.schema.foo",
    version: "1.0.0",
    category: "brief",
    validator: z.object({ name: z.string() }),
    compatibilityMetadata: {},
    description: "Test schema",
    ...overrides,
  };
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("DesignSchemaRegistry", () => {
  let registry: DesignSchemaRegistry;

  beforeEach(() => {
    registry = new DesignSchemaRegistry();
  });

  // ── Registration ────────────────────────────────────────────────────────────

  it("registers a schema successfully", () => {
    const entry = makeSchema();
    registry.register(entry);
    expect(registry.size).toBe(1);
  });

  it("throws RegistrationCollisionError on duplicate (id, version)", () => {
    registry.register(makeSchema());
    expect(() => registry.register(makeSchema())).toThrow(SchemaRegistrationCollisionError);
    expect(() => registry.register(makeSchema())).toThrow(/collision/i);
  });

  it("allows registering same id with a different version", () => {
    registry.register(makeSchema({ version: "1.0.0" }));
    registry.register(makeSchema({ version: "2.0.0" }));
    expect(registry.size).toBe(2);
  });

  // ── Retrieval ───────────────────────────────────────────────────────────────

  it("gets a schema by id (returns latest insertion)", () => {
    registry.register(makeSchema({ version: "1.0.0" }));
    registry.register(makeSchema({ version: "2.0.0" }));
    const entry = registry.get("test.schema.foo");
    expect(entry?.version).toBe("2.0.0");
  });

  it("gets a schema by id and exact version", () => {
    registry.register(makeSchema({ version: "1.0.0" }));
    registry.register(makeSchema({ version: "2.0.0" }));
    expect(registry.get("test.schema.foo", "1.0.0")?.version).toBe("1.0.0");
    expect(registry.get("test.schema.foo", "2.0.0")?.version).toBe("2.0.0");
  });

  it("returns undefined for an unregistered id", () => {
    expect(registry.get("does.not.exist")).toBeUndefined();
  });

  it("returns undefined for an unregistered version", () => {
    registry.register(makeSchema({ version: "1.0.0" }));
    expect(registry.get("test.schema.foo", "9.9.9")).toBeUndefined();
  });

  it("resolves an alias to the canonical schema", () => {
    registry.register(
      makeSchema({
        id: "canonical.id",
        version: "1.0.0",
        compatibilityMetadata: { aliases: ["old.alias"] },
      }),
    );
    const via = registry.get("old.alias", "1.0.0");
    expect(via?.id).toBe("canonical.id");
  });

  // ── List ────────────────────────────────────────────────────────────────────

  it("lists all registered schemas", () => {
    registry.register(makeSchema({ id: "a.schema", category: "brief" }));
    registry.register(makeSchema({ id: "b.schema", category: "artifact" }));
    expect(registry.list()).toHaveLength(2);
  });

  it("listByCategory returns only matching schemas", () => {
    registry.register(makeSchema({ id: "a.schema", category: "brief" }));
    registry.register(makeSchema({ id: "b.schema", category: "artifact" }));
    expect(registry.listByCategory("brief")).toHaveLength(1);
    expect(registry.listByCategory("artifact")).toHaveLength(1);
    expect(registry.listByCategory("workflow")).toHaveLength(0);
  });

  // ── Validation ──────────────────────────────────────────────────────────────

  it("validates valid data against a registered schema", () => {
    registry.register(makeSchema());
    const result = registry.validate("test.schema.foo", { name: "hello" });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("returns errors for invalid data", () => {
    registry.register(makeSchema());
    const result = registry.validate("test.schema.foo", { name: 42 }); // number, not string
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("returns an error when the schema is not registered", () => {
    const result = registry.validate("missing.schema", { anything: true });
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.message).toMatch(/not registered/i);
  });

  it("validates against a specific version", () => {
    registry.register(
      makeSchema({
        version: "1.0.0",
        validator: z.object({ v1field: z.string() }),
      }),
    );
    registry.register(
      makeSchema({
        version: "2.0.0",
        validator: z.object({ v2field: z.number() }),
      }),
    );
    expect(registry.validate("test.schema.foo", { v1field: "ok" }, "1.0.0").valid).toBe(true);
    expect(registry.validate("test.schema.foo", { v2field: 1 }, "2.0.0").valid).toBe(true);
    expect(registry.validate("test.schema.foo", { v1field: "ok" }, "2.0.0").valid).toBe(false);
  });

  // ── Clear ───────────────────────────────────────────────────────────────────

  it("clear() empties the registry", () => {
    registry.register(makeSchema());
    registry.clear();
    expect(registry.size).toBe(0);
    expect(registry.list()).toHaveLength(0);
    expect(registry.get("test.schema.foo")).toBeUndefined();
  });

  // ── Serialization stability ─────────────────────────────────────────────────

  it("non-function fields round-trip through JSON", () => {
    const entry = makeSchema({
      id: "stable.schema",
      version: "1.0.0",
      category: "artifact",
      description: "Serialization test",
      compatibilityMetadata: { minVersion: "1.0.0", aliases: ["alt.id"] },
    });
    registry.register(entry);
    const stored = registry.get("stable.schema")!;

    const serialized = JSON.stringify({
      id: stored.id,
      version: stored.version,
      category: stored.category,
      description: stored.description,
      compatibilityMetadata: stored.compatibilityMetadata,
    });

    const parsed = JSON.parse(serialized);
    expect(parsed.id).toBe("stable.schema");
    expect(parsed.version).toBe("1.0.0");
    expect(parsed.category).toBe("artifact");
    expect(parsed.compatibilityMetadata.aliases).toContain("alt.id");
  });
});
