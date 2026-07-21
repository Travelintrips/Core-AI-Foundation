/**
 * materialLibrary.test.ts — Team 21: Universal Material Library Foundation
 *
 * Covers all 20 required test cases:
 * 1.  material validation
 * 2.  duplicate material ID (prevented by UUID)
 * 3.  category registration
 * 4.  category hierarchy
 * 5.  invalid property type
 * 6.  property value validation
 * 7.  search
 * 8.  filters
 * 9.  sorting
 * 10. domain compatibility
 * 11. unavailable material
 * 12. deprecated material
 * 13. material assignment
 * 14. invalid target
 * 15. read-only material
 * 16. tenant isolation adapter
 * 17. platform scope rejection
 * 18. unsafe preview
 * 19. plugin extension
 * 20. no domain leakage
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  createMaterial,
  getMaterial,
  updateMaterial,
  deleteMaterial,
  listMaterials,
  MaterialNotFoundError,
  MaterialAccessDeniedError,
  MaterialReadOnlyError,
  MaterialValidationError,
  _resetStoreForTests,
} from "../materialLibraryService.js";
import {
  validateAssignment,
  createAssignment,
  MaterialAssignmentValidationError,
  _resetAssignmentStoreForTests,
} from "../materialAssignmentService.js";
import {
  MaterialCategoryRegistry,
  materialCategoryRegistry,
  DuplicateCategoryError,
  UNKNOWN_CATEGORY_SENTINEL,
} from "../categoryRegistry.js";
import { validatePropertyValue, validateAllProperties } from "../propertySchema.js";
import {
  materialPluginRegistry,
  registerMaterialPlugin,
} from "../pluginContract.js";
import { assertSafePreviewUrl, UnsafePreviewError } from "../types.js";
import type { RequestContext } from "../../../security/requestContext.js";
import type { MaterialDefinition, MaterialCategory } from "../types.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makePlatformCtx(): RequestContext {
  return {
    tenantId: null,
    actorId: "platform-actor",
    actorType: "platform_admin",
    authMode: "internal",
    requestId: "req-1",
    correlationId: "req-1",
    source: "api",
    permissions: ["*"],
    resourceScope: null,
    isPlatformAdmin: true,
    isPlatformWide: true,
    originatingActorId: null,
    metadata: {},
  };
}

function makeTenantCtx(tenantId = "tenant-A"): RequestContext {
  return {
    tenantId,
    actorId: "user-1",
    actorType: "tenant_admin",
    authMode: "session",
    requestId: "req-2",
    correlationId: "req-2",
    source: "api",
    permissions: ["read", "create", "edit", "delete"],
    resourceScope: null,
    isPlatformAdmin: false,
    isPlatformWide: false,
    originatingActorId: null,
    metadata: {},
  };
}

function makeBaseMaterialInput(overrides: Partial<Omit<MaterialDefinition, "materialId" | "tenantId" | "createdAt" | "updatedAt" | "version">> = {}) {
  return {
    name: "Test Material",
    categoryId: "textile",
    description: "A test material",
    status: "active" as const,
    source: "tenant" as const,
    preview: {
      previewUrl: "https://example.com/preview.jpg",
      thumbnailUrl: null,
      altText: "Test material swatch",
      swatchColor: "#FFFFFF",
      additionalSwatches: [],
    },
    properties: {},
    tags: ["test"],
    compatibility: { compatibleDomains: [] },
    extensions: {},
    ...overrides,
  };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  _resetStoreForTests();
  _resetAssignmentStoreForTests();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Material validation — missing required fields
// ─────────────────────────────────────────────────────────────────────────────
describe("1. Material validation", () => {
  it("rejects material with unregistered categoryId", () => {
    const ctx = makeTenantCtx();
    expect(() =>
      createMaterial(makeBaseMaterialInput({ categoryId: "nonexistent_category_xyz" }), ctx),
    ).toThrow(MaterialValidationError);
  });

  it("accepts material with valid categoryId", () => {
    const ctx = makeTenantCtx();
    const m = createMaterial(makeBaseMaterialInput({ categoryId: "wood" }), ctx);
    expect(m.materialId).toBeTruthy();
    expect(m.categoryId).toBe("wood");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Duplicate material ID — UUIDs prevent it; test store isolation
// ─────────────────────────────────────────────────────────────────────────────
describe("2. Duplicate material ID prevention", () => {
  it("creates two materials with distinct IDs", () => {
    const ctx = makeTenantCtx();
    const m1 = createMaterial(makeBaseMaterialInput(), ctx);
    const m2 = createMaterial(makeBaseMaterialInput(), ctx);
    expect(m1.materialId).not.toBe(m2.materialId);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Category registration
// ─────────────────────────────────────────────────────────────────────────────
describe("3. Category registration", () => {
  it("platform registry contains seed categories", () => {
    expect(materialCategoryRegistry.has("textile")).toBe(true);
    expect(materialCategoryRegistry.has("wood")).toBe(true);
    expect(materialCategoryRegistry.has("metal")).toBe(true);
    expect(materialCategoryRegistry.has("digital_material")).toBe(true);
  });

  it("throws DuplicateCategoryError on re-registration without force", () => {
    const reg = new MaterialCategoryRegistry();
    const cat: MaterialCategory = {
      categoryId: "test-cat",
      name: "Test",
      sortOrder: 1,
      applicableDomains: [],
      stability: "stable",
      capabilities: [],
      propertyDefinitions: [],
    };
    reg.register(cat);
    expect(() => reg.register(cat)).toThrow(DuplicateCategoryError);
  });

  it("allows re-registration with force: true", () => {
    const reg = new MaterialCategoryRegistry();
    const cat: MaterialCategory = {
      categoryId: "forceable",
      name: "Forceable",
      sortOrder: 1,
      applicableDomains: [],
      stability: "stable",
      capabilities: [],
      propertyDefinitions: [],
    };
    reg.register(cat);
    expect(() => reg.register(cat, { force: true })).not.toThrow();
  });

  it("returns UNKNOWN_CATEGORY_SENTINEL for unregistered ID", () => {
    const result = materialCategoryRegistry.getOrUnknown("does_not_exist");
    expect(result.categoryId).toBe("__unknown__");
    expect(result).toBe(UNKNOWN_CATEGORY_SENTINEL);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Category hierarchy
// ─────────────────────────────────────────────────────────────────────────────
describe("4. Category hierarchy", () => {
  it("resolves parent → child hierarchy correctly", () => {
    const reg = new MaterialCategoryRegistry();
    const parent: MaterialCategory = {
      categoryId: "parent",
      name: "Parent",
      sortOrder: 1,
      applicableDomains: [],
      stability: "stable",
      capabilities: [],
      propertyDefinitions: [
        { propertyId: "parent_prop", name: "Parent Prop", type: "text", required: false },
      ],
    };
    const child: MaterialCategory = {
      categoryId: "child",
      name: "Child",
      parentId: "parent",
      sortOrder: 1,
      applicableDomains: [],
      stability: "stable",
      capabilities: [],
      propertyDefinitions: [
        { propertyId: "child_prop", name: "Child Prop", type: "number", required: false },
      ],
    };
    reg.register(parent);
    reg.register(child);
    const defs = reg.resolvePropertyDefinitions("child");
    const ids = defs.map((d) => d.propertyId);
    expect(ids).toContain("parent_prop");
    expect(ids).toContain("child_prop");
  });

  it("getChildren returns correct children sorted by sortOrder", () => {
    const reg = new MaterialCategoryRegistry();
    reg.register({ categoryId: "root", name: "Root", sortOrder: 1, applicableDomains: [], stability: "stable", capabilities: [], propertyDefinitions: [] });
    reg.register({ categoryId: "child-b", name: "B", parentId: "root", sortOrder: 20, applicableDomains: [], stability: "stable", capabilities: [], propertyDefinitions: [] });
    reg.register({ categoryId: "child-a", name: "A", parentId: "root", sortOrder: 10, applicableDomains: [], stability: "stable", capabilities: [], propertyDefinitions: [] });
    const children = reg.getChildren("root");
    expect(children[0].categoryId).toBe("child-a");
    expect(children[1].categoryId).toBe("child-b");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Invalid property type
// ─────────────────────────────────────────────────────────────────────────────
describe("5. Invalid property type", () => {
  it("returns error for completely unknown property type", () => {
    const def = { propertyId: "x", name: "X", type: "unknown_type" as never, required: false };
    const result = validatePropertyValue(def, "value");
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/unknown type/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Property value validation
// ─────────────────────────────────────────────────────────────────────────────
describe("6. Property value validation", () => {
  it("validates text property", () => {
    const def = { propertyId: "name", name: "Name", type: "text" as const, required: true };
    expect(validatePropertyValue(def, "hello").valid).toBe(true);
    expect(validatePropertyValue(def, 42).valid).toBe(false);
    expect(validatePropertyValue(def, null).valid).toBe(false);
  });

  it("validates enum property with enumOptions", () => {
    const def = { propertyId: "finish", name: "Finish", type: "enum" as const, required: false, enumOptions: ["matte", "gloss"] };
    expect(validatePropertyValue(def, "matte").valid).toBe(true);
    expect(validatePropertyValue(def, "shiny").valid).toBe(false);
  });

  it("validates percentage range (0–100)", () => {
    const def = { propertyId: "opacity", name: "Opacity", type: "percentage" as const, required: false };
    expect(validatePropertyValue(def, 50).valid).toBe(true);
    expect(validatePropertyValue(def, 150).valid).toBe(false);
    expect(validatePropertyValue(def, -5).valid).toBe(false);
  });

  it("validates color hex format", () => {
    const def = { propertyId: "color", name: "Color", type: "color" as const, required: false };
    expect(validatePropertyValue(def, "#FF0000").valid).toBe(true);
    expect(validatePropertyValue(def, "#FFF").valid).toBe(true);
    expect(validatePropertyValue(def, "red").valid).toBe(false);
  });

  it("validates measurement object", () => {
    const def = { propertyId: "thickness", name: "Thickness", type: "measurement" as const, required: false };
    expect(validatePropertyValue(def, { value: 3.5, unit: "mm" }).valid).toBe(true);
    expect(validatePropertyValue(def, { value: "thick" }).valid).toBe(false);
  });

  it("validateAllProperties catches multiple errors", () => {
    const defs = [
      { propertyId: "a", name: "A", type: "number" as const, required: true },
      { propertyId: "b", name: "B", type: "boolean" as const, required: true },
    ];
    const result = validateAllProperties(defs, { a: "not-a-number", b: "not-a-boolean" });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Search
// ─────────────────────────────────────────────────────────────────────────────
describe("7. Search", () => {
  it("finds material by name substring", () => {
    const ctx = makeTenantCtx();
    createMaterial(makeBaseMaterialInput({ name: "Merino Wool Fabric" }), ctx);
    createMaterial(makeBaseMaterialInput({ name: "Oak Wood Panel" }), ctx);
    const result = listMaterials({ q: "merino" }, "name_asc", 1, 20, ctx);
    expect(result.items.length).toBe(1);
    expect(result.items[0].name).toBe("Merino Wool Fabric");
  });

  it("finds material by tag", () => {
    const ctx = makeTenantCtx();
    createMaterial(makeBaseMaterialInput({ name: "A", tags: ["luxury", "premium"] }), ctx);
    createMaterial(makeBaseMaterialInput({ name: "B", tags: ["budget"] }), ctx);
    const result = listMaterials({ tags: ["luxury"] }, "name_asc", 1, 20, ctx);
    expect(result.items.length).toBe(1);
    expect(result.items[0].name).toBe("A");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Filters
// ─────────────────────────────────────────────────────────────────────────────
describe("8. Filters", () => {
  it("filters by categoryId", () => {
    const ctx = makeTenantCtx();
    createMaterial(makeBaseMaterialInput({ categoryId: "wood" }), ctx);
    createMaterial(makeBaseMaterialInput({ categoryId: "metal" }), ctx);
    const result = listMaterials({ categoryIds: ["wood"] }, "name_asc", 1, 20, ctx);
    expect(result.items.every((m) => m.categoryId === "wood")).toBe(true);
  });

  it("filters by source", () => {
    const ctx = makeTenantCtx();
    createMaterial(makeBaseMaterialInput({ source: "tenant" }), ctx);
    createMaterial(makeBaseMaterialInput({ source: "uploaded" }), ctx);
    const result = listMaterials({ source: "uploaded" }, "name_asc", 1, 20, ctx);
    expect(result.items.every((m) => m.source === "uploaded")).toBe(true);
  });

  it("excludes inactive by default", () => {
    const ctx = makeTenantCtx();
    createMaterial(makeBaseMaterialInput({ status: "active" }), ctx);
    createMaterial(makeBaseMaterialInput({ status: "inactive" }), ctx);
    const result = listMaterials({}, "name_asc", 1, 20, ctx);
    expect(result.items.every((m) => m.status === "active")).toBe(true);
  });

  it("includes inactive with includeInactive: true", () => {
    const ctx = makeTenantCtx();
    createMaterial(makeBaseMaterialInput({ status: "active" }), ctx);
    createMaterial(makeBaseMaterialInput({ status: "deprecated" }), ctx);
    const result = listMaterials({ includeInactive: true }, "name_asc", 1, 20, ctx);
    expect(result.total).toBeGreaterThanOrEqual(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Sorting
// ─────────────────────────────────────────────────────────────────────────────
describe("9. Sorting", () => {
  it("sorts name_asc correctly", () => {
    const ctx = makeTenantCtx();
    createMaterial(makeBaseMaterialInput({ name: "Zinc" }), ctx);
    createMaterial(makeBaseMaterialInput({ name: "Ash" }), ctx);
    createMaterial(makeBaseMaterialInput({ name: "Oak" }), ctx);
    const result = listMaterials({}, "name_asc", 1, 20, ctx);
    const names = result.items.map((m) => m.name);
    expect(names).toEqual([...names].sort());
  });

  it("sorts name_desc correctly", () => {
    const ctx = makeTenantCtx();
    createMaterial(makeBaseMaterialInput({ name: "Zinc" }), ctx);
    createMaterial(makeBaseMaterialInput({ name: "Ash" }), ctx);
    const result = listMaterials({}, "name_desc", 1, 20, ctx);
    const names = result.items.map((m) => m.name);
    expect(names[0]).toBe("Zinc");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. Domain compatibility
// ─────────────────────────────────────────────────────────────────────────────
describe("10. Domain compatibility", () => {
  it("filters by compatible domain", () => {
    const ctx = makeTenantCtx();
    createMaterial(makeBaseMaterialInput({ name: "Fashion Only", compatibility: { compatibleDomains: ["fashion"] } }), ctx);
    createMaterial(makeBaseMaterialInput({ name: "Universal", compatibility: { compatibleDomains: [] } }), ctx);
    const fashionResult = listMaterials({ domain: "fashion" }, "name_asc", 1, 20, ctx);
    expect(fashionResult.items.some((m) => m.name === "Fashion Only")).toBe(true);
    expect(fashionResult.items.some((m) => m.name === "Universal")).toBe(true);

    const interiorResult = listMaterials({ domain: "interior" }, "name_asc", 1, 20, ctx);
    expect(interiorResult.items.some((m) => m.name === "Fashion Only")).toBe(false);
    expect(interiorResult.items.some((m) => m.name === "Universal")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. Unavailable material
// ─────────────────────────────────────────────────────────────────────────────
describe("11. Unavailable material", () => {
  it("does not appear in default search", () => {
    const ctx = makeTenantCtx();
    createMaterial(makeBaseMaterialInput({ status: "unavailable" }), ctx);
    const result = listMaterials({}, "name_asc", 1, 20, ctx);
    expect(result.items.some((m) => m.status === "unavailable")).toBe(false);
  });

  it("appears when includeInactive: true", () => {
    const ctx = makeTenantCtx();
    createMaterial(makeBaseMaterialInput({ status: "unavailable" }), ctx);
    const result = listMaterials({ includeInactive: true }, "name_asc", 1, 20, ctx);
    expect(result.items.some((m) => m.status === "unavailable")).toBe(true);
  });

  it("assignment rejects unavailable material", () => {
    const ctx = makeTenantCtx();
    const m = createMaterial(makeBaseMaterialInput({ status: "unavailable" }), ctx);
    const result = validateAssignment(
      { materialId: m.materialId, targetArtifactId: "artifact-1" },
      ctx,
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("not active"))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. Deprecated material
// ─────────────────────────────────────────────────────────────────────────────
describe("12. Deprecated material", () => {
  it("deprecated material hidden in default search", () => {
    const ctx = makeTenantCtx();
    createMaterial(makeBaseMaterialInput({ status: "deprecated" }), ctx);
    const result = listMaterials({}, "name_asc", 1, 20, ctx);
    expect(result.items.some((m) => m.status === "deprecated")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. Material assignment
// ─────────────────────────────────────────────────────────────────────────────
describe("13. Material assignment", () => {
  it("creates valid assignment for active material", () => {
    const ctx = makeTenantCtx();
    const m = createMaterial(makeBaseMaterialInput(), ctx);
    const assignment = createAssignment(
      { materialId: m.materialId, targetArtifactId: "artifact-123", assignmentSource: "user" },
      ctx,
    );
    expect(assignment.assignmentId).toBeTruthy();
    expect(assignment.materialId).toBe(m.materialId);
    expect(assignment.targetArtifactId).toBe("artifact-123");
    expect(assignment.materialVersion).toBe(m.version);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 14. Invalid target
// ─────────────────────────────────────────────────────────────────────────────
describe("14. Invalid target", () => {
  it("rejects empty targetArtifactId", () => {
    const ctx = makeTenantCtx();
    const m = createMaterial(makeBaseMaterialInput(), ctx);
    expect(() =>
      createAssignment({ materialId: m.materialId, targetArtifactId: "" }, ctx),
    ).toThrow(MaterialAssignmentValidationError);
  });

  it("rejects whitespace-only targetArtifactId", () => {
    const ctx = makeTenantCtx();
    const m = createMaterial(makeBaseMaterialInput(), ctx);
    expect(() =>
      createAssignment({ materialId: m.materialId, targetArtifactId: "   " }, ctx),
    ).toThrow(MaterialAssignmentValidationError);
  });

  it("rejects both targetElementId and targetRegionId set simultaneously", () => {
    const ctx = makeTenantCtx();
    const m = createMaterial(makeBaseMaterialInput(), ctx);
    const result = validateAssignment(
      {
        materialId: m.materialId,
        targetArtifactId: "artifact-1",
        targetElementId: "el-1",
        targetRegionId: "region-1",
      },
      ctx,
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("mutually exclusive") || e.includes("not both"))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 15. Read-only material
// ─────────────────────────────────────────────────────────────────────────────
describe("15. Read-only material", () => {
  it("cannot update a read-only material", () => {
    const ctx = makePlatformCtx();
    const m = createMaterial(makeBaseMaterialInput({ readOnly: true }), ctx, { platformLevel: true } as never);
    // updateMaterial should throw
    expect(() => updateMaterial(m.materialId, { name: "New Name" }, ctx)).toThrow(MaterialReadOnlyError);
  });

  it("cannot delete a read-only material", () => {
    const ctx = makePlatformCtx();
    const m = createMaterial(makeBaseMaterialInput({ readOnly: true }), ctx, { platformLevel: true } as never);
    expect(() => deleteMaterial(m.materialId, ctx)).toThrow(MaterialReadOnlyError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 16. Tenant isolation adapter
// ─────────────────────────────────────────────────────────────────────────────
describe("16. Tenant isolation", () => {
  it("tenant A cannot see tenant B materials", () => {
    const ctxA = makeTenantCtx("tenant-A");
    const ctxB = makeTenantCtx("tenant-B");
    createMaterial(makeBaseMaterialInput({ name: "A Material" }), ctxA);
    createMaterial(makeBaseMaterialInput({ name: "B Material" }), ctxB);

    const resultA = listMaterials({}, "name_asc", 1, 20, ctxA);
    expect(resultA.items.every((m) => m.tenantId === "tenant-A")).toBe(true);
    expect(resultA.items.some((m) => m.name === "B Material")).toBe(false);
  });

  it("tenant cannot getMaterial from another tenant", () => {
    const ctxA = makeTenantCtx("tenant-A");
    const ctxB = makeTenantCtx("tenant-B");
    const m = createMaterial(makeBaseMaterialInput(), ctxA);
    expect(() => getMaterial(m.materialId, ctxB)).toThrow(MaterialAccessDeniedError);
  });

  it("platform admin can see all tenant materials", () => {
    const ctxA = makeTenantCtx("tenant-A");
    const ctxB = makeTenantCtx("tenant-B");
    const platformCtx = makePlatformCtx();
    createMaterial(makeBaseMaterialInput({ name: "A" }), ctxA);
    createMaterial(makeBaseMaterialInput({ name: "B" }), ctxB);
    const result = listMaterials({}, "name_asc", 1, 100, platformCtx);
    expect(result.items.length).toBeGreaterThanOrEqual(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 17. Platform scope rejection
// ─────────────────────────────────────────────────────────────────────────────
describe("17. Platform scope rejection", () => {
  it("non-platform-admin cannot create platform-level material", () => {
    const ctx = makeTenantCtx();
    expect(() =>
      createMaterial(makeBaseMaterialInput(), ctx, { platformLevel: true } as never),
    ).toThrow(MaterialAccessDeniedError);
  });

  it("platform admin can create platform-level material (tenantId = null)", () => {
    const ctx = makePlatformCtx();
    const m = createMaterial(makeBaseMaterialInput(), ctx, { platformLevel: true } as never);
    expect(m.tenantId).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 18. Unsafe preview
// ─────────────────────────────────────────────────────────────────────────────
describe("18. Unsafe preview", () => {
  it("rejects data: URL in previewUrl", () => {
    expect(() => assertSafePreviewUrl("data:image/png;base64,abc")).toThrow(UnsafePreviewError);
  });

  it("rejects javascript: URL in previewUrl", () => {
    expect(() => assertSafePreviewUrl("javascript:alert(1)")).toThrow(UnsafePreviewError);
  });

  it("rejects raw storage path (no protocol)", () => {
    expect(() => assertSafePreviewUrl("/storage/bucket/file.png")).toThrow(UnsafePreviewError);
  });

  it("accepts https:// URL", () => {
    expect(() => assertSafePreviewUrl("https://cdn.example.com/material.jpg")).not.toThrow();
  });

  it("accepts null (no preview)", () => {
    expect(() => assertSafePreviewUrl(null)).not.toThrow();
  });

  it("createMaterial rejects unsafe previewUrl", () => {
    const ctx = makeTenantCtx();
    expect(() =>
      createMaterial(
        makeBaseMaterialInput({ preview: { previewUrl: "data:image/png;base64,X", thumbnailUrl: null, altText: "", swatchColor: null, additionalSwatches: [] } }),
        ctx,
      ),
    ).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 19. Plugin extension
// ─────────────────────────────────────────────────────────────────────────────
describe("19. Plugin extension", () => {
  it("registers a plugin and its categories", () => {
    registerMaterialPlugin({
      pluginId: "test-plugin-ext",
      name: "Test Plugin",
      version: "1.0.0",
      categories: [
        {
          categoryId: "test-plugin-cat-unique",
          name: "Plugin Category",
          sortOrder: 999,
          applicableDomains: ["test_domain"],
          stability: "experimental",
          capabilities: ["test_cap"],
          propertyDefinitions: [
            { propertyId: "plugin_prop", name: "Plugin Prop", type: "text", required: false },
          ],
        },
      ],
      domains: ["test_domain"],
    });
    expect(materialCategoryRegistry.has("test-plugin-cat-unique")).toBe(true);
    const cat = materialCategoryRegistry.get("test-plugin-cat-unique");
    expect(cat?.pluginId).toBe("test-plugin-ext");
    expect(cat?.capabilities).toContain("test_cap");
  });

  it("re-registering same pluginId + version is a no-op", () => {
    const pluginId = "idempotent-plugin";
    registerMaterialPlugin({ pluginId, name: "P", version: "1.0.0", categories: [] });
    registerMaterialPlugin({ pluginId, name: "P", version: "1.0.0", categories: [] });
    expect(materialPluginRegistry.has(pluginId)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 20. No domain leakage
// ─────────────────────────────────────────────────────────────────────────────
describe("20. No domain leakage — core is domain-neutral", () => {
  it("material compatible only with fashion is not returned in interior filter", () => {
    const ctx = makeTenantCtx();
    createMaterial(
      makeBaseMaterialInput({ name: "Fashion Only", compatibility: { compatibleDomains: ["fashion"] } }),
      ctx,
    );
    const interiorResult = listMaterials({ domain: "interior" }, "name_asc", 1, 20, ctx);
    expect(interiorResult.items.some((m) => m.name === "Fashion Only")).toBe(false);
  });

  it("domain-neutral material (empty compatibleDomains) is returned for any domain filter", () => {
    const ctx = makeTenantCtx();
    createMaterial(
      makeBaseMaterialInput({ name: "Universal Mat", compatibility: { compatibleDomains: [] } }),
      ctx,
    );
    const fashionResult = listMaterials({ domain: "fashion" }, "name_asc", 1, 20, ctx);
    const interiorResult = listMaterials({ domain: "interior" }, "name_asc", 1, 20, ctx);
    expect(fashionResult.items.some((m) => m.name === "Universal Mat")).toBe(true);
    expect(interiorResult.items.some((m) => m.name === "Universal Mat")).toBe(true);
  });

  it("category registry list can filter by domain", () => {
    const onlyStone = materialCategoryRegistry.list({ domain: "interior" });
    // stone is in applicableDomains: ["interior", "architecture", "landscape"]
    expect(onlyStone.some((c) => c.categoryId === "stone")).toBe(true);
    // digital_material has no domain restriction — appears for all
    expect(onlyStone.some((c) => c.categoryId === "digital_material")).toBe(true);
  });
});
