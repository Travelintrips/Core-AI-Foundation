import { afterEach, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { globalLimiter, isDevDedicatedLoginRoute, loginLimiter } from "../rateLimiter.js";

const originalUrl = process.env["PUBLIC_APP_URL"];
const originalAdminKey = process.env["ADMIN_API_KEY"];
afterEach(() => {
  if (originalUrl === undefined) delete process.env["PUBLIC_APP_URL"];
  else process.env["PUBLIC_APP_URL"] = originalUrl;
  if (originalAdminKey === undefined) delete process.env["ADMIN_API_KEY"];
  else process.env["ADMIN_API_KEY"] = originalAdminKey;
});
describe("isolated DEV login global-rate-bucket exemption", () => {
  it("accepts only the six exact loginLimiter-protected paths and HTTP methods", () => {
    process.env["PUBLIC_APP_URL"] = "https://dev.cstlogistic.co.id/";
    const paths = [
      ["POST", "/internal/auth/login"],
      ["POST", "/internal/auth/dev-login"],
      ["POST", "/internal/auth/request-magic-link"],
      ["GET", "/internal/auth/magic-login"],
      ["POST", "/internal/auth/request-password-reset"],
      ["POST", "/internal/auth/reset-password"],
    ] as const;
    for (const [method, path] of paths) {
      expect(isDevDedicatedLoginRoute({ method, path })).toBe(true);
      expect(isDevDedicatedLoginRoute({ method: method === "GET" ? "POST" : "GET", path })).toBe(false);
      expect(isDevDedicatedLoginRoute({ method, path: path + "/other" })).toBe(false);
    }
    for (const path of ["/internal/auth/me", "/internal/auth/users", "/internal/auth/email-diagnostics", "/internal/auth/logout", "/internal/auth/change-password", "/payments"]) {
      expect(isDevDedicatedLoginRoute({ method: "POST", path })).toBe(false);
    }
  });
  it("does not exempt login routes in PROD or another DEV domain", () => {
    for (const url of ["https://aicore.cstlogistic.co.id", "https://other-dev.example", ""]) {
      process.env["PUBLIC_APP_URL"] = url;
      expect(isDevDedicatedLoginRoute({ method: "POST", path: "/internal/auth/login" })).toBe(false);
      expect(isDevDedicatedLoginRoute({ method: "POST", path: "/internal/auth/request-magic-link" })).toBe(false);
    }
  });
  it("keeps the standalone login attempt limiter active", async () => {
    process.env["PUBLIC_APP_URL"] = "https://dev.cstlogistic.co.id";
    process.env["ADMIN_API_KEY"] = "test-nonmatching-key";
    const app = express();
    app.set("trust proxy", 1);
    app.use("/api", globalLimiter);
    app.post("/api/internal/auth/login", loginLimiter, (_req, res) => res.json({ accepted: true }));
    const client = request.agent(app);
    for (let i = 0; i < 8; i++) {
      expect((await client.post("/api/internal/auth/login")).status).toBe(200);
    }
    const denied = await client.post("/api/internal/auth/login");
    expect(denied.status).toBe(429);
    expect(denied.body.code).toBe("RATE_LIMIT_EXCEEDED");
  });
});
