import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminApiKey: vi.fn((_req: unknown, _res: unknown, next: () => void) => next()),
  health: vi.fn(),
}));

vi.mock("../../middleware/adminAuth.js", () => ({
  requireAdminApiKey: mocks.requireAdminApiKey,
}));

vi.mock("../../services/gpt02Issue159IssuerReaderSocketClient.js", () => ({
  readGpt02Issue159IssuerReaderSocketHealth: mocks.health,
}));

import router from "../gpt02-issue159-issuer-reader.js";

const app = express();
app.use(router);

describe("GPT02 Issue159 issuer-reader admin health route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminApiKey.mockImplementation((_req, _res, next) => next());
    mocks.health.mockResolvedValue({
      environment: "DEV",
      nativeRoleAuthenticated: true,
      tlsVerified: true,
      readOnlySessionVerified: true,
      businessEvidenceRead: false,
      persistedTrustedReadProven: false,
      signingPermitted: false,
      authorizationGranted: false,
      dispatchPermitted: false,
      releaseDecision: "NO_GO",
    });
  });

  it("returns only native read-only health and keeps all authority disabled", async () => {
    const response = await request(app)
      .get("/internal/gpt02/issue159/issuer-reader/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      environment: "DEV",
      reader: "gpt02_issuer_evidence_reader",
      authenticationVerified: true,
      tlsVerified: true,
      readOnlySessionVerified: true,
      businessEvidenceRead: false,
      persistedTrustedReadProven: false,
      signingPermitted: false,
      authorizationGranted: false,
      dispatchPermitted: false,
      releaseDecision: "NO_GO",
    });
    expect(mocks.requireAdminApiKey).toHaveBeenCalledTimes(1);
    expect(mocks.health).toHaveBeenCalledTimes(1);
  });

  it("fails closed and returns no credential or database details when the socket is unavailable", async () => {
    mocks.health.mockRejectedValue(new Error("PRIVATE_DSN_MUST_NOT_LEAK"));
    const response = await request(app)
      .get("/internal/gpt02/issue159/issuer-reader/health");
    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      ok: false,
      environment: "DEV",
      reason: "ISSUER_READER_RUNTIME_UNAVAILABLE",
      authenticationVerified: false,
      tlsVerified: false,
      readOnlySessionVerified: false,
      businessEvidenceRead: false,
      persistedTrustedReadProven: false,
      signingPermitted: false,
      authorizationGranted: false,
      dispatchPermitted: false,
      releaseDecision: "NO_GO",
    });
    expect(JSON.stringify(response.body)).not.toContain("PRIVATE_DSN_MUST_NOT_LEAK");
  });

  it("keeps the route admin-gated", async () => {
    const source = await import("node:fs/promises");
    const routeSource = await source.readFile(
      new URL("../gpt02-issue159-issuer-reader.ts", import.meta.url),
      "utf8",
    );
    expect(routeSource).toContain("requireAdminApiKey");
    expect(routeSource).toContain('"/internal/gpt02/issue159/issuer-reader/health"');
  });
});
