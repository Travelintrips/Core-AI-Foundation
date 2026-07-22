/**
 * Domain Plugin Framework — Feature Flag Integration (Team 07)
 *
 * Lightweight feature flag resolver for plugin enable/disable gating.
 * Wire this to Team 05's discovery-analytics feature-flag service if
 * you need dynamic flags; for now it reads PLUGIN_FLAGS env var and
 * an in-process override map for tests.
 *
 * Format of PLUGIN_FLAGS env var:
 *   PLUGIN_FLAGS=fashion:true,interior:false,furniture:true
 */

// In-process overrides — used in tests and at startup.
const overrides = new Map<string, boolean>();

/**
 * Override a flag value in-process (for tests or programmatic control).
 * Calling with `undefined` removes the override so env-var lookup resumes.
 */
export function setFlagOverride(flag: string, value: boolean | undefined): void {
  if (value === undefined) {
    overrides.delete(flag);
  } else {
    overrides.set(flag, value);
  }
}

/** Remove all in-process overrides (useful in test afterEach). */
export function clearFlagOverrides(): void {
  overrides.clear();
}

/**
 * Resolve whether a feature flag is enabled.
 * Resolution order: in-process override → PLUGIN_FLAGS env var → default (true).
 *
 * Default is true so that plugins without a featureFlag field are enabled
 * automatically, and newly introduced flags don't silently disable plugins
 * in environments that haven't set the variable yet.
 */
export function isFlagEnabled(flag: string): boolean {
  if (overrides.has(flag)) {
    return overrides.get(flag)!;
  }

  const raw = process.env["PLUGIN_FLAGS"] ?? "";
  for (const pair of raw.split(",")) {
    const [key, val] = pair.trim().split(":");
    if (key === flag) {
      return val?.toLowerCase() !== "false";
    }
  }

  // Unknown flag → enabled by default.
  return true;
}
