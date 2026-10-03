import { randomInt, randomUUID } from "node:crypto";
import { pool, withTransientDatabaseRetry } from "@workspace/db";

const PAIRING_TTL_MS = 10 * 60 * 1000;

export type McpOauthPairing = {
  id: string;
  code: string;
  status: "pending" | "approved";
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  resource: string;
  state: string;
  approvedUserId: number | null;
  expiresAt: Date;
};

type PairingRow = {
  id: string;
  code: string;
  status: "pending" | "approved";
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  scope: string;
  resource: string;
  state: string;
  approved_user_id: number | null;
  expires_at: Date;
};

function mapRow(row: PairingRow): McpOauthPairing {
  return {
    id: row.id,
    code: row.code,
    status: row.status,
    clientId: row.client_id,
    redirectUri: row.redirect_uri,
    codeChallenge: row.code_challenge,
    scope: row.scope,
    resource: row.resource,
    state: row.state,
    approvedUserId: row.approved_user_id,
    expiresAt: row.expires_at,
  };
}

function generateCode(): string {
  return randomInt(0, 100_000_000).toString().padStart(8, "0");
}

export async function createMcpOauthPairing(input: {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  resource: string;
  state: string;
}): Promise<McpOauthPairing> {
  try {
    await withTransientDatabaseRetry(
      () => pool.query(
        "DELETE FROM ai_platform.mcp_oauth_pairings WHERE expires_at < now() - interval '1 hour'",
      ),
      { attempts: 3, baseDelayMs: 150 },
    );
  } catch {
    // Cleanup is best-effort and must never block a fresh OAuth pairing.
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const id = randomUUID();
    const code = generateCode();
    const expiresAt = new Date(Date.now() + PAIRING_TTL_MS);
    try {
      const result = await withTransientDatabaseRetry(
        () => pool.query<PairingRow>(
          `INSERT INTO ai_platform.mcp_oauth_pairings
            (id, code, client_id, redirect_uri, code_challenge, scope, resource, state, expires_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           RETURNING id, code, status, client_id, redirect_uri, code_challenge, scope, resource, state, approved_user_id, expires_at`,
          [id, code, input.clientId, input.redirectUri, input.codeChallenge, input.scope, input.resource, input.state, expiresAt],
        ),
        { attempts: 3, baseDelayMs: 150 },
      );
      return mapRow(result.rows[0]!);
    } catch (error) {
      const codeValue = (error as { code?: string } | null)?.code;
      if (codeValue !== "23505" || attempt === 4) throw error;
    }
  }
  throw new Error("pairing_creation_failed");
}

export async function getMcpOauthPairing(id: string): Promise<McpOauthPairing | null> {
  const result = await withTransientDatabaseRetry(
    () => pool.query<PairingRow>(
      `SELECT id, code, status, client_id, redirect_uri, code_challenge, scope, resource, state, approved_user_id, expires_at
         FROM ai_platform.mcp_oauth_pairings
        WHERE id = $1
        LIMIT 1`,
      [id],
    ),
    { attempts: 3, baseDelayMs: 150 },
  );
  const row = result.rows[0];
  if (!row) return null;
  return mapRow(row);
}

export async function approveMcpOauthPairing(code: string, userId: number): Promise<boolean> {
  const result = await withTransientDatabaseRetry(
    () => pool.query(
      `UPDATE ai_platform.mcp_oauth_pairings
          SET status = 'approved', approved_user_id = $2, approved_at = now()
        WHERE code = $1
          AND status = 'pending'
          AND expires_at > now()`,
      [code, userId],
    ),
    { attempts: 3, baseDelayMs: 150 },
  );
  return (result.rowCount ?? 0) > 0;
}
