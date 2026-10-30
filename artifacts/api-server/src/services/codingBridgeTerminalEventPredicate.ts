import { sql } from "drizzle-orm";

/**
 * Apply lifecycle eligibility before LIMIT. Keep all raw transport ACK and
 * progress records in the ledger without allowing them to starve callbacks.
 * Construct the SQL only when used so test suites that mock drizzle-orm
 * without sql can still import unrelated bridge services safely.
 */
export function codingBridgeTerminalEventPredicate() {
  return sql`(
    response.kind IN ('COMPLETED', 'FAILED', 'BLOCKER')
    OR response.checkpoint_json ->> 'eventType' IN
      ('COMPLETED', 'FAILED', 'BLOCKED', 'MERGED', 'DEPLOYED')
    OR response.metadata_json ->> 'eventType' IN
      ('COMPLETED', 'FAILED', 'BLOCKED', 'MERGED', 'DEPLOYED')
    OR (
      response.kind NOT IN ('ACK', 'PROGRESS')
      AND (
        concat_ws(' ', response.message, response.checkpoint_json::text, response.metadata_json::text)
          ~* '(^|[^[:alnum:]_])merge(d)?([^[:alnum:]_]|$)'
        OR (
          concat_ws(' ', response.message, response.checkpoint_json::text, response.metadata_json::text)
            ~* '(^|[^[:alnum:]_])deploy(ed|ment)?([^[:alnum:]_]|$)'
          AND concat_ws(' ', response.message, response.checkpoint_json::text, response.metadata_json::text)
            ~* 'success|succeed|completed|selesai|deployed'
        )
      )
    )
  )`;
}
