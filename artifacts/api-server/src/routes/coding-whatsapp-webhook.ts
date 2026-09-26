import crypto from "node:crypto";
import { Router, raw } from "express";
import { appendCodingBridgeResponse, submitCodingBridgeCommand } from "../services/localCodingControlBridgeService.js";
import { logger } from "../lib/logger.js";

const router = Router();

type IncomingEnvelope = {
  event?: unknown;
  deviceId?: unknown;
  workerId?: unknown;
  receivedAt?: unknown;
  message?: {
    key?: {
      id?: unknown;
      remoteJid?: unknown;
      participant?: unknown;
      fromMe?: unknown;
    };
    message?: {
      conversation?: unknown;
      extendedTextMessage?: { text?: unknown } | null;
      imageMessage?: { caption?: unknown } | null;
      videoMessage?: { caption?: unknown } | null;
    } | null;
  } | null;
};

function normalizeDigits(value: string): string {
  return value.replace(/\D/g, "");
}

function allowedSenders(): Set<string> {
  return new Set(
    (process.env.AI_CODING_WA_ALLOWED_SENDERS ?? "")
      .split(",")
      .map((value) => normalizeDigits(value.trim()))
      .filter(Boolean),
  );
}

function senderCandidates(payload: IncomingEnvelope): string[] {
  const values = [
    payload.message?.key?.remoteJid,
    payload.message?.key?.participant,
  ];
  return values
    .filter((value): value is string => typeof value === "string")
    .map(normalizeDigits)
    .filter(Boolean);
}

function extractText(payload: IncomingEnvelope): string {
  const message = payload.message?.message;
  const candidates = [
    message?.conversation,
    message?.extendedTextMessage?.text,
    message?.imageMessage?.caption,
    message?.videoMessage?.caption,
  ];
  const text = candidates.find((value): value is string => typeof value === "string");
  return text?.trim() ?? "";
}

function verifySignature(rawBody: Buffer, supplied: string | undefined, secret: string): boolean {
  if (!supplied) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  if (supplied.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(supplied, "utf8"), Buffer.from(expected, "utf8"));
  } catch {
    return false;
  }
}

router.post(
  "/ai/coding/whatsapp/webhook",
  raw({ type: "application/json", limit: "512kb" }),
  async (req, res): Promise<void> => {
    const secret = (process.env.AI_CODING_WA_INCOMING_SECRET ?? "").trim();
    if (!secret) {
      logger.warn("[coding-wa-inbound] incoming secret is not configured");
      res.status(503).json({ error: "WHATSAPP_CODING_WEBHOOK_NOT_CONFIGURED" });
      return;
    }

    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
    const signature =
      typeof req.header("x-cst-wa-signature") === "string"
        ? req.header("x-cst-wa-signature")!
        : undefined;

    if (!verifySignature(body, signature, secret)) {
      res.status(401).json({ error: "INVALID_SIGNATURE" });
      return;
    }

    let payload: IncomingEnvelope;
    try {
      payload = JSON.parse(body.toString("utf8")) as IncomingEnvelope;
    } catch {
      res.status(400).json({ error: "INVALID_JSON" });
      return;
    }

    if (payload.event !== "message.received" || payload.message?.key?.fromMe === true) {
      res.status(202).json({ accepted: false, reason: "IGNORED_EVENT" });
      return;
    }

    const allowlist = allowedSenders();
    if (allowlist.size === 0) {
      logger.warn("[coding-wa-inbound] sender allowlist is empty");
      res.status(503).json({ error: "WHATSAPP_CODING_ALLOWLIST_NOT_CONFIGURED" });
      return;
    }

    const sender = senderCandidates(payload).find((candidate) => allowlist.has(candidate));
    if (!sender) {
      res.status(403).json({ error: "SENDER_NOT_ALLOWED" });
      return;
    }

    const text = extractText(payload);
    if (!/^coding(?:\s|:)/i.test(text)) {
      res.status(202).json({ accepted: false, reason: "NOT_A_CODING_COMMAND" });
      return;
    }

    const instruction = text.replace(/^coding\s*:?[\s]*/i, "").trim();
    if (!instruction) {
      res.status(400).json({ error: "EMPTY_CODING_COMMAND" });
      return;
    }

    const messageId =
      typeof payload.message?.key?.id === "string" && payload.message.key.id.trim()
        ? payload.message.key.id.trim()
        : crypto.createHash("sha256").update(body).digest("hex").slice(0, 32);

    const result = await submitCodingBridgeCommand({
      externalCommandId: messageId,
      instruction,
      source: "whatsapp",
      commandType: "WHATSAPP_INSTRUCTION",
      authority: {
        channel: "whatsapp",
        sourceWrite: false,
        deploy: false,
        requiresExplicitApprovalForWrite: true,
      },
      metadata: {
        deviceId: typeof payload.deviceId === "string" ? payload.deviceId : null,
        workerId: typeof payload.workerId === "string" ? payload.workerId : null,
        senderSuffix: sender.slice(-4),
      },
    });

    if (result.created) {
      await appendCodingBridgeResponse({
        commandId: result.command.id,
        taskId: result.command.taskId,
        kind: "CHECKPOINT",
        message:
          "Perintah coding dari WhatsApp sudah diterima AI Core. Perintah tersimpan dengan mode aman: belum ada write/deploy sebelum approval.",
        checkpoint: {
          status: "WHATSAPP_COMMAND_RECEIVED",
          source: "whatsapp",
        },
      });
    }

    res.status(result.created ? 201 : 200).json({
      accepted: true,
      duplicate: !result.created,
      commandId: result.command.id,
      status: result.command.status,
    });
  },
);

export default router;
