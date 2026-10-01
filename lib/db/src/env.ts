/**
 * Resolves the Postgres connection string for the current environment.
 *
 * Production on Hostinger uses the Supabase shared pooler. Hostinger can
 * briefly overlap old/new Node processes during a rolling deploy; transaction
 * mode (port 6543) shares the backend pool safely.
 */

function normalizedEnvironmentValue(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function isProductionDatabaseEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    normalizedEnvironmentValue(env["NODE_ENV"]) === "production" ||
    normalizedEnvironmentValue(env["APP_ENV"]) === "production"
  );
}

function projectRefFromSupabaseUrl(env: NodeJS.ProcessEnv): string | null {
  for (const key of ["SUPABASE_URL", "VITE_SUPABASE_URL"]) {
    const value = env[key];
    if (!value) continue;
    try {
      const host = new URL(value).hostname.toLowerCase();
      const match = /^([a-z0-9-]+)\.supabase\.co$/.exec(host);
      if (match?.[1]) return match[1];
    } catch {
      // Ignore malformed metadata URLs. The database URL validation below
      // remains authoritative for the actual connection.
    }
  }
  return null;
}

export function normalizeProductionPoolerUrl(
  value: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  try {
    const parsed = new URL(value);
    if (!parsed.hostname.endsWith(".pooler.supabase.com")) return value;

    // Supavisor's shared pooler requires the tenant/project ref in the
    // username (postgres.<project-ref>). A direct-connection username of plain
    // "postgres" otherwise reaches the pooler but fails authentication.
    if (parsed.username === "postgres") {
      const projectRef = projectRefFromSupabaseUrl(env);
      if (projectRef) parsed.username = `postgres.${projectRef}`;
    }

    const forceSession =
      normalizedEnvironmentValue(env["SUPABASE_FORCE_SESSION_POOLER"]) === "true";
    if (!forceSession && parsed.port === "5432") {
      parsed.port = "6543";
    }

    return parsed.toString();
  } catch {
    // Keep the original value; node-postgres will report a precise connection
    // error if the supplied URL itself is malformed.
    return value;
  }
}

export function resolveDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const isProduction = isProductionDatabaseEnvironment(env);

  const url = isProduction
    ? env["SUPABASE_PROD_DATABASE_URL"] || env["SUPABASE_DATABASE_URL"]
    : env["SUPABASE_DEV_DATABASE_URL"] || env["SUPABASE_DATABASE_URL_DEV"];

  if (!url) {
    const missingVar = isProduction
      ? "SUPABASE_PROD_DATABASE_URL"
      : "SUPABASE_DEV_DATABASE_URL";
    throw new Error(
      `${missingVar} must be set. Did you forget to configure the Supabase connection string?`,
    );
  }

  return isProduction ? normalizeProductionPoolerUrl(url, env) : url;
}
