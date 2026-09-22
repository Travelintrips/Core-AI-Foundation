/**
 * Resolves the Postgres connection string for the current environment.
 *
 * Production on Hostinger must use Supabase transaction pooling. Hostinger can
 * briefly overlap old/new Node processes during a rolling deploy; session-mode
 * pooling (port 5432) can exhaust the small Supavisor client limit in that
 * situation. Transaction mode (port 6543) shares the backend pool safely.
 */
function normalizeProductionPoolerUrl(value: string): string {
  if (process.env["SUPABASE_FORCE_SESSION_POOLER"] === "true") return value;

  try {
    const parsed = new URL(value);
    if (parsed.hostname.endsWith(".pooler.supabase.com") && parsed.port === "5432") {
      parsed.port = "6543";
      return parsed.toString();
    }
  } catch {
    // Keep the original value; node-postgres will report a precise connection
    // error if the supplied URL itself is malformed.
  }

  return value;
}

export function resolveDatabaseUrl(): string {
  const isProduction = process.env.NODE_ENV === "production";

  const url = isProduction
    ? process.env.SUPABASE_PROD_DATABASE_URL || process.env.SUPABASE_DATABASE_URL
    : process.env.SUPABASE_DEV_DATABASE_URL || process.env.SUPABASE_DATABASE_URL_DEV;

  if (!url) {
    const missingVar = isProduction
      ? "SUPABASE_PROD_DATABASE_URL"
      : "SUPABASE_DEV_DATABASE_URL";
    throw new Error(
      `${missingVar} must be set. Did you forget to configure the Supabase connection string?`,
    );
  }

  return isProduction ? normalizeProductionPoolerUrl(url) : url;
}
