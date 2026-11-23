import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { ReleaseError, releaseCredentialBinding, task189Target, verifyMandate } from "./task189ReleaseMandate.js";

type Admin = { userId: number };
type Worker = { id: string; name: string; binding: string };
export type ReleaseAction =
  | { kind: "inspect"; admin: Admin }
  | { kind: "register"; admin: Admin; mandate: unknown; signature: string }
  | { kind: "revoke"; admin: Admin; grantId: string }
  | { kind: "issue"; worker: Worker; grantId: string }
  | { kind: "redeem"; admin: Admin; grantId: string; permitId: string };

export async function task189Release(action: ReleaseAction, publicDer: string | undefined) {
  return db.transaction(async tx => {
    // Keep registration, revocation, issue and redemption ordered across replicas.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(189, 20261124)`);
    const credential = (await tx.execute(sql`
      SELECT id::text,token_hash FROM ai_platform.ai_agent_service_tokens
      WHERE name=${task189Target.principal} AND is_active AND 'agent:work'=ANY(scopes)
        AND scopes <@ ARRAY['agent:work','agent:presence']::text[] AND (expires_at IS NULL OR expires_at>clock_timestamp())
      FOR SHARE
    `)).rows[0];
    const binding = credential && releaseCredentialBinding(String(credential.token_hash));
    if (action.kind === "issue" && (!credential || action.worker.name !== task189Target.principal ||
        action.worker.id !== credential.id || action.worker.binding !== binding))
      throw new ReleaseError(403, "DELEGATE_IDENTITY_MISMATCH");

    if (action.kind === "inspect") {
      const row = (await tx.execute(sql`
        SELECT g.grant_id,g.revoked_at,p.permit_id,p.expires_at,p.consumed_at
        FROM task189_release.grants g LEFT JOIN task189_release.permit p USING (grant_id)
        ORDER BY (p.permit_id IS NOT NULL) DESC,g.registered_at DESC LIMIT 1
      `)).rows[0];
      return { target: task189Target, credentialId: credential?.id ?? null,
        credentialBinding: binding ?? null, record: row ?? null, authorityConfigured: Boolean(publicDer) };
    }
    if (action.kind === "revoke") {
      const row = (await tx.execute(sql`
        UPDATE task189_release.grants SET revoked_at=COALESCE(revoked_at,clock_timestamp()),
          revoked_by=COALESCE(revoked_by,${action.admin.userId})
        WHERE grant_id=${action.grantId}::uuid RETURNING grant_id,revoked_at
      `)).rows[0];
      if (!row) throw new ReleaseError(404, "MANDATE_NOT_REGISTERED");
      return row;
    }

    const job = (await tx.execute(sql`
      SELECT 1 FROM public.ai_execution_jobs WHERE id=${task189Target.job}::uuid
        AND task_id=189 AND company_id='default' AND status='prepared'
        AND started_at IS NULL AND final_ack_verified IS FALSE
    `)).rows[0];
    if (!job) throw new ReleaseError(409, "JOB_NOT_AWAITING_PREPARATION");
    let payload: unknown;
    let signature: unknown;
    if (action.kind === "register") {
      payload = action.mandate;
      signature = action.signature;
    } else {
      const stored = (await tx.execute(sql`
        SELECT mandate,signature,revoked_at FROM task189_release.grants WHERE grant_id=${action.grantId}::uuid
      `)).rows[0];
      if (!stored) throw new ReleaseError(404, "MANDATE_NOT_REGISTERED");
      if (stored.revoked_at) throw new ReleaseError(409, "MANDATE_REVOKED");
      payload = stored.mandate;
      signature = stored.signature;
    }
    const time = (await tx.execute(sql`SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS ms`)).rows[0];
    const grant = verifyMandate(payload, signature, publicDer, Number(time?.ms));
    if (grant.credentialId !== credential?.id || grant.credentialBinding !== binding)
      throw new ReleaseError(403, "MANDATE_CREDENTIAL_MISMATCH");
    if (action.kind !== "register" && grant.grantId !== action.grantId)
      throw new ReleaseError(403, "MANDATE_ID_MISMATCH");
    if (action.kind === "register") {
      await tx.execute(sql`
        INSERT INTO task189_release.grants(grant_id,mandate,signature,registered_by)
        VALUES (${grant.grantId}::uuid,${JSON.stringify(grant)}::jsonb,${action.signature},${action.admin.userId})
        ON CONFLICT (grant_id) DO NOTHING
      `);
      const stored = (await tx.execute(sql`SELECT grant_id FROM task189_release.grants
        WHERE grant_id=${grant.grantId}::uuid AND signature=${action.signature} AND revoked_at IS NULL
          AND mandate=${JSON.stringify(grant)}::jsonb`)).rows[0];
      if (!stored) throw new ReleaseError(409, "MANDATE_ID_ALREADY_USED");
      return { grantId: grant.grantId, registered: true };
    }

    if (action.kind === "issue") {
      await tx.execute(sql`
        WITH ts AS MATERIALIZED (SELECT clock_timestamp() AS at)
        INSERT INTO task189_release.permit(grant_id,permit_id,issued_at,expires_at)
        SELECT ${grant.grantId}::uuid,${randomUUID()}::uuid,ts.at,
          least(ts.at+interval '3 minutes',to_timestamp(${grant.expiresAt}/1000.0))
        FROM ts WHERE ts.at<to_timestamp(${grant.expiresAt}/1000.0)
        ON CONFLICT (singleton) DO NOTHING
      `);
      const row = (await tx.execute(sql`
        SELECT permit_id,issued_at,expires_at,consumed_at,expires_at>clock_timestamp() AS unexpired
        FROM task189_release.permit WHERE grant_id=${grant.grantId}::uuid
      `)).rows[0];
      if (!row) throw new ReleaseError(409, "ISSUANCE_UNAVAILABLE");
      return { grantId: grant.grantId, permitId: row.permit_id, issuedAt: row.issued_at,
        expiresAt: row.expires_at, usable: row.unexpired === true && row.consumed_at === null };
    }
    if (action.admin.userId !== grant.redeemerUserId)
      throw new ReleaseError(403, "MANDATE_REDEEMER_MISMATCH");
    const used = (await tx.execute(sql`
      WITH ts AS MATERIALIZED (SELECT clock_timestamp() AS at)
      UPDATE task189_release.permit p SET consumed_at=ts.at,consumed_by=${action.admin.userId} FROM ts
      WHERE p.grant_id=${grant.grantId}::uuid AND p.permit_id=${action.permitId}::uuid
        AND p.consumed_at IS NULL AND ts.at>=p.issued_at AND ts.at<p.expires_at
      RETURNING p.permit_id,p.consumed_at
    `)).rows[0];
    if (!used) throw new ReleaseError(409, "PERMIT_UNAVAILABLE_OR_ALREADY_CONSUMED");
    return { grantId: grant.grantId, permitId: used.permit_id, consumedAt: used.consumed_at };
  });
}
