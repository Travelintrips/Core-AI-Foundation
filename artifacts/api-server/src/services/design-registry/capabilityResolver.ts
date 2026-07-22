/**
 * capabilityResolver.ts — Resolves design capabilities with explainability.
 *
 * Resolution modes:
 *   exact     — direct id lookup
 *   domain    — all capabilities in a domain applicable to a given stage
 *   unsupported — explicit, human-readable explanation when nothing matches
 *
 * All results carry an `explanation` field so callers (plugins, orchestrators)
 * can surface "why" without requiring additional lookups.
 */

import type { DesignCapabilityEntry, CapabilityResolveResult, WorkflowStage, ExecutionKind } from "./types.js";
import type { DesignCapabilityRegistry } from "./designCapabilityRegistry.js";
import type { DesignSchemaRegistry } from "./designSchemaRegistry.js";

export interface ResolveOptions {
  /** If true, also verify that both input and output schemas are registered. */
  verifySchemas?: boolean;
}

export interface BulkResolveResult {
  stage: WorkflowStage;
  executionKind?: ExecutionKind;
  capabilities: DesignCapabilityEntry[];
  explanation: string;
}

export class CapabilityResolver {
  constructor(
    private readonly capabilities: DesignCapabilityRegistry,
    private readonly schemas: DesignSchemaRegistry,
  ) {}

  // ── Exact resolution ─────────────────────────────────────────────────────────

  /**
   * Resolve a capability by exact ID.
   *
   * Returns { found: true, capability, explanation } on success.
   * Returns { found: false, capabilityId, explanation } when not registered or schema ref broken.
   */
  resolve(capabilityId: string, options: ResolveOptions = {}): CapabilityResolveResult {
    const capability = this.capabilities.get(capabilityId);

    if (!capability) {
      return {
        found: false,
        capabilityId,
        explanation:
          `Capability "${capabilityId}" is not registered in the DesignCapabilityRegistry. ` +
          `Register it via globalCapabilityRegistry.register() before use.`,
      };
    }

    // Optional schema verification
    if (options.verifySchemas) {
      const missingSchemas: string[] = [];

      if (!this.schemas.get(capability.inputSchemaId)) {
        missingSchemas.push(`input schema "${capability.inputSchemaId}"`);
      }
      if (!this.schemas.get(capability.outputSchemaId)) {
        missingSchemas.push(`output schema "${capability.outputSchemaId}"`);
      }

      if (missingSchemas.length > 0) {
        return {
          found: false,
          capabilityId,
          explanation:
            `Capability "${capabilityId}" references unregistered schema(s): ` +
            missingSchemas.join(", ") +
            `. Register those schemas in the DesignSchemaRegistry first.`,
        };
      }
    }

    const parts: string[] = [`Capability "${capabilityId}" resolved (executionKind=${capability.executionKind})`];
    if (capability.aiCapabilityRef) {
      parts.push(`reusing existing AI capability skill "${capability.aiCapabilityRef}"`);
    }
    if (capability.domain) {
      parts.push(`domain="${capability.domain}"`);
    }
    parts.push(`stages=[${capability.stageApplicability.join(",")}]`);

    return {
      found: true,
      capability,
      explanation: parts.join("; "),
    };
  }

  // ── Stage-based bulk resolution ───────────────────────────────────────────────

  /**
   * Resolve all capabilities applicable to a given workflow stage.
   * Optionally filter by execution kind.
   */
  resolveByStage(stage: WorkflowStage, executionKind?: ExecutionKind): BulkResolveResult {
    const capabilities = this.capabilities.listByStage(stage, executionKind);

    if (capabilities.length === 0) {
      return {
        stage,
        executionKind,
        capabilities: [],
        explanation:
          `No capabilities registered for stage "${stage}"` +
          (executionKind ? ` with executionKind "${executionKind}"` : "") +
          `. Register capabilities via globalCapabilityRegistry.register().`,
      };
    }

    return {
      stage,
      executionKind,
      capabilities,
      explanation:
        `Found ${capabilities.length} capability(ies) for stage "${stage}"` +
        (executionKind ? ` (executionKind=${executionKind})` : "") +
        `: [${capabilities.map((c) => c.id).join(", ")}]`,
    };
  }

  // ── Version compatibility check ───────────────────────────────────────────────

  /**
   * Check whether a schema version is compatible with the registered entry's
   * compatibility metadata (minVersion / maxVersion).
   *
   * Comparison is a simple lexicographic semver prefix check — sufficient for
   * the registry's current needs.  Replace with a full semver library if
   * pre-release / build-metadata comparisons are required.
   */
  isSchemaVersionCompatible(schemaId: string, requestedVersion: string): boolean {
    const entry = this.schemas.get(schemaId);
    if (!entry) return false;

    const { minVersion, maxVersion } = entry.compatibilityMetadata;
    if (minVersion && requestedVersion < minVersion) return false;
    if (maxVersion && requestedVersion > maxVersion) return false;
    return true;
  }

  /**
   * Explain whether a schema version is compatible and why.
   */
  explainSchemaCompatibility(schemaId: string, requestedVersion: string): string {
    const entry = this.schemas.get(schemaId);
    if (!entry) {
      return `Schema "${schemaId}" is not registered — compatibility cannot be determined.`;
    }

    const { minVersion, maxVersion } = entry.compatibilityMetadata;
    const compatible = this.isSchemaVersionCompatible(schemaId, requestedVersion);

    if (compatible) {
      return (
        `Schema "${schemaId}" version "${requestedVersion}" is compatible ` +
        `(registered version="${entry.version}"` +
        (minVersion ? `, minVersion="${minVersion}"` : "") +
        (maxVersion ? `, maxVersion="${maxVersion}"` : "") +
        `)` 
      );
    }

    return (
      `Schema "${schemaId}" version "${requestedVersion}" is NOT compatible ` +
      `(registered version="${entry.version}"` +
      (minVersion ? `, minVersion="${minVersion}"` : "") +
      (maxVersion ? `, maxVersion="${maxVersion}"` : "") +
      `)`
    );
  }
}
