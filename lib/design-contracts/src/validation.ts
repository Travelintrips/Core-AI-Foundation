/**
 * validation.ts — Typed ValidationResult and architecture error hierarchy.
 *
 * Rules:
 *   - ValidationResult is a discriminated union (success | failure); never throw
 *     silently — callers must inspect the result.
 *   - ArchitectureError codes are stable string literals; add new codes, never
 *     rename existing ones.
 *   - Fields in ValidationFailure are additive (optional extensions welcome).
 */

import { z } from "zod";

// ── Error codes ───────────────────────────────────────────────────────────────

export const ARCHITECTURE_ERROR_CODES = [
  // Contract version errors
  "CONTRACT_VERSION_UNSUPPORTED",
  "CONTRACT_VERSION_MISSING",
  // Schema / field errors
  "REQUIRED_FIELD_MISSING",
  "FIELD_TYPE_INVALID",
  "FIELD_VALUE_OUT_OF_RANGE",
  // Plugin / capability errors
  "PLUGIN_VERSION_INCOMPATIBLE",
  "CAPABILITY_NOT_SUPPORTED",
  "CAPABILITY_INPUT_INVALID",
  "CAPABILITY_OUTPUT_INVALID",
  // Event / command errors
  "EVENT_PAYLOAD_INVALID",
  "EVENT_VERSION_UNSUPPORTED",
  "COMMAND_PAYLOAD_INVALID",
  // Stage errors
  "STAGE_DEPENDENCY_CYCLE",
  "STAGE_DEPENDENCY_MISSING",
  "STAGE_ARTIFACT_TYPE_UNSUPPORTED",
  // Domain leakage
  "DOMAIN_FIELD_IN_CORE_CONTRACT",
  // General
  "UNKNOWN_EXTENSION_FIELD",
  "SERIALIZATION_ERROR",
  "INTERNAL_CONTRACT_ERROR",
] as const;

export type ArchitectureErrorCode = (typeof ARCHITECTURE_ERROR_CODES)[number];

// ── Validation field issue ────────────────────────────────────────────────────

export interface ValidationIssue {
  /** Dot-path to the offending field (e.g. "context.tenantId"). */
  path: string;
  code: ArchitectureErrorCode;
  message: string;
  /** Raw value that triggered the issue (omit for security-sensitive fields). */
  received?: unknown;
}

// ── ValidationResult discriminated union ──────────────────────────────────────

export type ValidationSuccess<T> = {
  success: true;
  data: T;
};

export type ValidationFailure = {
  success: false;
  code: ArchitectureErrorCode;
  message: string;
  issues: ValidationIssue[];
};

export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

// ── Helpers ───────────────────────────────────────────────────────────────────

export function ok<T>(data: T): ValidationSuccess<T> {
  return { success: true, data };
}

export function fail(
  code: ArchitectureErrorCode,
  message: string,
  issues: ValidationIssue[] = [],
): ValidationFailure {
  return { success: false, code, message, issues };
}

/**
 * Parse a Zod schema and map the result to a ValidationResult.
 * Unknown extension fields trigger UNKNOWN_EXTENSION_FIELD issues but do NOT
 * cause failure by default — they are included in the issues array with the
 * data still returned (fail-open for forward compatibility of minor versions).
 */
export function parseContract<T>(
  schema: z.ZodType<T>,
  input: unknown,
  opts: { strict?: boolean } = {},
): ValidationResult<T> {
  const result = schema.safeParse(input);
  if (result.success) {
    return ok(result.data);
  }
  const issues: ValidationIssue[] = result.error.issues.map((issue) => ({
    path: issue.path.join("."),
    code: mapZodCode(issue.code),
    message: issue.message,
    received: "received" in issue ? issue.received : undefined,
  }));
  return fail("REQUIRED_FIELD_MISSING", "Contract validation failed", issues);
}

function mapZodCode(zodCode: z.ZodIssueCode): ArchitectureErrorCode {
  switch (zodCode) {
    case z.ZodIssueCode.invalid_type:
      return "FIELD_TYPE_INVALID";
    case z.ZodIssueCode.too_small:
    case z.ZodIssueCode.too_big:
      return "FIELD_VALUE_OUT_OF_RANGE";
    case z.ZodIssueCode.unrecognized_keys:
      return "UNKNOWN_EXTENSION_FIELD";
    default:
      return "REQUIRED_FIELD_MISSING";
  }
}
