/**
 * CST-DEV model one-job: pin the public Supabase Root 2021 CA. Do NOT trust
 * whatever certificate is sent by an unauthenticated pooler as a new root.
 * This module never downloads anything, changes global trust or contacts DB.
 */
import { X509Certificate } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";

export const CST_ONEJOB_DEV_CA_PATH =
  "/run/cst-onejob-dev-db/ca/prod-ca-2021.crt";
export const CST_ONEJOB_SUPABASE_CA_FINGERPRINT =
  "807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA";

export function loadPinnedCstDevSupabaseRootCa(
  path: string = CST_ONEJOB_DEV_CA_PATH,
): Buffer {
  let info;
  try { info = lstatSync(path); }
  catch { throw Error("CST_DEV_ONEJOB_CA_NOT_AVAILABLE"); }
  if (!info.isFile() || info.isSymbolicLink() ||
      info.size < 500 || info.size > 8_192 ||
      (info.mode & 0o022) !== 0) {
    throw Error("CST_DEV_ONEJOB_CA_FILE_NOT_TRUSTED");
  }
  let pem: Buffer;
  let cert: X509Certificate;
  try {
    pem = readFileSync(path);
    cert = new X509Certificate(pem);
  } catch {
    throw Error("CST_DEV_ONEJOB_CA_INVALID_PEM");
  }
  const actual = cert.fingerprint256.replace(/:/g,"").toUpperCase();
  if (actual !== CST_ONEJOB_SUPABASE_CA_FINGERPRINT ||
      cert.ca !== true || cert.verify(cert.publicKey) !== true) {
    throw Error("CST_DEV_ONEJOB_CA_FINGERPRINT_MISMATCH");
  }
  return pem;
}


/**
 * Direct, bounded PostgreSQL client options for CST-DEV one-job staging and
 * admission. Both require verify-full in the validated DSN, but neither
 * passes that URL to node-postgres: an sslmode URL option would overwrite
 * the explicit pinned CA supplied below.
 *
 * This module does not connect, issue credentials, or authorize a job.
 */
export const CST_ONEJOB_DEV_POOLER = "aws-1-ap-southeast-2.pooler.supabase.com";
const CST_ONEJOB_DEV_PROJECT = "xssrfshdrtdfupgqwfdw";
// Dedicated narrow service principals only. These names are SOURCE ALLOWLIST
// entries, not grants or LOGIN activation in CST-DEV.
export const CST_ONEJOB_DEV_DEDICATED_LOGINS = Object.freeze([
  "cst_team_model_pilot_stage_login",
  "cst_onejob_broker_login",
  "cst_onejob_qa_receipt_login",
  "cst_onejob_subscriber_login",
  "cst_onejob_finalack_login",
] as const);
export type CstOneJobDedicatedLogin =
  (typeof CST_ONEJOB_DEV_DEDICATED_LOGINS)[number];

export function createPinnedCstOneJobPgConnection(
  connectionUrl: string,
  dedicatedLogin: CstOneJobDedicatedLogin,
  pinnedCaFile: string = CST_ONEJOB_DEV_CA_PATH,
) {
  if (!CST_ONEJOB_DEV_DEDICATED_LOGINS.includes(dedicatedLogin))
    throw Error("CST_DEV_ONEJOB_LOGIN_NOT_ALLOWED");
  let url: URL;
  try { url = new URL(connectionUrl); }
  catch { throw Error("CST_DEV_ONEJOB_DATABASE_URL_INVALID"); }
  let username: string, password: string;
  try {
    username = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password);
  } catch { throw Error("CST_DEV_ONEJOB_DATABASE_IDENTITY_INVALID"); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) ||
      url.hostname !== CST_ONEJOB_DEV_POOLER ||
      url.port !== "6543" ||
      url.pathname !== "/postgres" ||
      username !== dedicatedLogin + "." + CST_ONEJOB_DEV_PROJECT ||
      password.length < 16 ||
      url.searchParams.size !== 1 ||
      url.searchParams.get("sslmode") !== "verify-full" ||
      url.hash !== "")
    throw Error("CST_DEV_ONEJOB_DATABASE_SCOPE_OR_TLS_DENIED");
  const trustedCa = loadPinnedCstDevSupabaseRootCa(pinnedCaFile);
  return {
    host: CST_ONEJOB_DEV_POOLER,
    port: 6543,
    database: "postgres",
    user: username,
    password,
    ssl: {
      rejectUnauthorized: true as const,
      ca: trustedCa,
      servername: CST_ONEJOB_DEV_POOLER,
    },
  };
}
