import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  projectResult: {} as Record<string, unknown>,
  queries: [] as string[],
  projectExists: true,
}));

vi.mock("@workspace/db", () => ({
  pool: {
    query: vi.fn(async (text: string, params?: unknown[]) => {
      state.queries.push(text);
      if (text.includes("FROM ai_platform.creative_projects")) {
        return {
          rows: state.projectExists ? [{
            project_id: params?.[0],
            title: "Calm Living Room",
            style_preference: "japandi",
            color_preference: "#F4EFE6, #A99B88",
            notes: null,
            result: state.projectResult,
          }] : [],
        };
      }
      if (text.includes("FROM ai_platform.id_concept_drafts")) {
        return {
          rows: [{
            project_uuid: params?.[0],
            review_state: "approved_for_rendering",
            materials_draft: { items: [{ id: "draft-material", name: "Draft material" }] },
            furniture_draft: { items: [{ id: "draft-furniture", item: "Draft furniture" }] },
            lighting_draft: { items: [] },
            space_plan_draft: { zones: [] },
            approved_materials: { items: [{ materialCode: "MAT-JAP-01" }] },
            approved_furniture: { items: [{ code: "FUR-JAP-01" }] },
            approved_lighting: { items: [{ id: "approved-light" }] },
            approved_space_plan: { zones: [{ id: "approved-zone" }] },
          }],
        };
      }
      if (text.includes("FROM ai_platform.materials")) {
        return {
          rows: [{
            id: 1,
            material_code: "MAT-JAP-01",
            name: "Japanese Oak",
            category: "Floor",
            color: "Natural oak",
            finish: "Matte",
            texture: "Fine grain",
            thumbnail_url: "https://cdn.example.com/material.jpg",
          }],
        };
      }
      if (text.includes("FROM ai_platform.furniture_items")) {
        return {
          rows: [{
            id: "00000000-0000-4000-8000-000000000001",
            code: "FUR-JAP-01",
            name: "Low Oak Lounge Chair",
            furniture_type: "chair",
            style: "Japandi",
            primary_materials: ["oak"],
            colors: ["natural"],
            thumbnail_url: "https://cdn.example.com/chair.jpg",
          }],
        };
      }
      if (text.includes("FROM ai_platform.id_interior_asset_images") || text.includes("FROM ai_platform.creative_ai_assets")) {
        return { rows: [] };
      }
      if (text.includes("UPDATE ai_platform.creative_projects")) {
        const result = JSON.parse(String(params?.[1])) as Record<string, unknown>;
        state.projectResult = { ...state.projectResult, moodboard: result };
        return { rows: [] };
      }
      throw new Error(`Unexpected query: ${text}`);
    }),
  },
}));

import { generateMoodboard, getMoodboard } from "../moodboardService.js";

const PROJECT_UUID = "00000000-0000-4000-8000-000000000099";

describe("WP-08 moodboard service", () => {
  beforeEach(() => {
    state.projectResult = {};
    state.queries.length = 0;
    state.projectExists = true;
  });

  it("uses the approved snapshot and does not mutate draft input", async () => {
    const result = await generateMoodboard(PROJECT_UUID);

    expect(result.reused).toBe(false);
    expect(result.moodboard.materials[0]?.id).toBe("MAT-JAP-01");
    expect(result.moodboard.materials[0]?.name).toBe("Japanese Oak");
    expect(result.moodboard.furniture[0]?.id).toBe("FUR-JAP-01");
    expect(result.moodboard.moodboardId).toBe(`moodboard-${PROJECT_UUID}`);
    expect(result.moodboard.referenceImages).toEqual(result.moodboard.images);
    expect(result.moodboard.status).toBe("ready");
    expect(result.moodboard.metadata.algorithmVersion).toBe("wp08.v1");
    expect(result.moodboard.metadata.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(result.moodboard.warnings).not.toContain("Material reference \"draft-material\" is not available in the active canonical library.");
  });

  it("reuses a persisted valid moodboard unless force is requested", async () => {
    const first = await generateMoodboard(PROJECT_UUID);
    const queryCountAfterFirst = state.queries.length;
    const second = await generateMoodboard(PROJECT_UUID);

    expect(second.reused).toBe(true);
    expect(second.moodboard).toEqual(first.moodboard);
    expect(state.queries.length).toBe(queryCountAfterFirst + 1);
    expect(await getMoodboard(PROJECT_UUID)).toEqual(first.moodboard);
  });

  it("is deterministic for the same source data", async () => {
    const first = await generateMoodboard(PROJECT_UUID, { force: true });
    const second = await generateMoodboard(PROJECT_UUID, { force: true });

    expect(second.moodboard).toEqual(first.moodboard);
  });

  it("preserves unrelated result keys and returns the persisted moodboard", async () => {
    state.projectResult = { existingKey: "preserved", otherNamespace: { value: 1 } };
    const generated = await generateMoodboard(PROJECT_UUID);

    expect(state.projectResult).toEqual({
      existingKey: "preserved",
      otherNamespace: { value: 1 },
      moodboard: generated.moodboard,
    });
    expect(await getMoodboard(PROJECT_UUID)).toEqual(generated.moodboard);
  });

  it("fails safely when the project does not exist", async () => {
    state.projectExists = false;

    await expect(generateMoodboard(PROJECT_UUID)).rejects.toMatchObject({
      status: 404,
      code: "PROJECT_NOT_FOUND",
    });
    await expect(getMoodboard(PROJECT_UUID)).rejects.toMatchObject({
      status: 404,
      code: "PROJECT_NOT_FOUND",
    });
  });
});