/**
 * Engineering Team — Validation Report Schema
 *
 * Re-exports the ValidationIssue and ValidationReport types defined in
 * engineering.types.ts. The Zod runtime schema is intentionally omitted —
 * validation reports are produced by deterministic code, not parsed from
 * external input, so runtime schema validation is unnecessary overhead.
 */

export type {
  ValidationIssue,
  ValidationReport,
  OptimizationChange,
  OptimizationResult,
} from "../types/engineering.types.js";
