import { appSchema } from "./_pg-schema";
import { index, jsonb, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
export const aiCodingGithubDeliveriesTable=appSchema.table("ai_coding_github_deliveries",{
 id:uuid("id").primaryKey().defaultRandom(),deliveryId:text("delivery_id").notNull(),eventName:text("event_name").notNull(),
 repository:text("repository").notNull(),headSha:text("head_sha"),payloadJson:jsonb("payload_json").notNull().default({}),
 status:text("status").notNull().default("RECEIVED"),createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
 processedAt:timestamp("processed_at",{withTimezone:true}),
},t=>[uniqueIndex("ai_coding_github_deliveries_delivery_uidx").on(t.deliveryId),index("ai_coding_github_deliveries_repo_sha_idx").on(t.repository,t.headSha)]);
