/**
 * aiSecretService — reads provider API keys from environment variables.
 * Never stores or logs actual secret values.
 */

/** Maps provider slug → environment variable name */
const PROVIDER_ENV_VARS: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GEMINI_API_KEY",
  "google-gemini": "GEMINI_API_KEY",
  gemini: "GEMINI_API_KEY",
  replicate: "REPLICATE_API_TOKEN",
  mistral: "MISTRAL_API_KEY",
};

/**
 * Returns the API key for a provider, or null if not configured.
 * Reads from the environment — never hardcoded.
 */
export function getProviderApiKey(providerSlug: string): string | null {
  const envVarName = PROVIDER_ENV_VARS[providerSlug.toLowerCase()];
  if (!envVarName) return null;
  const value = process.env[envVarName];
  return value && value.trim() ? value.trim() : null;
}

/**
 * Returns the env var name for a provider slug, for display purposes.
 */
export function getProviderEnvVarName(providerSlug: string): string | null {
  return PROVIDER_ENV_VARS[providerSlug.toLowerCase()] ?? null;
}

/**
 * Masks a secret value for safe display (e.g., in Settings UI).
 * Shows first 4 and last 4 chars only.
 */
export function maskSecretValue(value: string): string {
  if (!value) return "••••••••";
  if (value.length <= 8) return "•".repeat(value.length);
  return `${value.slice(0, 4)}${"•".repeat(Math.min(12, value.length - 8))}${value.slice(-4)}`;
}

/**
 * Returns true if the key name looks like a secret (should be masked in responses).
 */
export function isSecretKey(key: string): boolean {
  const upper = key.toUpperCase();
  return (
    upper.includes("KEY") ||
    upper.includes("TOKEN") ||
    upper.includes("SECRET") ||
    upper.includes("PASSWORD") ||
    upper.includes("CREDENTIAL")
  );
}
