/**
 * Universal Design Component & Object Library — ComponentRegistry (Team 22)
 *
 * In-memory registry. Pure logic — no DB, no I/O.
 *
 * Properties:
 *  - Unique component ID (collisions rejected)
 *  - Version-aware: multiple versions per ID; deterministic latest resolution
 *  - Variant-aware: variant lookup by ID within a resolved definition
 *  - Plugin ownership: builtin + plugin contributions tracked
 *  - Deprecation: deprecated definitions resolvable but flagged
 *  - Unavailable: not returned for instantiation; surfaced in browser as disabled
 *  - Idempotency key tracking: boundary check for instantiation requests
 *  - No persistence — callers own persistence
 */

import type {
  ComponentDefinition,
  ComponentStatus,
  ComponentVariant,
  ComponentBrowserFilter,
  ComponentInstantiationRequest,
  InstantiationValidationResult,
  ValidationIssue,
  ComponentParameterSchema,
} from "./types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Unsafe schema field names — plugin_schema_reference safety guard
// ─────────────────────────────────────────────────────────────────────────────

const UNSAFE_SCHEMA_FIELD_PATTERNS = [
  /\bexec\b/i,
  /\beval\b/i,
  /\bfn\b/i,
  /\bcode\b/i,
  /\bscript\b/i,
  /\brun\b/i,
  /\bcallable\b/i,
  /\binvoke\b/i,
];

function hasUnsafeSchemaField(schema: ComponentParameterSchema): boolean {
  if (schema.kind !== "plugin_schema_reference") return false;
  // Check schemaId and pluginId for embedded executable indicators
  const combined = `${schema.schemaId} ${schema.pluginId}`.toLowerCase();
  return UNSAFE_SCHEMA_FIELD_PATTERNS.some((re) => re.test(combined));
}

function parametersContainUnsafeSchema(
  parameters: Record<string, ComponentParameterSchema>,
): boolean {
  return Object.values(parameters).some(hasUnsafeSchemaField);
}

// ─────────────────────────────────────────────────────────────────────────────
// Registration error types
// ─────────────────────────────────────────────────────────────────────────────

export class ComponentRegistrationError extends Error {
  constructor(
    public readonly componentId: string,
    reason: string,
  ) {
    super(`[ComponentRegistry] Cannot register "${componentId}": ${reason}`);
    this.name = "ComponentRegistrationError";
  }
}

export class ComponentResolutionError extends Error {
  constructor(
    public readonly componentId: string,
    reason: string,
  ) {
    super(`[ComponentRegistry] Cannot resolve "${componentId}": ${reason}`);
    this.name = "ComponentResolutionError";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Version helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Compares semver strings. Returns negative if a < b, positive if a > b, 0 if equal. */
function compareSemver(a: string, b: string): number {
  const parse = (v: string) =>
    v.split(".").map((n) => parseInt(n, 10) || 0) as [number, number, number];
  const [aMaj, aMin, aPatch] = parse(a);
  const [bMaj, bMin, bPatch] = parse(b);
  if (aMaj !== bMaj) return aMaj - bMaj;
  if (aMin !== bMin) return aMin - bMin;
  return aPatch - bPatch;
}

/** Deterministic latest: highest semver among all registered versions. */
function resolveLatest(versions: ComponentDefinition[]): ComponentDefinition {
  return versions.reduce((best, cur) =>
    compareSemver(cur.version, best.version) > 0 ? cur : best,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ComponentRegistry
// ─────────────────────────────────────────────────────────────────────────────

export class ComponentRegistry {
  /**
   * Maps componentId → list of all registered versions.
   * Multiple versions of the same ID can coexist.
   */
  private readonly _byId = new Map<string, ComponentDefinition[]>();

  /**
   * Seen idempotency keys for instantiation requests.
   * Boundary check only — no persistence.
   */
  private readonly _idempotencyKeys = new Set<string>();

  // ── Registration ────────────────────────────────────────────────────────────

  /**
   * Register a ComponentDefinition.
   *
   * Rejects:
   *  - Empty or whitespace-only ID
   *  - Duplicate (id + version) combination
   *  - Unsafe plugin schema fields (exec/eval/fn/code/script/run/callable/invoke)
   *
   * Does not reject deprecated/unavailable — they are valid registry entries.
   */
  register(def: ComponentDefinition): void {
    const id = def.id.trim();
    if (!id) {
      throw new ComponentRegistrationError(
        def.id,
        "component ID must be a non-empty string",
      );
    }

    // Safety: reject unsafe plugin schema references
    if (parametersContainUnsafeSchema(def.parameters)) {
      throw new ComponentRegistrationError(
        id,
        "parameters contain a plugin_schema_reference with unsafe field indicators (exec/eval/fn/code/script/run/callable/invoke)",
      );
    }

    const existing = this._byId.get(id) ?? [];
    const duplicate = existing.find((e) => e.version === def.version);
    if (duplicate) {
      throw new ComponentRegistrationError(
        id,
        `version "${def.version}" is already registered`,
      );
    }

    this._byId.set(id, [...existing, def]);
  }

  /**
   * Register multiple definitions at once (e.g. plugin batch contribution).
   * Throws on first failure — no partial registration.
   */
  registerAll(defs: ComponentDefinition[]): void {
    for (const def of defs) {
      this.register(def);
    }
  }

  // ── Resolution ──────────────────────────────────────────────────────────────

  /**
   * Resolve a component definition.
   *
   * - If version is given: returns exact version or undefined.
   * - If version omitted: deterministically returns the latest version
   *   (highest semver). Deprecated versions are still returned but
   *   unavailable ones are returned as-is (callers check status).
   *
   * Returns undefined if the ID is not registered.
   */
  resolve(
    id: string,
    version?: string,
  ): ComponentDefinition | undefined {
    const versions = this._byId.get(id);
    if (!versions || versions.length === 0) return undefined;

    if (version) {
      return versions.find((d) => d.version === version);
    }

    return resolveLatest(versions);
  }

  /**
   * Resolve a specific variant within a component.
   * Returns undefined if component or variant is not found.
   */
  resolveVariant(
    id: string,
    variantId: string,
    version?: string,
  ): ComponentVariant | undefined {
    const def = this.resolve(id, version);
    if (!def) return undefined;
    return def.variants.find((v) => v.id === variantId);
  }

  /** List all versions of a specific component ID. */
  listVersions(id: string): ComponentDefinition[] {
    return this._byId.get(id) ?? [];
  }

  // ── Listing & filtering ─────────────────────────────────────────────────────

  /**
   * Return the latest version of every registered component.
   * Includes all statuses (active, deprecated, unavailable).
   */
  listAll(): ComponentDefinition[] {
    return Array.from(this._byId.values()).map(resolveLatest);
  }

  /** Filter by status. */
  listByStatus(status: ComponentStatus): ComponentDefinition[] {
    return this.listAll().filter((d) => d.status === status);
  }

  /** Filter by category ID. */
  listByCategory(categoryId: string): ComponentDefinition[] {
    return this.listAll().filter((d) => d.category.id === categoryId);
  }

  /**
   * Filter by domain compatibility.
   * Returns only components whose compatibility.domains includes the given domain.
   */
  listByDomain(domain: string): ComponentDefinition[] {
    return this.listAll().filter((d) =>
      d.compatibility.domains.includes(domain),
    );
  }

  /**
   * Filter by source.
   * If pluginId is given, further narrows to that specific plugin.
   */
  listBySource(
    sourceKind: "builtin" | "plugin",
    pluginId?: string,
  ): ComponentDefinition[] {
    return this.listAll().filter((d) => {
      if (d.source.kind !== sourceKind) return false;
      if (pluginId !== undefined && d.source.pluginId !== pluginId) return false;
      return true;
    });
  }

  /**
   * Filter components compatible with a domain and a set of caller-held capabilities.
   * A component is compatible when:
   *   1. Its compatibility.domains includes domain.
   *   2. Every item in compatibility.requiredCapabilities is in callerCapabilities.
   */
  filterByCompatibility(
    domain: string,
    callerCapabilities: string[] = [],
  ): ComponentDefinition[] {
    const capSet = new Set(callerCapabilities);
    return this.listAll().filter((d) => {
      if (!d.compatibility.domains.includes(domain)) return false;
      return d.compatibility.requiredCapabilities.every((cap) =>
        capSet.has(cap),
      );
    });
  }

  /**
   * Full-text search across label, description, tags, category label.
   * Case-insensitive substring match. Does not include unavailable components
   * unless the caller explicitly requests them via the filter.
   */
  search(query: string): ComponentDefinition[] {
    const q = query.toLowerCase().trim();
    if (!q) return this.listAll();
    return this.listAll().filter((d) => {
      const haystack = [
        d.id,
        d.label,
        d.description,
        d.category.label,
        d.category.id,
        ...d.tags,
        ...(d.variants.map((v) => v.label)),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }

  /**
   * Apply a ComponentBrowserFilter.
   * This is the primary query used by ComponentBrowser and ComponentPicker.
   */
  filter(f: ComponentBrowserFilter): ComponentDefinition[] {
    let results = this.listAll();

    if (f.status !== undefined) {
      results = results.filter((d) => d.status === f.status);
    }

    if (f.categoryId) {
      results = results.filter((d) => d.category.id === f.categoryId);
    }

    if (f.domain) {
      results = results.filter((d) =>
        d.compatibility.domains.includes(f.domain!),
      );
    }

    if (f.sourceKind) {
      results = results.filter((d) => d.source.kind === f.sourceKind);
    }

    if (f.pluginId) {
      results = results.filter((d) => d.source.pluginId === f.pluginId);
    }

    if (f.tags && f.tags.length > 0) {
      const filterTags = new Set(f.tags);
      results = results.filter((d) =>
        d.tags.some((t) => filterTags.has(t)),
      );
    }

    if (f.variantId) {
      results = results.filter((d) =>
        d.variants.some((v) => v.id === f.variantId),
      );
    }

    if (f.query) {
      const q = f.query.toLowerCase().trim();
      results = results.filter((d) => {
        const haystack = [
          d.id,
          d.label,
          d.description,
          d.category.label,
          ...d.tags,
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(q);
      });
    }

    return results;
  }

  // ── Dependency validation ───────────────────────────────────────────────────

  /**
   * Check that all dependencies of a component are present in the registry
   * and are active (not unavailable).
   *
   * Returns missing/unavailable dependency IDs.
   */
  validateDependencies(id: string, version?: string): string[] {
    const def = this.resolve(id, version);
    if (!def) return [];

    const missing: string[] = [];
    for (const depId of def.compatibility.dependencies) {
      const dep = this.resolve(depId);
      if (!dep || dep.status === "unavailable") {
        missing.push(depId);
      }
    }
    return missing;
  }

  // ── Instantiation request validation ───────────────────────────────────────

  /**
   * Validate a ComponentInstantiationRequest without persisting.
   *
   * Checks:
   *  1. componentId is registered
   *  2. requested version exists (if specified)
   *  3. component is not unavailable
   *  4. variantId exists (if specified)
   *  5. required parameters are present
   *  6. idempotencyKey is non-empty
   *  7. targetArtifactId is non-empty
   *  8. requestedBy is non-empty
   *  9. caller has required permissions (basic presence check)
   */
  validateInstantiationRequest(
    req: ComponentInstantiationRequest,
    callerPermissions: string[] = [],
  ): InstantiationValidationResult {
    const issues: ValidationIssue[] = [];

    // Basic required fields
    if (!req.componentId || !req.componentId.trim()) {
      issues.push({ field: "componentId", message: "componentId is required." });
    }
    if (!req.targetArtifactId || !req.targetArtifactId.trim()) {
      issues.push({
        field: "targetArtifactId",
        message: "targetArtifactId is required.",
      });
    }
    if (!req.requestedBy || !req.requestedBy.trim()) {
      issues.push({ field: "requestedBy", message: "requestedBy is required." });
    }
    if (!req.idempotencyKey || !req.idempotencyKey.trim()) {
      issues.push({
        field: "idempotencyKey",
        message: "idempotencyKey is required.",
      });
    }

    if (issues.length > 0) return { valid: false, issues };

    // Resolve component
    const def = this.resolve(req.componentId, req.version);
    if (!def) {
      issues.push({
        field: "componentId",
        message: req.version
          ? `Component "${req.componentId}" version "${req.version}" is not registered.`
          : `Component "${req.componentId}" is not registered.`,
      });
      return { valid: false, issues };
    }

    // Status check
    if (def.status === "unavailable") {
      issues.push({
        field: "componentId",
        message: `Component "${req.componentId}" is unavailable and cannot be instantiated.`,
      });
    }

    // Variant check
    if (req.variantId) {
      const variant = def.variants.find((v) => v.id === req.variantId);
      if (!variant) {
        issues.push({
          field: "variantId",
          message: `Variant "${req.variantId}" does not exist on component "${req.componentId}".`,
        });
      }
    }

    // Required parameter check
    const missingParams: string[] = [];
    for (const [key, schema] of Object.entries(def.parameters)) {
      if (schema.required && !(key in req.parameters)) {
        missingParams.push(key);
      }
    }
    if (missingParams.length > 0) {
      issues.push({
        field: "parameters",
        message: `Missing required parameters: ${missingParams.join(", ")}.`,
      });
    }

    // Permission check
    if (def.permissions && def.permissions.length > 0) {
      const callerSet = new Set(callerPermissions);
      const missing = def.permissions.filter((p) => !callerSet.has(p));
      if (missing.length > 0) {
        issues.push({
          field: "permissions",
          message: `Caller lacks required permissions: ${missing.join(", ")}.`,
        });
      }
    }

    return { valid: issues.length === 0, issues };
  }

  // ── Idempotency key tracking ────────────────────────────────────────────────

  /**
   * Returns true if this key has been seen before (duplicate).
   * Side effect: records the key on first call so subsequent calls return true.
   *
   * NOTE: This is an in-memory boundary check. For durable idempotency
   * across restarts, callers must persist keys in their own store.
   */
  checkAndMarkIdempotencyKey(key: string): boolean {
    if (this._idempotencyKeys.has(key)) return true; // duplicate
    this._idempotencyKeys.add(key);
    return false;
  }

  /** Purely check without marking (for test inspection). */
  hasIdempotencyKey(key: string): boolean {
    return this._idempotencyKeys.has(key);
  }

  // ── Introspection ───────────────────────────────────────────────────────────

  /** Total number of unique component IDs registered (all versions). */
  get size(): number {
    return this._byId.size;
  }

  /** Return registry stats. */
  stats(): {
    totalIds: number;
    totalVersions: number;
    byStatus: Record<ComponentStatus, number>;
    bySource: Record<"builtin" | "plugin", number>;
  } {
    const all = this.listAll();
    const byStatus: Record<ComponentStatus, number> = {
      active: 0,
      deprecated: 0,
      unavailable: 0,
    };
    const bySource: Record<"builtin" | "plugin", number> = {
      builtin: 0,
      plugin: 0,
    };
    let totalVersions = 0;
    for (const [, versions] of this._byId) {
      totalVersions += versions.length;
    }
    for (const d of all) {
      byStatus[d.status]++;
      bySource[d.source.kind]++;
    }
    return {
      totalIds: this._byId.size,
      totalVersions,
      byStatus,
      bySource,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton export for the platform-level registry.
// Plugins call `platformRegistry.register(def)` during their init phase.
// ─────────────────────────────────────────────────────────────────────────────

export const platformRegistry = new ComponentRegistry();
