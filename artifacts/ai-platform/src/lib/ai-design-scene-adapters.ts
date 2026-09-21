import type { DesignObject, DesignScene } from "@/lib/ai-design-core";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : undefined;
}
function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
function assetFromValue(value: unknown): string | undefined {
  const source = record(value);
  if (!source) return undefined;
  for (const key of ["url", "previewUrl", "preview_url", "imageUrl", "image_url", "frontUrl", "front_url"]) {
    const found = stringValue(source[key]);
    if (found) return found;
  }
  return undefined;
}
function assetFrom(records: Array<UnknownRecord | undefined>) {
  const values = records.filter(Boolean) as UnknownRecord[];
  const find = (keys: string[]) => {
    for (const source of values) for (const key of keys) {
      const value = stringValue(source[key]);
      if (value) return value;
    }
    return undefined;
  };
  const glbUrl = find(["glbUrl", "glb_url", "modelGlbUrl", "model_glb_url"]);
  const gltfUrl = find(["gltfUrl", "gltf_url", "modelGltfUrl", "model_gltf_url"]);
  let previewUrl = find(["previewUrl", "preview_url", "renderUrl", "render_url", "imageUrl", "image_url", "url"]);
  if (!previewUrl) {
    for (const source of values) {
      for (const key of ["flat-design", "front-back-preview"]) {
        const value = source[key];
        previewUrl = stringValue(value) ?? assetFromValue(value);
        if (previewUrl) break;
      }
      if (previewUrl) break;
    }
  }
  return { mode: glbUrl || gltfUrl ? "real-3d" as const : "2d-preview" as const, glbUrl, gltfUrl, previewUrl };
}
function uniqueObjects(objects: DesignObject[]) {
  const seen = new Set<string>();
  return objects.filter(object => object.id && !seen.has(object.id) && Boolean(seen.add(object.id)));
}

export function interiorOutputToDesignScene(input: {
  projectId: string | number;
  furniturePlacement?: Array<{ item: string; widthM: number; depthM: number; note?: string }> | null;
  materialRecommendations?: Record<string, Record<string, string>> | null;
  output?: UnknownRecord | null;
}): DesignScene {
  const furniture = (input.furniturePlacement ?? []).map((item, index): DesignObject => ({
    id: `furniture-${index}`, kind: "furniture", name: item.item, visible: true, quantity: 1,
    dimensions: { width: item.widthM, depth: item.depthM, unit: "m" },
    metadata: { note: item.note ?? "" },
  }));
  const materials = Object.entries(input.materialRecommendations ?? {}).map(([name, values]): DesignObject => ({
    id: `surface-${name}`, kind: "surface", name, visible: true, quantity: 1,
    material: { name: Object.values(values)[0] ?? name },
  }));
  const output = record(input.output) ?? {};
  return {
    id: `interior-${input.projectId}`, domain: "interior", version: 1,
    objects: uniqueObjects([...furniture, ...materials]),
    asset: assetFrom([record(output.asset), record(output.assets), output]),
  };
}

export function fashionOrderToDesignScene(input: {
  orderId: string | number;
  serviceType: string;
  colorways?: string[] | null;
  blueprintPanels?: Record<string, unknown> | null;
  compositionJson?: UnknownRecord | null;
  outputs?: UnknownRecord | null;
}): DesignScene {
  const panels = Object.entries(input.blueprintPanels ?? {})
    .filter(([, value]) => record(value)?.enabled !== false)
    .map(([name]) => name);
  const names = panels.length ? panels : ["garment"];
  const objects = names.map((name, index): DesignObject => ({
    id: `part-${name}`, kind: "garment-part", name, visible: true, quantity: 1,
    material: { name: input.serviceType, color: input.colorways?.[index % Math.max(1, input.colorways?.length ?? 0)] },
  }));
  const outputs = record(input.outputs) ?? {};
  const composition = record(input.compositionJson) ?? {};
  return {
    id: `fashion-${input.orderId}`, domain: "fashion", version: 1, objects: uniqueObjects(objects), embellishments: [],
    asset: assetFrom([record(outputs.asset), record(outputs.assets), record(composition.asset), outputs, composition]),
  };
}
