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
