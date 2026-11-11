import { createRequire } from "node:module";
import {
  createGpt02Issue159IssuerReaderPool,
} from "./gpt02Issue159IssuerReaderPool.js";
import {
  probeGpt02Issue159IssuerReaderReadOnly,
  readGpt02Issue159IssuerLedgerReadOnly,
} from "./gpt02Issue159IssuerLedgerReadOnly.js";

type PoolLike = {
  connect(): Promise<unknown>;
  end(): Promise<void>;
};
type PoolConstructor = new (config: Record<string, unknown>) => PoolLike;
type ReaderEnvironment = Record<string, string | undefined>;

const ROLE = "gpt02_issuer_evidence_reader";
const CREDENTIAL_DIRECTORY = "/run/credentials/gpt02-issue159-issuer-reader.service";
const require = createRequire(import.meta.url);

const fail = (code: string): never => {
  const error = new Error(code);
  error.name = "Gpt02IssuerTrustedReaderError";
  throw error;
};

function loadOperationalPool(): PoolConstructor {
  let pg: unknown;
  try {
    pg = require("pg");
  } catch {
    return fail("GPT02_ISSUER_READER_PG_DRIVER_REQUIRED");
  }
  if (!pg || typeof pg !== "object" ||
      typeof (pg as Record<string, unknown>).Pool !== "function") {
    return fail("GPT02_ISSUER_READER_PG_DRIVER_REQUIRED");
  }
  return (pg as { Pool: PoolConstructor }).Pool;
}

/**
 * Trusted wrapper around the issuer ledger reader.
 *
 * Operational mode never accepts an injected pool. It creates the pool from
 * the exact systemd LoadCredential mount, then relies on the ledger reader's
 * native role/session/TLS checks before asserting persisted-read provenance.
 * Test mode can inject a fake pool but can NEVER promote that result to a
 * trusted persisted read.
 *
 * This adapter only reads. It does not consume a nonce, create a lease,
 * sign evidence, authorize, create commands, or dispatch.
 */
export function createGpt02Issue159IssuerTrustedReader({
  env = process.env,
  Pool,
  nodeEnv = env.NODE_ENV,
  appEnv = env.APP_ENV,
}: {
  env?: ReaderEnvironment;
  Pool?: PoolConstructor;
  nodeEnv?: string;
  appEnv?: string;
} = {}) {
  const synthetic = nodeEnv === "test" && appEnv !== "production";
  let PoolClass: PoolConstructor;

  if (synthetic) {
    if (typeof Pool !== "function") {
      return fail("GPT02_ISSUER_TRUSTED_READER_TEST_POOL_REQUIRED");
    }
    PoolClass = Pool;
  } else {
    if (Pool !== undefined) {
      return fail("GPT02_ISSUER_TRUSTED_READER_CALLER_POOL_FORBIDDEN");
    }
    if (nodeEnv !== "development" || appEnv !== "development") {
      return fail("GPT02_ISSUER_TRUSTED_READER_EXPLICIT_CST_DEV_MODE_REQUIRED");
    }
    if (env.CREDENTIALS_DIRECTORY !== CREDENTIAL_DIRECTORY) {
      return fail("GPT02_ISSUER_TRUSTED_READER_SYSTEMD_CREDENTIALS_REQUIRED");
    }
    PoolClass = loadOperationalPool();
  }

  const reader = createGpt02Issue159IssuerReaderPool({
    env,
    Pool: PoolClass,
    nodeEnv,
    appEnv,
  });
  const metadata = reader.metadata;
  if (metadata.environment !== "DEV" ||
      metadata.projectRef !== "xssrfshdrtdfupgqwfdw" ||
      metadata.role !== ROLE ||
      metadata.maxConnections !== 1 ||
      metadata.credentialSource !== "systemd-credential-files" ||
      metadata.credentialDirectory !== CREDENTIAL_DIRECTORY ||
      metadata.readOnlyByDefault !== true ||
      metadata.tlsPinned !== true ||
      metadata.sharedPoolFallback !== false ||
      metadata.signingPermitted !== false ||
      metadata.dispatchPermitted !== false) {
    void reader.close();
    return fail("GPT02_ISSUER_TRUSTED_READER_POOL_METADATA_INVALID");
  }

  return Object.freeze({
    metadata: Object.freeze({
      environment: "DEV" as const,
      role: ROLE,
      source: "systemd-credential-backed-issuer-reader" as const,
      credentialDirectory: CREDENTIAL_DIRECTORY,
      tlsPinned: true as const,
      readOnly: true as const,
      callerPoolInjection: false as const,
      signingPermitted: false as const,
      authorizationGranted: false as const,
      dispatchPermitted: false as const,
      releaseDecision: "NO_GO" as const,
    }),
    health: async () => {
      const result = await probeGpt02Issue159IssuerReaderReadOnly(
        reader.issuerPool as Parameters<typeof probeGpt02Issue159IssuerReaderReadOnly>[0],
      );
      return Object.freeze({
        ...result,
        environment: "DEV" as const,
        operationalTrustedReaderRuntime: !synthetic && result.readOnlySessionVerified === true,
        persistedTrustedReadProven: false as const,
        signingPermitted: false as const,
        authorizationGranted: false as const,
        dispatchPermitted: false as const,
        releaseDecision: "NO_GO" as const,
      });
    },
    read: async (input: unknown) => {
      const result = await readGpt02Issue159IssuerLedgerReadOnly(
        reader.issuerPool as Parameters<typeof readGpt02Issue159IssuerLedgerReadOnly>[0],
        input,
      );
      if (synthetic ||
          result.readOnlySessionVerified !== true ||
          result.issuerLedgerMatched !== true) {
        return result;
      }
      return Object.freeze({
        ...result,
        persistedTrustedReadProven: true as const,
        trustedReadProof: Object.freeze({
          environment: "DEV" as const,
          source: "systemd-credential-backed-issuer-reader" as const,
          role: ROLE,
          credentialSource: "systemd-credential-files" as const,
          credentialDirectory: CREDENTIAL_DIRECTORY,
          nativeRoleVerified: true as const,
          clientTlsVerified: true as const,
          readOnlySessionVerified: true as const,
          signingPermitted: false as const,
          authorizationGranted: false as const,
          dispatchPermitted: false as const,
          releaseDecision: "NO_GO" as const,
        }),
      });
    },
    close: reader.close,
  });
}
