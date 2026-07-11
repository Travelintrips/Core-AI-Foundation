import { pgSchema } from "drizzle-orm/pg-core";

/**
 * Dedicated Postgres schema for this app's tables. We deliberately avoid the
 * default "public" schema since the shared Supabase project's public schema
 * is already crowded with tables from other apps.
 */
export const appSchema = pgSchema("ai_platform");
