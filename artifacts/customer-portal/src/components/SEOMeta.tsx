/**
 * SEOMeta — per-route metadata component.
 *
 * Uses react-helmet-async to inject <title>, <meta>, <link rel="canonical">,
 * Open Graph, Twitter Card, and JSON-LD tags into <head> on every route
 * change. Works client-side in this Vite SPA; static fallbacks in index.html
 * cover initial page load for crawlers.
 *
 * Usage:
 *   <SEOMeta
 *     title="Katalog Layanan"
 *     description="Jelajahi 50+ layanan creative AI profesional."
 *     canonical="/services"
 *   />
 */

import { Helmet } from "react-helmet-async";
import {
  SITE_NAME,
  SITE_URL,
  DEFAULT_OG_IMAGE,
  DEFAULT_OG_IMAGE_WIDTH,
  DEFAULT_OG_IMAGE_HEIGHT,
  DEFAULT_LOCALE,
  pageTitle,
  canonicalUrl,
} from "@/lib/seo";

interface SEOMetaProps {
  /** Page-level title (without site name). Will be appended with " — Creative Studio". */
  title: string;
  /** Meta description — 120–160 characters ideal. */
  description: string;
  /** Relative path for canonical, e.g. "/services". Omit for noindex pages. */
  canonical?: string;
  /** Absolute URL to an OG image. Defaults to /opengraph.jpg (1280×720). */
  ogImage?: string;
  /** OG type — "website" (default) or "article". */
  ogType?: "website" | "article";
  /** Set true for private/token-gated pages that must not be indexed. */
  noindex?: boolean;
  /** JSON-LD schema object or array of objects. */
  jsonLd?: object | object[];
}

export function SEOMeta({
  title,
  description,
  canonical,
  ogImage,
  ogType = "website",
  noindex = false,
  jsonLd,
}: SEOMetaProps) {
  const fullTitle = pageTitle(title);
  const absCanonical = canonical ? canonicalUrl(canonical) : undefined;
  const image = ogImage ?? DEFAULT_OG_IMAGE;
  const pageUrl = absCanonical ?? SITE_URL;

  const schemas = jsonLd
    ? Array.isArray(jsonLd)
      ? jsonLd
      : [jsonLd]
    : [];

  return (
    <Helmet>
      {/* ── Primary ──────────────────────────────────────────────── */}
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      <meta
        name="robots"
        content={noindex ? "noindex, nofollow" : "index, follow"}
      />
      {absCanonical && <link rel="canonical" href={absCanonical} />}

      {/* ── Open Graph ───────────────────────────────────────────── */}
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:type" content={ogType} />
      <meta property="og:url" content={pageUrl} />
      <meta property="og:image" content={image} />
      <meta property="og:image:width" content={String(DEFAULT_OG_IMAGE_WIDTH)} />
      <meta property="og:image:height" content={String(DEFAULT_OG_IMAGE_HEIGHT)} />
      <meta property="og:image:alt" content={`${fullTitle} — ${SITE_NAME}`} />
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:locale" content={DEFAULT_LOCALE} />

      {/* ── Twitter Card ─────────────────────────────────────────── */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={image} />
      <meta name="twitter:image:alt" content={fullTitle} />

      {/* ── JSON-LD ──────────────────────────────────────────────── */}
      {schemas.map((schema, i) => (
        <script key={i} type="application/ld+json">
          {JSON.stringify(schema)}
        </script>
      ))}
    </Helmet>
  );
}
