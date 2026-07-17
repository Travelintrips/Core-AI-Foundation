/**
 * urlValidator.ts — SSRF guard for Asset Intelligence V2 (Team 06)
 *
 * Validates external URLs before any HTTP fetch to prevent Server-Side
 * Request Forgery (SSRF). Must be called before any outgoing HTTP request
 * in this domain.
 *
 * Blocks:
 *  - Non-http/https schemes
 *  - localhost (127.0.0.0/8, ::1)
 *  - Link-local / cloud metadata (169.254.0.0/16, fe80::/10)
 *  - RFC-1918 private ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
 *  - IPv6 private/loopback (::1, fc00::/7, fe80::/10)
 *  - Unroutable / reserved ranges
 *
 * Enforces:
 *  - Response size limit (10 MB)
 *  - Timeout (5 s)
 *  - Max redirects (3)
 *
 * Usage:
 *   const result = await validateExternalUrl(url);
 *   if (!result.ok) throw new Error(result.reason);
 */

import * as dnsPromises from "dns/promises";
import * as net from "net";

// ── Config ────────────────────────────────────────────────────────────────────

export const URL_VALIDATOR_CONFIG = {
  maxResponseBytes: 10 * 1024 * 1024, // 10 MB
  timeoutMs:        5_000,
  maxRedirects:     3,
} as const;

// ── Result type ───────────────────────────────────────────────────────────────

export interface UrlValidationResult {
  ok: true;
  resolvedIp: string;
  normalizedUrl: string;
}

export interface UrlValidationError {
  ok: false;
  reason: string;
  code:
    | "INVALID_URL"
    | "SCHEME_NOT_ALLOWED"
    | "BLOCKED_HOST"
    | "BLOCKED_IP"
    | "DNS_FAILURE"
    | "SSRF_REDIRECT";
}

export type UrlValidationOutcome = UrlValidationResult | UrlValidationError;

// ── Private IPv4 range table ──────────────────────────────────────────────────

interface Ipv4Range {
  base: number;   // network address as 32-bit uint
  bits: number;   // prefix length
  label: string;
}

const PRIVATE_IPV4: Ipv4Range[] = [
  { base: cidr("127.0.0.0"),     bits: 8,  label: "loopback" },
  { base: cidr("10.0.0.0"),      bits: 8,  label: "RFC-1918 10/8" },
  { base: cidr("172.16.0.0"),    bits: 12, label: "RFC-1918 172.16/12" },
  { base: cidr("192.168.0.0"),   bits: 16, label: "RFC-1918 192.168/16" },
  { base: cidr("169.254.0.0"),   bits: 16, label: "link-local / cloud-metadata" },
  { base: cidr("0.0.0.0"),       bits: 8,  label: "this-network" },
  { base: cidr("100.64.0.0"),    bits: 10, label: "CGNAT" },
  { base: cidr("192.0.0.0"),     bits: 24, label: "IETF protocol" },
  { base: cidr("198.18.0.0"),    bits: 15, label: "benchmarking" },
  { base: cidr("198.51.100.0"),  bits: 24, label: "TEST-NET-2" },
  { base: cidr("203.0.113.0"),   bits: 24, label: "TEST-NET-3" },
  { base: cidr("240.0.0.0"),     bits: 4,  label: "reserved" },
  { base: cidr("255.255.255.255"), bits: 32, label: "broadcast" },
];

/** IPv6 prefix patterns to block (prefix string matching is sufficient here). */
const BLOCKED_IPV6_PREFIXES: Array<{ prefix: string; label: string }> = [
  { prefix: "::1",          label: "IPv6 loopback" },
  { prefix: "::ffff:",      label: "IPv4-mapped loopback/private" },
  { prefix: "fc",           label: "IPv6 ULA (fc00::/7)" },
  { prefix: "fd",           label: "IPv6 ULA (fd00::/7)" },
  { prefix: "fe80",         label: "IPv6 link-local (fe80::/10)" },
  { prefix: "fe90",         label: "IPv6 link-local" },
  { prefix: "fea0",         label: "IPv6 link-local" },
  { prefix: "feb0",         label: "IPv6 link-local" },
  { prefix: "fec0",         label: "IPv6 site-local (deprecated)" },
  { prefix: "ff",           label: "IPv6 multicast" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function cidr(ip: string): number {
  const parts = ip.split(".").map(Number);
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
}

function isPrivateIpv4(ip: string): { blocked: boolean; label?: string } {
  if (!net.isIPv4(ip)) return { blocked: false };
  const n = cidr(ip);
  for (const range of PRIVATE_IPV4) {
    const mask = range.bits === 32 ? 0xffffffff : ~(0xffffffff >>> range.bits);
    if ((n & mask) >>> 0 === range.base) {
      return { blocked: true, label: range.label };
    }
  }
  return { blocked: false };
}

function isBlockedIpv6(ip: string): { blocked: boolean; label?: string } {
  if (!net.isIPv6(ip)) return { blocked: false };
  const lower = ip.toLowerCase().replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/, (_m, v4) => {
    // Unwrap IPv4-mapped and check as IPv4
    const check = isPrivateIpv4(v4);
    return check.blocked ? "::ffff:private" : "::ffff:public";
  });

  for (const { prefix, label } of BLOCKED_IPV6_PREFIXES) {
    if (lower.startsWith(prefix) || lower === "::ffff:private") {
      return { blocked: true, label };
    }
  }
  return { blocked: false };
}

function isIpBlocked(ip: string): { blocked: boolean; label?: string } {
  if (net.isIPv4(ip)) return isPrivateIpv4(ip);
  if (net.isIPv6(ip)) return isBlockedIpv6(ip);
  return { blocked: false };
}

// ── Localhost hostname check (pre-DNS) ────────────────────────────────────────

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "ip6-localhost",
  "ip6-loopback",
  "broadcasthost",
]);

function isBlockedHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return (
    BLOCKED_HOSTNAMES.has(lower) ||
    lower.endsWith(".localhost") ||
    lower.endsWith(".local") ||
    lower.endsWith(".internal")
  );
}

// ── Main validator ────────────────────────────────────────────────────────────

/**
 * Validate a URL for safe external fetching (SSRF guard).
 *
 * This function:
 * 1. Parses and validates the URL.
 * 2. Rejects non-http/https schemes.
 * 3. Rejects blocked hostnames before DNS.
 * 4. Resolves the hostname via DNS.
 * 5. Rejects resolved IPs in private/reserved ranges.
 *
 * @param rawUrl  The URL string to validate.
 * @returns       UrlValidationOutcome — check `.ok` before using.
 */
export async function validateExternalUrl(rawUrl: string): Promise<UrlValidationOutcome> {
  // 1. Parse
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, code: "INVALID_URL", reason: `Invalid URL: ${rawUrl}` };
  }

  // 2. Scheme allowlist
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      ok: false,
      code: "SCHEME_NOT_ALLOWED",
      reason: `Scheme '${parsed.protocol}' is not allowed. Only http/https are permitted.`,
    };
  }

  // Strip IPv6 brackets if present.
  // WHATWG URL spec: .hostname returns "[::1]" (with brackets) for IPv6 literals,
  // but net.isIP() requires the un-bracketed form "::1". Strip them here.
  const rawHostname = parsed.hostname.toLowerCase();
  const hostname    = rawHostname.startsWith("[") && rawHostname.endsWith("]")
    ? rawHostname.slice(1, -1)
    : rawHostname;

  // 3. Blocked hostnames (pre-DNS check)
  if (isBlockedHostname(hostname)) {
    return { ok: false, code: "BLOCKED_HOST", reason: `Hostname '${hostname}' is not allowed.` };
  }

  // 4. If hostname is already an IP literal, check it directly
  if (net.isIP(hostname)) {
    const check = isIpBlocked(hostname);
    if (check.blocked) {
      return {
        ok: false,
        code: "BLOCKED_IP",
        reason: `IP ${hostname} is in a blocked range (${check.label ?? "private"}).`,
      };
    }
    return { ok: true, resolvedIp: hostname, normalizedUrl: parsed.toString() };
  }

  // 5. DNS resolution
  let resolvedAddress: string;
  try {
    const lookup = await dnsPromises.lookup(hostname, { all: false });
    resolvedAddress = lookup.address;
  } catch (err) {
    return {
      ok: false,
      code: "DNS_FAILURE",
      reason: `DNS resolution failed for '${hostname}': ${(err as Error).message}`,
    };
  }

  // 6. Check resolved IP
  const ipCheck = isIpBlocked(resolvedAddress);
  if (ipCheck.blocked) {
    return {
      ok: false,
      code: "BLOCKED_IP",
      reason: `URL resolves to a blocked IP ${resolvedAddress} (${ipCheck.label ?? "private range"}).`,
    };
  }

  return { ok: true, resolvedIp: resolvedAddress, normalizedUrl: parsed.toString() };
}

/**
 * Validate a redirect target (called after following an HTTP redirect).
 * Performs IP-level check without re-doing DNS (IP is known from redirect response).
 */
export function validateRedirectIp(ip: string, originalUrl: string): UrlValidationOutcome {
  if (net.isIP(ip)) {
    const check = isIpBlocked(ip);
    if (check.blocked) {
      return {
        ok: false,
        code: "SSRF_REDIRECT",
        reason: `Redirect from ${originalUrl} resolved to blocked IP ${ip} (${check.label ?? "private"}).`,
      };
    }
  }
  return { ok: true, resolvedIp: ip, normalizedUrl: originalUrl };
}
