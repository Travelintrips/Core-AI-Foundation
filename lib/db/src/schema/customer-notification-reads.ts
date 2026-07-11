import { appSchema } from "./_pg-schema";
import { serial, text, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * customer_notification_reads — Customer Workspace Notification Center.
 *
 * Notifications themselves are synthesized on read from existing project /
 * payment / quotation / review data (no duplicated event storage, and no
 * coupling to the Event Bus internals). This table only tracks which
 * synthetic notification keys a customer has marked read, so the feature
 * is purely additive and does not touch any existing module.
 */
export const customerNotificationReadsTable = appSchema.table(
  "customer_notification_reads",
  {
    id: serial("id").primaryKey(),
    emailHash: text("email_hash").notNull(),
    notificationKey: text("notification_key").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("customer_notification_reads_email_key_uq").on(t.emailHash, t.notificationKey)],
);

export const insertCustomerNotificationReadSchema = createInsertSchema(customerNotificationReadsTable).omit({
  id: true,
  readAt: true,
});
export type InsertCustomerNotificationRead = z.infer<typeof insertCustomerNotificationReadSchema>;
export type CustomerNotificationRead = typeof customerNotificationReadsTable.$inferSelect;
