/**
 * Material Catalog Integration — Phase 3 Foundation
 * Typed domain errors. Secrets are never included in error messages.
 */

export class CatalogProviderNotFoundError extends Error {
  readonly code = "CATALOG_PROVIDER_NOT_FOUND" as const;
  constructor(providerId: string) {
    super(`Catalog provider not found: '${providerId}'`);
    this.name = "CatalogProviderNotFoundError";
  }
}

export class CatalogDuplicateProviderError extends Error {
  readonly code = "CATALOG_DUPLICATE_PROVIDER" as const;
  constructor(providerId: string) {
    super(`Catalog provider already registered: '${providerId}'`);
    this.name = "CatalogDuplicateProviderError";
  }
}

export class CatalogConfigValidationError extends Error {
  readonly code = "CATALOG_CONFIG_VALIDATION_ERROR" as const;
  readonly validationErrors: string[];
  constructor(providerId: string, errors: string[]) {
    super(`Provider config validation failed for '${providerId}': ${errors.join("; ")}`);
    this.name = "CatalogConfigValidationError";
    this.validationErrors = errors;
  }
}

export class CatalogValidationError extends Error {
  readonly code = "CATALOG_VALIDATION_ERROR" as const;
  readonly validationErrors: string[];
  constructor(message: string, errors: string[]) {
    super(message);
    this.name = "CatalogValidationError";
    this.validationErrors = errors;
  }
}

export class CatalogProviderError extends Error {
  readonly code = "CATALOG_PROVIDER_ERROR" as const;
  readonly providerId: string;
  constructor(providerId: string, message: string) {
    super(`Provider '${providerId}' error: ${message}`);
    this.name = "CatalogProviderError";
    this.providerId = providerId;
  }
}

export class CatalogProductionImportRejectedError extends Error {
  readonly code = "CATALOG_PRODUCTION_IMPORT_REJECTED" as const;
  constructor() {
    super(
      "Production imports are not permitted in Phase 3. dryRun must be true.",
    );
    this.name = "CatalogProductionImportRejectedError";
  }
}

export class CatalogPayloadTooLargeError extends Error {
  readonly code = "CATALOG_PAYLOAD_TOO_LARGE" as const;
  constructor(received: number, limit: number) {
    super(`Catalog payload too large: received ${received} records, limit is ${limit}`);
    this.name = "CatalogPayloadTooLargeError";
  }
}

export class CatalogResponseTooLargeError extends Error {
  readonly code = "CATALOG_RESPONSE_TOO_LARGE" as const;
  readonly receivedBytes: number;
  readonly limitBytes: number;
  constructor(receivedBytes: number, limitBytes: number) {
    super(`Catalog response too large: received ${receivedBytes} bytes, limit is ${limitBytes}`);
    this.name = "CatalogResponseTooLargeError";
    this.receivedBytes = receivedBytes;
    this.limitBytes = limitBytes;
  }
}

export type CatalogFetchErrorCategory =
  | "authentication"
  | "rate_limit"
  | "timeout"
  | "network"
  | "schema"
  | "aborted"
  | "http"
  | "payload";

export class CatalogFetchError extends Error {
  readonly code = "CATALOG_FETCH_ERROR" as const;
  readonly category: CatalogFetchErrorCategory;
  readonly statusCode?: number;
  readonly retryCount: number;

  constructor(
    category: CatalogFetchErrorCategory,
    message: string,
    options?: { statusCode?: number; retryCount?: number },
  ) {
    super(message);
    this.name = "CatalogFetchError";
    this.category = category;
    this.statusCode = options?.statusCode;
    this.retryCount = options?.retryCount ?? 0;
  }
}

export class CatalogUnsupportedUrlSchemeError extends Error {
  readonly code = "CATALOG_UNSUPPORTED_URL_SCHEME" as const;
  constructor(scheme: string) {
    // Never echo back a full URL — only the scheme to avoid leaking paths.
    super(`Unsupported URL scheme: '${scheme}'. Only 'https' is permitted.`);
    this.name = "CatalogUnsupportedUrlSchemeError";
  }
}

export class CatalogFeatureDisabledError extends Error {
  readonly code = "CATALOG_FEATURE_DISABLED" as const;
  constructor() {
    super(
      "Material catalog integration is disabled. Set MATERIAL_CATALOG_INTEGRATION_ENABLED=true to enable.",
    );
    this.name = "CatalogFeatureDisabledError";
  }
}

/** Redacts secrets from a provider config object before logging or returning. */
export function redactProviderConfig(config: unknown): unknown {
  if (config === null || typeof config !== "object") return config;
  // Match any key that contains a sensitive term anywhere (camelCase, snake_case, prefix, suffix).
  // Examples: apiKey, accessToken, feedSecret, authHeader, x_api_key, bearerToken.
  const SENSITIVE_KEYS = /(secret|key|token|password|credential|auth|apikey|api_key)/i;
  if (Array.isArray(config)) return config.map((value) => redactProviderConfig(value));
  const redacted: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config as Record<string, unknown>)) {
    redacted[k] = SENSITIVE_KEYS.test(k) ? "[REDACTED]" : redactProviderConfig(v);
  }
  return redacted;
}
