/**
 * Universal Catalog Import — Website Adapter
 * Extracts material catalog data from public websites.
 *
 * Pipeline:
 *   1. Fetch robots.txt → stop if disallowed
 *   2. Attempt JSON-LD extraction
 *   3. Attempt embedded JSON in <script> tags
 *   4. Attempt sitemap-linked product pages (shallow, max 20 URLs)
 *   5. Semantic HTML extraction (structured product markup)
 *
 * Hard stops:
 *   - robots.txt Disallow
 *   - Login required (redirect to /login, /signin, /auth)
 *   - CAPTCHA detected
 *   - Anti-bot response (403 with known patterns)
 */

import type { CatalogAdapter, AdapterInput, AdapterResult, RawExtractedItem } from "../types.js";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_SITEMAP_URLS = 20;
const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024; // 5 MB per page

export class WebsiteAdapter implements CatalogAdapter {
  readonly sourceType = "website" as const;
  readonly displayName = "Public Website Catalog";
  readonly supportedMimeTypes = ["text/html"];

  async extract(input: AdapterInput): Promise<AdapterResult> {
    const warnings: string[] = [];
    const errors: string[] = [];

    if (!input.url) {
      return { rawItems: [], warnings, errors: ["No URL provided for website adapter"], sourceMetadata: {} };
    }

    let targetUrl: URL;
    try {
      targetUrl = new URL(input.url);
      if (targetUrl.protocol !== "https:") {
        return { rawItems: [], warnings, errors: ["Only HTTPS URLs are permitted"], sourceMetadata: {} };
      }
    } catch {
      return { rawItems: [], warnings, errors: ["Invalid URL provided"], sourceMetadata: {} };
    }

    // ── Step 1: robots.txt check ──────────────────────────────────────────────
    const robotsBlocked = await checkRobots(targetUrl);
    if (robotsBlocked) {
      return {
        rawItems: [],
        warnings,
        errors: ["robots.txt disallows crawling this URL. Stopping as required."],
        sourceMetadata: { url: input.url, robotsBlocked: true },
      };
    }

    // ── Step 2: Fetch the target page ─────────────────────────────────────────
    let html: string;
    try {
      html = await fetchPage(targetUrl.toString());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("login") || msg.includes("auth")) {
        return { rawItems: [], warnings, errors: ["Login required — stopped"], sourceMetadata: { url: input.url } };
      }
      return { rawItems: [], warnings, errors: [`Fetch error: ${msg}`], sourceMetadata: { url: input.url } };
    }

    // Detect hard-stop conditions
    const stopReason = detectHardStop(html, targetUrl.toString());
    if (stopReason) {
      return { rawItems: [], warnings, errors: [stopReason], sourceMetadata: { url: input.url } };
    }

    const rawItems: RawExtractedItem[] = [];

    // ── Step 3: JSON-LD extraction ────────────────────────────────────────────
    const jsonLdItems = extractJsonLd(html, targetUrl.toString());
    if (jsonLdItems.length > 0) {
      rawItems.push(...jsonLdItems);
      warnings.push(`Extracted ${jsonLdItems.length} items via JSON-LD`);
    }

    // ── Step 4: Embedded JSON in script tags ──────────────────────────────────
    if (rawItems.length === 0) {
      const embeddedItems = extractEmbeddedJson(html, targetUrl.toString());
      if (embeddedItems.length > 0) {
        rawItems.push(...embeddedItems);
        warnings.push(`Extracted ${embeddedItems.length} items via embedded JSON`);
      }
    }

    // ── Step 5: Sitemap product URLs (shallow) ────────────────────────────────
    if (rawItems.length === 0) {
      const sitemapUrls = await extractSitemapProductUrls(targetUrl, MAX_SITEMAP_URLS);
      if (sitemapUrls.length > 0) {
        warnings.push(`Found ${sitemapUrls.length} product URLs in sitemap`);
        for (const productUrl of sitemapUrls.slice(0, MAX_SITEMAP_URLS)) {
          try {
            const productHtml = await fetchPage(productUrl);
            const productItems = extractJsonLd(productHtml, productUrl);
            if (productItems.length > 0) {
              rawItems.push(...productItems);
            } else {
              rawItems.push({
                raw: { _htmlSnippet: extractSemanticProduct(productHtml), _sourceUrl: productUrl },
                sourceContext: { elementType: "sitemap_product_page" },
              });
            }
          } catch {
            warnings.push(`Could not fetch product page: ${productUrl}`);
          }
        }
      }
    }

    // ── Step 6: Semantic HTML fallback ────────────────────────────────────────
    if (rawItems.length === 0) {
      const semanticContent = extractSemanticProduct(html);
      if (semanticContent) {
        rawItems.push({
          raw: { _htmlContent: semanticContent, _sourceUrl: targetUrl.toString() },
          sourceContext: { elementType: "semantic_html" },
        });
        warnings.push("No structured data found; extracted semantic HTML for AI processing");
      } else {
        errors.push("Could not extract any structured product data from this URL");
      }
    }

    return {
      rawItems,
      warnings,
      errors,
      sourceMetadata: { url: input.url, totalItems: rawItems.length },
    };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function checkRobots(targetUrl: URL): Promise<boolean> {
  try {
    const robotsUrl = `${targetUrl.protocol}//${targetUrl.hostname}/robots.txt`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
      const res = await fetch(robotsUrl, { signal: controller.signal });
      if (!res.ok) return false; // no robots.txt = OK
      const text = await res.text();
      return isDisallowed(text, targetUrl.pathname);
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false; // network error reading robots = continue
  }
}

function isDisallowed(robotsTxt: string, path: string): boolean {
  const lines = robotsTxt.split("\n").map((l) => l.trim());
  let currentAgentApplies = false;
  for (const line of lines) {
    if (line.startsWith("User-agent:")) {
      const agent = line.slice(11).trim();
      currentAgentApplies = agent === "*" || agent.toLowerCase() === "catalogbot";
    } else if (currentAgentApplies && line.startsWith("Disallow:")) {
      const disallowedPath = line.slice(9).trim();
      // Empty Disallow means "disallow nothing" — skip it
      if (disallowedPath && (disallowedPath === "/" || path.startsWith(disallowedPath))) return true;
    }
  }
  return false;
}

async function fetchPage(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "CatalogBot/1.0 (material catalog importer; contact: admin@cstlogistic.co.id)",
        Accept: "text/html,application/xhtml+xml,application/json",
      },
    });

    // Check for auth redirect
    const finalUrl = res.url;
    if (/\/(login|signin|auth|account)\b/i.test(finalUrl)) {
      throw new Error("login redirect detected");
    }

    if (!res.ok) {
      if (res.status === 403) throw new Error(`anti-bot response (403): ${url}`);
      throw new Error(`HTTP ${res.status}`);
    }

    // Size guard
    const contentLength = parseInt(res.headers.get("content-length") ?? "0", 10);
    if (contentLength > MAX_PAYLOAD_BYTES) {
      throw new Error(`Response too large (${contentLength} bytes)`);
    }
    const text = await res.text();
    if (Buffer.byteLength(text, "utf-8") > MAX_PAYLOAD_BYTES) {
      throw new Error("Response body too large");
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

function detectHardStop(html: string, url: string): string | null {
  const lower = html.toLowerCase();
  if (lower.includes("captcha") || lower.includes("cf-challenge")) {
    return "CAPTCHA detected — cannot extract without human interaction";
  }
  if (/\/(login|signin|sign-in|auth)\b/i.test(url)) {
    return "Login required — stopped as per extraction rules";
  }
  if (lower.includes("please log in") || lower.includes("sign in to continue")) {
    return "Login wall detected in HTML — stopped";
  }
  return null;
}

function extractJsonLd(html: string, sourceUrl: string): RawExtractedItem[] {
  const items: RawExtractedItem[] = [];
  const scriptPattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;

  while ((match = scriptPattern.exec(html)) !== null) {
    try {
      const jsonText = match[1] ?? "";
      const parsed = JSON.parse(jsonText) as unknown;
      const objects = Array.isArray(parsed) ? parsed : [parsed];
      for (const obj of objects) {
        if (obj && typeof obj === "object") {
          const typed = obj as Record<string, unknown>;
          const type = String(typed["@type"] ?? "").toLowerCase();
          if (type.includes("product") || type.includes("item") || !type) {
            items.push({
              raw: { ...typed, _sourceUrl: sourceUrl, _extractionMethod: "json-ld" },
              sourceContext: { elementType: "json_ld" },
            });
          }
        }
      }
    } catch {
      // Invalid JSON-LD — skip
    }
  }
  return items;
}

function extractEmbeddedJson(html: string, sourceUrl: string): RawExtractedItem[] {
  const items: RawExtractedItem[] = [];
  // Look for common variable patterns: window.__DATA__ = {...}, var products = [...]
  const patterns = [
    /window\.__(?:DATA|PRODUCTS|CATALOG|STATE)__\s*=\s*(\{[\s\S]{0,100000}\})/,
    /var\s+(?:products|catalog|items)\s*=\s*(\[[\s\S]{0,100000}\])/,
    /"products"\s*:\s*(\[[\s\S]{0,50000}\])/,
    /"catalog"\s*:\s*(\[[\s\S]{0,50000}\])/,
  ];

  for (const pattern of patterns) {
    const m = html.match(pattern);
    if (m?.[1]) {
      try {
        const parsed = JSON.parse(m[1]) as unknown;
        const arr = Array.isArray(parsed) ? parsed : Object.values(parsed as Record<string, unknown>).find(Array.isArray) ?? [];
        for (const item of arr as unknown[]) {
          if (item && typeof item === "object") {
            items.push({
              raw: { ...(item as Record<string, unknown>), _sourceUrl: sourceUrl, _extractionMethod: "embedded-json" },
              sourceContext: { elementType: "embedded_json" },
            });
          }
        }
        if (items.length > 0) break;
      } catch {
        // Invalid JSON — try next pattern
      }
    }
  }
  return items;
}

async function extractSitemapProductUrls(baseUrl: URL, maxUrls: number): Promise<string[]> {
  const urls: string[] = [];
  try {
    const sitemapUrl = `${baseUrl.protocol}//${baseUrl.hostname}/sitemap.xml`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(sitemapUrl, { signal: controller.signal });
      if (!res.ok) return [];
      const text = await res.text();
      const urlPattern = /<loc>(https?:\/\/[^<]+)<\/loc>/g;
      let m: RegExpExecArray | null;
      while ((m = urlPattern.exec(text)) !== null && urls.length < maxUrls) {
        const u = m[1] ?? "";
        if (/\/(product|material|item|catalog)\//i.test(u)) {
          urls.push(u);
        }
      }
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // No sitemap or network error
  }
  return urls;
}

function extractSemanticProduct(html: string): string {
  // Extract content from structured product containers
  const patterns = [
    /<article[^>]*>([\s\S]{0,5000}?)<\/article>/gi,
    /<div[^>]+(?:class|id)=["'][^"']*product[^"']*["'][^>]*>([\s\S]{0,5000}?)<\/div>/gi,
    /<main[^>]*>([\s\S]{0,10000}?)<\/main>/gi,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match?.[1]) {
      // Strip HTML tags
      return match[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 3000);
    }
  }
  return "";
}

export const websiteAdapter = new WebsiteAdapter();
