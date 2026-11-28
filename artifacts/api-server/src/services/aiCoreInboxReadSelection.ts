import { sql } from "drizzle-orm";
import { z } from "zod";

/** Read receipts must identify explicitly selected Inbox messages. Missing or
 * empty selections must never imply "all". This is not a job acknowledgement. */
export const InboxReadRequest = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
}).strict();

export function buildAiCoreInboxReadQuery(ids: unknown) {
  const parsed = InboxReadRequest.safeParse({ ids });
  if (!parsed.success) return null;
  const clean = [...new Set(parsed.data.ids.map(id => id.toLowerCase()))];
  // Bind each UUID separately. A JS array interpolated into a SQL template
  // can become a parenthesized value list instead of a PostgreSQL array.
  return sql`
    UPDATE ai_platform.ai_core_chat_inbox_messages
    SET read_at = COALESCE(read_at, NOW())
    WHERE id IN (${sql.join(clean.map(id => sql`${id}::uuid`), sql`, `)})
    RETURNING id
  `;
}
