/**
 * branding-identity/routes.test.ts — Team 27
 *
 * Tests:
 *   - GET  /ai/branding/manifest
 *   - POST /ai/branding/briefs (valid + invalid)
 *   - GET  /ai/branding/briefs
 *   - GET  /ai/branding/briefs/:id
 *   - GET  /ai/branding/briefs/:id/workflow
 *   - POST /ai/branding/briefs/:id/workflow/advance
 *   - GET  /ai/branding/briefs/:id/artifacts
 *   - POST /ai/branding/briefs/:id/artifacts
 *   - GET  /ai/branding/briefs/:id/guideline
 */

import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import brandingIdentityRouter from "../routes.js";
import { _resetStore } from "../service.js";

// ── App setup ─────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());
app.use(brandingIdentityRouter);

// ── Fixtures ──────────────────────────────────────────────────────────────────

const validBody = {
  companyName:      "TestCo",
  industry:         "Retail",
  targetAudience:   "Consumers aged 20-40",
  positioning:      "Affordable premium products",
  brandPersonality: ["friendly", "reliable"],
  brandValues:      ["quality", "value"],
  tone:             ["warm", "clear"],
  preferredStyle:   "modern",
  usageChannels:    ["digital", "social"],
};

beforeEach(() => {
  _resetStore();
});

// ── GET /ai/branding/manifest ─────────────────────────────────────────────────

describe("GET /ai/branding/manifest", () => {
  it("returns 200 with plugin manifest", async () => {
    const res = await request(app).get("/ai/branding/manifest");
    expect(res.status).toBe(200);
    expect(res.body.pluginId).toBe("branding-identity");
    expect(Array.isArray(res.body.entries)).toBe(true);
    expect(res.body.entries).toHaveLength(11);
  });

  it("manifest includes requiredCount and totalCount", async () => {
    const res = await request(app).get("/ai/branding/manifest");
    expect(typeof res.body.requiredCount).toBe("number");
    expect(typeof res.body.totalCount).toBe("number");
    expect(res.body.totalCount).toBeGreaterThanOrEqual(res.body.requiredCount);
  });
});

// ── POST /ai/branding/briefs ──────────────────────────────────────────────────

describe("POST /ai/branding/briefs", () => {
  it("creates a brief and returns 201", async () => {
    const res = await request(app).post("/ai/branding/briefs").send(validBody);
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.workflow).toBeDefined();
  });

  it("returns 400 for missing required field", async () => {
    const { companyName: _, ...rest } = validBody;
    const res = await request(app).post("/ai/branding/briefs").send(rest);
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it("returns 400 for empty brandPersonality", async () => {
    const res = await request(app)
      .post("/ai/branding/briefs")
      .send({ ...validBody, brandPersonality: [] });
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid usageChannels value", async () => {
    const res = await request(app)
      .post("/ai/branding/briefs")
      .send({ ...validBody, usageChannels: ["not_a_channel"] });
    expect(res.status).toBe(400);
  });
});

// ── GET /ai/branding/briefs ───────────────────────────────────────────────────

describe("GET /ai/branding/briefs", () => {
  it("returns empty list initially", async () => {
    const res = await request(app).get("/ai/branding/briefs");
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(0);
    expect(res.body.total).toBe(0);
  });

  it("lists created briefs", async () => {
    await request(app).post("/ai/branding/briefs").send(validBody);
    await request(app).post("/ai/branding/briefs").send(validBody);
    const res = await request(app).get("/ai/branding/briefs");
    expect(res.body.total).toBe(2);
  });

  it("respects pageSize query param", async () => {
    await request(app).post("/ai/branding/briefs").send(validBody);
    await request(app).post("/ai/branding/briefs").send(validBody);
    const res = await request(app).get("/ai/branding/briefs?pageSize=1");
    expect(res.body.items).toHaveLength(1);
    expect(res.body.total).toBe(2);
  });
});

// ── GET /ai/branding/briefs/:id ───────────────────────────────────────────────

describe("GET /ai/branding/briefs/:id", () => {
  it("returns the brief", async () => {
    const create = await request(app).post("/ai/branding/briefs").send(validBody);
    const { id } = create.body;
    const res    = await request(app).get(`/ai/branding/briefs/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(id);
    expect(res.body.brief.companyName).toBe("TestCo");
  });

  it("returns 404 for unknown id", async () => {
    const res = await request(app).get("/ai/branding/briefs/unknown-id");
    expect(res.status).toBe(404);
  });
});

// ── GET /ai/branding/briefs/:id/workflow ──────────────────────────────────────

describe("GET /ai/branding/briefs/:id/workflow", () => {
  it("returns workflow and progress", async () => {
    const create = await request(app).post("/ai/branding/briefs").send(validBody);
    const { id } = create.body;
    const res    = await request(app).get(`/ai/branding/briefs/${id}/workflow`);
    expect(res.status).toBe(200);
    expect(res.body.workflow.currentStage).toBe("brand_brief");
    expect(typeof res.body.progress.percentComplete).toBe("number");
  });

  it("returns 404 for unknown id", async () => {
    const res = await request(app).get("/ai/branding/briefs/nope/workflow");
    expect(res.status).toBe(404);
  });
});

// ── POST /ai/branding/briefs/:id/workflow/advance ─────────────────────────────

describe("POST /ai/branding/briefs/:id/workflow/advance", () => {
  it("advances to next stage and returns 200", async () => {
    const create  = await request(app).post("/ai/branding/briefs").send(validBody);
    const { id }  = create.body;
    const res     = await request(app)
      .post(`/ai/branding/briefs/${id}/workflow/advance`)
      .send({ targetStage: "research" });
    expect(res.status).toBe(200);
    expect(res.body.workflow.currentStage).toBe("research");
  });

  it("returns 400 for invalid transition", async () => {
    const create  = await request(app).post("/ai/branding/briefs").send(validBody);
    const { id }  = create.body;
    const res     = await request(app)
      .post(`/ai/branding/briefs/${id}/workflow/advance`)
      .send({ targetStage: "positioning" }); // skip stages
    expect(res.status).toBe(400);
  });

  it("returns 400 for missing targetStage", async () => {
    const create  = await request(app).post("/ai/branding/briefs").send(validBody);
    const { id }  = create.body;
    const res     = await request(app)
      .post(`/ai/branding/briefs/${id}/workflow/advance`)
      .send({});
    expect(res.status).toBe(400);
  });

  it("returns 404 for unknown brief", async () => {
    const res = await request(app)
      .post("/ai/branding/briefs/nope/workflow/advance")
      .send({ targetStage: "research" });
    expect(res.status).toBe(404);
  });

  it("accepts advance with optional note", async () => {
    const create  = await request(app).post("/ai/branding/briefs").send(validBody);
    const { id }  = create.body;
    const res     = await request(app)
      .post(`/ai/branding/briefs/${id}/workflow/advance`)
      .send({ targetStage: "research", note: "Starting research" });
    expect(res.status).toBe(200);
  });
});

// ── GET /ai/branding/briefs/:id/artifacts ─────────────────────────────────────

describe("GET /ai/branding/briefs/:id/artifacts", () => {
  it("returns empty list for new brief", async () => {
    const create  = await request(app).post("/ai/branding/briefs").send(validBody);
    const { id }  = create.body;
    const res     = await request(app).get(`/ai/branding/briefs/${id}/artifacts`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(0);
    expect(res.body.total).toBe(0);
  });

  it("returns 404 for unknown brief", async () => {
    const res = await request(app).get("/ai/branding/briefs/nope/artifacts");
    expect(res.status).toBe(404);
  });
});

// ── POST /ai/branding/briefs/:id/artifacts ────────────────────────────────────

describe("POST /ai/branding/briefs/:id/artifacts", () => {
  it("registers artifact and returns 201", async () => {
    const create  = await request(app).post("/ai/branding/briefs").send(validBody);
    const { id }  = create.body;
    const res     = await request(app)
      .post(`/ai/branding/briefs/${id}/artifacts`)
      .send({
        artifactType: "brand_strategy",
        title:        "Core Strategy Document",
        stage:        "brand_strategy",
      });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.briefId).toBe(id);
  });

  it("returns 400 for invalid artifact type", async () => {
    const create  = await request(app).post("/ai/branding/briefs").send(validBody);
    const { id }  = create.body;
    const res     = await request(app)
      .post(`/ai/branding/briefs/${id}/artifacts`)
      .send({
        artifactType: "invalid_type",
        title:        "Test",
        stage:        "brand_brief",
      });
    expect(res.status).toBe(400);
  });

  it("returns 404 for unknown brief", async () => {
    const res = await request(app)
      .post("/ai/branding/briefs/nope/artifacts")
      .send({
        artifactType: "brand_strategy",
        title:        "Test",
        stage:        "brand_strategy",
      });
    expect(res.status).toBe(404);
  });
});

// ── GET /ai/branding/briefs/:id/guideline ─────────────────────────────────────

describe("GET /ai/branding/briefs/:id/guideline", () => {
  it("returns export readiness check", async () => {
    const create  = await request(app).post("/ai/branding/briefs").send(validBody);
    const { id }  = create.body;
    const res     = await request(app).get(`/ai/branding/briefs/${id}/guideline`);
    expect(res.status).toBe(200);
    expect(typeof res.body.canExport).toBe("boolean");
    expect(Array.isArray(res.body.missingArtifacts)).toBe(true);
    expect(res.body.companyName).toBe("TestCo");
  });

  it("returns canExport:false for brief with no artifacts", async () => {
    const create  = await request(app).post("/ai/branding/briefs").send(validBody);
    const { id }  = create.body;
    const res     = await request(app).get(`/ai/branding/briefs/${id}/guideline`);
    expect(res.body.canExport).toBe(false);
  });

  it("returns 404 for unknown brief", async () => {
    const res = await request(app).get("/ai/branding/briefs/nope/guideline");
    expect(res.status).toBe(404);
  });
});
