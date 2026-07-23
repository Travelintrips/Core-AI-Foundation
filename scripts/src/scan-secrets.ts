#!/usr/bin/env tsx
/**
 * Repository secret scanner.
 *
 * Scans all git-tracked files for likely secrets / credentials.
 * Prints: <file>:<line>: [<rule-id>]   — NEVER prints matched values.
 * Exit 0 = clean repository.
 * Exit 1 = one or more secrets detected.
 *
 * Safe placeholders in .env.example (e.g. <set-in-replit-secrets>) are ignored.
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Rule definitions
// ---------------------------------------------------------------------------

export interface Rule {
  id: string;
  /** Pattern that signals a potential secret on a line. */
  pattern: RegExp;
  /**
   * If present AND the line also matches this pattern, the finding is
   * suppressed (used to allow safe placeholder lines).
   */
  allowIfMatches?: RegExp;
}

/** Matches any placeholder value like <set-in-replit-secrets> or <your-key-here>. */
const PLACEHOLDER = /<[a-z][a-z0-9\-_]*>/i;

export const RULES: Rule[] = [
  // ── AI provider API keys ──────────────────────────────────────────────────
  {
    id: "openai-api-key",
    // sk-proj-... or sk-<alpha>-... style
    pattern: /sk-(?:proj|[a-zA-Z0-9]{1,10})-[A-Za-z0-9_\-]{20,}/,
  },
  {
    id: "anthropic-api-key",
    pattern: /sk-ant-api\d+-[A-Za-z0-9_\-]{20,}/,
  },
  {
    id: "google-ai-api-key",
    // AIzaSy… (39 chars total)
    pattern: /AIzaSy[A-Za-z0-9_\-]{33}/,
  },
  {
    id: "replicate-api-token",
    // r8_ followed by 20+ alphanum chars
    pattern: /r8_[A-Za-z0-9]{20,}/,
  },
  {
    id: "generic-short-api-key",
    // Bare assignment of a 20-40 char alphanumeric string to a *_KEY or *_TOKEN variable
    // Catches Mistral, Cohere, Fonnte, etc.
    pattern:
      /(?:MISTRAL|COHERE|FONNTE)_(?:API_KEY|API_TOKEN|TOKEN)\s*[=:]\s*["']?(?!<)[A-Za-z0-9_\-+/]{16,}/,
    allowIfMatches: PLACEHOLDER,
  },

  // ── Database URLs with embedded credentials ───────────────────────────────
  {
    id: "database-url-with-credentials",
    // postgresql://user:pass@ — but NOT placeholder passwords
    pattern: /(?:postgresql|postgres|mysql|mongodb(?:\+srv)?):\/\/[^:@\s]+:[^@\s<>]{4,}@/,
    allowIfMatches: PLACEHOLDER,
  },

  // ── Supabase JWTs (anon key or service_role key) ──────────────────────────
  {
    id: "supabase-jwt",
    // All Supabase project JWTs start with this fixed header
    pattern:
      /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_\-]{40,}/,
  },

  // ── SMTP password ─────────────────────────────────────────────────────────
  {
    id: "smtp-password-assignment",
    pattern: /SMTP_PASS\s*[=:]\s*["']?(?!<)[^\s"'<>]{4,}/,
    allowIfMatches: PLACEHOLDER,
  },

  // ── Admin / session secrets ───────────────────────────────────────────────
  {
    id: "admin-api-key-assignment",
    // Hex string ≥ 20 chars assigned to ADMIN_API_KEY
    pattern: /ADMIN_API_KEY\s*[=:]\s*["']?(?!<)[a-fA-F0-9]{20,}/,
    allowIfMatches: PLACEHOLDER,
  },
  {
    id: "session-secret-assignment",
    pattern: /SESSION_SECRET\s*[=:]\s*["']?(?!<)[^\s"'<>]{16,}/,
    allowIfMatches: PLACEHOLDER,
  },

  // ── Generic secret variable assignment ───────────────────────────────────
  {
    id: "generic-secret-assignment",
    // *_SECRET or *_PASSWORD or *_TOKEN assigned a non-placeholder value
    pattern:
      /(?:_SECRET|_PASSWORD|_PASSWD|_TOKEN)\s*[=:]\s*["']?(?!<)[^\s"'<>]{8,}/,
    allowIfMatches: PLACEHOLDER,
  },

  // ── Private key blocks ────────────────────────────────────────────────────
  {
    id: "private-key-block",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
  },
];

// ---------------------------------------------------------------------------
// Core scanning logic (exported for tests)
// ---------------------------------------------------------------------------

export interface Finding {
  file: string;
  line: number;
  ruleId: string;
}

/** Files whose placeholder lines are always safe to skip. */
const PLACEHOLDER_SAFE_FILES = new Set([".env.example"]);

/** File extensions that are always binary — skip content scanning. */
const BINARY_EXT =
  /\.(png|jpe?g|gif|ico|webp|svg|woff2?|ttf|eot|otf|pdf|zip|tar|gz|bz2|br|bin|map|wasm|db|sqlite)$/i;

/**
 * Scan the content of a single file and return all findings.
 * `filePath` is used only for placeholder-safe-file lookup (not for I/O).
 */
export function scanContent(content: string, filePath: string): Finding[] {
  const findings: Finding[] = [];
  const isPlaceholderSafe = PLACEHOLDER_SAFE_FILES.has(filePath);
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    for (const rule of RULES) {
      if (!rule.pattern.test(line)) continue;

      // If the line contains a placeholder AND the rule allows that, skip.
      if (rule.allowIfMatches && rule.allowIfMatches.test(line)) continue;

      // For placeholder-safe files (.env.example), also suppress if the line
      // contains any <…> placeholder marker.
      if (isPlaceholderSafe && PLACEHOLDER.test(line)) continue;

      findings.push({ file: filePath, line: lineNum, ruleId: rule.id });
      break; // one finding per line is enough
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Main entrypoint (only runs when executed directly, not when imported)
// ---------------------------------------------------------------------------

function getTrackedFiles(): string[] {
  const out = execSync("git ls-files", { encoding: "utf8" });
  return out.trim().split("\n").filter(Boolean);
}

function main(): void {
  const repoRoot = resolve(import.meta.dirname ?? process.cwd(), "../../");
  const files = getTrackedFiles();
  let totalFindings = 0;

  for (const relPath of files) {
    if (BINARY_EXT.test(relPath)) continue;

    let content: string;
    try {
      content = readFileSync(resolve(repoRoot, relPath), "utf8");
    } catch {
      // Unreadable file — skip silently
      continue;
    }

    const findings = scanContent(content, relPath);
    for (const f of findings) {
      // Print location + rule only — never the matched value
      process.stdout.write(`${f.file}:${f.line}: [${f.ruleId}]\n`);
      totalFindings++;
    }
  }

  if (totalFindings > 0) {
    process.stderr.write(
      `\nFAIL: ${totalFindings} potential secret(s) found in tracked files.\n` +
        `Remove them and store credentials in Replit Secrets instead.\n`
    );
    process.exit(1);
  } else {
    process.stdout.write(
      "PASS: No secrets detected in tracked files.\n"
    );
    process.exit(0);
  }
}

main();
