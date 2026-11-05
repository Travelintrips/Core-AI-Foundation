import { createPublicKey, verify } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

export type DevAttestation = {
  commandId: string; eventId: string; challenge: string; conversationId: string;
  workerId: string; keyId: string; assistantMessageId: string;
  assistantResponseHash: string; observedAt: string; signature: string;
};
const HEX64 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const WORKER = "openclaw-travelintrips-dev";
const KEY_ID = "openclaw-travelintrips-dev-ed25519-v1";
export function verifyDevAttestation(v: DevAttestation, keyDerB64: string): boolean {
  if (v.workerId !== WORKER || v.keyId !== KEY_ID ||
      !HEX64.test(v.eventId) || !HEX64.test(v.challenge) ||
      !HEX64.test(v.assistantResponseHash) ||
      !UUID.test(v.commandId) || !UUID.test(v.conversationId) ||
      !UUID.test(v.assistantMessageId) ||
      !/^\d{4}-\d\d-\d\dT/.test(v.observedAt)) return false;
  const message = [
    "dev-chatgpt-assistant-attestation/v1",
    "keyId=" + v.keyId, "workerId=" + v.workerId,
    "conversationId=" + v.conversationId, "eventId=" + v.eventId,
    "challenge=" + v.challenge, "assistantMessageId=" + v.assistantMessageId,
    "assistantResponseHash=" + v.assistantResponseHash,
    "observedAt=" + v.observedAt,
  ].join("\n");
  try {
    const key = createPublicKey({ key: Buffer.from(keyDerB64, "base64"), format: "der", type: "spki" });
    const signature = Buffer.from(v.signature, "base64");
    return signature.length === 64 && verify(null, Buffer.from(message, "utf8"), key, signature);
  } catch { return false; }
}
export async function persistVerifiedDevAttestation(v: DevAttestation) {
  if (process.env.APP_ENV !== "development" || process.env.NODE_ENV !== "development") {
    return { status: 404 as const };
  }
  const key = process.env.AI_CORE_DEV_ASSISTANT_ATTESTATION_PUBLIC_KEY_DER_B64;
  if (!key) return { status: 503 as const };
  if (!verifyDevAttestation(v, key)) return { status: 422 as const };
  try {
    const result = await db.execute(sql`
      INSERT INTO ai_platform.chatgpt_attestation_final_callbacks_dev (
        event_id, command_id, worker_id, conversation_id, challenge, key_id,
        assistant_message_id, response_hash, signature_b64, verified_at
      ) VALUES (
        ${v.eventId}, ${v.commandId}::uuid, ${v.workerId},
        ${v.conversationId}::uuid, ${v.challenge}, ${v.keyId},
        ${v.assistantMessageId}::uuid, ${v.assistantResponseHash},
        ${v.signature}, now()
      )
      RETURNING callback_id, event_id
    `);
    const row = result.rows[0] as {callback_id:string;event_id:string}|undefined;
    return row ? {status: 201 as const, callbackId: row.callback_id, eventId: row.event_id} : {status: 500 as const};
  } catch (e) {
    const code = (e as {code?:string;cause?:{code?:string}}).code || (e as {cause?:{code?:string}}).cause?.code;
    if (code === "23505") return {status: 409 as const};
    if (code === "23514" || code === "23503") return {status: 422 as const};
    return {status: 503 as const};
  }
}

[executed on device: srv1792369 (0891e23a-6a6b-4f8c-a16a-962e888e2014)]