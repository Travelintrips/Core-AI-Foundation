import type {
  CatalogFetchContext,
  CatalogProviderCapabilities,
  CatalogProviderValidationResult,
  ExternalCatalogResult,
} from "../../types.js";
import type { MaterialCatalogProvider } from "../../catalogProvider.js";
import { CatalogConfigValidationError, CatalogFetchError } from "../../errors.js";
import { parseNiroGraniteConfig } from "./niroGraniteConfig.js";
import { mapFixturePage, fetchOfficialFeedJson } from "./niroGraniteClient.js";
import { NIRO_GRANITE_PROVIDER_ID } from "./niroGraniteSchemas.js";
import { NIRO_GRANITE_FIXTURE } from "./niroGraniteFixture.js";

export const niroGraniteOfficialProvider: MaterialCatalogProvider = {
  providerId: NIRO_GRANITE_PROVIDER_ID,
  displayName: "Niro Granite Official Catalog Feed",
  sourceType: "official_feed",

  getCapabilities(): CatalogProviderCapabilities {
    return {
      supportedBrands: ["Niro Granite"],
      supportedCountries: ["ID"],
      supportsPagination: true,
      supportsFiltering: true,
      maxItemsPerFetch: 500,
      requiresCredentials: false,
    };
  },

  async validateConfig(config: unknown): Promise<CatalogProviderValidationResult> {
    const parsed = parseNiroGraniteConfig(config);
    return parsed.success
      ? { valid: true, errors: [] }
      : { valid: false, errors: parsed.errors };
  },

  async fetchCatalog(context: CatalogFetchContext): Promise<ExternalCatalogResult> {
    const parsed = parseNiroGraniteConfig(context.config);
    if (!parsed.success) {
      throw new CatalogConfigValidationError(NIRO_GRANITE_PROVIDER_ID, parsed.errors);
    }
    if (parsed.data.mode === "feed") {
      if (!parsed.data.liveFetchEnabled) {
        throw new CatalogFetchError("authentication", "Live official feed access is not enabled.");
      }
      return fetchOfficialFeedJson(parsed.data, context);
    }
    return mapFixturePage(NIRO_GRANITE_FIXTURE, context);
  },
};