import { createHmac, timingSafeEqual, createHash } from "node:crypto";
import { Router } from "express";
import express from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { decodeStandardWebhookSecret } from "../services/aiCoreMcpEventWebhookService.js";

const router = Router();
// Dedicated isolated receiver, mounted before the general JSON parser and admin guard.
// Never log request bodies, credentials, or signature headers.
export function checkInboundSignature(input: {
  secret: string; eventId: string; timestamp: string; signature: string; body: Buffer; now?: number;
}): boolean {
  if (!/^evt_[a-f0-9]{40}$/.test(input.eventId)) return false;
  if (!/^\d{10}$/.test(input.timestamp)) return false;
  if (Math.abs((input.now ?? Date.now()) / 1000 - Number(input.timestamp)) > 300) return false;
  const signature = input.signature.split(" ").find(v => v.startsWith("v1,"));
  if (!signature) return false;
  const received = Buffer.from(signature.slice(3), "base64");
  const expected = createHmac("sha256", decodeStandardWebhookSecret(input.secret))
    .update(input.eventId + "." + input.timestamp + "." + input.body.toString("utf8"))
    .digest();
  return received.length === expected.length && timingSafeEqual(received, expected);
}

router.post("/ai/core-chat/callback-receiver", express.raw({ type: "application/json", limit: "64kb" }), async (req, res) => {
  const secret = process.env["AI_CORE_CALLBACK_RECEIVER_SECRET"]?.trim();
  if (!secret) { res.status(503).json({ error: "receiver_not_configured" }); return; }
  const body = req.body;
  if (!Buffer.isBuffer(body)) { res.status(415).json({ error: "expected_json" }); return; }
  const eventId = req.header("webhook-id") ?? "";
  const timestamp = req.header("webhook-timestamp") ?? "";
  const subscriptionId = req.header("X-MCP-Subscription-Id") ?? "";
  if (!/^sub_[a-f0-9]{40}$/.test(subscriptionId)) { res.status(401).json({ error: "invalid_subscription" }); return; }
  try {
    if (!checkInboundSignature({ secret, eventId, timestamp, signature: req.header("webhook-signature") ?? "", body })) {
      res.status(401).json({ error: "invalid_signature" }); return;
    }
    const payload = JSON.parse(body.toString("utf8")) as Record<string, unknown>;
    if (payload.eventId !== eventId || payload.name !== "ai_core.task.terminal") {
      res.status(400).json({ error: "invalid_event" }); return;
    }
    const digest = createHash("sha256").update(body).digest("hex");
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ai_platform.ai_core_signed_callback_receipts (
        event_id TEXT PRIMARY KEY,
        subscription_id TEXT NOT NULL,
        payload_digest TEXT NOT NULL,
        received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    const saved = await db.execute(sql`
      INSERT INTO ai_platform.ai_core_signed_callback_receipts (event_id,subscription_id,payload_digest)
      VALUES (${eventId},${subscriptionId},${digest})
      ON CONFLICT (event_id) DO UPDATE SET event_id = EXCLUDED.event_id
      WHERE ai_platform.ai_core_signed_callback_receipts.subscription_id = EXCLUDED.subscription_id
        AND ai_platform.ai_core_signed_callback_receipts.payload_digest = EXCLUDED.payload_digest
      RETURNING event_id
    `);
    if (!saved.rows?.length) { res.status(409).json({ error: "event_collision" }); return; }
    const signature = createHmac("sha256", decodeStandardWebhookSecret(secret))
      .update(`receipt:${eventId}:${subscriptionId}`).digest("hex");
    res.status(200).json({ eventId, subscriptionId, signature });
  } catch {
    res.status(500).json({ error: "receiver_unavailable" });
  }
});
export default router;
