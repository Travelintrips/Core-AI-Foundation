import { sql } from "drizzle-orm";

/**
 * SQL prefilter for lifecycle events exposed through read_ai_core_events.
 * Mirrors the route's classifier with fixed transport kinds, explicit event
 * types and legacy merge/deploy vocabulary. ACK and PROGRESS remain durable,
 * never auto-acknowledged, deleted or promoted to a ChatGPT Final ACK.
 * The response table must use the alias "response".
 */
export const codingBridgeTerminalEventPredicate = sql`(
  response.kind IN ('COMPLETED', 'FAILED', 'BLOCKER')
  OR response.checkpoint_json ->> 'eventType' IN
    ('COMPLETED', 'FAILED', 'BLOCKED', 'MERGED', 'DEPLOYED')
  OR response.metadata_json ->> 'eventType' IN
    ('COMPLETED', 'FAILED', 'BLOCKED', 'MERGED', 'DEPLOYED')
  OR concat_ws(' ', response.message, response.checkpoint_json::text, response.metadata_json::text)
    ~* '\mmerge(d)?\M'
  OR (
    concat_ws(' ', response.message, response.checkpoint_json::text, response.metadata_json::text)
      ~* '\mdeploy(ed|ment)?\M'
    AND concat_ws(' ', response.message, response.checkpoint_json::text, response.metadata_json::text)
      ~* 'success|succeed|completed|selesai|deployed'
  )
)`;
