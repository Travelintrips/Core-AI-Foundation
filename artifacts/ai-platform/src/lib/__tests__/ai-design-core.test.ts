import { describe, expect, it } from "vitest";
import { applyDesignPatch, hasReal3DAsset, type DesignScene } from "../ai-design-core";

const base: DesignScene = {
  id: "scene-1", domain: "interior", version: 1,
  objects: [
    { id: "chair", kind: "furniture", name: "Chair", quantity: 1 },
    { id: "wall", kind: "surface", name: "Wall", locked: true },
  ],
};

describe("AI Design Core", () => {
  it("changes furniture quantity while preserving other objects", () => {
    const next = applyDesignPatch(base, { op: "set-quantity", objectId: "chair", quantity: 3 });
    expect(next.objects.find(o => o.id === "chair")?.quantity).toBe(3);
    expect(next.objects.find(o => o.id === "wall")?.name).toBe("Wall");
    expect(next.version).toBe(2);
    expect(base.objects.find(o => o.id === "chair")?.quantity).toBe(1);
  });

  it("refuses edits to locked objects", () => {
    expect(() => applyDesignPatch(base, { op: "set-material", objectId: "wall", material: { name: "Marble" } })).toThrow("OBJECT_LOCKED");
  });

  it("supports fashion embellishments without mutating garment parts", () => {
    const fashion: DesignScene = { id: "f", domain: "fashion", version: 1, objects: [{ id: "neck", kind: "garment-part", name: "Neckline" }] };
    const next = applyDesignPatch(fashion, { op: "upsert-embellishment", embellishment: { id: "b1", type: "bead", targetPartId: "neck", color: "#c0c0c0", sizeMm: 3, density: 40, pattern: "follow-edge" } });
    expect(next.embellishments?.[0].sizeMm).toBe(3);
    expect(next.objects[0]).toEqual(fashion.objects[0]);
  });

  it("only calls a model real 3D when GLB/GLTF exists", () => {
    expect(hasReal3DAsset({ ...base, asset: { mode: "2d-preview", previewUrl: "/x.png" } })).toBe(false);
    expect(hasReal3DAsset({ ...base, asset: { mode: "real-3d", glbUrl: "/x.glb" } })).toBe(true);
  });
});
