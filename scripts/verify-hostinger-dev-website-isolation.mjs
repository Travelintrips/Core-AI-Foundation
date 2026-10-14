/**
 * Fail-closed Hostinger DEV virtual-host identity guard.
 *
 * A Hostinger CloudLinux username identifies a hosting account, not necessarily
 * a single website. Several isolated website roots can share that username.
 * This verifies the actual website resources while preserving explicit domain
 * scoping for all DEV mutation endpoints.
 *
 * Never print hosting usernames, document roots or API responses to logs.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const normalizeDomain = (value) =>
  typeof value === "string" ? value.trim().toLowerCase().replace(/\.$/, "") : "";

function deny(reason) {
  throw new Error("HOSTINGER_DEV_SITE_ISOLATION_BLOCKED:" + reason);
}

export function verifyHostingerDevWebsiteIsolation(
  payload,
  devDomain,
  prodDomain,
  expectedDevUsername,
) {
  const dev = normalizeDomain(devDomain);
  const prod = normalizeDomain(prodDomain);
  if (!dev || !prod || dev === prod) deny("DOMAIN_COLLISION");
  if (!payload || !Array.isArray(payload.data)) deny("INVALID_WEBSITE_INVENTORY");

  const matches = (domain) => payload.data.filter(
    (site) => site && site.is_enabled === true &&
      normalizeDomain(site.domain) === domain,
  );
  const devSites = matches(dev);
  const prodSites = matches(prod);
  if (devSites.length !== 1 || prodSites.length !== 1) {
    deny("MISSING_OR_AMBIGUOUS_WEBSITE");
  }

  const devSite = devSites[0];
  const prodSite = prodSites[0];
  const username = typeof devSite.username === "string"
    ? devSite.username.trim() : "";
  const prodUsername = typeof prodSite.username === "string"
    ? prodSite.username.trim() : "";
  if (!username || !prodUsername || username !== expectedDevUsername) {
    deny("HOSTING_ACCOUNT_IDENTITY_MISSING_OR_MISMATCH");
  }

  const devRoot = typeof devSite.root_directory === "string"
    ? devSite.root_directory.trim().replace(/\/+$/, "") : "";
  const prodRoot = typeof prodSite.root_directory === "string"
    ? prodSite.root_directory.trim().replace(/\/+$/, "") : "";
  // Reject aliases and any missing or common filesystem root. A shared
  // account username is allowed only when the virtual hosts are independent.
  const vhostType = String(devSite.vhost_type ?? "").toLowerCase();
  if (!devRoot || !prodRoot) deny("UNVERIFIABLE_WEBSITE_ROOT");
  if (devRoot === prodRoot) deny("SHARED_WEBSITE_ROOT");
  if (normalizeDomain(devSite.parent_domain) === prod) {
    deny("DEV_PARKED_ON_PROD");
  }
  if (vhostType === "parked" || vhostType === "alias") {
    deny("DEV_ALIAS_NOT_ISOLATED");
  }
  return { safe: true, resource: "distinct-website-roots" };
}

if (process.argv[1] &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [, , filename, devDomain, prodDomain, devUsername] = process.argv;
    if (!filename || !devDomain || !prodDomain || !devUsername) {
      deny("INVALID_INVOCATION");
    }
    const payload = JSON.parse(readFileSync(filename, "utf8"));
    verifyHostingerDevWebsiteIsolation(
      payload,
      devDomain,
      prodDomain,
      devUsername,
    );
    console.log("hostinger_dev_site_isolation=PASS distinct_roots=true");
  } catch (error) {
    console.error("::error::" + (error instanceof Error ? error.message : "HOSTINGER_DEV_SITE_ISOLATION_BLOCKED"));
    process.exitCode = 1;
  }
}
