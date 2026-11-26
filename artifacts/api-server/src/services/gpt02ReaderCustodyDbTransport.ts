/**
 * Explicit CST-DEV-only transport pins for the GPT02-1782 separate reader.
 * The sealed credential still names the native PostgreSQL ROLE; Supavisor
 * session mode requires ROLE.project_ref as the wire login, but the database
 * session_user/current_user MUST remain the native role and be checked by
 * each caller. No production, transaction pooler, dynamic host or fallback.
 */
export const GPT02_CUSTODY_PROJECT = "xssrfshdrtdfupgqwfdw" as const;
export const GPT02_CUSTODY_READER_ROLE = "gpt02_owner_ledger_reader_1782_dev" as const;
export const GPT02_CUSTODY_DIRECT_HOST = "db.xssrfshdrtdfupgqwfdw.supabase.co" as const;
export const GPT02_CUSTODY_SESSION_POOLER_HOST = "aws-0-ap-southeast-2.pooler.supabase.com" as const;

export type Gpt02PinnedReaderDbTransport = Readonly<{
  host: typeof GPT02_CUSTODY_DIRECT_HOST | typeof GPT02_CUSTODY_SESSION_POOLER_HOST;
  port: 5432;
  database: "postgres";
  databaseUser: string;
  tlsServerName: string;
  mode: "direct" | "session-pooler";
}>;

export function resolveGpt02ReaderDbTransport(config: {
  host?: unknown; port?: unknown; database?: unknown; user?: unknown;
  projectId?: unknown; sslMode?: unknown;
}): Gpt02PinnedReaderDbTransport | null {
  if (config.projectId !== GPT02_CUSTODY_PROJECT ||
      config.user !== GPT02_CUSTODY_READER_ROLE ||
      config.database !== "postgres" || config.port !== 5432 ||
      config.sslMode !== "verify-full") return null;

  if (config.host === GPT02_CUSTODY_DIRECT_HOST) {
    return Object.freeze({
      host: GPT02_CUSTODY_DIRECT_HOST, port: 5432, database: "postgres",
      databaseUser: GPT02_CUSTODY_READER_ROLE, tlsServerName: GPT02_CUSTODY_DIRECT_HOST, mode: "direct",
    });
  }
  if (config.host === GPT02_CUSTODY_SESSION_POOLER_HOST) {
    return Object.freeze({
      host: GPT02_CUSTODY_SESSION_POOLER_HOST, port: 5432, database: "postgres",
      databaseUser: `${GPT02_CUSTODY_READER_ROLE}.${GPT02_CUSTODY_PROJECT}`,
      tlsServerName: GPT02_CUSTODY_SESSION_POOLER_HOST, mode: "session-pooler",
    });
  }
  return null;
}
