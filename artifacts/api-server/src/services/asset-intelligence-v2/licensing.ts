/**
 * licensing.ts — Licensing metadata CRUD (Team 06)
 *
 * Writes/reads from ai_asset_licensing table.
 * This is a PLACEHOLDER system — no automated license detection.
 * Admin sets license type; customers can see (non-sensitive) fields only.
 *
 * Metadata redaction rules:
 *   - licenseOwner is NOT exposed to customer workspace
 *   - notes is NOT exposed to customer workspace
 *   - All other fields are safe to return to customers
 */

import { pool } from "@workspace/db";
import type { LicensingMetadata, LicenseType } from "./types.js";

// ── Default license for AI-generated assets ───────────────────────────────────

export const AI_GENERATED_LICENSE: Pick<LicensingMetadata, "licenseType" | "usageRights" | "restrictions"> = {
  licenseType: "ai_generated",
  usageRights: ["commercial", "print", "web", "social_media", "internal"],
  restrictions: ["no_resale_as_raw_asset", "attribution_to_platform_optional"],
};

// ── CRUD ──────────────────────────────────────────────────────────────────────

export async function upsertLicensing(params: {
  assetId: number;
  assetSource: string;
  clientId: string;
  licenseType: LicenseType;
  licenseOwner?: string | null;
  attribution?: string | null;
  usageRights?: string[];
  restrictions?: string[];
  expiresAt?: string | null;
  notes?: string | null;
}): Promise<LicensingMetadata> {
  const res = await pool.query<{
    asset_id: number; asset_source: string; license_type: string;
    license_owner: string | null; attribution: string | null;
    usage_rights: string[]; restrictions: string[];
    expires_at: Date | null; notes: string | null;
    created_at: Date; updated_at: Date;
  }>(
    `INSERT INTO ai_platform.ai_asset_licensing
       (asset_id, asset_source, client_id, license_type, license_owner,
        attribution, usage_rights, restrictions, expires_at, notes,
        created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())
     ON CONFLICT (asset_id, asset_source) DO UPDATE SET
       license_type   = EXCLUDED.license_type,
       license_owner  = EXCLUDED.license_owner,
       attribution    = EXCLUDED.attribution,
       usage_rights   = EXCLUDED.usage_rights,
       restrictions   = EXCLUDED.restrictions,
       expires_at     = EXCLUDED.expires_at,
       notes          = EXCLUDED.notes,
       updated_at     = NOW()
     RETURNING *`,
    [
      params.assetId,
      params.assetSource,
      params.clientId,
      params.licenseType,
      params.licenseOwner ?? null,
      params.attribution ?? null,
      params.usageRights ?? [],
      params.restrictions ?? [],
      params.expiresAt ?? null,
      params.notes ?? null,
    ],
  );
  return toView(res.rows[0]!);
}

export async function getLicensing(assetId: number, assetSource: string): Promise<LicensingMetadata | null> {
  const res = await pool.query<{
    asset_id: number; asset_source: string; license_type: string;
    license_owner: string | null; attribution: string | null;
    usage_rights: string[]; restrictions: string[];
    expires_at: Date | null; notes: string | null;
    created_at: Date; updated_at: Date;
  }>(
    `SELECT * FROM ai_platform.ai_asset_licensing
     WHERE asset_id = $1 AND asset_source = $2 LIMIT 1`,
    [assetId, assetSource],
  );
  if (!res.rows[0]) return null;
  return toView(res.rows[0]!);
}

/**
 * Redacted view — safe to return to customer workspace.
 * Strips licenseOwner and notes.
 */
export async function getLicensingRedacted(assetId: number, assetSource: string): Promise<Omit<LicensingMetadata, "licenseOwner" | "notes"> | null> {
  const full = await getLicensing(assetId, assetSource);
  if (!full) return null;
  const { licenseOwner: _lo, notes: _n, ...safe } = full;
  return safe;
}

function toView(row: {
  asset_id: number; asset_source: string; license_type: string;
  license_owner: string | null; attribution: string | null;
  usage_rights: string[]; restrictions: string[];
  expires_at: Date | null; notes: string | null;
  created_at: Date; updated_at: Date;
}): LicensingMetadata {
  return {
    assetId:     row.asset_id,
    assetSource: row.asset_source,
    licenseType: row.license_type as LicenseType,
    licenseOwner: row.license_owner,
    attribution:  row.attribution,
    usageRights:  Array.isArray(row.usage_rights) ? row.usage_rights : [],
    restrictions: Array.isArray(row.restrictions) ? row.restrictions : [],
    expiresAt:    row.expires_at?.toISOString() ?? null,
    notes:        row.notes,
    createdAt:    row.created_at.toISOString(),
    updatedAt:    row.updated_at.toISOString(),
  };
}
