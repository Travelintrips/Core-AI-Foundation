import { appSchema } from "./_pg-schema";
import { serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const aiReferralsTable = appSchema.table("ai_referrals", {
  id: serial("id").primaryKey(),
  referrerProfileId: integer("referrer_profile_id").notNull(),
  refereeProfileId: integer("referee_profile_id"),
  referralCode: text("referral_code").notNull().unique(),
  referralLink: text("referral_link"),
  status: text("status").notNull().default("pending"),
  rewardType: text("reward_type"),
  rewardAmount: integer("reward_amount"),
  rewardStatus: text("reward_status").default("pending"),
  convertedAt: timestamp("converted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAiReferralSchema = createInsertSchema(aiReferralsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAiReferral = z.infer<typeof insertAiReferralSchema>;
export type AiReferral = typeof aiReferralsTable.$inferSelect;
