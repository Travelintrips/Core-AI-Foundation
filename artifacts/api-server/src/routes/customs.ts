/**
 * customs.ts — BTKI Tariff Search
 *
 * GET /customs/hs-search?q=...   — full-text search by keyword / HS code (max 20 results)
 * GET /customs/hs/:code          — detail for one HS code (BM per FTA, PPN, PPh, LARTAS, perizinan)
 *
 * Data source: btki_tariff table (6 990 rows, already populated).
 * Uses raw pool.query — table is NOT in the Drizzle schema.
 *
 * Synonym map: maps common Indonesian keywords to narrow, chapter-specific
 * English terms so that garment queries (baju, pakaian, kemeja, etc.) surface
 * chapter 61/62 first and don't bleed into chapters 39/40/42.
 *
 * Sort priority (applied to every search):
 *   1. Exact HS-code match
 *   2. HS-code prefix match
 *   3. Chapter priority  (ch 61/62 first for garment queries; uniform otherwise)
 *   4. Leaf rows first  (10-digit dotted codes like 6109.10.00 have real tariff data;
 *                        heading rows 4/6-digit have null FTA)
 *   5. hs_code ascending
 */

import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";

const router: IRouter = Router();

// ── shared column list ────────────────────────────────────────────────────────
const COLS = `
  id, hs_code, hs_code_6, hs_code_4, hs_code_2,
  description_id, description_en, unit, category,
  bm_mfn, bm_acfta, bm_afta, bm_aifta, bm_aanzfta,
  bm_ahkfta, bm_asfta, bm_akfta, bm_indonesia_australia,
  ppn_rate, ppnbm_rate, pph22_rate, pph22_non_api,
  lartas_import, lartas_export, lartas_desc,
  regulator_import, regulator_export,
  perizinan_import, perizinan_export, notes, updated_at
`;

// ── Synonym map ───────────────────────────────────────────────────────────────
// Maps Indonesian search keywords → narrow English terms used in BTKI descriptions.
//
// CRITICAL rules:
//   • Terms must NOT appear in ch 39/40/42 heading descriptions.
//     Avoid "apparel", "clothing", "accessories" — they appear in:
//       ch 39: "articles of apparel and clothing accessories"
//       ch 40: "articles of apparel and clothing accessories (vulcanised rubber)"
//   • Avoid bare "suit" or "dress" — substring-match against "suitable", "dressed"
//     in botanical/chemical descriptions (→ ch 06 flowers false positives).
//   • Use plural or compound forms specific to the target chapter.
const SYNONYM_MAP: Record<string, string[]> = {
  // ── Garment / Chapters 61–62 ────────────────────────────────────────────────
  baju:          ["shirts", "blouses", "polo shirts", "pullovers", "jerseys", "knitted garments"],
  kemeja:        ["shirts", "blouses"],
  kaos:          ["t-shirts", "singlets", "undershirts", "vests"],
  celana:        ["trousers", "breeches", "shorts", "pantaloons"],
  rok:           ["skirts", "skirts and divided skirts"],
  jas:           ["jackets", "blazers", "suit jackets"],
  mantel:        ["overcoats", "carcoats", "raincoats", "windcheaters", "anoraks"],
  jaket:         ["jackets", "anoraks", "windcheaters", "windbreakers"],
  pakaian:       ["garments", "jerseys", "pullovers", "windcheaters", "anoraks"],
  bra:           ["brassieres"],
  korset:        ["corsets", "girdles", "braces"],
  piyama:        ["pyjamas", "nightwear", "dressing gowns"],
  gaun:          ["gowns", "dresses", "ball gowns"],
  celana_dalam:  ["underwear", "briefs", "boxer", "panties"],
  kaos_kaki:     ["socks", "hosiery", "stockings", "tights"],
  sarung:        ["sarongs", "sarong"],
  dasi:          ["ties", "cravats", "neckties", "bow ties"],
  syal:          ["scarves", "mufflers", "scarfs"],
  // ── Headwear / Chapter 65 ───────────────────────────────────────────────────
  topi:          ["headgear", "hats", "caps", "berets", "helmets"],
  // ── Footwear / Chapter 64 ───────────────────────────────────────────────────
  sepatu:        ["footwear", "shoes", "boots", "overshoes"],
  sandal:        ["sandals", "flip-flops", "thongs"],
  // ── Bags / Chapter 42 ───────────────────────────────────────────────────────
  tas:           ["bags", "handbags", "backpacks", "satchels"],
  koper:         ["suitcases", "trunks", "valises"],
  dompet:        ["wallets", "purses", "coin purses"],
  // ── Textiles / Chapters 50–63 ───────────────────────────────────────────────
  selimut:       ["blankets", "travelling rugs"],
  handuk:        ["towels", "toilet linen", "kitchen linen"],
  sprei:         ["bed linen", "bed sheets"],
  kain:          ["fabrics", "woven fabrics", "textile fabrics"],
  tekstil:       ["textiles", "woven fabrics", "knitted fabrics"],
  benang:        ["yarn", "thread", "filament"],
  katun:         ["cotton"],
  sutra:         ["silk"],
  wol:           ["wool", "fine animal hair"],
  nilon:         ["nylon", "polyamide"],
  polyester:     ["polyester", "polyesters"],
  renda:         ["lace", "tulles", "lace fabrics"],
  bordir:        ["embroidery", "embroidered"],
};

/**
 * Build the WHERE clause + its bound parameters for the search query.
 *
 * Design contract:
 *   - whereParams holds ONLY the values referenced in the WHERE fragment.
 *   - The count query passes whereParams as-is (no extra params → no "42P18" error).
 *   - The data query appends LIMIT/OFFSET after whereParams.
 *   - ORDER BY values for exact/prefix match are embedded as SQL literals
 *     (after single-quote escaping) to avoid adding untyped params.
 */
function buildSearch(q: string): {
  where: string;
  whereParams: unknown[];
  isGarmentQuery: boolean;
} {
  const normalized = q.toLowerCase().trim().replace(/\s+/g, "_");
  const synonyms   = SYNONYM_MAP[normalized] ?? SYNONYM_MAP[q.toLowerCase().trim()];

  const rawPattern = `%${q}%`;

  if (!synonyms) {
    // Plain ILIKE path — $1 is the only WHERE param.
    return {
      where: `(
        description_id ILIKE $1
        OR description_en ILIKE $1
        OR hs_code       ILIKE $1
        OR hs_code_6     ILIKE $1
        OR category      ILIKE $1
      )`,
      whereParams: [rawPattern],
      isGarmentQuery: false,
    };
  }

  // Synonym path: match description_id / hs_code with raw pattern ($1)
  // and description_en with narrow, chapter-specific English terms ($2..$N+1).
  const synParams  = synonyms.map((syn) => `%${syn}%`);
  const synClauses = synParams.map((_, i) => `description_en ILIKE $${i + 2}`);

  return {
    where: `(
      description_id ILIKE $1
      OR hs_code     ILIKE $1
      OR ${synClauses.join(" OR ")}
    )`,
    whereParams: [rawPattern, ...synParams],
    isGarmentQuery: true,
  };
}

// ── GET /customs/hs-search?q=... ─────────────────────────────────────────────
router.get("/customs/hs-search", async (req, res) => {
  const q        = typeof req.query.q     === "string" ? req.query.q.trim() : "";
  const pageStr  = typeof req.query.page  === "string" ? req.query.page     : "1";
  const limitStr = typeof req.query.limit === "string" ? req.query.limit    : "20";

  const page   = Math.max(1, parseInt(pageStr, 10)  || 1);
  const limit  = Math.min(50, Math.max(1, parseInt(limitStr, 10) || 20));
  const offset = (page - 1) * limit;

  if (!q || q.length < 2) {
    return res.json({ results: [], total: 0, page, limit });
  }

  try {
    const { where, whereParams, isGarmentQuery } = buildSearch(q);

    // Chapter priority: garment queries boost ch 61/62 to the top.
    // Non-garment queries use uniform priority (0 = no boost).
    const chapterSort = isGarmentQuery
      ? "CASE WHEN LEFT(REPLACE(hs_code, '.', ''), 2) IN ('61', '62') THEN 0 ELSE 1 END"
      : "0";

    // Leaf-row priority: rows with 10-digit dotted HS codes (e.g. 6109.10.00)
    // have real tariff data; 4/6-digit heading rows have all-null FTA fields.
    const leafSort =
      "CASE WHEN hs_code ~ '^[0-9]{4}\\.[0-9]{2}\\.[0-9]{2}$' THEN 0 ELSE 1 END";

    // Embed exact/prefix literals into ORDER BY to avoid untyped-parameter errors.
    const safeQ      = q.replace(/'/g, "''");
    const safePrefix = `${safeQ}%`;

    const n = whereParams.length; // LIMIT is $(n+1), OFFSET is $(n+2)

    const [dataRes, countRes] = await Promise.all([
      pool.query(
        `SELECT ${COLS}
         FROM btki_tariff
         WHERE ${where}
         ORDER BY
           CASE WHEN hs_code = '${safeQ}'          THEN 0
                WHEN hs_code ILIKE '${safePrefix}'  THEN 1
                ELSE 2 END,
           ${chapterSort},
           ${leafSort},
           hs_code
         LIMIT $${n + 1} OFFSET $${n + 2}`,
        [...whereParams, limit, offset]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS total
         FROM btki_tariff
         WHERE ${where}`,
        whereParams   // count query uses only the WHERE params — no extras
      ),
    ]);

    res.json({
      results: dataRes.rows,
      total:   countRes.rows[0]?.total ?? 0,
      page,
      limit,
    });
  } catch (err) {
    console.error("[customs/hs-search]", err);
    res.status(500).json({ error: "Search failed" });
  }
});

// ── GET /customs/hs/:code ─────────────────────────────────────────────────────
router.get("/customs/hs/:code", async (req, res) => {
  const code = req.params.code?.trim() ?? "";

  // Accept both raw ("8471.30.00") and normalised ("847130") formats
  const sanitized = code.replace(/[^0-9.]/g, "").substring(0, 12);
  if (!sanitized) {
    return res.status(400).json({ error: "Invalid HS code" });
  }

  try {
    const result = await pool.query(
      `SELECT ${COLS}
       FROM btki_tariff
       WHERE hs_code = $1
          OR hs_code_6 = $2
       LIMIT 1`,
      [sanitized, sanitized.replace(/\./g, "")]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: `HS code ${sanitized} not found` });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("[customs/hs/:code]", err);
    res.status(500).json({ error: "Lookup failed" });
  }
});

export default router;
