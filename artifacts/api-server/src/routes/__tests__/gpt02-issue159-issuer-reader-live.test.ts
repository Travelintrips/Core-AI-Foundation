import express from "express";
import request from "supertest";
import { existsSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../middleware/adminAuth.js", () => ({
  requireAdminApiKey: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import router from "../gpt02-issue159-issuer-reader.js";

const socketPath = "/run/gpt02-issuer-reader/reader.sock";
const app = express();
app.use(router);

describe.skipIf(!existsSync(socketPath))(
  "GPT02 Issue159 live issuer-reader API to systemd socket integration",
  () => {
    afterEach(() => vi.unstubAllEnvs());

    it("reads live native reader health through the restricted Unix socket", async () => {
      vi.stubEnv("GPT02_ISSUER_READER_SOCKET_GID", "999");
      const response = await request(app)
        .get("/internal/gpt02/issue159/issuer-reader/health");
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        ok: true,
        environment: "DEV",
        reader: "gpt02_issuer_evidence_reader",
        authenticationVerified: true,
        tlsVerified: true,
        clientTlsVerified: true,
        backendTlsVerified: false,
        readOnlySessionVerified: true,
        businessEvidenceRead: false,
        persistedTrustedReadProven: false,
        signingPermitted: false,
        authorizationGranted: false,
        dispatchPermitted: false,
        releaseDecision: "NO_GO",
      });
    }, 15_000);
  },
);
