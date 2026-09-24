import { afterEach, describe, expect, it } from "vitest";
import { validateFileRedirectTarget } from "../fileRedirectPolicy.js";

const originalEnv = {
  nodeEnv: process.env["NODE_ENV"],
  publicAppUrl: process.env["PUBLIC_APP_URL"],
  allowedOrigins: process.env["ALLOWED_ORIGINS"],
  supabaseUrl: process.env["SUPABASE_URL"],
};

afterEach(() => {
  for (const [key, value] of Object.entries({
    NODE_ENV: originalEnv.nodeEnv,
    PUBLIC_APP_URL: originalEnv.publicAppUrl,
    ALLOWED_ORIGINS: originalEnv.allowedOrigins,
    SUPABASE_URL: originalEnv.supabaseUrl,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("file redirect policy", () => {
  it("allows a valid internal root-relative redirect", () => {
    expect(validateFileRedirectTarget("/storage/files/report.pdf")).toEqual({
      valid: true,
      target: "/storage/files/report.pdf",
    });
  });

  it("allows an exact trusted destination origin", () => {
    process.env["NODE_ENV"] = "production";
    process.env["PUBLIC_APP_URL"] = "https://aicore.example.test";

    expect(validateFileRedirectTarget("https://aicore.example.test/files/report.pdf")).toEqual({
      valid: true,
      target: "https://aicore.example.test/files/report.pdf",
    });
  });

  it("rejects an untrusted external destination", () => {
    expect(validateFileRedirectTarget("https://evil.example")).toMatchObject({ valid: false });
  });

  it("rejects protocol-relative redirects", () => {
    expect(validateFileRedirectTarget("//evil.example")).toMatchObject({ valid: false });
  });

  it("rejects javascript redirects", () => {
    expect(validateFileRedirectTarget("javascript:alert(1)")).toMatchObject({ valid: false });
  });

  it("rejects data, file, and unsupported schemes", () => {
    expect(validateFileRedirectTarget("data:text/html,<script>alert(1)</script>")).toMatchObject({ valid: false });
    expect(validateFileRedirectTarget("file:///etc/passwd")).toMatchObject({ valid: false });
    expect(validateFileRedirectTarget("ftp://trusted.example/file")).toMatchObject({ valid: false });
  });

  it("rejects encoded protocol-relative and backslash bypass variants", () => {
    expect(validateFileRedirectTarget("/%2f%2fevil.example")).toMatchObject({ valid: false });
    expect(validateFileRedirectTarget("%2f%2fevil.example")).toMatchObject({ valid: false });
    expect(validateFileRedirectTarget("/\\evil.example")).toMatchObject({ valid: false });
    expect(validateFileRedirectTarget("https:%2f%2fevil.example")).toMatchObject({ valid: false });
  });

  it("rejects malformed URLs and credentials in a trusted-looking URL", () => {
    expect(validateFileRedirectTarget("https://[")).toMatchObject({ valid: false });
    process.env["PUBLIC_APP_URL"] = "https://trusted.example.test";
    expect(validateFileRedirectTarget("https://evil.example@trusted.example.test/file")).toMatchObject({ valid: false });
  });

  it("does not trust a hostname suffix", () => {
    process.env["PUBLIC_APP_URL"] = "https://trusted.example.test";
    expect(validateFileRedirectTarget("https://trusted.example.test.evil.example/file")).toMatchObject({ valid: false });
  });
});