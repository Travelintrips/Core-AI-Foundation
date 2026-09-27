/**
 * apiFetch — centralized session-based fetch for the admin panel.
 *
 * Session auth contract (browser requests):
 *   - credentials: "include" — sends the internal_session cookie on every request
 *   - x-admin-api-key is NEVER injected by this helper; the cookie is the
 *     sole browser credential. API key auth is for server-to-server only.
 *
 * Auth response semantics:
 *   - 401 → session expired / not logged in → callers should redirect to /login
 *     (this function does NOT redirect automatically; use useAdminApi for hooks
 *     that need automatic 401 handling)
 *   - 403 → authenticated but not authorized → show an error, do NOT logout
 *
 * Callers distinguish auth errors via the `status` property on the thrown HttpError.
 *
 * Note: FormData bodies are passed as-is (no Content-Type override — browser
 * sets multipart/form-data with boundary automatically).
 */

// ── Typed error ───────────────────────────────────────────────────────────────

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/** Returns true when the error is an HttpError with status 401 */
export function isUnauthorized(err: unknown): err is HttpError {
  return err instanceof HttpError && err.status === 401;
}

/** Returns true when the error is an HttpError with status 403 */
export function isForbidden(err: unknown): err is HttpError {
  return err instanceof HttpError && err.status === 403;
}

// ── Core helper ───────────────────────────────────────────────────────────────

/**
 * apiFetch<T> — session-based JSON fetch.
 *
 * Always uses credentials: "include" and never injects x-admin-api-key.
 * Throws HttpError on non-2xx responses; callers should catch and check `.status`.
 */
export async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const hasBody =
    opts?.body != null && !(opts.body instanceof FormData);

  const res = await fetch(path, {
    ...opts,
    credentials: "include",
    headers: {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...(opts?.headers ?? {}),
      // x-admin-api-key intentionally omitted — browser auth uses session cookie only
    },
  });

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const b = await res.json();
      if (typeof b?.error === "string") {
        msg = b.error;
      } else if (b?.error && typeof b.error.message === "string") {
        msg = b.error.message;
      }
    } catch {
      /* ignore JSON parse error — keep the generic HTTP status message */
    }
    throw new HttpError(res.status, msg);
  }

  return res.json() as Promise<T>;
}

export type ApiEventStreamMessage<T = unknown> = {
  event: string;
  data: T;
};

/**
 * apiEventStream — authenticated POST/GET fetch that incrementally parses
 * text/event-stream responses. This is intentionally fetch-based (rather than
 * EventSource) so Ask Mode can stream a POST body while keeping session-cookie
 * authentication and the same 401/403 semantics as apiFetch.
 */
export async function apiEventStream(
  path: string,
  opts: RequestInit,
  onEvent: (message: ApiEventStreamMessage) => void,
): Promise<void> {
  const headers = new Headers(opts.headers ?? {});
  const hasBody = opts.body != null && !(opts.body instanceof FormData);
  if (hasBody && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  headers.set("Accept", "text/event-stream");

  const res = await fetch(path, {
    ...opts,
    credentials: "include",
    headers,
  });

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (typeof body?.error === "string") {
        msg = body.error;
      } else if (body?.error && typeof body.error.message === "string") {
        msg = body.error.message;
      }
    } catch {
      // keep generic status
    }
    throw new HttpError(res.status, msg);
  }

  if (!res.body) {
    throw new HttpError(502, "Streaming response body is unavailable.");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const consumeBlock = (block: string) => {
    const lines = block.replace(/\r/g, "").split("\n");
    let event = "message";
    const dataLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith("event:")) {
        event = line.slice(6).trim() || "message";
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }

    if (dataLines.length === 0) return;
    const raw = dataLines.join("\n");
    let data: unknown = raw;
    try {
      data = JSON.parse(raw) as unknown;
    } catch {
      // Plain-text SSE data is valid; surface it as-is.
    }
    onEvent({ event, data });
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      // Normalize the accumulated buffer, not only the latest chunk. A CRLF
      // pair may itself be split across network chunks.
      buffer = buffer.replace(/\r\n/g, "\n");
      let boundary = buffer.indexOf("\n\n");

      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        consumeBlock(block);
        boundary = buffer.indexOf("\n\n");
      }
    }

    buffer += decoder.decode();
    buffer = buffer.replace(/\r\n/g, "\n");
    if (buffer.trim()) consumeBlock(buffer);
  } finally {
    reader.releaseLock();
  }
}

