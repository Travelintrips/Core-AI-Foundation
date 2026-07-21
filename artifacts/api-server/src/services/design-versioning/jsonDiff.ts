/**
 * services/design-versioning/jsonDiff.ts — Team 09
 *
 * Structured JSON field diff for version comparison.
 *
 * Constraints:
 *  - Max 200 changed paths reported (truncated beyond that)
 *  - Input objects limited to 50 KB JSON each
 *  - Values truncated at 500 chars when serialized
 *  - Keys matching secret patterns are redacted (values never exposed)
 *  - No word-by-word / image diff — structural field diff only
 */

// ── Secret key filter ─────────────────────────────────────────────────────────
const SECRET_KEY_PATTERN = /key|token|secret|password|credential|auth|bearer|api_key/i;

function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}

// ── Value serialisation ───────────────────────────────────────────────────────
const MAX_VALUE_LENGTH = 500;

function serializeValue(value: unknown): string {
  const s = JSON.stringify(value) ?? "null";
  return s.length > MAX_VALUE_LENGTH ? s.slice(0, MAX_VALUE_LENGTH) + "…" : s;
}

// ── Type guard ────────────────────────────────────────────────────────────────

function isObjectLike(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ── Public types ──────────────────────────────────────────────────────────────

export interface DiffEntry {
  path: string;
  kind: "added" | "removed" | "modified";
  /** Present for 'removed' and 'modified' */
  oldValue?: string;
  /** Present for 'added' and 'modified' */
  newValue?: string;
}

export interface JsonDiffResult {
  addedCount: number;
  removedCount: number;
  modifiedCount: number;
  totalChanges: number;
  truncated: boolean;
  changes: DiffEntry[];
}

// ── Core diff ─────────────────────────────────────────────────────────────────
const MAX_CHANGES = 200;

/**
 * Recursively traverse two JSON objects and push structured DiffEntry records
 * into `out`. Uses original values for change detection; redacts secret-keyed
 * values in the output so credentials are never exposed.
 */
function collectDiff(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  prefix: string,
  out: DiffEntry[],
): void {
  if (out.length >= MAX_CHANGES) return;

  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);

  for (const key of allKeys) {
    if (out.length >= MAX_CHANGES) break;

    const path   = prefix ? `${prefix}.${key}` : key;
    const secret = isSecretKey(key);
    const inA    = key in a;
    const inB    = key in b;

    if (!inA) {
      // Added key
      out.push({
        path,
        kind: "added",
        newValue: secret ? "[REDACTED]" : serializeValue(b[key]),
      });
    } else if (!inB) {
      // Removed key
      out.push({
        path,
        kind: "removed",
        oldValue: secret ? "[REDACTED]" : serializeValue(a[key]),
      });
    } else if (secret) {
      // Secret key: detect change using original values, display REDACTED
      if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) {
        out.push({ path, kind: "modified", oldValue: "[REDACTED]", newValue: "[REDACTED]" });
      }
    } else if (isObjectLike(a[key]) && isObjectLike(b[key])) {
      // Recurse into nested plain objects using original values directly
      collectDiff(
        a[key] as Record<string, unknown>,
        b[key] as Record<string, unknown>,
        path,
        out,
      );
    } else if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) {
      // Scalar / array change
      out.push({
        path,
        kind: "modified",
        oldValue: serializeValue(a[key]),
        newValue: serializeValue(b[key]),
      });
    }
    // else: unchanged — skip
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export class JsonDiffInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JsonDiffInputError";
  }
}

/**
 * Compute a structured diff between two JSON-serializable objects.
 *
 * @param a   The "before" object (old version's contentSnapshot)
 * @param b   The "after" object (new version's contentSnapshot)
 * @returns   Structured diff result
 * @throws    JsonDiffInputError if inputs exceed size limits or are not plain objects
 */
export function diffJson(a: unknown, b: unknown): JsonDiffResult {
  if (!isObjectLike(a)) throw new JsonDiffInputError("Old content must be a plain JSON object");
  if (!isObjectLike(b)) throw new JsonDiffInputError("New content must be a plain JSON object");

  // Size guard (50 KB each)
  const aStr = JSON.stringify(a);
  const bStr = JSON.stringify(b);
  if (aStr.length > 50_000) throw new JsonDiffInputError("Old content exceeds 50 KB limit");
  if (bStr.length > 50_000) throw new JsonDiffInputError("New content exceeds 50 KB limit");

  const changes: DiffEntry[] = [];
  collectDiff(a, b, "", changes);

  const truncated = changes.length >= MAX_CHANGES;

  return {
    addedCount:    changes.filter((c) => c.kind === "added").length,
    removedCount:  changes.filter((c) => c.kind === "removed").length,
    modifiedCount: changes.filter((c) => c.kind === "modified").length,
    totalChanges:  changes.length,
    truncated,
    changes,
  };
}
