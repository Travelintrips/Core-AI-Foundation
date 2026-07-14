/**
 * use-runtime-event-stream.ts — SSE client hook for canonical runtime events.
 *
 * Uses native EventSource for realtime delivery.
 * Falls back to periodic REST polling when EventSource is unavailable or
 * repeatedly fails to connect.
 *
 * State:
 *   connectionStatus  — 'connecting' | 'live' | 'reconnecting' | 'offline' | 'unavailable'
 *   events            — sorted, deduped CanonicalEvent[]
 *   lastEventAt       — Date | null
 *   reconnectCount    — number
 *   isStale           — boolean (no heartbeat/event for STALE_THRESHOLD_MS)
 *   error             — string | null
 */

import { useState, useEffect, useRef, useCallback } from 'react';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface CanonicalEvent {
  eventId: string;
  eventType: string;
  projectId: string;
  workflowId: string | null;
  stepId: number | null;
  workerId: string | null;
  createdAt: string;
  publicMessage: string;
  severity: 'info' | 'warning' | 'error';
  status: string;
  progress: number;
  source: 'project' | 'step' | 'worker' | 'artifact' | 'review';
  metadata: Record<string, unknown>;
}

export type ConnectionStatus = 'connecting' | 'live' | 'reconnecting' | 'offline' | 'unavailable';

/**
 * V4.1 — deterministic, customer-safe summary paired with a CanonicalEvent.
 * Mirrors artifacts/api-server/src/services/executionSummaryService.ts.
 * Never contains prompts, reasoning, raw provider output, cost, or errors.
 */
export interface ExecutionSummary {
  sourceEventId: string;
  eventType: string;
  title: string;
  summary: string;
  whyItMatters: string;
  nextStep: string | null;
  status: 'info' | 'success' | 'warning' | 'error';
  customerAction: { kind: 'view_review' | 'view_files' | 'view_payments' | 'contact_support'; label: string } | null;
  isDerived: true;
  artifactCount: number;
}

export interface RuntimeEventStreamState {
  connectionStatus: ConnectionStatus;
  events: CanonicalEvent[];
  /** V4.1 — keyed by CanonicalEvent.eventId. May be missing for an event; callers must tolerate that. */
  summariesByEventId: Record<string, ExecutionSummary>;
  lastEventAt: Date | null;
  reconnectCount: number;
  isStale: boolean;
  error: string | null;
}

// ─── Merge helpers (exported for tests) ────────────────────────────────────────

function compareByCursor(a: CanonicalEvent, b: CanonicalEvent): number {
  const tDiff = a.createdAt.localeCompare(b.createdAt);
  if (tDiff !== 0) return tDiff;
  return a.eventId.localeCompare(b.eventId);
}

/**
 * Deterministic merge: dedup by eventId, sort by createdAt+eventId ASC.
 * Safe to call repeatedly — result is idempotent.
 */
export function mergeEvents(
  existing: CanonicalEvent[],
  incoming: CanonicalEvent[],
): CanonicalEvent[] {
  const map = new Map<string, CanonicalEvent>();
  for (const e of existing) map.set(e.eventId, e);
  for (const e of incoming) map.set(e.eventId, e);
  return Array.from(map.values()).sort(compareByCursor);
}

/** V4.1 — merge summaries by eventId. Additive/optional: missing entries are simply absent. */
export function mergeSummaries(
  existing: Record<string, ExecutionSummary>,
  incoming: ExecutionSummary[],
): Record<string, ExecutionSummary> {
  if (incoming.length === 0) return existing;
  const merged = { ...existing };
  for (const s of incoming) merged[s.sourceEventId] = s;
  return merged;
}

// ─── URLs ──────────────────────────────────────────────────────────────────────

const sseUrl = (token: string, projectNumber: string) =>
  `/api/public/customer/workspace/${token}/projects/${projectNumber}/events/stream`;

const restUrl = (token: string, projectNumber: string) =>
  `/api/public/customer/workspace/${token}/projects/${projectNumber}/events`;

// ─── Config ────────────────────────────────────────────────────────────────────

const STALE_THRESHOLD_MS = 60_000;               // mark stale after 60s of silence
const FALLBACK_POLL_INTERVAL_MS = 12_000;        // REST fallback interval
const MAX_RECONNECTS_BEFORE_FALLBACK = 5;        // switch to polling after N failures

// ─── Hook ──────────────────────────────────────────────────────────────────────

export function useRuntimeEventStream({
  token,
  projectNumber,
  enabled = true,
}: {
  token: string;
  projectNumber: string;
  enabled?: boolean;
}): RuntimeEventStreamState {
  const [state, setState] = useState<RuntimeEventStreamState>({
    connectionStatus: 'connecting',
    events: [],
    summariesByEventId: {},
    lastEventAt: null,
    reconnectCount: 0,
    isStale: false,
    error: null,
  });

  const esRef = useRef<EventSource | null>(null);
  const staleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fallbackTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectCountRef = useRef(0);
  const eventsRef = useRef<CanonicalEvent[]>([]);
  const summariesRef = useRef<Record<string, ExecutionSummary>>({});
  const isCompletedRef = useRef(false);
  const isFallbackRef = useRef(false);

  // ── Helpers ─────────────────────────────────────────────────────────────────

  const resetStaleTimer = useCallback(() => {
    if (staleTimerRef.current) clearTimeout(staleTimerRef.current);
    setState((prev) => ({ ...prev, isStale: false }));
    staleTimerRef.current = setTimeout(() => {
      setState((prev) => ({ ...prev, isStale: true }));
    }, STALE_THRESHOLD_MS);
  }, []);

  const addEvents = useCallback(
    (incoming: CanonicalEvent[], incomingSummaries: ExecutionSummary[] = []) => {
      if (incoming.length === 0 && incomingSummaries.length === 0) return;
      const merged = mergeEvents(eventsRef.current, incoming);
      eventsRef.current = merged;
      const mergedSummaries = mergeSummaries(summariesRef.current, incomingSummaries);
      summariesRef.current = mergedSummaries;
      setState((prev) => ({
        ...prev,
        events: merged,
        summariesByEventId: mergedSummaries,
        lastEventAt: new Date(),
      }));
      resetStaleTimer();
    },
    [resetStaleTimer],
  );

  const setStatus = useCallback((status: ConnectionStatus, error: string | null = null) => {
    setState((prev) => ({ ...prev, connectionStatus: status, error }));
  }, []);

  // ── Fallback REST polling ────────────────────────────────────────────────────

  const stopFallback = useCallback(() => {
    if (fallbackTimerRef.current) {
      clearInterval(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
    isFallbackRef.current = false;
  }, []);

  const startFallback = useCallback(() => {
    if (fallbackTimerRef.current) return; // already running
    isFallbackRef.current = true;
    setStatus('offline');

    const poll = async () => {
      try {
        const res = await fetch(restUrl(token, projectNumber));
        if (!res.ok) return;
        const data = (await res.json()) as { events?: CanonicalEvent[]; summaries?: ExecutionSummary[] };
        if (data.events?.length) addEvents(data.events, data.summaries ?? []);
      } catch {
        /* ignore — next poll will retry */
      }
    };

    void poll();
    fallbackTimerRef.current = setInterval(poll, FALLBACK_POLL_INTERVAL_MS);
  }, [token, projectNumber, addEvents, setStatus]);

  // ── EventSource connect ──────────────────────────────────────────────────────

  const connect = useCallback(() => {
    if (!enabled || isCompletedRef.current) return;

    if (typeof EventSource === 'undefined') {
      startFallback();
      return;
    }

    // Close previous connection cleanly
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    const isReconnect = reconnectCountRef.current > 0;
    setStatus(isReconnect ? 'reconnecting' : 'connecting');

    const es = new EventSource(sseUrl(token, projectNumber));
    esRef.current = es;

    es.addEventListener('snapshot', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data as string) as { events?: CanonicalEvent[]; summaries?: ExecutionSummary[] };
        if (data.events) addEvents(data.events, data.summaries ?? []);
      } catch { /* ignore */ }
      setStatus('live');
      stopFallback();
      resetStaleTimer();
    });

    es.addEventListener('runtime.event', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data as string) as { event?: CanonicalEvent; summary?: ExecutionSummary };
        if (data.event) addEvents([data.event], data.summary ? [data.summary] : []);
      } catch { /* ignore */ }
      setStatus('live');
      resetStaleTimer();
    });

    es.addEventListener('heartbeat', () => {
      // Mark live as soon as a heartbeat arrives (satisfies "not before heartbeat" rule)
      setStatus('live');
      resetStaleTimer();
    });

    es.addEventListener('stream.complete', () => {
      isCompletedRef.current = true;
      es.close();
      esRef.current = null;
      setState((prev) => ({ ...prev, connectionStatus: 'offline', isStale: false }));
    });

    es.addEventListener('stream.warning', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data as string) as { message?: string };
        setState((prev) => ({ ...prev, error: data.message ?? 'Updates delayed' }));
      } catch { /* ignore */ }
    });

    es.addEventListener('stream.error', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data as string) as { message?: string };
        setState((prev) => ({ ...prev, error: data.message ?? 'Stream unavailable' }));
      } catch { /* ignore */ }
      es.close();
      esRef.current = null;
      setStatus('unavailable', 'Connection failed');
      startFallback();
    });

    es.onerror = () => {
      reconnectCountRef.current++;
      setState((prev) => ({
        ...prev,
        connectionStatus: 'reconnecting',
        reconnectCount: reconnectCountRef.current,
      }));

      if (reconnectCountRef.current >= MAX_RECONNECTS_BEFORE_FALLBACK) {
        // Too many reconnect attempts — give up on SSE, switch to REST polling
        es.close();
        esRef.current = null;
        startFallback();
      }
      // Below threshold: native EventSource will auto-reconnect (browser behaviour)
    };
  }, [enabled, token, projectNumber, addEvents, setStatus, resetStaleTimer, startFallback, stopFallback]);

  // ── Tab visibility: reconnect when tab becomes visible again ─────────────────

  useEffect(() => {
    const handleVisibility = () => {
      if (
        document.visibilityState === 'visible' &&
        !isCompletedRef.current &&
        !isFallbackRef.current
      ) {
        const s = state.connectionStatus;
        if (s === 'offline' || s === 'unavailable' || state.isStale) {
          reconnectCountRef.current = 0;
          connect();
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.connectionStatus, state.isStale]);

  // ── Network online/offline ───────────────────────────────────────────────────

  useEffect(() => {
    const handleOnline = () => {
      if (isCompletedRef.current) return;
      stopFallback();
      reconnectCountRef.current = 0;
      connect();
    };
    const handleOffline = () => {
      setState((prev) => ({ ...prev, connectionStatus: 'offline' }));
      startFallback();
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Main effect ──────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!enabled || !token || !projectNumber) return;

    isCompletedRef.current = false;
    reconnectCountRef.current = 0;
    eventsRef.current = [];
    summariesRef.current = {};
    connect();

    return () => {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
      stopFallback();
      if (staleTimerRef.current) clearTimeout(staleTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, token, projectNumber]);

  return state;
}
