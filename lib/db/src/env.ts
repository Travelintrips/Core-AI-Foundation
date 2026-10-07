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

function projectRefFromMetadataUrl(
  value: string | undefined,
): string | null {
  if (!value) return null;
  try {
    const host = new URL(value).hostname.toLowerCase();
    const match = /^([a-z0-9-]+)\.supabase\.co$/.exec(host);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function projectRefFromSupabaseUrl(env: NodeJS.ProcessEnv): string | null {
  for (const key of ["SUPABASE_URL", "VITE_SUPABASE_URL"]) {
    const projectRef = projectRefFromMetadataUrl(env[key]);
    if (projectRef) return projectRef;
  }
  return null;
}

function projectRefFromDevSupabaseUrl(env: NodeJS.ProcessEnv): string | null {
  for (const key of ["SUPABASE_URL_DEV", "VITE_SUPABASE_URL_DEV"]) {
    const projectRef = projectRefFromMetadataUrl(env[key]);
    if (projectRef) return projectRef;
  }
  return null;
}

function projectRefFromDatabaseUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    const directMatch = /^db\.([a-z0-9-]+)\.supabase\.co$/.exec(
      parsed.hostname.toLowerCase(),
    );
    if (directMatch?.[1]) return directMatch[1];

    if (parsed.hostname.toLowerCase().endsWith(".pooler.supabase.com")) {
      const usernameMatch = /^postgres\.([a-z0-9-]+)$/i.exec(parsed.username);
      if (usernameMatch?.[1]) return usernameMatch[1].toLowerCase();
    }
  } catch {
    // The caller will pass the original URL to node-postgres, which reports
    // malformed URLs precisely. Isolation checks only act on parseable refs.
  }
  return null;
}

function assertDevelopmentDatabaseIsolation(
  value: string,
  env: NodeJS.ProcessEnv,
): void {
  const expectedDevRef = projectRefFromDevSupabaseUrl(env);
  const productionRef = projectRefFromSupabaseUrl(env);
  const actualRef = projectRefFromDatabaseUrl(value);

  if (expectedDevRef && !actualRef) {
    throw new Error(
      "Development database isolation check failed: the active database URL does not expose a Supabase project ref.",
    );
  }

  if (expectedDevRef && actualRef !== expectedDevRef) {
    throw new Error(
      `Development database isolation check failed: expected Supabase DEV project ${expectedDevRef}, got ${actualRef ?? "unknown"}.`,
    );
  }

  if (productionRef && actualRef === productionRef) {
    throw new Error(
      "Development database isolation check failed: production Supabase is configured as the active DEV database.",
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

  if (!isProduction) {
    assertDevelopmentDatabaseIsolation(url, env);
    return url;
  }

  return normalizeProductionPoolerUrl(url, env);
}
