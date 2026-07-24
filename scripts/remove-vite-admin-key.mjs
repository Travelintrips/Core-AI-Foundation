#!/usr/bin/env node
/**
 * Comprehensive removal of VITE_ADMIN_API_KEY and x-admin-api-key from frontend.
 *
 * Strategy per line:
 *   REMOVE whole line if it is:
 *     - A const/let/var declaration containing VITE_ADMIN_API_KEY
 *     - A const ADMIN_HEADERS = { "x-admin-api-key": ... } declaration
 *     - A standalone "x-admin-api-key": value, property line
 *     - A standalone ...(X ? { "x-admin-api-key": X } : {}), spread line
 *     - An if (X) headers["x-admin-api-key"] = X; assignment line
 *     - A stale comment mentioning VITE_ADMIN_API_KEY in auth context
 *   INLINE replace on lines that also contain other content:
 *     - Remove "x-admin-api-key": X, inline property
 *     - Remove ...(X ? { "x-admin-api-key": X } : {}), inline spread
 *     - Remove headers: { "x-admin-api-key": import.meta.env... }, inline
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative, extname } from "node:path";

// Matches any const/let/var declaration that reads VITE_ADMIN_API_KEY
const DECL_VITE = /\bimport\.meta\.env(?:\??\.VITE_ADMIN_API_KEY|\??\[["']VITE_ADMIN_API_KEY["']\]|\s*as\s+any\)\.env\??\.\[?"VITE_ADMIN_API_KEY"?\])/;

function isWholeLineRemoval(line) {
  const t = line.trim();

  // Variable declaration reading VITE_ADMIN_API_KEY
  if (/^(?:export\s+)?(?:const|let|var)\s+/.test(t) && DECL_VITE.test(t)) return true;

  // const ADMIN_HEADERS = { "x-admin-api-key": ... }
  if (/^(?:export\s+)?(?:const|let|var)\s+ADMIN_HEADERS\s*=\s*\{/.test(t) && /[xX]-[aA]dmin-[aA]pi-[kK]ey/.test(t)) return true;

  // Standalone property: "x-admin-api-key": ...,
  if (/^["'][xX]-[aA]dmin-[aA]pi-[kK]ey["']\s*:/.test(t)) return true;

  // Standalone spread: ...(X ? { "x-admin-api-key": X } : {}),
  if (/^\.\.\.\(/.test(t) && /[xX]-[aA]dmin-[aA]pi-[kK]ey/.test(t)) return true;

  // if (X) headers["x-admin-api-key"] = X;
  if (/^if\s*\(/.test(t) && /[xX]-[aA]dmin-[aA]pi-[kK]ey/.test(t)) return true;

  // Stale auth comment lines
  if (/^\*\s*Auth:\s*VITE_ADMIN_API_KEY/.test(t)) return true;
  if (/^\*\s*All requests are admin-authenticated via VITE_ADMIN_API_KEY/.test(t)) return true;
  if (/^\*\s*x-admin-api-key pattern\./.test(t)) return true;

  return false;
}

// Inline replacements — applied when line is NOT wholly removed
const INLINE_PATTERNS = [
  // ...(X ? { "x-admin-api-key": X } : {}), — inside a larger expression
  [/\.\.\.\(\s*(?:[a-zA-Z_$][a-zA-Z0-9_$]*)\s*\?\s*\{\s*["'][xX]-[aA]dmin-[aA]pi-[kK]ey["']\s*:\s*[a-zA-Z_$][a-zA-Z0-9_$]*\s*\}\s*:\s*\{\s*\}\s*\)\s*,?\s*/g, ''],
  // "x-admin-api-key": X,  — inside a larger object
  [/["'][xX]-[aA]dmin-[aA]pi-[kK]ey["']\s*:\s*[a-zA-Z_$][a-zA-Z0-9_$]*\s*,\s*/g, ''],
  // "x-admin-api-key": X  — last property, no trailing comma
  [/,\s*["'][xX]-[aA]dmin-[aA]pi-[kK]ey["']\s*:\s*[a-zA-Z_$][a-zA-Z0-9_$]*/g, ''],
  // "x-admin-api-key": import.meta.env.VITE_ADMIN_API_KEY ?? ""
  [/["'][xX]-[aA]dmin-[aA]pi-[kK]ey["']\s*:\s*import\.meta\.env[.\[\]"'A-Z_a-z0-9?]*\s*\?\?\s*["']{2}\s*,?\s*/g, ''],
  // (window as any).__ADMIN_API_KEY__ ?? import.meta.env.VITE_ADMIN_API_KEY ?? "" in headers
  [/\(window as any\)\.__ADMIN_API_KEY__\s*\?\?\s*import\.meta\.env[.\[\]"'A-Z_a-z0-9?]*\s*\?\?\s*["']{2}/g, '""'],
];

function processLine(line) {
  if (isWholeLineRemoval(line)) return null; // signal: remove
  let result = line;
  for (const [pat, repl] of INLINE_PATTERNS) {
    result = result.replace(pat, repl);
  }
  return result;
}

function processFile(filepath) {
  const original = readFileSync(filepath, "utf8");
  const lines = original.split("\n");
  const newLines = [];
  let removed = 0;

  for (const line of lines) {
    const out = processLine(line);
    if (out === null) {
      removed++;
      // Avoid double blank lines
      if (newLines.length > 0 && newLines[newLines.length - 1].trim() !== "") {
        newLines.push("");
      }
    } else {
      newLines.push(out);
    }
  }

  const newContent = newLines.join("\n");
  if (newContent !== original) {
    writeFileSync(filepath, newContent, "utf8");
    return removed;
  }
  return 0;
}

function walkDir(dir, results = []) {
  for (const entry of readdirSync(dir)) {
    if (["node_modules", "dist", ".git"].includes(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkDir(full, results);
    else if ([".ts", ".tsx"].includes(extname(full))) results.push(full);
  }
  return results;
}

const root = resolve(import.meta.dirname, "..");
const aiSrc = join(root, "artifacts", "ai-platform", "src");
const extra = [join(root, "artifacts", "customer-portal", "src", "pages", "dev-test.tsx")];

const targets = [...walkDir(aiSrc), ...extra];
let totalChanged = 0, totalRemoved = 0;
const changedFiles = [];

for (const fpath of targets.sort()) {
  try {
    const removed = processFile(fpath);
    if (removed > 0) {
      totalChanged++;
      totalRemoved += removed;
      changedFiles.push([relative(root, fpath), removed]);
    }
  } catch (e) {
    console.error(`ERROR ${fpath}: ${e.message}`);
  }
}

console.log(`Files changed: ${totalChanged}, lines removed: ${totalRemoved}`);
for (const [f, n] of changedFiles) console.log(`  [${String(n).padStart(2)}] ${f}`);
