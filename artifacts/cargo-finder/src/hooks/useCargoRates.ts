import { useQuery } from '@tanstack/react-query';

export interface RateResult {
  mode: 'express' | 'air' | 'LCL' | string;
  priceMin: number | null;
  priceMax: number | null;
  currency: string;
  transitMin: number | null;
  transitMax: number | null;
  transitUnit: string;
}

export interface CargoRatesResponse {
  origin: string;
  destination: string;
  numQuotes: number;
  results: RateResult[];
  attribution: string;
}

export interface SearchParams {
  origin: string;
  destination: string;
  weight: number;
  width?: number;
  length?: number;
  height?: number;
  quantity?: number;
}

// ── City normalisation (same list as the backend proxy) ──────────────────────
// Format: "City,Country" — no space after comma (Freightos is encoding-sensitive).
const CITY_ALIASES: Record<string, string> = {
  "jakarta": "Jakarta,Indonesia", "surabaya": "Surabaya,Indonesia",
  "medan": "Medan,Indonesia", "bandung": "Bandung,Indonesia",
  "makassar": "Makassar,Indonesia", "semarang": "Semarang,Indonesia",
  "bali": "Bali,Indonesia", "denpasar": "Denpasar,Indonesia",
  "singapore": "Singapore,Singapore", "singapura": "Singapore,Singapore",
  "kuala lumpur": "Kuala Lumpur,Malaysia", "kl": "Kuala Lumpur,Malaysia",
  "penang": "Penang,Malaysia", "johor bahru": "Johor Bahru,Malaysia",
  "bangkok": "Bangkok,Thailand", "phuket": "Phuket,Thailand",
  "ho chi minh": "Ho Chi Minh City,Vietnam", "ho chi minh city": "Ho Chi Minh City,Vietnam",
  "hcmc": "Ho Chi Minh City,Vietnam", "hanoi": "Hanoi,Vietnam",
  "manila": "Manila,Philippines",
  "tokyo": "Tokyo,Japan", "osaka": "Osaka,Japan",
  "shanghai": "Shanghai,China", "beijing": "Beijing,China",
  "guangzhou": "Guangzhou,China", "shenzhen": "Shenzhen,China",
  "hong kong": "Hong Kong,Hong Kong", "hongkong": "Hong Kong,Hong Kong",
  "seoul": "Seoul,South Korea", "busan": "Busan,South Korea",
  "mumbai": "Mumbai,India", "delhi": "Delhi,India", "new delhi": "New Delhi,India",
  "chennai": "Chennai,India", "bangalore": "Bangalore,India",
  "dubai": "Dubai,UAE", "abu dhabi": "Abu Dhabi,UAE",
  "doha": "Doha,Qatar", "riyadh": "Riyadh,Saudi Arabia",
  "amsterdam": "Amsterdam,Netherlands", "rotterdam": "Rotterdam,Netherlands",
  "london": "London,United Kingdom", "hamburg": "Hamburg,Germany",
  "frankfurt": "Frankfurt,Germany", "paris": "Paris,France",
  "antwerp": "Antwerp,Belgium", "barcelona": "Barcelona,Spain",
  "milan": "Milan,Italy",
  "los angeles": "Los Angeles,USA", "la": "Los Angeles,USA",
  "new york": "New York,USA", "nyc": "New York,USA",
  "chicago": "Chicago,USA", "houston": "Houston,USA", "miami": "Miami,USA",
  "sydney": "Sydney,Australia", "melbourne": "Melbourne,Australia",
};

function normalizeCity(input: string): string {
  const trimmed = input.trim();
  const alias = CITY_ALIASES[trimmed.toLowerCase()];
  if (alias) return alias;
  // Strip spaces around user-typed commas: "Jakarta , Indonesia" → "Jakarta,Indonesia"
  return trimmed.replace(/\s*,\s*/g, ',');
}

// ── Raw Freightos response types ─────────────────────────────────────────────
type MoneyAmount = { amount: number; currency: string };
type RawMode = {
  mode: string;
  price?: { min?: { moneyAmount?: MoneyAmount }; max?: { moneyAmount?: MoneyAmount } };
  transitTimes?: { min?: number; max?: number; unit?: string };
};
type FreightosResponse = {
  response?: {
    estimatedFreightRates?: { numQuotes?: number; mode?: RawMode | RawMode[] };
    errors?: unknown;
  };
};

const FREIGHTOS_BASE = 'https://ship.freightos.com/api/shippingCalculator';

async function fetchRates(params: SearchParams): Promise<CargoRatesResponse> {
  const normalizedOrigin      = normalizeCity(params.origin);
  const normalizedDestination = normalizeCity(params.destination);

  const qs = new URLSearchParams({
    loadtype: 'boxes',
    origin:      normalizedOrigin,
    destination: normalizedDestination,
    weight:   String(params.weight),
    width:    String(params.width  ?? 60),
    length:   String(params.length ?? 40),
    height:   String(params.height ?? 40),
    quantity: String(params.quantity ?? 1),
  });

  const res = await fetch(`${FREIGHTOS_BASE}?${qs.toString()}`, {
    headers: { Accept: 'application/json, text/plain, */*' },
  });

  if (!res.ok) {
    throw new Error(`Freightos returned ${res.status}`);
  }

  const raw: FreightosResponse = await res.json();
  const rates = raw?.response?.estimatedFreightRates;
  const numQuotes = Number(rates?.numQuotes ?? 0);

  if (!numQuotes || !rates?.mode) {
    return { origin: normalizedOrigin, destination: normalizedDestination, numQuotes: 0, results: [], attribution: 'Powered by Freightos' };
  }

  const modes: RawMode[] = Array.isArray(rates.mode) ? rates.mode : [rates.mode];
  const results: RateResult[] = modes.map((m) => ({
    mode:        m.mode,
    priceMin:    m.price?.min?.moneyAmount?.amount  ?? null,
    priceMax:    m.price?.max?.moneyAmount?.amount  ?? null,
    currency:    m.price?.min?.moneyAmount?.currency ?? 'USD',
    transitMin:  m.transitTimes?.min  ?? null,
    transitMax:  m.transitTimes?.max  ?? null,
    transitUnit: m.transitTimes?.unit ?? 'days',
  }));

  return { origin: normalizedOrigin, destination: normalizedDestination, numQuotes, results, attribution: 'Powered by Freightos (freightos.com)' };
}

export function useCargoRates(params: SearchParams | null) {
  return useQuery({
    queryKey: ['cargoRates', params],
    queryFn:  () => fetchRates(params!),
    // Only fetch when params are set (user clicked Search / quick-pick).
    // Changing queryParams to a new object changes the queryKey → auto re-fetch.
    enabled:  params !== null,
    retry:    1,
    staleTime: 10 * 60 * 1000, // 10 min — avoid hammering the API for the same route
  });
}
