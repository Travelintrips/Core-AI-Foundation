/**
 * cargo-rates.ts — Freightos Proxy (Cargo Rate Finder)
 *
 * Proxies requests to the Freightos public shippingCalculator API.
 * Needed because browsers block cross-origin calls to ship.freightos.com.
 *
 * GET /cargo/rates?origin=Jakarta,Indonesia&destination=Bangkok,Thailand&weight=100&width=60&length=40&height=40&quantity=1
 */

import { Router, type Request, type Response } from "express";

// Normalize common city shorthand → "City,Country" format expected by Freightos.
// IMPORTANT: no space after comma — Freightos API is sensitive to this encoding.
// Keys are lowercase; values use the exact "City,Country" form.
const CITY_ALIASES: Record<string, string> = {
  // Indonesia
  "jakarta":          "Jakarta,Indonesia",
  "surabaya":         "Surabaya,Indonesia",
  "medan":            "Medan,Indonesia",
  "bandung":          "Bandung,Indonesia",
  "makassar":         "Makassar,Indonesia",
  "semarang":         "Semarang,Indonesia",
  "bali":             "Bali,Indonesia",
  "denpasar":         "Denpasar,Indonesia",
  // Singapore
  "singapore":        "Singapore,Singapore",
  "singapura":        "Singapore,Singapore",
  // Malaysia
  "kuala lumpur":     "Kuala Lumpur,Malaysia",
  "kl":               "Kuala Lumpur,Malaysia",
  "penang":           "Penang,Malaysia",
  "johor bahru":      "Johor Bahru,Malaysia",
  // Thailand
  "bangkok":          "Bangkok,Thailand",
  "phuket":           "Phuket,Thailand",
  // Vietnam
  "ho chi minh":      "Ho Chi Minh City,Vietnam",
  "ho chi minh city": "Ho Chi Minh City,Vietnam",
  "hcmc":             "Ho Chi Minh City,Vietnam",
  "hanoi":            "Hanoi,Vietnam",
  // Philippines
  "manila":           "Manila,Philippines",
  // Japan
  "tokyo":            "Tokyo,Japan",
  "osaka":            "Osaka,Japan",
  // China
  "shanghai":         "Shanghai,China",
  "beijing":          "Beijing,China",
  "guangzhou":        "Guangzhou,China",
  "shenzhen":         "Shenzhen,China",
  "hong kong":        "Hong Kong,Hong Kong",
  "hongkong":         "Hong Kong,Hong Kong",
  // South Korea
  "seoul":            "Seoul,South Korea",
  "busan":            "Busan,South Korea",
  // India
  "mumbai":           "Mumbai,India",
  "delhi":            "Delhi,India",
  "new delhi":        "New Delhi,India",
  "chennai":          "Chennai,India",
  "bangalore":        "Bangalore,India",
  // Middle East
  "dubai":            "Dubai,UAE",
  "abu dhabi":        "Abu Dhabi,UAE",
  "doha":             "Doha,Qatar",
  "riyadh":           "Riyadh,Saudi Arabia",
  // Europe
  "amsterdam":        "Amsterdam,Netherlands",
  "rotterdam":        "Rotterdam,Netherlands",
  "london":           "London,United Kingdom",
  "hamburg":          "Hamburg,Germany",
  "frankfurt":        "Frankfurt,Germany",
  "paris":            "Paris,France",
  "antwerp":          "Antwerp,Belgium",
  "barcelona":        "Barcelona,Spain",
  "milan":            "Milan,Italy",
  // USA
  "los angeles":      "Los Angeles,USA",
  "la":               "Los Angeles,USA",
  "new york":         "New York,USA",
  "nyc":              "New York,USA",
  "chicago":          "Chicago,USA",
  "houston":          "Houston,USA",
  "miami":            "Miami,USA",
  // Australia
  "sydney":           "Sydney,Australia",
  "melbourne":        "Melbourne,Australia",
};

function normalizeCity(input: string): string {
  const trimmed = input.trim();
  const key = trimmed.toLowerCase();
  if (CITY_ALIASES[key]) return CITY_ALIASES[key];
  // Also strip spaces around commas user might type: "Jakarta , Indonesia" → "Jakarta,Indonesia"
  return trimmed.replace(/\s*,\s*/g, ",");
}

// ── Simple in-memory cache to avoid hammering Freightos (Cloudflare rate-limits) ──
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const rateCache = new Map<string, { ts: number; data: unknown }>();

function cacheKey(o: string, d: string, w: string, wi: string, l: string, h: string, q: string) {
  return `${o}|${d}|${w}|${wi}|${l}|${h}|${q}`;
}

function getCached(key: string): unknown | null {
  const entry = rateCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) { rateCache.delete(key); return null; }
  return entry.data;
}

function setCached(key: string, data: unknown) {
  // Keep cache bounded
  if (rateCache.size > 200) {
    const oldest = [...rateCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    if (oldest) rateCache.delete(oldest[0]);
  }
  rateCache.set(key, { ts: Date.now(), data });
}

const router = Router();

const FREIGHTOS_BASE = "https://ship.freightos.com/api/shippingCalculator";
const TIMEOUT_MS = 12_000;

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : fallback;
}

router.get("/cargo/rates", async (req: Request, res: Response) => {
  const origin      = str(req.query["origin"]);
  const destination = str(req.query["destination"]);
  const weight      = str(req.query["weight"], "100");
  const width       = str(req.query["width"],  "60");
  const length      = str(req.query["length"], "40");
  const height      = str(req.query["height"], "40");
  const quantity    = str(req.query["quantity"], "1");

  if (!origin || !destination) {
    return res.status(400).json({ error: "origin and destination are required" });
  }

  const normalizedOrigin      = normalizeCity(origin);
  const normalizedDestination = normalizeCity(destination);

  // Serve from cache if available (avoids Cloudflare 1015 rate-limit errors)
  const ck = cacheKey(normalizedOrigin, normalizedDestination, weight, width, length, height, quantity);
  const cached = getCached(ck);
  if (cached) return res.json(cached);

  const params = new URLSearchParams({ loadtype: "boxes", origin: normalizedOrigin, destination: normalizedDestination, weight, width, length, height, quantity });
  const url = `${FREIGHTOS_BASE}?${params.toString()}`;

  let data: unknown;
  try {
    const response = await fetch(url, {
      headers: {
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Referer": "https://ship.freightos.com/",
        "Origin": "https://ship.freightos.com",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    data = await response.json();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "upstream error";
    return res.status(502).json({ error: `Freightos request failed: ${msg}` });
  }

  // Normalise into a cleaner shape for the UI
  type MoneyAmount = { amount: number; currency: string };
  type RawMode = {
    mode: string;
    price?: { min?: { moneyAmount?: MoneyAmount }; max?: { moneyAmount?: MoneyAmount } };
    transitTimes?: { min?: number; max?: number; unit?: string };
  };
  type FreightosResponse = {
    response?: {
      estimatedFreightRates?: {
        numQuotes?: number;
        mode?: RawMode | RawMode[];
      };
      errors?: unknown;
    };
  };

  const raw = data as FreightosResponse;
  const rates = raw?.response?.estimatedFreightRates;
  const numQuotes = Number(rates?.numQuotes ?? 0);

  if (!numQuotes || !rates?.mode) {
    const empty = { origin: normalizedOrigin, destination: normalizedDestination, numQuotes: 0, results: [], attribution: "Powered by Freightos" };
    setCached(ck, empty);
    return res.json(empty);
  }

  const modes: RawMode[] = Array.isArray(rates.mode) ? rates.mode : [rates.mode];
  const results = modes.map((m) => ({
    mode: m.mode,
    priceMin: m.price?.min?.moneyAmount?.amount ?? null,
    priceMax: m.price?.max?.moneyAmount?.amount ?? null,
    currency: m.price?.min?.moneyAmount?.currency ?? "USD",
    transitMin: m.transitTimes?.min ?? null,
    transitMax: m.transitTimes?.max ?? null,
    transitUnit: m.transitTimes?.unit ?? "days",
  }));

  const payload = { origin: normalizedOrigin, destination: normalizedDestination, numQuotes, results, attribution: "Powered by Freightos (freightos.com)" };
  setCached(ck, payload);
  return res.json(payload);
});

export default router;
