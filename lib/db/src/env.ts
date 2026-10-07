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

function projectRefFromUrlValue(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const host = new URL(value).hostname.toLowerCase();
    const direct = /^([a-z0-9-]+)\.supabase\.co$/.exec(host);
    if (direct?.[1]) return direct[1];

    if (host.endsWith(".pooler.supabase.com")) {
      const parsed = new URL(value);
      const username = decodeURIComponent(parsed.username);
      const pooled = /^postgres\.([a-z0-9-]+)$/.exec(username);
      if (pooled?.[1]) return pooled[1];
    }
  } catch {
    return null;
  }
  return null;
}

function projectRefFromSupabaseUrl(
  env: NodeJS.ProcessEnv,
  keys: string[],
): string | null {
  for (const key of keys) {
    const projectRef = projectRefFromUrlValue(env[key]);
    if (projectRef) return projectRef;
  }
  return null;
}

export function assertDevelopmentDatabaseIsolation(
  databaseUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (isProductionDatabaseEnvironment(env)) return;

  const expectedDevRef = projectRefFromSupabaseUrl(env, [
    "SUPABASE_URL_DEV",
    "VITE_SUPABASE_URL_DEV",
  ]);
  const activeDatabaseRef = projectRefFromUrlValue(databaseUrl);

  if (!expectedDevRef) {
    throw new Error(
      "SUPABASE_URL_DEV (or VITE_SUPABASE_URL_DEV) must be set in development so the database project can be verified.",
    );
  }

  if (!activeDatabaseRef) {
    throw new Error(
      "Development database URL must identify a Supabase project ref; refusing an unverifiable database connection.",
    );
  }

  if (activeDatabaseRef !== expectedDevRef) {
    throw new Error(
      `Development database isolation violation: active project ${activeDatabaseRef} does not match configured DEV project ${expectedDevRef}.`,
    );
  }
}

export function normalizeProductionPoolerUrl(
  value: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  try {
    const parsed = new URL(value);
    if (!parsed.hostname.endsWith(".pooler.supabase.com")) return value;

    if (parsed.username === "postgres") {
      const projectRef = projectRefFromSupabaseUrl(env, [
        "SUPABASE_URL",
        "VITE_SUPABASE_URL",
      ]);
      if (projectRef) parsed.username = `postgres.${projectRef}`;
    }

    const forceSession =
      normalizedEnvironmentValue(env["SUPABASE_FORCE_SESSION_POOLER"]) === "true";
    if (!forceSession && parsed.port === "5432") {
      parsed.port = "6543";
    }

    return parsed.toString();
  } catch {
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

  if (!isProduction) {
    assertDevelopmentDatabaseIsolation(url, env);
    return url;
  }

  return normalizeProductionPoolerUrl(url, env);
}
