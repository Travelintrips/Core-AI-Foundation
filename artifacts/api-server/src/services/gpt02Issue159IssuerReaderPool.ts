import { X509Certificate } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";

const PROJECT_REF = "xssrfshdrtdfupgqwfdw";
const POOLER_HOST = "aws-1-ap-southeast-2.pooler.supabase.com";
const DATABASE = "postgres";
const ROLE = "gpt02_issuer_evidence_reader";
const DSN_ENV = "GPT02_ISSUER_READER_DATABASE_URL_DEV";
const CA_ENV = "GPT02_READER_DEV_CA";
const CREDENTIAL_DIR = "/run/credentials/gpt02-dev";
const DSN_CREDENTIAL = "issuer-reader-dsn";
const CA_CREDENTIAL = "supabase-root-ca-2021.crt";
const PINNED_ROOT_FINGERPRINT =
  "807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa";

const fail = (code: string): never => {
  const error = new Error(code);
  error.name = "Gpt02IssuerReaderPoolError";
  throw error;
};

type PoolLike = {
  connect(): Promise<unknown>;
  end(): Promise<void>;
};
type PoolConstructor = new (config: Record<string, unknown>) => PoolLike;
type ReaderEnvironment = Record<string, string | undefined>;

function pinnedReaderCa(pem: string | undefined): string {
  if (
    typeof pem !== "string" ||
    pem.length > 8192 ||
    !/^-----BEGIN CERTIFICATE-----\r?\n(?:[A-Za-z0-9+/=]+\r?\n)+-----END CERTIFICATE-----\r?\n?$/.test(pem)
  ) {
    return fail("GPT02_ISSUER_READER_PINNED_CA_REQUIRED");
  }
  try {
    const certificate = new X509Certificate(pem);
    const fingerprint = certificate.fingerprint256.replaceAll(":", "").toLowerCase();
    if (!certificate.ca || fingerprint !== PINNED_ROOT_FINGERPRINT) {
      return fail("GPT02_ISSUER_READER_PINNED_CA_REQUIRED");
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "GPT02_ISSUER_READER_PINNED_CA_REQUIRED"
    ) throw error;
    return fail("GPT02_ISSUER_READER_PINNED_CA_REQUIRED");
  }
  return pem;
}


function readCredentialFile(path: string, synthetic: boolean): string {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    return fail("GPT02_ISSUER_READER_CREDENTIAL_FILE_REQUIRED");
  }
  const mode = stat.mode & 0o777;
  const uid = synthetic ? (process.getuid?.() ?? stat.uid) : 0;
  const gid = synthetic ? (process.getgid?.() ?? stat.gid) : 0;
  if (!stat.isFile() || stat.isSymbolicLink() ||
      stat.uid !== uid || stat.gid !== gid ||
      ![0o400, 0o600].includes(mode)) {
    return fail("GPT02_ISSUER_READER_CREDENTIAL_FILE_SECURITY_INVALID");
  }
  let value: string;
  try {
    value = readFileSync(path, "utf8");
  } catch {
    return fail("GPT02_ISSUER_READER_CREDENTIAL_FILE_REQUIRED");
  }
  if (!value || value.length > 8192) {
    return fail("GPT02_ISSUER_READER_CREDENTIAL_FILE_INVALID");
  }
  return value;
}

function parseIssuerReaderDsn(value: string | undefined) {
  if (typeof value !== "string" || value.length < 1 || value.length > 4096) {
    return fail("GPT02_ISSUER_READER_DSN_REQUIRED");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail("GPT02_ISSUER_READER_DSN_INVALID");
  }

  if (
    (url.protocol !== "postgresql:" && url.protocol !== "postgres:") ||
    url.hostname !== POOLER_HOST ||
    Number(url.port || 5432) !== 5432 ||
    url.pathname !== "/" + DATABASE
  ) {
    return fail("GPT02_ISSUER_READER_CST_DEV_TARGET_REQUIRED");
  }

  let username: string;
  try {
    username = decodeURIComponent(url.username);
  } catch {
    return fail("GPT02_ISSUER_READER_DSN_INVALID");
  }

  if (username !== ROLE + "." + PROJECT_REF || !url.password) {
    return fail("GPT02_ISSUER_READER_DEDICATED_IDENTITY_REQUIRED");
  }
  if (url.hash || url.searchParams.size !== 0) {
    return fail("GPT02_ISSUER_READER_DSN_QUERY_FORBIDDEN");
  }

  return Object.freeze({ connectionString: value });
}

/**
 * Creates one dedicated, maximum-one-connection CST-DEV issuer reader pool.
 *
 * The DSN is mandatory and pinned to the issuer-only Postgres role. There is
 * no application-pool fallback, no shared Hub/Core reader fallback, and no
 * production mode. The returned pool is read-only from PostgreSQL startup.
 *
 * Pool is injected so source tests do not import or instantiate the shared
 * application DB pool. Runtime integration must pass the installed pg.Pool
 * constructor explicitly and must separately prove native DB identity/TLS.
 */
export function createGpt02Issue159IssuerReaderPool({
  env = process.env,
  Pool,
  nodeEnv = process.env.NODE_ENV,
  appEnv = process.env.APP_ENV,
  credentialDirectory = CREDENTIAL_DIR,
}: {
  env?: ReaderEnvironment;
  Pool: PoolConstructor;
  nodeEnv?: string;
  appEnv?: string;
  credentialDirectory?: string;
}) {
  const synthetic = nodeEnv === "test" && appEnv !== "production";

  if (env.NODE_TLS_REJECT_UNAUTHORIZED === "0") {
    return fail("GPT02_ISSUER_READER_TLS_DISABLE_FORBIDDEN");
  }
  if (!synthetic && (nodeEnv !== "development" || appEnv !== "development")) {
    return fail("GPT02_ISSUER_READER_EXPLICIT_CST_DEV_MODE_REQUIRED");
  }
  if (typeof Pool !== "function") {
    return fail("GPT02_ISSUER_READER_POOL_FACTORY_REQUIRED");
  }

  let dsnValue: string | undefined;
  let caValue: string | undefined;
  if (synthetic) {
    const hasSyntheticEnv = typeof env[DSN_ENV] === "string" ||
      typeof env[CA_ENV] === "string";
    if (hasSyntheticEnv) {
      dsnValue = env[DSN_ENV];
      caValue = env[CA_ENV];
    } else {
      dsnValue = readCredentialFile(`${credentialDirectory}/${DSN_CREDENTIAL}`, true);
      caValue = readCredentialFile(`${credentialDirectory}/${CA_CREDENTIAL}`, true);
    }
  } else {
    if (credentialDirectory !== CREDENTIAL_DIR ||
        typeof env[DSN_ENV] === "string" || typeof env[CA_ENV] === "string") {
      return fail("GPT02_ISSUER_READER_OPERATIONAL_CREDENTIAL_SOURCE_NOT_PINNED");
    }
    assertCredentialDirectory(CREDENTIAL_DIR);
    dsnValue = readCredentialFile(`${CREDENTIAL_DIR}/${DSN_CREDENTIAL}`, false);
    caValue = readCredentialFile(`${CREDENTIAL_DIR}/${CA_CREDENTIAL}`, false);
  }
  const ca = pinnedReaderCa(caValue);
  const dsn = parseIssuerReaderDsn(dsnValue);

  for (const sharedName of [
    "SUPABASE_DATABASE_URL_DEV",
    "SUPABASE_DATABASE_URL",
    "GPT02_HUB_READER_DATABASE_URL_DEV",
    "GPT02_CORE_READER_DATABASE_URL_DEV",
  ]) {
    const shared = env[sharedName];
    if (typeof shared === "string" && shared.length > 0 && shared === dsn.connectionString) {
      return fail("GPT02_ISSUER_READER_SHARED_DSN_FORBIDDEN");
    }
  }

  const pool = new Pool({
    connectionString: dsn.connectionString,
    max: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
    ssl: { ca, rejectUnauthorized: true },
    options:
      "-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=10000 -c row_security=on",
    application_name: "gpt02-issuer-evidence-reader",
    // Supabase's session pooler rejects search_path in libpq startup options.
    // Apply the safe path after the connection is established and before it
    // can be handed to a caller (same verified pool initialization hook used by the existing application DB).
    verify: (client: { query(sql: string): Promise<unknown> }, done: (error?: Error) => void) => {
      client.query("SET search_path TO pg_catalog")
        .then(() => done())
        .catch((error: unknown) => done(error instanceof Error ? error : new Error("GPT02_ISSUER_READER_SESSION_INIT_FAILED")));
    },
    allowExitOnIdle: true,
  });

  if (!pool || typeof pool.connect !== "function" || typeof pool.end !== "function") {
    return fail("GPT02_ISSUER_READER_POOL_INVALID");
  }

  return Object.freeze({
    issuerPool: pool,
    close: () => pool.end(),
    metadata: Object.freeze({
      environment: "DEV" as const,
      projectRef: PROJECT_REF,
      host: POOLER_HOST,
      database: DATABASE,
      role: ROLE,
      maxConnections: 1 as const,
      independentCredentialsRequired: true as const,
      credentialSource: "systemd-credential-files" as const,
      credentialDirectory: CREDENTIAL_DIR,
      readOnlyByDefault: true as const,
      tlsPinned: true as const,
      sharedPoolFallback: false as const,
      dispatchPermitted: false as const,
      signingPermitted: false as const,
    }),
  });
}
