/**
 * versionChain.ts — Version chain management (Team 06)
 *
 * Manages explicit version chains in the ai_asset_version_chains table.
 * Reads asset data from existing tables; writes to new v2 tables only.
 *
 * A "version chain" groups all intentional variants of the same logical asset:
 *   logo_primary.svg → logo_dark.svg → logo_transparent.png → logo_icon.png
 *
 * Version types:
 *   original | transparent | dark | light | icon | landscape | portrait |
 *   horizontal | vertical | inverted | thumbnail | animated | print_ready
 */

import { pool } from "@workspace/db";
import type { VersionChainV2, VersionChainMember } from "./types.js";

const VERSION_TYPE_KEYWORDS: Record<string, string[]> = {
  transparent: ["transparent", "nobg", "no_bg", "alpha", "clear"],
  dark:        ["dark", "black", "hitam", "noir", "night"],
  light:       ["light", "white", "putih", "blanc", "day"],
  icon:        ["icon", "favicon", "small", "mini", "tiny"],
  landscape:   ["landscape", "horizontal", "wide", "banner", "widescreen"],
  portrait:    ["portrait", "vertical", "tall", "narrow"],
  inverted:    ["inverted", "invert", "reversed", "negative"],
  thumbnail:   ["thumb", "thumbnail", "preview", "small", "sm"],
  print_ready: ["print", "cmyk", "bleed", "hires", "hi_res", "300dpi"],
  animated:    ["animated", "animation", "gif", "motion", "animate"],
};

export function detectVersionType(fileName: string): string {
  const lower = fileName.toLowerCase();
  for (const [vType, keywords] of Object.entries(VERSION_TYPE_KEYWORDS) as Array<[string, string[]]>) {
    if (keywords.some((k) => lower.includes(k))) return vType;
  }
  return "original";
}

// ── CRUD on ai_asset_version_chains ──────────────────────────────────────────

export async function createVersionChain(
  clientId: string,
  primaryAssetId: number | null,
): Promise<number> {
  const res = await pool.query<{ id: number }>(
    `INSERT INTO ai_platform.ai_asset_version_chains
       (client_id, primary_asset_id, created_at, updated_at)
     VALUES ($1, $2, NOW(), NOW())
     RETURNING id`,
    [clientId, primaryAssetId],
  );
  return res.rows[0]!.id;
}

export async function addMemberToChain(
  chainId: number,
  assetId: number,
  assetSource: string,
  versionType: string,
  versionLabel: string,
  role: "primary" | "variant",
): Promise<void> {
  await pool.query(
    `INSERT INTO ai_platform.ai_asset_version_chain_members
       (chain_id, asset_id, asset_source, version_type, version_label, role, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (chain_id, asset_id, asset_source) DO UPDATE
       SET version_type = EXCLUDED.version_type,
           version_label = EXCLUDED.version_label,
           role = EXCLUDED.role`,
    [chainId, assetId, assetSource, versionType, versionLabel, role],
  );
}

export async function getVersionChain(chainId: number): Promise<VersionChainV2 | null> {
  const chainRes = await pool.query<{
    id: number; client_id: string; primary_asset_id: number | null;
    created_at: Date; updated_at: Date;
  }>(
    `SELECT id, client_id, primary_asset_id, created_at, updated_at
     FROM ai_platform.ai_asset_version_chains WHERE id = $1`,
    [chainId],
  );
  if (!chainRes.rows[0]) return null;
  const chain = chainRes.rows[0]!;

  const membersRes = await pool.query<{
    asset_id: number; asset_source: string; version_type: string;
    version_label: string; role: string;
  }>(
    `SELECT asset_id, asset_source, version_type, version_label, role
     FROM ai_platform.ai_asset_version_chain_members
     WHERE chain_id = $1
     ORDER BY CASE WHEN role = 'primary' THEN 0 ELSE 1 END, asset_id`,
    [chainId],
  );

  const members: VersionChainMember[] = membersRes.rows.map((r: { asset_id: number; asset_source: string; version_type: string; version_label: string; role: string }) => ({
    assetId:      r.asset_id,
    assetSource:  r.asset_source,
    versionType:  r.version_type,
    versionLabel: r.version_label,
    role:         r.role as "primary" | "variant",
  }));

  return {
    chainId: chain.id,
    clientId: chain.client_id,
    primaryAssetId: chain.primary_asset_id,
    members,
    totalVariants: members.filter((m) => m.role === "variant").length,
    createdAt: chain.created_at.toISOString(),
    updatedAt: chain.updated_at.toISOString(),
  };
}

export async function listVersionChainsForClient(clientId: string): Promise<VersionChainV2[]> {
  const chainsRes = await pool.query<{ id: number }>(
    `SELECT id FROM ai_platform.ai_asset_version_chains WHERE client_id = $1 ORDER BY id`,
    [clientId],
  );
  const chains: VersionChainV2[] = [];
  for (const row of chainsRes.rows) {
    const chain = await getVersionChain(row.id);
    if (chain) chains.push(chain);
  }
  return chains;
}

/**
 * Auto-group assets into version chains based on perceptual hash similarity.
 * Reads from ai_asset_intelligence_v2, writes to ai_asset_version_chains.
 */
export async function autoGroupVersionChains(clientId: string): Promise<{
  chainsCreated: number;
  assetsGrouped: number;
}> {
  const assetsRes = await pool.query<{
    asset_id: number; asset_source: string; perceptual_hash: string | null;
    hash_tier: string | null; version_type: string;
  }>(
    `SELECT asset_id, asset_source, perceptual_hash, hash_tier, version_type
     FROM ai_platform.ai_asset_intelligence_v2
     WHERE client_id = $1 AND perceptual_hash IS NOT NULL AND analysis_failed = false`,
    [clientId],
  );

  // Group by same hash (exact match for metadata tier — means same base file)
  const groups = new Map<string, typeof assetsRes.rows>();
  for (const row of assetsRes.rows) {
    const key = `${row.hash_tier}:${row.perceptual_hash}`;
    const g = groups.get(key) ?? [];
    g.push(row);
    groups.set(key, g);
  }

  let chainsCreated = 0;
  let assetsGrouped = 0;

  for (const members of Array.from(groups.values())) {
    if (members.length <= 1) continue;

    // Find the "original" as primary; fall back to first
    const primary = members.find((m) => m.version_type === "original") ?? members[0]!;
    const chainId = await createVersionChain(clientId, primary.asset_id);

    for (const member of members) {
      const isPrimary = member.asset_id === primary.asset_id;
      await addMemberToChain(
        chainId,
        member.asset_id,
        member.asset_source,
        member.version_type,
        member.version_type === "original" ? "Primary" : `${member.version_type} variant`,
        isPrimary ? "primary" : "variant",
      );
    }

    chainsCreated++;
    assetsGrouped += members.length;
  }

  return { chainsCreated, assetsGrouped };
}
