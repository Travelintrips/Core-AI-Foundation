import { describe, expect, it } from "vitest";
import { buildInteriorVersionSnapshot } from "../ReviewVersionsPanel";
import type { ConceptDraft, ItemAssetImage } from "../InteriorDesignEditor";

const draft: ConceptDraft = {
  id: 12,
  projectUuid: "project-uuid",
  originalSpacePlan: { zones: [] },
  originalMaterials: { items: [] },
  originalFurniture: { items: [] },
  originalLighting: { items: [] },
  originalVisualConcept: "Original",
  spacePlanDraft: { zones: [{ id: "zone-1", name: "Living" }] },
  materialsDraft: { items: [{ id: "mat-1", name: "Oak" }] },
  furnitureDraft: { items: [{ id: "fur-1", item: "Sofa" }] },
  lightingDraft: { items: [{ id: "light-1", fixtureType: "Pendant" }] },
  visualConceptDraft: "Warm, quiet living room",
  reviewState: "ready_for_review",
  hasUnsavedEdits: false,
  lastEditedBy: "admin",
  lastEditedAt: "2026-08-12T00:00:00.000Z",
  updatedAt: "2026-08-12T00:00:00.000Z",
  createdAt: "2026-08-11T00:00:00.000Z",
};

const asset: ItemAssetImage = {
  id: 7,
  projectUuid: "project-uuid",
  itemType: "material",
  itemId: "mat-1",
  thumbnailUrl: "https://example.test/thumb.jpg",
  imageUrl: "https://example.test/full.jpg",
  imageAlt: "Oak",
  imageSource: "internal",
  imageSourceUrl: null,
  imageLicense: null,
  imageAttribution: null,
  isManualUpload: false,
  storagePath: "projects/project-uuid/mat-1.jpg",
};

describe("buildInteriorVersionSnapshot", () => {
  it("captures reconstruction and review references without binary payloads", () => {
    const snapshot = buildInteriorVersionSnapshot(draft, "project-uuid", { "material:mat-1": asset });

    expect(snapshot.schemaVersion).toBe("interior-design-review-v1");
    expect(snapshot.projectUuid).toBe("project-uuid");
    expect(snapshot.spacePlan).toEqual(draft.spacePlanDraft);
    expect(snapshot.moodboard).toEqual({
      projectUuid: "project-uuid",
      reference: "interior-design-moodboard",
    });
    expect(snapshot.render.reference).toBe("interior-render-outputs");
    expect(snapshot.assetRefs).toEqual([{
      id: 7,
      itemType: "material",
      itemId: "mat-1",
      storagePath: "projects/project-uuid/mat-1.jpg",
    }]);
    expect(JSON.stringify(snapshot)).not.toContain("base64");
    expect(JSON.stringify(snapshot)).not.toContain("imageData");
    expect(JSON.stringify(snapshot)).not.toContain("apiKey");
    expect(snapshot.review.customerApproval).toBe("not_applicable");
  });

  it("uses stable metadata and preserves the selected review state", () => {
    const snapshot = buildInteriorVersionSnapshot(draft, "project-uuid", {});

    expect(snapshot.metadata).toEqual({
      draftId: 12,
      source: "interior_design_concept",
      updatedAt: "2026-08-12T00:00:00.000Z",
    });
    expect(snapshot.review.state).toBe("ready_for_review");
  });
});