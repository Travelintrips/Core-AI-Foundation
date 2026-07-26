import { hasProvider, registerProvider } from "./providerRegistry.js";
import { isMaterialCatalogEnabled } from "./featureFlag.js";
import { redactProviderConfig } from "./errors.js";
import { niroGraniteOfficialProvider } from "./providers/niroGranite/niroGraniteProvider.js";
import { getNiroGraniteServerConfig } from "./providers/niroGranite/niroGraniteConfig.js";

export const NIRO_GRANITE_PROVIDER_FLAG = "MATERIAL_NIRO_GRANITE_PROVIDER_ENABLED";

export interface OfficialProviderRegistrationResult {
  readonly registered: boolean;
  readonly providerId: string;
  readonly reason?: string;
}

export async function registerOfficialMaterialProviders(): Promise<OfficialProviderRegistrationResult> {
  const providerId = niroGraniteOfficialProvider.providerId;
  if (!isMaterialCatalogEnabled()) {
    return { registered: false, providerId, reason: "MATERIAL_CATALOG_INTEGRATION_ENABLED is false." };
  }
  if (process.env[NIRO_GRANITE_PROVIDER_FLAG] !== "true") {
    return { registered: false, providerId, reason: `${NIRO_GRANITE_PROVIDER_FLAG} is false.` };
  }

  const config = getNiroGraniteServerConfig();
  const validation = await niroGraniteOfficialProvider.validateConfig(config);
  if (!validation.valid) {
    // Deliberately redact before diagnostics. The returned errors never contain values.
    void redactProviderConfig(config);
    return { registered: false, providerId, reason: validation.errors.join("; ") };
  }
  if (!hasProvider(providerId)) registerProvider(niroGraniteOfficialProvider);
  return { registered: true, providerId };
}