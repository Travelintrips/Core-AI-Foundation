/**
 * customs.ts — BTKI Tariff Search
 *
 * GET /customs/hs-search?q=...   — full-text search by keyword / HS code (max 20 results)
 * GET /customs/hs/:code          — detail for one HS code (BM per FTA, PPN, PPh, LARTAS, perizinan)
 *
 * Data source: btki_tariff table (6 990 rows, already populated).
 * Uses raw pool.query — table is NOT in the Drizzle schema.
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

// ── GET /customs/hs-search?q=... ─────────────────────────────────────────────
router.get("/customs/hs-search", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const pageStr = typeof req.query.page === "string" ? req.query.page : "1";
  const limitStr = typeof req.query.limit === "string" ? req.query.limit : "20";

  const page = Math.max(1, parseInt(pageStr, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(limitStr, 10) || 20));
  const offset = (page - 1) * limit;

  if (!q || q.length < 2) {
    return res.json({ results: [], total: 0, page, limit });
  }

  const pattern = `%${q}%`;

  try {
    const [dataRes, countRes] = await Promise.all([
      pool.query(
        `SELECT ${COLS}
         FROM btki_tariff
         WHERE description_id ILIKE $1
            OR description_en ILIKE $1
            OR hs_code ILIKE $1
            OR hs_code_6 ILIKE $1
            OR category ILIKE $1
         ORDER BY
           CASE WHEN hs_code = $2 THEN 0
                WHEN hs_code ILIKE $3 THEN 1
                ELSE 2 END,
           hs_code
         LIMIT $4 OFFSET $5`,
        [pattern, q, `${q}%`, limit, offset]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS total
         FROM btki_tariff
         WHERE description_id ILIKE $1
            OR description_en ILIKE $1
            OR hs_code ILIKE $1
            OR hs_code_6 ILIKE $1
            OR category ILIKE $1`,
        [pattern]
      ),
    ]);

    res.json({
      results: dataRes.rows,
      total: countRes.rows[0]?.total ?? 0,
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
