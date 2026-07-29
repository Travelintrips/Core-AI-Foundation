/**
 * SEO utilities — Creative Studio
 *
 * Single source of truth for all metadata constants and helper functions.
 * Never imports auth, API keys, or business logic.
 */

export const SITE_URL = "https://aicore.cstlogistic.co.id";
export const SITE_NAME = "Creative Studio";
export const SITE_TAGLINE = "Platform AI Creative Enterprise";
export const DEFAULT_OG_IMAGE = `${SITE_URL}/opengraph.jpg`;
export const DEFAULT_OG_IMAGE_WIDTH = 1280;
export const DEFAULT_OG_IMAGE_HEIGHT = 720;
export const DEFAULT_LOCALE = "id_ID";
export const DEFAULT_LANG = "id";

export const DEFAULT_DESCRIPTION =
  "Platform AI Creative Enterprise terdepan di Indonesia. Branding, desain, packaging, interior, fashion, dan marketing — semua dalam satu platform profesional berbasis AI.";

/** Build a full page title with site name suffix. */
export function pageTitle(title: string): string {
  return `${title} — ${SITE_NAME}`;
}

/** Build an absolute canonical URL from a relative path. */
export function canonicalUrl(path: string): string {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

// ── JSON-LD schema helpers ────────────────────────────────────────────────────

export const organizationSchema = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: SITE_NAME,
  url: SITE_URL,
  logo: `${SITE_URL}/favicon.svg`,
  image: DEFAULT_OG_IMAGE,
  description: DEFAULT_DESCRIPTION,
  address: {
    "@type": "PostalAddress",
    addressCountry: "ID",
  },
};

export const webSiteSchema = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: SITE_NAME,
  url: SITE_URL,
  inLanguage: DEFAULT_LANG,
  potentialAction: {
    "@type": "SearchAction",
    target: {
      "@type": "EntryPoint",
      urlTemplate: `${SITE_URL}/services?q={search_term_string}`,
    },
    "query-input": "required name=search_term_string",
  },
};

export function serviceSchema(opts: {
  name: string;
  description: string;
  url: string;
  image?: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "Service",
    name: opts.name,
    description: opts.description,
    url: opts.url,
    image: opts.image ?? DEFAULT_OG_IMAGE,
    provider: {
      "@type": "Organization",
      name: SITE_NAME,
      url: SITE_URL,
    },
  };
}

export function breadcrumbSchema(items: { name: string; url: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}
