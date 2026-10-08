const CODING_HOST = "coding.cstlogistic.co.id";
const INTERNAL_API_ORIGIN = "https://aicore.cstlogistic.co.id";

export function resolveCodingApiUrl(
  input: string,
  hostname: string,
): string {
  if (
    hostname.toLowerCase() === CODING_HOST &&
    input.startsWith("/api/")
  ) {
    return `${INTERNAL_API_ORIGIN}${input}`;
  }
  return input;
}

/**
 * The coding dashboard is deployed as a static Hostinger site while the
 * authenticated API remains on aicore.cstlogistic.co.id. Keep the split
 * transparent to existing UI code, including legacy direct fetch("/api/...")
 * call sites, and preserve session cookies on the internal API origin.
 */
export function installCodingApiBridge(): void {
  if (typeof window === "undefined") return;
  if (window.location.hostname.toLowerCase() !== CODING_HOST) return;

  const nativeFetch = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === "string") {
      const resolved = resolveCodingApiUrl(input, window.location.hostname);
      if (resolved !== input) {
        return nativeFetch(resolved, {
          ...init,
          credentials: init?.credentials ?? "include",
        });
      }
    } else if (input instanceof URL) {
      const relative = input.origin === window.location.origin
        ? `${input.pathname}${input.search}${input.hash}`
        : "";
      const resolved = relative
        ? resolveCodingApiUrl(relative, window.location.hostname)
        : "";
      if (resolved && resolved !== relative) {
        return nativeFetch(resolved, {
          ...init,
          credentials: init?.credentials ?? "include",
        });
      }
    }

    return nativeFetch(input, init);
  }) as typeof window.fetch;
}
