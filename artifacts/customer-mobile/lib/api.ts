/**
 * API client for Creative AI Studio.
 * Uses EXPO_PUBLIC_DOMAIN injected at build time for absolute URLs.
 */

export const BASE_URL = process.env.EXPO_PUBLIC_DOMAIN
  ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
  : '';

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let message = `Error ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
      else if (body?.message) message = body.message;
    } catch { /* ignore */ }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

/** Base URL for customer workspace endpoints */
export const wsBase = (token: string) =>
  `/api/public/customer/workspace/${token}`;
