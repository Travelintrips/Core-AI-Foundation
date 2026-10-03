import { describe, expect, it } from "vitest";
import express from "express";
import cors from "cors";
import request from "supertest";
import { oauthNavigationCors } from "../oauthNavigationCors.js";

function makeApp() {
  const app = express();
  app.use(oauthNavigationCors(cors({
    origin(origin, callback) {
      if (!origin || origin === "https://aicore.cstlogistic.co.id") {
        callback(null, true);
      } else {
        callback(new Error("Origin not allowed"));
      }
    },
    credentials: true,
  })));
  app.use(express.urlencoded({ extended: true }));
  app.post("/api/ai/core-chat/oauth/authorize", (req, res) => {
    if (req.body.response_type !== "code") {
      res.status(400).json({ error: "unsupported_response_type" });
      return;
    }
    res.redirect(302, "/pairing");
  });
  app.get("/api/ai/core-chat/oauth/authorize", (_req, res) => res.send("Consent"));
  app.post("/api/ai/core-chat/oauth/token", (_req, res) => res.sendStatus(200));
  return app;
}

describe("OAuth browser navigation CORS", () => {
  it.each(["null", "https://chatgpt.com"])(
    "allows consent form navigation with Origin %s without granting CORS access",
    async (origin) => {
      const res = await request(makeApp())
        .post("/api/ai/core-chat/oauth/authorize")
        .set("Origin", origin).type("form").send({ response_type: "code" });
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe("/pairing");
      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
      expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
    },
  );

  it("still reaches OAuth request validation for an opaque-origin form", async () => {
    const res = await request(makeApp()).post("/api/ai/core-chat/oauth/authorize")
      .set("Origin", "null").type("form").send({ response_type: "token" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("unsupported_response_type");
  });

  it("allows GET consent navigation", async () => {
    const res = await request(makeApp()).get("/api/ai/core-chat/oauth/authorize")
      .set("Origin", "null");
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("keeps token API CORS restrictions", async () => {
    const res = await request(makeApp()).post("/api/ai/core-chat/oauth/token")
      .set("Origin", "https://chatgpt.com");
    expect(res.status).toBe(500);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("keeps trusted-origin token API access", async () => {
    const res = await request(makeApp()).post("/api/ai/core-chat/oauth/token")
      .set("Origin", "https://aicore.cstlogistic.co.id");
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("https://aicore.cstlogistic.co.id");
  });

  it("does not exempt cross-origin preflight requests", async () => {
    const res = await request(makeApp()).options("/api/ai/core-chat/oauth/authorize")
      .set("Origin", "https://chatgpt.com")
      .set("Access-Control-Request-Method", "POST");
    expect(res.status).toBe(500);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
