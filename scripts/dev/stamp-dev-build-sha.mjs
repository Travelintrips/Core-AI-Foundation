/**
 * Stamp the exact build-job source SHA in a DEV Docker image. A marker copied
 * from an earlier Docker context must never certify a new QA candidate.
 * This script does not fetch credentials or access a database/network.
 */
import { rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const sourceSha = (process.env.GITHUB_SHA ?? "").trim();
const marker = resolve(process.cwd(), ".cst-build-sha");

// Always discard a stale file or symlink first, even when GITHUB_SHA is absent.
rmSync(marker, { force: true });
if (/^[a-f0-9]{40}$/i.test(sourceSha) && !/^0{40}$/.test(sourceSha)) {
  const exact = sourceSha.toLowerCase();
  writeFileSync(marker, `${exact}\n`, { mode: 0o644 });
  console.log(`CST_DEV_BUILD_SHA_STAMPED ${exact}`);
} else {
  // The health endpoint must return "unknown" rather than an older SHA.
  console.log("CST_DEV_BUILD_SHA_UNVERIFIED_MARKER_REMOVED");
}
