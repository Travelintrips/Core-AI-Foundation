import { NiroGraniteProviderConfigSchema, type NiroGraniteProviderConfig } from "./niroGraniteSchemas.js";

export function getNiroGraniteServerConfig(): NiroGraniteProviderConfig {
  return {
    mode: process.env["MATERIAL_NIRO_GRANITE_MODE"] === "feed" ? "feed" : "fixture",
    feedUrl: process.env["MATERIAL_NIRO_GRANITE_FEED_URL"],
    apiKey: process.env["MATERIAL_NIRO_GRANITE_API_KEY"],
    accessToken: process.env["MATERIAL_NIRO_GRANITE_ACCESS_TOKEN"],
    locale: (process.env["MATERIAL_NIRO_GRANITE_LOCALE"] as "id-ID" | "en-ID" | undefined) ?? "id-ID",
    country: "ID",
    timeoutMs: Number(process.env["MATERIAL_NIRO_GRANITE_TIMEOUT_MS"] ?? 5000),
    liveFetchEnabled: process.env["MATERIAL_NIRO_GRANITE_LIVE_FETCH_ENABLED"] === "true",
  };
}

export function parseNiroGraniteConfig(config: unknown): {
  success: true;
  data: NiroGraniteProviderConfig;
} | {
  success: false;
  errors: string[];
} {
  const parsed = NiroGraniteProviderConfigSchema.safeParse(config ?? {});
  if (!parsed.success) {
    return {
      success: false,
      errors: parsed.error.issues.map((issue) => `${issue.path.join(".") || "config"}: ${issue.message}`),
    };
  }

  const errors: string[] = [];
  if (parsed.data.mode === "feed") {
    if (!parsed.data.liveFetchEnabled) {
      errors.push("Live feed mode is disabled until an approved official source is configured.");
    }
    if (!parsed.data.feedUrl) errors.push("feedUrl is required for feed mode.");
  }
  if (parsed.data.feedUrl) {
    try {
      const url = new URL(parsed.data.feedUrl);
      if (url.protocol !== "https:") errors.push("feedUrl must use HTTPS.");
    } catch {
      errors.push("feedUrl must be a valid URL.");
    }
  }

  return errors.length > 0
    ? { success: false, errors }
    : { success: true, data: parsed.data };
}