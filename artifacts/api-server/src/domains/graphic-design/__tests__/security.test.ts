/**
 * security.test.ts — Graphic Design Domain Security Tests (Team 15)
 *
 * Covers per Global Remediation Rules:
 *  - unauthorized requests (missing / wrong admin key)
 *  - IDOR: tenantId must come from header, never body
 *  - malformed payload
 *  - invalid enum values (serviceCode, tier)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import express, { type Application } from "express";
import request from "supertest";
import { graphicDesignRouter } from "../index.js";

// ── App factory ───────────────────────────────────────────────────────────────

function makeApp(): Application {
  const app = express();
  app.use(express.json());
  app.use(graphicDesignRouter);
  return app;
}

const VALID_ADMIN_KEY = "test-admin-secret-key-123";
const WRONG_ADMIN_KEY = "wrong-key";

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.stubEnv("ADMIN_API_KEY", VALID_ADMIN_KEY);
});

// ── POST /ai/graphic-design/manifest/build — auth & IDOR ─────────────────────

const VALID_BUILD_BODY = {
  gdRequestId: 1,
  serviceCode: "logo",
  packageTier: "professional",
  producedFiles: [{ fileName: "logo-primary.svg" }],
  qcSummary: { score: 80, passed: true, warnings: [] },
};

describe("POST /ai/graphic-design/manifest/build — authentication", () => {
  it("returns 401 when x-admin-api-key header is missing", async () => {
    const res = await request(makeApp())
      .post("/ai/graphic-design/manifest/build")
      .set("x-tenant-id", "tenant-a")
      .send(VALID_BUILD_BODY);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/unauthorized/i);
  });

  it("returns 401 when x-admin-api-key is wrong", async () => {
    const res = await request(makeApp())
      .post("/ai/graphic-design/manifest/build")
      .set("x-admin-api-key", WRONG_ADMIN_KEY)
      .set("x-tenant-id", "tenant-a")
      .send(VALID_BUILD_BODY);
    expect(res.status).toBe(401);
  });

  it("returns 400 when admin key is correct but x-tenant-id header is missing (IDOR guard)", async () => {
    const res = await request(makeApp())
      .post("/ai/graphic-design/manifest/build")
      .set("x-admin-api-key", VALID_ADMIN_KEY)
      // no x-tenant-id header
      .send(VALID_BUILD_BODY);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/x-tenant-id/i);
  });

  it("ignores tenantId in request body — uses x-tenant-id header instead", async () => {
    const bodyWithTenant = { ...VALID_BUILD_BODY, tenantId: "attacker-tenant" };
    const res = await request(makeApp())
      .post("/ai/graphic-design/manifest/build")
      .set("x-admin-api-key", VALID_ADMIN_KEY)
      .set("x-tenant-id", "real-tenant")
      .send(bodyWithTenant);
    // Should succeed (200) — tenantId from body is ignored, not an error
    expect(res.status).toBe(200);
    // Manifest tenantId must reflect the header value, not the body value
    expect(res.body.tenantId).toBe("real-tenant");
  });

  it("succeeds with valid key, valid header, valid body", async () => {
    const res = await request(makeApp())
      .post("/ai/graphic-design/manifest/build")
      .set("x-admin-api-key", VALID_ADMIN_KEY)
      .set("x-tenant-id", "tenant-a")
      .send(VALID_BUILD_BODY);
    expect(res.status).toBe(200);
    expect(res.body.serviceCode).toBe("logo");
  });
});

describe("POST /ai/graphic-design/manifest/build — malformed payload", () => {
  const authed = () =>
    request(makeApp())
      .post("/ai/graphic-design/manifest/build")
      .set("x-admin-api-key", VALID_ADMIN_KEY)
      .set("x-tenant-id", "tenant-a");

  it("rejects missing gdRequestId", async () => {
    const { gdRequestId: _, ...rest } = VALID_BUILD_BODY;
    const res = await authed().send(rest);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/gdRequestId/i);
  });

  it("rejects string gdRequestId (must be number)", async () => {
    const res = await authed().send({ ...VALID_BUILD_BODY, gdRequestId: "1" });
    expect(res.status).toBe(400);
  });

  it("rejects invalid serviceCode", async () => {
    const res = await authed().send({ ...VALID_BUILD_BODY, serviceCode: "invalid-service" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/serviceCode/i);
  });

  it("rejects invalid packageTier", async () => {
    const res = await authed().send({ ...VALID_BUILD_BODY, packageTier: "diamond" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/packageTier/i);
  });

  it("rejects producedFiles as non-array", async () => {
    const res = await authed().send({ ...VALID_BUILD_BODY, producedFiles: "file.pdf" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/producedFiles/i);
  });

  it("rejects qcSummary as non-object", async () => {
    const res = await authed().send({ ...VALID_BUILD_BODY, qcSummary: "pass" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/qcSummary/i);
  });

  it("rejects entirely empty body", async () => {
    const res = await authed().send({});
    expect(res.status).toBe(400);
  });
});

// ── POST /ai/graphic-design/qc/score — auth ───────────────────────────────────

const VALID_QC_BODY = {
  serviceCode: "logo",
  packageTier: "professional",
  generationReport: {
    briefCompleteness: 0.9,
    printSpecValid: true,
    outputWidthMm: null,
    outputHeightMm: null,
    outputDpi: null,
    outputColorMode: null,
    bleedPresent: null,
    safeAreaRespected: null,
    textOverflowDetected: false,
    producedFileCount: 6,
  },
};

describe("POST /ai/graphic-design/qc/score — authentication", () => {
  it("returns 401 when x-admin-api-key header is missing", async () => {
    const res = await request(makeApp())
      .post("/ai/graphic-design/qc/score")
      .send(VALID_QC_BODY);
    expect(res.status).toBe(401);
  });

  it("returns 401 when x-admin-api-key is wrong", async () => {
    const res = await request(makeApp())
      .post("/ai/graphic-design/qc/score")
      .set("x-admin-api-key", WRONG_ADMIN_KEY)
      .send(VALID_QC_BODY);
    expect(res.status).toBe(401);
  });

  it("succeeds with valid key and valid body", async () => {
    const res = await request(makeApp())
      .post("/ai/graphic-design/qc/score")
      .set("x-admin-api-key", VALID_ADMIN_KEY)
      .send(VALID_QC_BODY);
    expect(res.status).toBe(200);
    expect(typeof res.body.qcScore).toBe("number");
    expect(typeof res.body.passed).toBe("boolean");
  });
});

describe("POST /ai/graphic-design/qc/score — malformed payload", () => {
  const authed = () =>
    request(makeApp())
      .post("/ai/graphic-design/qc/score")
      .set("x-admin-api-key", VALID_ADMIN_KEY);

  it("rejects missing generationReport", async () => {
    const res = await authed().send({ serviceCode: "logo", packageTier: "professional" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/generationReport/i);
  });

  it("rejects invalid serviceCode", async () => {
    const res = await authed().send({ ...VALID_QC_BODY, serviceCode: "banner-xl" });
    expect(res.status).toBe(400);
  });

  it("rejects invalid packageTier", async () => {
    const res = await authed().send({ ...VALID_QC_BODY, packageTier: "free" });
    expect(res.status).toBe(400);
  });
});

// ── Public routes — no auth needed, invalid param handling ───────────────────

describe("GET /ai/graphic-design/services/:serviceCode — invalid params", () => {
  it("returns 400 for unknown service code", async () => {
    const res = await request(makeApp()).get("/ai/graphic-design/services/unknown-code");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unknown service/i);
  });

  it("returns 200 for valid service code", async () => {
    const res = await request(makeApp()).get("/ai/graphic-design/services/logo");
    expect(res.status).toBe(200);
    expect(res.body.code).toBe("logo");
  });
});

describe("GET /ai/graphic-design/print-spec/:serviceCode — invalid params", () => {
  it("returns 400 for unknown service code", async () => {
    const res = await request(makeApp()).get("/ai/graphic-design/print-spec/fake");
    expect(res.status).toBe(400);
  });
});

describe("POST /ai/graphic-design/brief/score — malformed payload", () => {
  it("returns 400 when serviceCode is missing", async () => {
    const res = await request(makeApp())
      .post("/ai/graphic-design/brief/score")
      .send({ briefJson: { gdProjectName: "Test" } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/serviceCode/i);
  });

  it("returns 400 when briefJson is not an object", async () => {
    const res = await request(makeApp())
      .post("/ai/graphic-design/brief/score")
      .send({ serviceCode: "logo", briefJson: "not-an-object" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/briefJson/i);
  });

  it("returns 400 when body is empty", async () => {
    const res = await request(makeApp())
      .post("/ai/graphic-design/brief/score")
      .send({});
    expect(res.status).toBe(400);
  });
});

describe("GET /ai/graphic-design/packages/:tier/:serviceCode — invalid params", () => {
  it("returns 400 for unknown tier", async () => {
    const res = await request(makeApp()).get("/ai/graphic-design/packages/vip/logo");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/tier/i);
  });

  it("returns 400 for unknown serviceCode", async () => {
    const res = await request(makeApp()).get("/ai/graphic-design/packages/starter/unicorn");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/service/i);
  });

  it("returns 200 for valid tier × service", async () => {
    const res = await request(makeApp()).get("/ai/graphic-design/packages/starter/logo");
    expect(res.status).toBe(200);
    expect(res.body.policy).toBeDefined();
  });
});

describe("GET /ai/graphic-design/manifest/:serviceCode/:tier — invalid params", () => {
  it("returns 400 for unknown service", async () => {
    const res = await request(makeApp()).get("/ai/graphic-design/manifest/brochure-xl/starter");
    expect(res.status).toBe(400);
  });

  it("returns 400 for unknown tier", async () => {
    const res = await request(makeApp()).get("/ai/graphic-design/manifest/logo/premium");
    expect(res.status).toBe(400);
  });
});
