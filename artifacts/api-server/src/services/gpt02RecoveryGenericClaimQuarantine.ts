/**
 * Generic external-agent work claim/submit MUST NOT issue GPT02 recovery.
 * Dedicated DEV issuer + server-side fencing/native ACK is not yet authorized.
 * The SQL fragment is used inside the claim's SELECT ... FOR UPDATE predicate:
 * even a directly targeted command ID cannot bypass the quarantine.
 */
import {sql} from "drizzle-orm";

const recoveryKeys = [
  "gpt02Recovery",
  "gpt02RecoveryParentCommandId",
  "recoveryParentCommandId",
  "recovery_parent_command_id",
  // Source-only Issue159 outbox candidates must never reach the generic
  // API or generic worker claim path, even with a null/false marker.
  "gpt02Issue159PositivePermit",
] as const;

export function isQuarantinedGpt02RecoveryMetadata(value: unknown): boolean {
  if(value===null || typeof value!=="object" || Array.isArray(value))return false;
  const m=value as Record<string,unknown>;
  return recoveryKeys.some(k=>Object.prototype.hasOwnProperty.call(m,k)) ||
    (m["capability"]==="chatgpt:wake" &&
      Object.prototype.hasOwnProperty.call(m,"parentCommandId"));
}

// SQL key checks deliberately test PRESENCE, not truthiness: a malicious
// null/false recovery marker may not circumvent the generic-worker blockade.
// Do not require reservation-table SELECT grants from the application role.
// Construct lazily: unrelated bridge tests mock drizzle-orm without a sql
// export and must not fail merely from importing this safety module.
export function genericClaimNotGpt02RecoverySql() {
  return sql`
  NOT (
    metadata_json ?| ARRAY[
      'gpt02Recovery','gpt02RecoveryParentCommandId',
      'recoveryParentCommandId','recovery_parent_command_id',
      'gpt02Issue159PositivePermit'
    ]::text[]
    OR (
      metadata_json ->> 'capability' = 'chatgpt:wake'
      AND metadata_json ? 'parentCommandId'
    )
  )
`;
}


// Additional DEV-only fail-closed identity census. No broad ledger SELECT.
// SQL is emitted only for APP_ENV=development, keeping legacy PROD schema
// independent until a separately approved migration exists there.
export function genericClaimNotReservedCandidateSql() {
  if(process.env["APP_ENV"]!=="development")
    return sql`TRUE`;
  return sql`ai_platform.gpt02_dev_generic_claim_allowed(id)`;
}
