/**
 * designSchemaRegistry.ts — Central registry for Universal Design Platform schemas.
 *
 * Schemas are keyed by (id, version).  Registering the same (id, version) pair
 * twice throws RegistrationCollisionError; use a new version string or call
 * clear() in test setup.
 *
 * Usage:
 *   import { globalSchemaRegistry } from "./index.js";
 *   globalSchemaRegistry.register({ id: "design.brief.fashion", version: "1.0.0", ... });
 *   const entry = globalSchemaRegistry.get("design.brief.fashion");
 */

import type { SchemaCategory, DesignSchemaEntry, SchemaValidationResult } from "./types.js";

// ── Errors ────────────────────────────────────────────────────────────────────

export class RegistrationCollisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistrationCollisionError";
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeKey(id: string, version: string): string {
  return `${id}@${version}`;
}

// ── Registry ──────────────────────────────────────────────────────────────────

export class DesignSchemaRegistry {
  /** Primary store: (id@version) → entry */
  private readonly _schemas = new Map<string, DesignSchemaEntry>();
  /** Alias store: (alias@version) → canonical key */
  private readonly _aliases = new Map<string, string>();

  // ── Registration ────────────────────────────────────────────────────────────

  /**
   * Register a schema entry.
   * @throws RegistrationCollisionError if (id, version) is already registered.
   */
  register(entry: DesignSchemaEntry): void {
    const key = makeKey(entry.id, entry.version);

    if (this._schemas.has(key)) {
      throw new RegistrationCollisionError(
        `Schema collision: "${entry.id}" version "${entry.version}" is already registered. ` +
          `Bump the version string or de-register the existing entry first.`,
      );
    }

    this._schemas.set(key, entry);

    // Register aliases pointing to this canonical key
    for (const alias of entry.compatibilityMetadata.aliases ?? []) {
      const aliasKey = makeKey(alias, entry.version);
      if (!this._aliases.has(aliasKey)) {
        this._aliases.set(aliasKey, key);
      }
    }
  }

  // ── Retrieval ────────────────────────────────────────────────────────────────

  /**
   * Retrieve a schema by id and optional version.
   *
   * - If version is provided, exact (id@version) lookup is performed first,
   *   then alias lookup.
   * - If version is omitted, returns the latest entry with that id
   *   (last in insertion order — register in ascending version order for
   *   predictable behaviour).
   */
  get(id: string, version?: string): DesignSchemaEntry | undefined {
    if (version !== undefined) {
      const key = makeKey(id, version);
      const direct = this._schemas.get(key);
      if (direct) return direct;

      // Try alias
      const canonicalKey = this._aliases.get(key);
      return canonicalKey ? this._schemas.get(canonicalKey) : undefined;
    }

    // No version → return the latest entry with this id (last insertion wins)
    let match: DesignSchemaEntry | undefined;
    for (const entry of this._schemas.values()) {
      if (entry.id === id) match = entry;
    }
    return match;
  }

  /** Returns all registered schema entries (insertion order). */
  list(): DesignSchemaEntry[] {
    return [...this._schemas.values()];
  }

  /** Returns all schemas for a given category. */
  listByCategory(category: SchemaCategory): DesignSchemaEntry[] {
    return this.list().filter((s) => s.category === category);
  }

  // ── Validation ───────────────────────────────────────────────────────────────

  /**
   * Validate arbitrary data against a registered schema.
   *
   * Returns { valid: true, errors: [] } on success.
   * Returns { valid: false, errors } when the schema is not found OR data fails validation.
   */
  validate(schemaId: string, data: unknown, version?: string): SchemaValidationResult {
    const entry = this.get(schemaId, version);
    if (!entry) {
      return {
        valid: false,
        errors: [
          {
            code: "custom",
            message: `Schema "${schemaId}"${version ? `@${version}` : ""} is not registered`,
            path: [],
            input: data,
          } as import("zod/v4").ZodIssue,
        ],
      };
    }

    const result = entry.validator.safeParse(data);
    if (result.success) return { valid: true, errors: [] };
    return { valid: false, errors: result.error.issues };
  }

  // ── Housekeeping ─────────────────────────────────────────────────────────────

  /** Total number of registered schemas (not counting aliases). */
  get size(): number {
    return this._schemas.size;
  }

  /** Remove all entries. Intended for test isolation. */
  clear(): void {
    this._schemas.clear();
    this._aliases.clear();
  }
}
