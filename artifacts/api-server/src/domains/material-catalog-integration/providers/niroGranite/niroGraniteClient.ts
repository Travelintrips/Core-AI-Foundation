import { MAX_PAYLOAD_SIZE_BYTES } from "../../schemas.js";
import {
  CatalogFetchError,
  CatalogResponseTooLargeError,
} from "../../errors.js";
import type { CatalogFetchContext, ExternalCatalogItem, ExternalCatalogResult } from "../../types.js";
import { mapNiroGraniteRecord } from "./niroGraniteMapper.js";
import {
  NiroGraniteFeedEnvelopeSchema,
  type NiroGraniteProviderConfig,
} from "./niroGraniteSchemas.js";
import { parseNiroGraniteConfig } from "./niroGraniteConfig.js";

const MAX_RETRIES = 2;

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new CatalogFetchError("aborted", "Catalog fetch was cancelled.");
  }
}

async function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new CatalogFetchError("aborted", "Catalog fetch was cancelled."));
    }, { once: true });
  });
}

async function readBodyWithLimit(response: Response, signal: AbortSignal | undefined): Promise<string> {
  if (!response.body) {
    const text = await response.text();
    const size = Buffer.byteLength(text, "utf8");
    if (size > MAX_PAYLOAD_SIZE_BYTES) throw new CatalogResponseTooLargeError(size, MAX_PAYLOAD_SIZE_BYTES);
    return text;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_PAYLOAD_SIZE_BYTES) {
        await reader.cancel();
        throw new CatalogResponseTooLargeError(total, MAX_PAYLOAD_SIZE_BYTES);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

export interface OfficialFeedFetchOptions {
  readonly fetchImpl?: typeof fetch;
  readonly retryDelayMs?: number;
}

export async function fetchOfficialFeedJson(
  config: NiroGraniteProviderConfig,
  context: CatalogFetchContext,
  options: OfficialFeedFetchOptions = {},
): Promise<ExternalCatalogResult> {
  if (!config.feedUrl) throw new CatalogFetchError("schema", "Official feed URL is not configured.");
  const fetchImpl = options.fetchImpl ?? fetch;
  let retryCount = 0;

  while (true) {
    throwIfAborted(context.abortSignal);
    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), config.timeoutMs);
    const abortHandler = () => timeoutController.abort();
    context.abortSignal?.addEventListener("abort", abortHandler, { once: true });
    try {
      const headers: Record<string, string> = { accept: "application/json" };
      if (config.accessToken) headers.authorization = `Bearer ${config.accessToken}`;
      if (config.apiKey) headers["x-api-key"] = config.apiKey;
      const response = await fetchImpl(config.feedUrl, {
        method: "GET",
        headers,
        signal: timeoutController.signal,
      });
      if (!response.ok) {
        const retryable = [429, 502, 503, 504].includes(response.status);
        if (response.status === 401 || response.status === 403) {
          throw new CatalogFetchError("authentication", "Official feed authentication failed.", {
            statusCode: response.status,
            retryCount,
          });
        }
        if (!retryable || retryCount >= MAX_RETRIES) {
          throw new CatalogFetchError(
            response.status === 429 ? "rate_limit" : "http",
            `Official feed request failed with HTTP ${response.status}.`,
            { statusCode: response.status, retryCount },
          );
        }
        retryCount++;
        await wait(options.retryDelayMs ?? 100, context.abortSignal);
        continue;
      }

      const body = await readBodyWithLimit(response, context.abortSignal);
      let json: unknown;
      try {
        json = JSON.parse(body);
      } catch {
        throw new CatalogFetchError("schema", "Official feed returned invalid JSON.", { retryCount });
      }
      const envelope = NiroGraniteFeedEnvelopeSchema.safeParse(json);
      if (!envelope.success) {
        throw new CatalogFetchError("schema", "Official feed response did not match the approved export format.", { retryCount });
      }
      const limit = Math.min(context.limit ?? 50, 500);
      const mappedItems = envelope.data.items.slice(0, limit).map(mapNiroGraniteRecord);
      return {
        items: mappedItems,
        nextCursor: envelope.data.nextCursor,
        totalAvailable: envelope.data.totalAvailable ?? envelope.data.items.length,
        sourceMetadata: { sourceType: "official_feed", responseFormat: "niro-granite-json-v1" },
        fetchedAt: new Date(),
        payloadSizeBytes: Buffer.byteLength(body, "utf8"),
      };
    } catch (error) {
      if (error instanceof CatalogResponseTooLargeError || error instanceof CatalogFetchError) {
        if (
          error instanceof CatalogFetchError &&
          error.category === "timeout" &&
          retryCount < MAX_RETRIES
        ) {
          retryCount++;
          await wait(options.retryDelayMs ?? 100, context.abortSignal);
          continue;
        }
        throw error;
      }
      if (timeoutController.signal.aborted && !context.abortSignal?.aborted) {
        if (retryCount < MAX_RETRIES) {
          retryCount++;
          await wait(options.retryDelayMs ?? 100, context.abortSignal);
          continue;
        }
        throw new CatalogFetchError("timeout", "Official feed request timed out.", { retryCount });
      }
      if (context.abortSignal?.aborted) {
        throw new CatalogFetchError("aborted", "Catalog fetch was cancelled.", { retryCount });
      }
      if (retryCount < MAX_RETRIES) {
        retryCount++;
        await wait(options.retryDelayMs ?? 100, context.abortSignal);
        continue;
      }
      throw new CatalogFetchError("network", "Official feed network request failed.", { retryCount });
    } finally {
      clearTimeout(timer);
      context.abortSignal?.removeEventListener("abort", abortHandler);
    }
  }
}

export function mapFixturePage(
  records: unknown[],
  context: CatalogFetchContext,
): ExternalCatalogResult {
  throwIfAborted(context.abortSignal);
  const limit = Math.min(context.limit ?? 50, 500);
  const offset = context.cursor ? Number.parseInt(context.cursor, 10) : 0;
  const safeOffset = Number.isFinite(offset) && offset >= 0 ? offset : 0;
  const filtered = records.filter((record) => {
    if (!context.brand && !context.country) return true;
    const raw = record as Record<string, unknown>;
    const brandMatches = !context.brand || String(raw["brand"] ?? "").toLowerCase().includes(context.brand.toLowerCase());
    const countryMatches = !context.country || String(raw["country"] ?? "").toUpperCase() === context.country.toUpperCase();
    return brandMatches && countryMatches;
  });
  const page = filtered.slice(safeOffset, safeOffset + limit);
  const nextCursor = safeOffset + limit < filtered.length ? String(safeOffset + limit) : undefined;
  const payloadSizeBytes = Buffer.byteLength(JSON.stringify(page), "utf8");
  if (payloadSizeBytes > MAX_PAYLOAD_SIZE_BYTES) {
    throw new CatalogResponseTooLargeError(payloadSizeBytes, MAX_PAYLOAD_SIZE_BYTES);
  }
  return {
    items: page.map(mapNiroGraniteRecord),
    nextCursor,
    totalAvailable: filtered.length,
    sourceMetadata: { sourceType: "official_feed", fixture: "niro-granite-official-export-v1" },
    fetchedAt: new Date("2026-01-15T00:00:00.000Z"),
    payloadSizeBytes,
  };
}

export function validateClientConfig(config: unknown) {
  return parseNiroGraniteConfig(config);
}