import crypto from "node:crypto";
import { Router, raw, urlencoded } from "express";
import { appendCodingBridgeResponse, submitCodingBridgeCommand } from "../services/localCodingControlBridgeService.js";
import { logger } from "../lib/logger.js";
import {
  CodingWhatsappTaskRuntimeError,
  createAndStartWhatsappCodingTask,
} from "../services/codingWhatsappTaskRuntimeService.js";
import {
  decideCodingCriticalApproval,
  parseCriticalApprovalCommand,
} from "../services/codingCriticalApprovalService.js";
import {
  buildWhatsappConversationId,
  requestAiCoreWhatsappChat,
  sendAiCoreWhatsappReply,
  transcribeAiCoreWhatsappVoiceNote,
} from "../services/aiCoreWhatsappChatService.js";

const router = Router();

type IncomingEnvelope = {
  event?: unknown;
  deviceId?: unknown;
  workerId?: unknown;
  receivedAt?: unknown;
  senderPhone?: unknown;
  senderPhoneJid?: unknown;
  voiceNote?: {
    mimeType?: unknown;
    base64?: unknown;
    ptt?: unknown;
    seconds?: unknown;
    byteLength?: unknown;
  } | null;
  message?: {
    key?: {
      id?: unknown;
      remoteJid?: unknown;
      remoteJidAlt?: unknown;
      participant?: unknown;
      participantAlt?: unknown;
      senderPn?: unknown;
      participantPn?: unknown;
      fromMe?: unknown;
    };
    message?: {
      conversation?: unknown;
      extendedTextMessage?: { text?: unknown } | null;
      imageMessage?: { caption?: unknown } | null;
      videoMessage?: { caption?: unknown } | null;
      buttonsResponseMessage?: {
        selectedButtonId?: unknown;
        selectedDisplayText?: unknown;
      } | null;
      templateButtonReplyMessage?: {
        selectedId?: unknown;
        selectedDisplayText?: unknown;
      } | null;
      listResponseMessage?: {
        title?: unknown;
        singleSelectReply?: { selectedRowId?: unknown } | null;
      } | null;
      interactiveResponseMessage?: {
        body?: { text?: unknown } | null;
        nativeFlowResponseMessage?: {
          name?: unknown;
          paramsJson?: unknown;
        } | null;
      } | null;
    } | null;
  } | null;
};

function normalizeDigits(value: string): string {
  return value.replace(/\D/g, "");
}

function allowedSenders(): Set<string> {
  const configured =
    process.env.AI_CORE_WA_ALLOWED_SENDERS ??
    process.env.AI_CODING_WA_ALLOWED_SENDERS ??
    "";
  return new Set(
    configured
      .split(",")
      .map((value) => normalizeDigits(value.trim()))
      .filter(Boolean),
  );
}

function senderCandidates(payload: IncomingEnvelope): string[] {
  const values = [
    payload.senderPhone,
    payload.senderPhoneJid,
    payload.message?.key?.remoteJidAlt,
    payload.message?.key?.participantAlt,
    payload.message?.key?.senderPn,
    payload.message?.key?.participantPn,
    payload.message?.key?.remoteJid,
    payload.message?.key?.participant,
  ];
  return values
    .filter((value): value is string => typeof value === "string")
    .map(normalizeDigits)
    .filter(Boolean);
}

type IncomingVoiceNote = {
  mimeType: string;
  base64: string;
  seconds: number | null;
};

function extractVoiceNote(payload: IncomingEnvelope): IncomingVoiceNote | null {
  const voice = payload.voiceNote;
  if (!voice || voice.ptt !== true) return null;
  if (typeof voice.base64 !== "string" || !voice.base64.trim()) return null;
  const mimeType =
    typeof voice.mimeType === "string" && voice.mimeType.trim()
      ? voice.mimeType.trim()
      : "audio/ogg; codecs=opus";
  const secondsValue = Number(voice.seconds ?? 0);
  return {
    mimeType,
    base64: voice.base64.trim(),
    seconds: Number.isFinite(secondsValue) && secondsValue > 0 ? secondsValue : null,
  };
}

function unwrapIncomingMessageContent(value: unknown): Record<string, unknown> | null {
  let content =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;

  for (let depth = 0; content && depth < 6; depth += 1) {
    const nestedCandidates = [
      (content.ephemeralMessage as { message?: unknown } | undefined)?.message,
      (content.viewOnceMessage as { message?: unknown } | undefined)?.message,
      (content.viewOnceMessageV2 as { message?: unknown } | undefined)?.message,
      (content.viewOnceMessageV2Extension as { message?: unknown } | undefined)?.message,
      (content.documentWithCaptionMessage as { message?: unknown } | undefined)?.message,
      (content.editedMessage as { message?: unknown } | undefined)?.message,
    ];
    const nested = nestedCandidates.find(
      (candidate) => candidate && typeof candidate === "object" && !Array.isArray(candidate),
    );
    if (!nested) break;
    content = nested as Record<string, unknown>;
  }

  return content;
}

function nativeFlowResponseId(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const response = value as {
    nativeFlowResponseMessage?: {
      paramsJson?: unknown;
    } | null;
  };
  const paramsJson = response.nativeFlowResponseMessage?.paramsJson;
  if (typeof paramsJson !== "string" || !paramsJson.trim()) return null;

  try {
    const parsed = JSON.parse(paramsJson) as { id?: unknown };
    return typeof parsed.id === "string" && parsed.id.trim()
      ? parsed.id.trim()
      : null;
  } catch {
    return null;
  }
}

function extractText(payload: IncomingEnvelope): string {
  const message = unwrapIncomingMessageContent(payload.message?.message);
  if (!message) return "";

  const extendedTextMessage =
    message.extendedTextMessage &&
    typeof message.extendedTextMessage === "object" &&
    !Array.isArray(message.extendedTextMessage)
      ? (message.extendedTextMessage as { text?: unknown })
      : null;
  const imageMessage =
    message.imageMessage &&
    typeof message.imageMessage === "object" &&
    !Array.isArray(message.imageMessage)
      ? (message.imageMessage as { caption?: unknown })
      : null;
  const videoMessage =
    message.videoMessage &&
    typeof message.videoMessage === "object" &&
    !Array.isArray(message.videoMessage)
      ? (message.videoMessage as { caption?: unknown })
      : null;
  const buttonsResponseMessage =
    message.buttonsResponseMessage &&
    typeof message.buttonsResponseMessage === "object" &&
    !Array.isArray(message.buttonsResponseMessage)
      ? (message.buttonsResponseMessage as {
          selectedButtonId?: unknown;
          selectedDisplayText?: unknown;
        })
      : null;
  const templateButtonReplyMessage =
    message.templateButtonReplyMessage &&
    typeof message.templateButtonReplyMessage === "object" &&
    !Array.isArray(message.templateButtonReplyMessage)
      ? (message.templateButtonReplyMessage as {
          selectedId?: unknown;
          selectedDisplayText?: unknown;
        })
      : null;
  const listResponseMessage =
    message.listResponseMessage &&
    typeof message.listResponseMessage === "object" &&
    !Array.isArray(message.listResponseMessage)
      ? (message.listResponseMessage as {
          title?: unknown;
          singleSelectReply?: { selectedRowId?: unknown } | null;
        })
      : null;
  const interactiveResponseMessage =
    message.interactiveResponseMessage &&
    typeof message.interactiveResponseMessage === "object" &&
    !Array.isArray(message.interactiveResponseMessage)
      ? (message.interactiveResponseMessage as {
          body?: { text?: unknown } | null;
          nativeFlowResponseMessage?: {
            name?: unknown;
            paramsJson?: unknown;
          } | null;
        })
      : null;

  const candidates = [
    nativeFlowResponseId(interactiveResponseMessage),
    buttonsResponseMessage?.selectedButtonId,
    templateButtonReplyMessage?.selectedId,
    listResponseMessage?.singleSelectReply?.selectedRowId,
    message.conversation,
    extendedTextMessage?.text,
    imageMessage?.caption,
    videoMessage?.caption,
    buttonsResponseMessage?.selectedDisplayText,
    templateButtonReplyMessage?.selectedDisplayText,
    listResponseMessage?.title,
    interactiveResponseMessage?.body?.text,
  ];
  const text = candidates.find((value): value is string => typeof value === "string");
  return text?.trim() ?? "";
}

function resolveReplyDestination(payload: IncomingEnvelope, senderDigits: string): string {
  const remoteJid =
    typeof payload.message?.key?.remoteJid === "string"
      ? payload.message.key.remoteJid.trim()
      : "";
  if (/^[0-9]+(?:-[0-9]+)?@g\.us$/i.test(remoteJid)) {
    return remoteJid;
  }
  return senderDigits;
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

function verifyApprovalLinkSignature(input: {
  token: string;
  decision: "APPROVE" | "REJECT";
  supplied: string;
  secret: string;
}): boolean {
  const expected = crypto
    .createHmac("sha256", input.secret)
    .update(`${input.token}:${input.decision}`)
    .digest("hex");

  if (input.supplied.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(
      Buffer.from(input.supplied, "utf8"),
      Buffer.from(expected, "utf8"),
    );
  } catch {
    return false;
  }
}

function htmlEscape(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      case "'": return "&#39;";
      default: return char;
    }
  });
}

router.get(
  "/a/:token",
  async (req, res): Promise<void> => {
    const token =
      typeof req.params["token"] === "string" ? req.params["token"].trim() : "";
    if (!/^[A-Za-z0-9_-]{12,80}$/.test(token)) {
      res.status(400).type("html").send(
        "<!doctype html><html><body><h2>Approval link tidak valid.</h2></body></html>",
      );
      return;
    }

    const escapedToken = htmlEscape(token);
    res
      .status(200)
      .type("html")
      .send(`<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AI Core Approval</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;background:#f5f7fb;margin:0;padding:24px;color:#111}
.card{max-width:520px;margin:40px auto;background:#fff;border-radius:16px;padding:24px;box-shadow:0 8px 30px rgba(0,0,0,.08)}
.actions{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:20px}
button{width:100%;padding:16px;border:0;border-radius:12px;font-size:18px;font-weight:700;cursor:pointer;color:#fff}
.approve{background:#16a34a}.reject{background:#dc2626}
.meta{color:#555;margin-top:8px}
</style>
</head>
<body>
<div class="card">
<h2>AI Core Admin Approval</h2>
<div class="meta">Pilih tindakan untuk approval ini.</div>
<form method="post" action="/api/a/${escapedToken}">
<div class="actions">
<button class="approve" type="submit" name="decision" value="APPROVE">✅ APPROVE</button>
<button class="reject" type="submit" name="decision" value="REJECT">❌ REJECT</button>
</div>
</form>
</div>
</body>
</html>`);
  },
);

router.post(
  "/a/:token",
  urlencoded({ extended: false, limit: "8kb" }),
  async (req, res): Promise<void> => {
    const token =
      typeof req.params["token"] === "string" ? req.params["token"].trim() : "";
    const decision =
      req.body?.decision === "APPROVE" || req.body?.decision === "REJECT"
        ? req.body.decision
        : null;

    if (!/^[A-Za-z0-9_-]{12,80}$/.test(token) || !decision) {
      res.status(400).type("html").send(
        "<!doctype html><html><body><h2>Approval tidak valid.</h2></body></html>",
      );
      return;
    }

    try {
      const approval = await decideCodingCriticalApproval({
        token,
        decision,
        senderDigits: "",
      });

      res
        .status(200)
        .type("html")
        .send(`<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AI Core Approval</title></head><body style="font-family:system-ui,-apple-system,sans-serif;padding:24px"><h2>${decision === "APPROVE" ? "✅ Approval diterima" : "❌ Task ditolak"}</h2><p>Status: ${htmlEscape(approval.status)}</p><p>Halaman ini boleh ditutup.</p></body></html>`);
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error);
      const status =
        code === "APPROVAL_NOT_FOUND"
          ? 404
          : ["APPROVAL_EXPIRED", "APPROVAL_NOT_PENDING", "APPROVAL_RACE_LOST"].includes(code)
            ? 409
            : 500;

      res
        .status(status)
        .type("html")
        .send(`<!doctype html><html><body><h2>Approval tidak dapat diproses.</h2><p>${htmlEscape(code)}</p></body></html>`);
    }
  },
);

router.get(
  "/ai/coding/whatsapp/approval",
  async (req, res): Promise<void> => {
    const secret = (process.env.AI_CODING_WA_INCOMING_SECRET ?? "").trim();
    const token = typeof req.query.token === "string" ? req.query.token.trim() : "";
    const decision =
      req.query.decision === "APPROVE" || req.query.decision === "REJECT"
        ? req.query.decision
        : null;
    const sig = typeof req.query.sig === "string" ? req.query.sig.trim() : "";

    if (
      !secret ||
      !token ||
      !decision ||
      !sig ||
      !verifyApprovalLinkSignature({
        token,
        decision,
        supplied: sig,
        secret,
      })
    ) {
      res.status(400).type("html").send(
        "<!doctype html><html><body><h2>Approval link tidak valid.</h2></body></html>",
      );
      return;
    }

    const escapedToken = htmlEscape(token);
    const escapedSig = htmlEscape(sig);
    const escapedDecision = htmlEscape(decision);
    const actionLabel = decision === "APPROVE" ? "APPROVE" : "REJECT";

    res
      .status(200)
      .type("html")
      .send(`<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AI Core Approval</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;background:#f5f7fb;margin:0;padding:24px;color:#111}
.card{max-width:520px;margin:40px auto;background:#fff;border-radius:16px;padding:24px;box-shadow:0 8px 30px rgba(0,0,0,.08)}
button{width:100%;padding:16px;border:0;border-radius:12px;font-size:18px;font-weight:700;cursor:pointer;background:${decision === "APPROVE" ? "#16a34a" : "#dc2626"};color:white}
.meta{color:#555;margin:12px 0 20px}
</style>
</head>
<body>
<div class="card">
<h2>AI Core Admin Approval</h2>
<div class="meta">Konfirmasi tindakan: <strong>${actionLabel}</strong></div>
<form method="post" action="/api/ai/coding/whatsapp/approval">
<input type="hidden" name="token" value="${escapedToken}">
<input type="hidden" name="decision" value="${escapedDecision}">
<input type="hidden" name="sig" value="${escapedSig}">
<button type="submit">Konfirmasi ${actionLabel}</button>
</form>
</div>
</body>
</html>`);
  },
);

router.post(
  "/ai/coding/whatsapp/approval",
  urlencoded({ extended: false, limit: "32kb" }),
  async (req, res): Promise<void> => {
    const secret = (process.env.AI_CODING_WA_INCOMING_SECRET ?? "").trim();
    const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
    const decision =
      req.body?.decision === "APPROVE" || req.body?.decision === "REJECT"
        ? req.body.decision
        : null;
    const sig = typeof req.body?.sig === "string" ? req.body.sig.trim() : "";

    if (
      !secret ||
      !token ||
      !decision ||
      !sig ||
      !verifyApprovalLinkSignature({
        token,
        decision,
        supplied: sig,
        secret,
      })
    ) {
      res.status(400).type("html").send(
        "<!doctype html><html><body><h2>Approval link tidak valid.</h2></body></html>",
      );
      return;
    }

    try {
      const approval = await decideCodingCriticalApproval({
        token,
        decision,
        senderDigits: "",
      });

      res
        .status(200)
        .type("html")
        .send(`<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AI Core Approval</title></head><body style="font-family:system-ui,-apple-system,sans-serif;padding:24px"><h2>${decision === "APPROVE" ? "✅ Approval diterima" : "❌ Task ditolak"}</h2><p>Approval ID: ${htmlEscape(approval.id)}</p><p>Status: ${htmlEscape(approval.status)}</p><p>Halaman ini boleh ditutup.</p></body></html>`);
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error);
      const status =
        code === "APPROVAL_NOT_FOUND"
          ? 404
          : ["APPROVAL_EXPIRED", "APPROVAL_NOT_PENDING", "APPROVAL_RACE_LOST"].includes(code)
            ? 409
            : 500;

      res
        .status(status)
        .type("html")
        .send(`<!doctype html><html><body><h2>Approval tidak dapat diproses.</h2><p>${htmlEscape(code)}</p></body></html>`);
    }
  },
);

router.post(
  "/ai/coding/whatsapp/webhook",
  raw({ type: "application/json", limit: "12mb" }),
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
      logger.info(
        {
          event: payload.event,
          deviceId: typeof payload.deviceId === "string" ? payload.deviceId : null,
        },
        "[coding-wa-inbound] sender ignored because it is not allowlisted",
      );
      res.status(202).json({ accepted: false, reason: "SENDER_NOT_ALLOWED" });
      return;
    }

    const messageId =
      typeof payload.message?.key?.id === "string" && payload.message.key.id.trim()
        ? payload.message.key.id.trim()
        : crypto.createHash("sha256").update(body).digest("hex").slice(0, 32);

    let text = extractText(payload);
    let inputSource: "text" | "whatsapp_voice" = "text";
    const voiceNote = extractVoiceNote(payload);

    if (!text && voiceNote) {
      try {
        const transcription = await transcribeAiCoreWhatsappVoiceNote({
          audioBase64: voiceNote.base64,
          mimeType: voiceNote.mimeType,
        });
        text = transcription.text;
        inputSource = "whatsapp_voice";
        logger.info(
          {
            provider: transcription.provider,
            model: transcription.model,
            seconds: voiceNote.seconds,
            senderSuffix: sender.slice(-4),
          },
          "[ai-core-wa-voice] voice note transcribed",
        );
      } catch (error) {
        const destination = resolveReplyDestination(payload, sender);
        const delivery = await sendAiCoreWhatsappReply({
          to: destination,
          deviceId: typeof payload.deviceId === "string" ? payload.deviceId : null,
          incomingMessageId: messageId,
          text: "Voice note belum bisa diproses. Silakan kirim ulang beberapa saat lagi atau kirim sebagai teks.",
        });
        logger.warn(
          { err: error, delivery, senderSuffix: sender.slice(-4) },
          "[ai-core-wa-voice] transcription failed",
        );
        res.status(200).json({
          accepted: true,
          kind: "AI_CORE_VOICE_NOTE",
          transcribed: false,
          replied: delivery.status === "queued",
        });
        return;
      }
    }

    if (!text) {
      res.status(202).json({ accepted: false, reason: "EMPTY_TEXT" });
      return;
    }

    // Critical approvals intentionally stay text-only. A speech-to-text mistake
    // must never authorize a guarded production action.
    const approvalCommand =
      inputSource === "text" ? parseCriticalApprovalCommand(text) : null;
    if (approvalCommand) {
      try {
        const approval = await decideCodingCriticalApproval({
          token: approvalCommand.token,
          decision: approvalCommand.decision,
          senderDigits: sender,
        });
        res.status(200).json({
          accepted: true,
          kind: "CRITICAL_APPROVAL",
          decision: approvalCommand.decision,
          approvalId: approval.id,
          taskId: approval.taskId,
          actionType: approval.actionType,
          status: approval.status,
        });
      } catch (error) {
        const code = error instanceof Error ? error.message : String(error);
        const status =
          code === "APPROVAL_NOT_FOUND"
            ? 404
            : ["APPROVAL_EXPIRED", "APPROVAL_NOT_PENDING", "APPROVAL_RACE_LOST"].includes(code)
              ? 409
              : 500;
        res.status(status).json({ error: code });
      }
      return;
    }

    if (!/^coding(?:\s|:)/i.test(text)) {
      if (process.env.AI_CORE_WA_CHAT_ENABLED === "false") {
        res.status(202).json({ accepted: false, reason: "AI_CORE_WA_CHAT_DISABLED" });
        return;
      }

      const destination = resolveReplyDestination(payload, sender);
      const conversationId = buildWhatsappConversationId(sender, destination);
      try {
        const chat = await requestAiCoreWhatsappChat({
          message: text,
          conversationId,
          source: inputSource,
        });
        const delivery = await sendAiCoreWhatsappReply({
          to: destination,
          deviceId: typeof payload.deviceId === "string" ? payload.deviceId : null,
          incomingMessageId: messageId,
          text: chat.reply,
        });

        if (delivery.status !== "queued") {
          logger.warn(
            { delivery, route: chat.route, provider: chat.provider, model: chat.model },
            "[ai-core-wa-chat] reply was not queued",
          );
          res.status(502).json({
            accepted: true,
            kind: "AI_CORE_CHAT",
            replied: false,
            route: chat.route,
            delivery,
          });
          return;
        }

        logger.info(
          {
            route: chat.route,
            provider: chat.provider,
            model: chat.model,
            messageId: delivery.messageId,
          },
          "[ai-core-wa-chat] reply queued",
        );
        res.status(200).json({
          accepted: true,
          kind: "AI_CORE_CHAT",
          replied: true,
          route: chat.route,
          provider: chat.provider,
          model: chat.model,
          inputSource,
          messageId: delivery.messageId,
        });
      } catch (error) {
        logger.warn({ err: error }, "[ai-core-wa-chat] chat handling failed");
        res.status(503).json({
          accepted: true,
          kind: "AI_CORE_CHAT",
          replied: false,
          error: "AI_CORE_WA_CHAT_FAILED",
        });
      }
      return;
    }

    const instruction = text.replace(/^coding\s*:?[\s]*/i, "").trim();
    if (!instruction) {
      res.status(400).json({ error: "EMPTY_CODING_COMMAND" });
      return;
    }

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
        inputSource,
      },
    });

    let codingTaskId = result.command.taskId ?? null;

    if (result.created) {
      try {
        const started = await createAndStartWhatsappCodingTask({
          commandId: result.command.id,
          instruction,
        });
        codingTaskId = started.task.id;

        await appendCodingBridgeResponse({
          commandId: result.command.id,
          taskId: started.task.id,
          kind: "CHECKPOINT",
          message:
            `Perintah WhatsApp sudah dibuat menjadi Coding Workspace task ${started.task.taskNumber} untuk ${started.repository.fullName} branch ${started.branch}. Analisis aman sudah dimulai. Write, commit, PR, merge, dan deploy tetap memerlukan gate/approval yang berlaku.`,
          checkpoint: {
            status: "WHATSAPP_TASK_STARTED",
            source: "whatsapp",
            taskId: started.task.id,
            taskNumber: started.task.taskNumber,
            repository: started.repository.fullName,
            branch: started.branch,
            sessionId: started.sessionId,
          },
        });
      } catch (error) {
        const message =
          error instanceof CodingWhatsappTaskRuntimeError
            ? error.message
            : `Gagal membuat Coding Workspace task: ${error instanceof Error ? error.message : String(error)}`;

        await appendCodingBridgeResponse({
          commandId: result.command.id,
          taskId: null,
          kind: "BLOCKER",
          message,
          checkpoint: {
            status:
              error instanceof CodingWhatsappTaskRuntimeError
                ? error.kind
                : "WHATSAPP_TASK_CREATION_FAILED",
            source: "whatsapp",
          },
        });
      }
    }

    res.status(result.created ? 201 : 200).json({
      accepted: true,
      duplicate: !result.created,
      commandId: result.command.id,
      taskId: codingTaskId,
      status: result.command.status,
    });
  },
);

export default router;
