/**
 * Resolves the Postgres connection string for the current environment.
 *
 * The project now lives on Supabase instead of Replit's built-in Postgres:
 * - production uses SUPABASE_PROD_DATABASE_URL
 * - everything else (development, local scripts) uses SUPABASE_DEV_DATABASE_URL
 */
export function resolveDatabaseUrl(): string {
  const isProduction = process.env.NODE_ENV === "production";

  // Some environments provision the connection string under a differently
  // named var (e.g. SUPABASE_DATABASE_URL_DEV / SUPABASE_DATABASE_URL)
  // instead of the canonical SUPABASE_(DEV|PROD)_DATABASE_URL name.
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

  return url;
}
