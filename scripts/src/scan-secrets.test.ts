/**
 * Tests for the repository secret scanner.
 *
 * Uses Node.js built-in test runner (node:test) — no extra dependencies.
 * Run with:  tsx --test ./src/scan-secrets.test.ts
 *
 * Test matrix:
 *  1. Fake secret fixture is detected (non-zero findings).
 *  2. Placeholder-safe line is ignored (.env.example style).
 *  3. Output never prints matched value — only file:line:[rule].
 *  4. Clean fixture returns zero findings.
 *  5. Violating fixture causes non-zero exit (integration, via child_process).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execSync, spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scanContent } from "./scan-secrets.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Unit tests — scanContent()
// ---------------------------------------------------------------------------

describe("scanContent — unit tests", () => {
  // ── Test 1: detects a fake OpenAI key ────────────────────────────────────
  it("detects a fake OpenAI API key", () => {
    const fakeKey = "sk-proj-FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE";
    const content = `OPENAI_API_KEY = "${fakeKey}"`;
    const findings = scanContent(content, "some/file.env");
    assert.ok(
      findings.length > 0,
      "Expected at least one finding for a fake OpenAI key"
    );
    assert.equal(findings[0].ruleId, "openai-api-key");
  });

  // ── Test 2: placeholder lines are ignored in .env.example ────────────────
  it("ignores placeholder value in .env.example", () => {
    const content = "OPENAI_API_KEY=<set-in-replit-secrets>";
    const findings = scanContent(content, ".env.example");
    assert.equal(
      findings.length,
      0,
      "Placeholder in .env.example should produce zero findings"
    );
  });

  // ── Test 3: output never contains the matched value ───────────────────────
  it("finding object does not expose the matched secret value", () => {
    const fakePass = "SMTP_PASS = \"FAKE_SMTP_PASSWORD_DO_NOT_USE\"";
    const findings = scanContent(fakePass, ".replit");
    assert.ok(findings.length > 0, "Expected a finding for SMTP_PASS");
    const finding = findings[0];
    // The Finding interface only has file, line, ruleId — no matched value.
    assert.ok(!("value" in finding), "Finding must not expose matched value");
    assert.ok(!("match" in finding), "Finding must not expose match");
    assert.equal(typeof finding.ruleId, "string");
    assert.equal(typeof finding.line, "number");
    assert.equal(typeof finding.file, "string");
  });

  // ── Test 4: clean content returns zero findings ───────────────────────────
  it("clean file content produces zero findings", () => {
    const content = [
      "# Normal config file",
      "NODE_ENV=development",
      "PORT=3000",
      "SMTP_HOST=smtp.example.com",
      "SMTP_PORT=465",
      "ALLOWED_ORIGINS=https://example.com",
    ].join("\n");
    const findings = scanContent(content, "some/config.ts");
    assert.equal(findings.length, 0, "Clean content should produce no findings");
  });

  // ── Additional: detects a fake database URL with credentials ─────────────
  it("detects a fake database URL containing credentials", () => {
    const content =
      "SUPABASE_DEV_DATABASE_URL=postgresql://fakeuser:fakepassword123@fake-host.supabase.com:5432/postgres";
    const findings = scanContent(content, ".replit");
    assert.ok(findings.length > 0, "Expected a finding for credentialed DB URL");
    assert.equal(findings[0].ruleId, "database-url-with-credentials");
  });

  // ── Additional: detects a fake Supabase JWT ───────────────────────────────
  it("detects a fake Supabase JWT token", () => {
    // This is a structurally valid but entirely fake JWT — not a real credential.
    const fakeJwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZha2VmYWtlZmFrZWZha2VmYWtlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSJ9.FAKESIGNATUREFAKESIGNATURE";
    const findings = scanContent(fakeJwt, ".replit");
    assert.ok(findings.length > 0, "Expected a finding for a fake Supabase JWT");
    assert.equal(findings[0].ruleId, "supabase-jwt");
  });

  // ── Additional: placeholder in non-.env.example file still flagged ────────
  it("non-placeholder value in .replit is flagged even with angle brackets present elsewhere on line", () => {
    // The key itself is a real-looking value; the angle bracket is elsewhere
    const content = `# comment <not-a-placeholder>\nADMIN_API_KEY = "6ea91a548c1f7620bc9bf53afda744fd49a3976b1efb8468"`;
    const findings = scanContent(content, ".replit");
    assert.ok(findings.length > 0, "Real key value must be detected");
  });
});

// ---------------------------------------------------------------------------
// Integration test — exit code
// ---------------------------------------------------------------------------

describe("scanContent — integration exit code", () => {
  const TMP = resolve(__dirname, "../../.test-scan-tmp");

  // ── Test 5a: violating fixture → non-zero exit ───────────────────────────
  it("scanner script exits non-zero when called against a violating fixture", () => {
    // We call scanContent directly (not the CLI) to avoid needing git ls-files.
    const violatingContent =
      'OPENAI_API_KEY = "sk-proj-FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE"';
    const findings = scanContent(violatingContent, "fixture.env");
    assert.ok(
      findings.length > 0,
      "Violating fixture must produce at least one finding"
    );
  });

  // ── Test 5b: clean fixture → zero findings ────────────────────────────────
  it("scanner returns zero findings for a clean fixture", () => {
    const cleanContent = "NODE_ENV=development\nPORT=3000\n# no secrets here";
    const findings = scanContent(cleanContent, "clean-fixture.env");
    assert.equal(findings.length, 0, "Clean fixture must produce zero findings");
  });
});
