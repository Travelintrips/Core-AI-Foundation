export type DesignDomain = "interior" | "architecture" | "fashion";
export type AssetMode = "2d-preview" | "real-3d";

export interface DesignMaterial {
  id?: string;
  name: string;
  color?: string;
  roughness?: number;
  metallic?: number;
  opacity?: number;
  textureUrl?: string;
}

export interface DesignObject {
  id: string;
  kind: string;
  name: string;
  locked?: boolean;
  visible?: boolean;
  quantity?: number;
  material?: DesignMaterial;
  dimensions?: { width?: number; height?: number; depth?: number; unit?: "mm" | "cm" | "m" };
  metadata?: Record<string, unknown>;
}

export interface Embellishment {
  id: string;
  type: "bead" | "sequin" | "embroidery" | "lace" | "button";
  targetPartId: string;
  color?: string;
  sizeMm?: number;
  density?: number;
  pattern?: "free" | "repeat" | "mirror" | "radial" | "follow-edge";
  positions?: Array<{ x: number; y: number; z?: number }>;
}

export interface DesignScene {
  id: string;
  domain: DesignDomain;
  version: number;
  objects: DesignObject[];
  embellishments?: Embellishment[];
  asset?: {
    mode: AssetMode;
    glbUrl?: string;
    gltfUrl?: string;
    previewUrl?: string;
    provider?: string;
  };
}

export type DesignPatch =
  | { op: "set-material"; objectId: string; material: DesignMaterial }
  | { op: "set-quantity"; objectId: string; quantity: number }
  | { op: "set-visible"; objectId: string; visible: boolean }
  | { op: "upsert-embellishment"; embellishment: Embellishment }
  | { op: "remove-embellishment"; embellishmentId: string };

export function applyDesignPatch(scene: DesignScene, patch: DesignPatch): DesignScene {
  const next: DesignScene = {
    ...scene,
    version: scene.version + 1,
    objects: scene.objects.map(o => ({ ...o, material: o.material ? { ...o.material } : undefined })),
    embellishments: scene.embellishments?.map(e => ({ ...e, positions: e.positions?.map(p => ({ ...p })) })),
  };
  const object = "objectId" in patch ? next.objects.find(o => o.id === patch.objectId) : undefined;
  if (object?.locked) throw new Error("OBJECT_LOCKED");

  switch (patch.op) {
    case "set-material":
      if (!object) throw new Error("OBJECT_NOT_FOUND");
      object.material = { ...patch.material };
      break;
    case "set-quantity":
      if (!object) throw new Error("OBJECT_NOT_FOUND");
      if (!Number.isInteger(patch.quantity) || patch.quantity < 0 || patch.quantity > 100) throw new Error("INVALID_QUANTITY");
      object.quantity = patch.quantity;
      break;
    case "set-visible":
      if (!object) throw new Error("OBJECT_NOT_FOUND");
      object.visible = patch.visible;
      break;
    case "upsert-embellishment": {
      const target = next.objects.find(o => o.id === patch.embellishment.targetPartId);
      if (!target) throw new Error("TARGET_NOT_FOUND");
      if (target.locked) throw new Error("OBJECT_LOCKED");
      next.embellishments ??= [];
      const idx = next.embellishments.findIndex(e => e.id === patch.embellishment.id);
      if (idx >= 0) next.embellishments[idx] = { ...patch.embellishment };
      else next.embellishments.push({ ...patch.embellishment });
      break;
    }
    case "remove-embellishment":
      next.embellishments = (next.embellishments ?? []).filter(e => e.id !== patch.embellishmentId);
      break;
  }
  return next;
}

export function hasReal3DAsset(scene: DesignScene): boolean {
  return scene.asset?.mode === "real-3d" && Boolean(scene.asset.glbUrl || scene.asset.gltfUrl);
}
