/**
 * Domain Plugin Framework — Version Compatibility (Team 07)
 *
 * Checks whether a plugin's declared contractVersion is compatible
 * with the current framework contract.
 */

import { PLUGIN_CONTRACT_VERSION } from "./types.js";

export interface CompatibilityResult {
  compatible: boolean;
  reason?: string;
}

/**
 * Returns true when the plugin's contractVersion is compatible with
 * the running framework.  Extend this function as the contract evolves
 * (e.g. accept a range of older versions during a transition period).
 */
export function checkCompatibility(
  pluginContractVersion: string,
): CompatibilityResult {
  if (!pluginContractVersion || pluginContractVersion.trim() === "") {
    return { compatible: false, reason: "contractVersion is missing or empty" };
  }

  if (pluginContractVersion === PLUGIN_CONTRACT_VERSION) {
    return { compatible: true };
  }

  // Future: accept older minor versions here if the framework is
  // backward-compatible.  For now, exact match is required.
  return {
    compatible: false,
    reason: `Plugin targets contract v${pluginContractVersion} but framework requires v${PLUGIN_CONTRACT_VERSION}`,
  };
}
