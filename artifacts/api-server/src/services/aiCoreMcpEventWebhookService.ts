import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "../lib/logger.js";

export const AI_CORE_TERMINAL_EVENT_NAME = "ai_core.task.terminal";
const DEFAULT_SUBSCRIPTION_TTL_MS = 24 * 60 * 60 * 1000;
const MIN_SUBSCRIPTION_TTL_MS = 5 * 60 * 1000;
const MAX_SUBSCRIPTION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_DELIVERY_ATTEMPTS = 5;
const DELIVERY_POLL_MS = 5_000;
const DELIVERY_BODY_LIMIT_BYTES = 256 * 1024;
const CALLBACK_RESPONSE_LIMIT_BYTES = 64 * 1024;

type TerminalEventType = "COMPLETED" | "FAILED" | "BLOCKED" | "MERGED" | "DEPLOYED";

export type AiCoreTerminalEventArguments = {
  taskId?: string;
  repository?: string;
  projectName?: string;
  eventTypes?: TerminalEventType[];
};

export class McpCallbackEndpointError extends Error {
  constructor(
    readonly reason:
      | "invalid_url"
      | "invalid_secret"
      | "dns_failed"
      | "private_address"
      | "timeout"
      | "challenge_failed"
      | "http_error"
      | "response_too_large",
    message: string,
  ) {
    super(message);
    this.name = "McpCallbackEndpointError";
  }
}

let ensurePromise: Promise<void> | null = null;
let deliveryTimer: NodeJS.Timeout | null = null;
let deliveryRunning = false;

function sessionSecret(): string {
  const value = process.env["SESSION_SECRET"]?.trim();
  if (!value) {
    throw new Error("SESSION_SECRET is required for MCP event subscriptions");
  }
  return value;
}

function encryptionKey(): Buffer {
  return createHash("sha256")
    .update("ai-core-mcp-event-secret\0")
    .update(sessionSecret())
    .digest();
}

function encryptSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(".");
}

function decryptSecret(value: string): string {
  const [version, ivRaw, tagRaw, ciphertextRaw] = value.split(".");
  if (version !== "v1" || !ivRaw || !tagRaw || !ciphertextRaw) {
    throw new Error("Invalid encrypted MCP event secret");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivRaw, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagRaw, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextRaw, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

function normalizeBase64(value: string): string {
  const remainder = value.length % 4;
  return remainder === 0 ? value : value + "=".repeat(4 - remainder);
}

export function decodeStandardWebhookSecret(secret: string): Buffer {
  if (!secret.startsWith("whsec_")) {
    throw new McpCallbackEndpointError(
      "invalid_secret",
      "Webhook signing secret must use the whsec_ prefix.",
    );
  }
  const encoded = secret.slice("whsec_".length);
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new McpCallbackEndpointError(
      "invalid_secret",
      "Webhook signing secret is not valid base64.",
    );
  }
  const decoded = Buffer.from(normalizeBase64(encoded), "base64");
  if (decoded.length < 24 || decoded.length > 64) {
    throw new McpCallbackEndpointError(
      "invalid_secret",
      "Webhook signing secret must decode to 24-64 bytes.",
    );
  }
  return decoded;
}

export function signStandardWebhook(
  secret: string,
  messageId: string,
  timestampSeconds: number,
  body: string,
): string {
  const key = decodeStandardWebhookSecret(secret);
  const signature = createHmac("sha256", key)
    .update(`${messageId}.${timestampSeconds}.${body}`)
    .digest("base64");
  return `v1,${signature}`;
}

function canonicalize(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
    .join(",")}}`;
}

export function canonicalJson(value: unknown): string {
  return canonicalize(value);
}

function deterministicSubscriptionId(input: {
  principalId: string;
  callbackUrl: string;
  eventName: string;
  arguments: AiCoreTerminalEventArguments;
}): string {
  const digest = createHash("sha256")
    .update(input.principalId)
    .update("\n")
    .update(input.callbackUrl)
    .update("\n")
    .update(input.eventName)
    .update("\n")
    .update(canonicalJson(input.arguments))
    .digest("hex");
  return `sub_${digest.slice(0, 40)}`;
}

const blockedAddresses = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as Array<[string, number]>) {
  blockedAddresses.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as Array<[string, number]>) {
  blockedAddresses.addSubnet(network, prefix, "ipv6");
}

function publicIpAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped?.[1]) return publicIpAddress(mapped[1]);
  const family = isIP(address);
  if (family === 4) return !blockedAddresses.check(address, "ipv4");
  if (family === 6) return !blockedAddresses.check(address, "ipv6");
  return false;
}

async function validatedCallbackTarget(rawUrl: string): Promise<{
  url: URL;
  address: string;
}> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new McpCallbackEndpointError("invalid_url", "Callback URL is invalid.");
  }
  if (
    url.protocol !== "https:" ||
    Boolean(url.username) ||
    Boolean(url.password) ||
    (url.port && url.port !== "443")
  ) {
    throw new McpCallbackEndpointError(
      "invalid_url",
      "Callback URL must use public HTTPS on port 443 without embedded credentials.",
    );
  }

  const hostname =
    url.hostname.startsWith("[") && url.hostname.endsWith("]")
      ? url.hostname.slice(1, -1)
      : url.hostname;
  let addresses: Awaited<ReturnType<typeof lookup>>;
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new McpCallbackEndpointError(
      "dns_failed",
      "Callback hostname could not be resolved.",
    );
  }
  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw new McpCallbackEndpointError(
      "dns_failed",
      "Callback hostname did not resolve to an address.",
    );
  }
  if (addresses.some((entry) => !publicIpAddress(entry.address))) {
    throw new McpCallbackEndpointError(
      "private_address",
      "Callback hostname resolves to a private, local, reserved, or non-public address.",
    );
  }
  return { url, address: addresses[0]!.address };
}

async function postPinnedHttps(
  rawUrl: string,
  body: string,
  headers: Record<string, string>,
  timeoutMs = 10_000,
): Promise<{ status: number; body: string }> {
  const target = await validatedCallbackTarget(rawUrl);
  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      {
        protocol: "https:",
        hostname: target.address,
        port: 443,
        path: `${target.url.pathname}${target.url.search}`,
        method: "POST",
        servername:
          target.url.hostname.startsWith("[") && target.url.hostname.endsWith("]")
            ? target.url.hostname.slice(1, -1)
            : target.url.hostname,
        headers: {
          ...headers,
          Host: target.url.host,
          "Content-Length": String(Buffer.byteLength(body, "utf8")),
        },
        rejectUnauthorized: true,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += buffer.length;
          if (size > CALLBACK_RESPONSE_LIMIT_BYTES) {
            request.destroy(
              new McpCallbackEndpointError(
                "response_too_large",
                "Callback response exceeded the allowed size.",
              ),
            );
            return;
          }
          chunks.push(buffer);
        });
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );

    request.setTimeout(timeoutMs, () => {
      request.destroy(
        new McpCallbackEndpointError("timeout", "Callback request timed out."),
      );
    });
    request.on("error", (error) => {
      reject(
        error instanceof McpCallbackEndpointError
          ? error
          : new McpCallbackEndpointError(
              "http_error",
              error instanceof Error ? error.message : "Callback request failed.",
            ),
      );
    });
    request.end(body);
  });
}

async function verifyCallback(input: {
  subscriptionId: string;
  callbackUrl: string;
  secret: string;
}): Promise<void> {
  const challenge = randomUUID();
  const messageId = `msg_verification_${randomUUID()}`;
  const body = JSON.stringify({ type: "verification", challenge });
  const timestamp = Math.floor(Date.now() / 1000);
  const response = await postPinnedHttps(
    input.callbackUrl,
    body,
    {
      "Content-Type": "application/json",
      "webhook-id": messageId,
      "webhook-timestamp": String(timestamp),
      "webhook-signature": signStandardWebhook(
        input.secret,
        messageId,
        timestamp,
        body,
      ),
      "X-MCP-Subscription-Id": input.subscriptionId,
    },
  );
  if (response.status < 200 || response.status >= 300) {
    throw new McpCallbackEndpointError(
      "challenge_failed",
      `Callback verification returned HTTP ${response.status}.`,
    );
  }

  let echoed = "";
  try {
    const parsed = JSON.parse(response.body) as { challenge?: unknown };
    echoed = typeof parsed.challenge === "string" ? parsed.challenge : "";
  } catch {
    throw new McpCallbackEndpointError(
      "challenge_failed",
      "Callback verification response was not valid JSON.",
    );
  }
  const expected = Buffer.from(challenge, "utf8");
  const actual = Buffer.from(echoed, "utf8");
  if (
    expected.length !== actual.length ||
    !timingSafeEqual(expected, actual)
  ) {
    throw new McpCallbackEndpointError(
      "challenge_failed",
      "Callback verification challenge did not match.",
    );
  }
}

async function ensureTablesInternal(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS ai_platform.ai_core_mcp_event_subscriptions (
      id TEXT PRIMARY KEY,
      principal_id TEXT NOT NULL,
      event_name TEXT NOT NULL,
      arguments_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      arguments_digest TEXT NOT NULL,
      callback_url TEXT NOT NULL,
      secret_ciphertext TEXT NOT NULL,
      verified_at TIMESTAMPTZ NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS ai_core_mcp_event_subscriptions_active_idx
      ON ai_platform.ai_core_mcp_event_subscriptions(event_name, active, expires_at)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS ai_core_mcp_event_subscriptions_principal_idx
      ON ai_platform.ai_core_mcp_event_subscriptions(principal_id, active)
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS ai_platform.ai_core_mcp_event_deliveries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id TEXT NOT NULL UNIQUE,
      subscription_id TEXT NOT NULL REFERENCES ai_platform.ai_core_mcp_event_subscriptions(id) ON DELETE CASCADE,
      response_id UUID,
      task_id UUID,
      event_name TEXT NOT NULL,
      payload_json JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_http_status INTEGER,
      last_error TEXT,
      delivered_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT ai_core_mcp_event_deliveries_status_check
        CHECK (status IN ('PENDING','DELIVERING','DELIVERED','FAILED','TERMINATED'))
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS ai_core_mcp_event_deliveries_pending_idx
      ON ai_platform.ai_core_mcp_event_deliveries(status, next_attempt_at, created_at)
  `);
}

export async function ensureAiCoreMcpEventTables(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = ensureTablesInternal().catch((error) => {
      ensurePromise = null;
      throw error;
    });
  }
  return ensurePromise;
}

function boundedTtlMs(requested: number | null | undefined): number {
  if (requested === null || requested === undefined) {
    return DEFAULT_SUBSCRIPTION_TTL_MS;
  }
  return Math.max(
    MIN_SUBSCRIPTION_TTL_MS,
    Math.min(MAX_SUBSCRIPTION_TTL_MS, Math.floor(requested)),
  );
}

export async function subscribeAiCoreMcpEvent(input: {
  principalId: string;
  eventName: string;
  arguments: AiCoreTerminalEventArguments;
  callbackUrl: string;
  secret: string;
  ttlMs?: number | null;
}): Promise<{ id: string; refreshBefore: string }> {
  await ensureAiCoreMcpEventTables();
  if (input.eventName !== AI_CORE_TERMINAL_EVENT_NAME) {
    throw new Error(`Unsupported MCP event: ${input.eventName}`);
  }
  decodeStandardWebhookSecret(input.secret);
  const subscriptionId = deterministicSubscriptionId(input);
  await verifyCallback({
    subscriptionId,
    callbackUrl: input.callbackUrl,
    secret: input.secret,
  });

  const canonicalArguments = canonicalJson(input.arguments);
  const argumentsDigest = createHash("sha256")
    .update(canonicalArguments)
    .digest("hex");
  const expiresAt = new Date(Date.now() + boundedTtlMs(input.ttlMs));

  await db.execute(sql`
    INSERT INTO ai_platform.ai_core_mcp_event_subscriptions (
      id,
      principal_id,
      event_name,
      arguments_json,
      arguments_digest,
      callback_url,
      secret_ciphertext,
      verified_at,
      expires_at,
      active,
      updated_at
    )
    VALUES (
      ${subscriptionId},
      ${input.principalId},
      ${input.eventName},
      ${JSON.stringify(input.arguments)}::jsonb,
      ${argumentsDigest},
      ${input.callbackUrl},
      ${encryptSecret(input.secret)},
      NOW(),
      ${expiresAt},
      TRUE,
      NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
      principal_id = EXCLUDED.principal_id,
      event_name = EXCLUDED.event_name,
      arguments_json = EXCLUDED.arguments_json,
      arguments_digest = EXCLUDED.arguments_digest,
      callback_url = EXCLUDED.callback_url,
      secret_ciphertext = EXCLUDED.secret_ciphertext,
      verified_at = NOW(),
      expires_at = EXCLUDED.expires_at,
      active = TRUE,
      updated_at = NOW()
  `);

  return { id: subscriptionId, refreshBefore: expiresAt.toISOString() };
}

export async function unsubscribeAiCoreMcpEvent(input: {
  principalId: string;
  eventName: string;
  arguments: AiCoreTerminalEventArguments;
  callbackUrl: string;
}): Promise<void> {
  await ensureAiCoreMcpEventTables();
  const subscriptionId = deterministicSubscriptionId(input);
  await db.execute(sql`
    UPDATE ai_platform.ai_core_mcp_event_subscriptions
    SET active = FALSE,
        expires_at = NOW(),
        updated_at = NOW()
    WHERE id = ${subscriptionId}
      AND principal_id = ${input.principalId}
  `);
}

export function matchesTerminalEventArguments(
  argumentsValue: AiCoreTerminalEventArguments,
  event: {
    taskId: string | null;
    repository: string | null;
    projectName: string | null;
    eventType: TerminalEventType;
  },
): boolean {
  if (argumentsValue.taskId && argumentsValue.taskId !== event.taskId) return false;
  if (
    argumentsValue.repository &&
    argumentsValue.repository !== event.repository
  ) return false;
  if (
    argumentsValue.projectName &&
    argumentsValue.projectName !== event.projectName
  ) return false;
  if (
    argumentsValue.eventTypes?.length &&
    !argumentsValue.eventTypes.includes(event.eventType)
  ) return false;
  return true;
}

function lifecycleEventType(input: {
  kind: string;
  checkpoint?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}): TerminalEventType | null {
  const explicit = [
    input.checkpoint?.["eventType"],
    input.metadata?.["eventType"],
  ].find((value) => typeof value === "string");
  if (
    typeof explicit === "string" &&
    ["COMPLETED", "FAILED", "BLOCKED", "MERGED", "DEPLOYED"].includes(explicit)
  ) {
    return explicit as TerminalEventType;
  }
  if (input.kind === "COMPLETED") return "COMPLETED";
  if (input.kind === "FAILED") return "FAILED";
  if (input.kind === "BLOCKER") return "BLOCKED";
  return null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export async function enqueueAiCoreMcpBridgeLifecycleEvent(input: {
  responseId: string;
  taskId?: string | null;
  kind: string;
  message: string;
  checkpoint?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  createdAt?: Date | string | null;
}): Promise<number> {
  const eventType = lifecycleEventType(input);
  if (!eventType) return 0;
  await ensureAiCoreMcpEventTables();

  let task:
    | {
        task_number?: unknown;
        project_name?: unknown;
        repository?: unknown;
        branch?: unknown;
        status?: unknown;
        result_summary?: unknown;
      }
    | undefined;
  if (input.taskId) {
    const taskResult = await db.execute(sql`
      SELECT
        task_number,
        project_name,
        repository,
        branch,
        status,
        result_summary
      FROM ai_platform.ai_coding_tasks
      WHERE id = ${input.taskId}::uuid
      LIMIT 1
    `);
    task = taskResult.rows?.[0];
  }

  const taskId = input.taskId ?? null;
  const repository = stringOrNull(task?.repository);
  const projectName = stringOrNull(task?.project_name);
  const createdAt =
    input.createdAt instanceof Date
      ? input.createdAt
      : typeof input.createdAt === "string"
        ? new Date(input.createdAt)
        : new Date();
  const safeTimestamp = Number.isFinite(createdAt.getTime())
    ? createdAt.toISOString()
    : new Date().toISOString();

  const subscriptions = await db.execute(sql`
    SELECT id, arguments_json
    FROM ai_platform.ai_core_mcp_event_subscriptions
    WHERE active = TRUE
      AND event_name = ${AI_CORE_TERMINAL_EVENT_NAME}
      AND expires_at > NOW()
  `);

  let queued = 0;
  for (const row of subscriptions.rows ?? []) {
    const subscriptionId = String(row["id"] ?? "");
    if (!subscriptionId) continue;
    const argumentsValue =
      row["arguments_json"] && typeof row["arguments_json"] === "object"
        ? (row["arguments_json"] as AiCoreTerminalEventArguments)
        : {};
    if (
      !matchesTerminalEventArguments(argumentsValue, {
        taskId,
        repository,
        projectName,
        eventType,
      })
    ) {
      continue;
    }

    const eventId = `evt_${createHash("sha256")
      .update(subscriptionId)
      .update(":")
      .update(input.responseId)
      .digest("hex")
      .slice(0, 40)}`;
    const payload = {
      eventId,
      name: AI_CORE_TERMINAL_EVENT_NAME,
      timestamp: safeTimestamp,
      data: {
        response_id: input.responseId,
        task_id: taskId,
        task_number: stringOrNull(task?.task_number),
        project_name: projectName,
        repository,
        branch: stringOrNull(task?.branch),
        event_type: eventType,
        status: stringOrNull(task?.status) ?? eventType,
        message: input.message.slice(0, 4_000),
        result_summary: stringOrNull(task?.result_summary)?.slice(0, 8_000) ?? null,
        workspace_url: taskId ? `/coding-workspace/${taskId}` : null,
      },
      cursor: null,
    };
    const serialized = JSON.stringify(payload);
    if (Buffer.byteLength(serialized, "utf8") > DELIVERY_BODY_LIMIT_BYTES) {
      logger.warn(
        { eventId, taskId, subscriptionId },
        "[mcp-events] terminal payload exceeded delivery limit",
      );
      continue;
    }

    const inserted = await db.execute(sql`
      INSERT INTO ai_platform.ai_core_mcp_event_deliveries (
        event_id,
        subscription_id,
        response_id,
        task_id,
        event_name,
        payload_json,
        status,
        next_attempt_at
      )
      VALUES (
        ${eventId},
        ${subscriptionId},
        ${input.responseId}::uuid,
        ${taskId}::uuid,
        ${AI_CORE_TERMINAL_EVENT_NAME},
        ${serialized}::jsonb,
        'PENDING',
        NOW()
      )
      ON CONFLICT (event_id) DO NOTHING
      RETURNING id
    `);
    if (inserted.rows?.length) queued += 1;
  }

  if (queued > 0) {
    void processPendingAiCoreMcpEventDeliveries().catch((error) => {
      logger.warn({ error }, "[mcp-events] immediate delivery pass failed");
    });
  }
  return queued;
}

async function claimNextDelivery() {
  const result = await db.execute(sql`
    WITH candidate AS (
      SELECT id
      FROM ai_platform.ai_core_mcp_event_deliveries
      WHERE (
          status = 'PENDING'
          AND next_attempt_at <= NOW()
        )
        OR (
          status = 'DELIVERING'
          AND updated_at < NOW() - INTERVAL '2 minutes'
        )
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE ai_platform.ai_core_mcp_event_deliveries AS delivery
    SET status = 'DELIVERING',
        attempt_count = delivery.attempt_count + 1,
        updated_at = NOW()
    FROM candidate
    WHERE delivery.id = candidate.id
    RETURNING
      delivery.id,
      delivery.event_id,
      delivery.subscription_id,
      delivery.payload_json,
      delivery.attempt_count
  `);
  return result.rows?.[0] ?? null;
}

function retryDelayMs(attempt: number): number {
  const delays = [1_000, 5_000, 30_000, 120_000, 600_000];
  return delays[Math.max(0, Math.min(delays.length - 1, attempt - 1))]!;
}

async function markDelivery(input: {
  id: string;
  status: "PENDING" | "DELIVERED" | "FAILED" | "TERMINATED";
  httpStatus?: number | null;
  error?: string | null;
  nextAttemptAt?: Date | null;
}): Promise<void> {
  await db.execute(sql`
    UPDATE ai_platform.ai_core_mcp_event_deliveries
    SET status = ${input.status},
        last_http_status = ${input.httpStatus ?? null},
        last_error = ${input.error?.slice(0, 2_000) ?? null},
        next_attempt_at = COALESCE(${input.nextAttemptAt ?? null}, next_attempt_at),
        delivered_at = CASE WHEN ${input.status} = 'DELIVERED' THEN NOW() ELSE delivered_at END,
        updated_at = NOW()
    WHERE id = ${input.id}::uuid
  `);
}

async function deliverClaimed(row: Record<string, unknown>): Promise<void> {
  const id = String(row["id"]);
  const eventId = String(row["event_id"]);
  const subscriptionId = String(row["subscription_id"]);
  const attempt = Number(row["attempt_count"] ?? 1);
  const payload =
    row["payload_json"] && typeof row["payload_json"] === "object"
      ? row["payload_json"]
      : null;
  if (!payload) {
    await markDelivery({
      id,
      status: "FAILED",
      error: "Stored MCP event payload is invalid.",
    });
    return;
  }

  const subscriptionResult = await db.execute(sql`
    SELECT callback_url, secret_ciphertext, active, expires_at
    FROM ai_platform.ai_core_mcp_event_subscriptions
    WHERE id = ${subscriptionId}
    LIMIT 1
  `);
  const subscription = subscriptionResult.rows?.[0];
  if (
    !subscription ||
    subscription["active"] !== true ||
    new Date(String(subscription["expires_at"])).getTime() <= Date.now()
  ) {
    await markDelivery({
      id,
      status: "TERMINATED",
      error: "Subscription is inactive or expired.",
    });
    return;
  }

  const callbackUrl = String(subscription["callback_url"] ?? "");
  const secret = decryptSecret(String(subscription["secret_ciphertext"] ?? ""));
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);

  try {
    const response = await postPinnedHttps(
      callbackUrl,
      body,
      {
        "Content-Type": "application/json",
        "webhook-id": eventId,
        "webhook-timestamp": String(timestamp),
        "webhook-signature": signStandardWebhook(
          secret,
          eventId,
          timestamp,
          body,
        ),
        "X-MCP-Subscription-Id": subscriptionId,
      },
    );

    if (response.status >= 200 && response.status < 300) {
      await markDelivery({
        id,
        status: "DELIVERED",
        httpStatus: response.status,
      });
      return;
    }

    if (response.status === 410 || response.status === 413) {
      await markDelivery({
        id,
        status: "TERMINATED",
        httpStatus: response.status,
        error: `Callback returned HTTP ${response.status}.`,
      });
      if (response.status === 410) {
        await db.execute(sql`
          UPDATE ai_platform.ai_core_mcp_event_subscriptions
          SET active = FALSE, expires_at = NOW(), updated_at = NOW()
          WHERE id = ${subscriptionId}
        `);
      }
      return;
    }

    const retryable =
      response.status === 408 ||
      response.status === 425 ||
      response.status === 429 ||
      response.status >= 500;
    if (retryable && attempt < MAX_DELIVERY_ATTEMPTS) {
      await markDelivery({
        id,
        status: "PENDING",
        httpStatus: response.status,
        error: `Callback returned transient HTTP ${response.status}.`,
        nextAttemptAt: new Date(Date.now() + retryDelayMs(attempt)),
      });
      return;
    }

    await markDelivery({
      id,
      status: "FAILED",
      httpStatus: response.status,
      error: `Callback returned HTTP ${response.status}.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook delivery failed.";
    if (attempt < MAX_DELIVERY_ATTEMPTS) {
      await markDelivery({
        id,
        status: "PENDING",
        error: message,
        nextAttemptAt: new Date(Date.now() + retryDelayMs(attempt)),
      });
      return;
    }
    await markDelivery({ id, status: "FAILED", error: message });
  }
}

export async function processPendingAiCoreMcpEventDeliveries(
  limit = 20,
): Promise<number> {
  await ensureAiCoreMcpEventTables();
  if (deliveryRunning) return 0;
  deliveryRunning = true;
  let processed = 0;
  try {
    const bounded = Math.max(1, Math.min(100, limit));
    for (let index = 0; index < bounded; index += 1) {
      const row = await claimNextDelivery();
      if (!row) break;
      await deliverClaimed(row as Record<string, unknown>);
      processed += 1;
    }
    return processed;
  } finally {
    deliveryRunning = false;
  }
}

export async function startAiCoreMcpEventDeliveryRuntime(): Promise<void> {
  await ensureAiCoreMcpEventTables();
  if (deliveryTimer) return;
  await processPendingAiCoreMcpEventDeliveries().catch((error) => {
    logger.warn({ error }, "[mcp-events] startup delivery pass failed");
  });
  deliveryTimer = setInterval(() => {
    void processPendingAiCoreMcpEventDeliveries().catch((error) => {
      logger.warn({ error }, "[mcp-events] delivery poll failed");
    });
  }, DELIVERY_POLL_MS);
  deliveryTimer.unref?.();
  logger.info("[mcp-events] Native MCP event delivery runtime started");
}
