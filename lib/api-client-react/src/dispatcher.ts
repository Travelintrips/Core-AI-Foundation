/**
 * Dispatcher hooks — Phase 5.1 Worker Dispatcher Runtime
 *
 * TanStack Query hooks for the dispatcher API.
 * Hand-written (not orval-generated) because the dispatcher is a server-side singleton.
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryOptions,
  type UseMutationOptions,
} from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DispatcherStatus {
  enabled: boolean;
  running: boolean;
  workerCount: number;
  idleWorkers: number;
  busyWorkers: number;
  queueLength: number;
  runningJobs: number;
  lastTick: string | null;
  lastHeartbeat: string | null;
  processedToday: number;
  failedToday: number;
}

export interface DispatcherSettings {
  dispatcherEnabled: boolean;
  workerPollIntervalMs: number;
  workerHeartbeatIntervalMs: number;
  workerTimeoutMs: number;
  jobTimeoutMs: number;
  maxConcurrentJobs: number;
}

export interface DispatcherTickResult extends DispatcherStatus {
  tick: { claimed: number; completed: number; failed: number };
}

// ── Query keys ────────────────────────────────────────────────────────────────

export const DISPATCHER_STATUS_QUERY_KEY  = ["dispatcher", "status"]   as const;
export const DISPATCHER_SETTINGS_QUERY_KEY = ["dispatcher", "settings"] as const;

export function getDispatcherStatusQueryKey() { return DISPATCHER_STATUS_QUERY_KEY; }
export function getDispatcherSettingsQueryKey() { return DISPATCHER_SETTINGS_QUERY_KEY; }

// ── Queries ───────────────────────────────────────────────────────────────────

export function useGetDispatcherStatus(
  options?: Omit<UseQueryOptions<DispatcherStatus>, "queryKey" | "queryFn">,
) {
  return useQuery<DispatcherStatus>({
    queryKey: DISPATCHER_STATUS_QUERY_KEY,
    queryFn:  () => customFetch<DispatcherStatus>("/api/ai/dispatcher/status", {}),
    refetchInterval: 3_000,
    ...options,
  });
}

export function useGetDispatcherSettings(
  options?: Omit<UseQueryOptions<DispatcherSettings>, "queryKey" | "queryFn">,
) {
  return useQuery<DispatcherSettings>({
    queryKey: DISPATCHER_SETTINGS_QUERY_KEY,
    queryFn:  () => customFetch<DispatcherSettings>("/api/ai/dispatcher/settings", {}),
    ...options,
  });
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export function useStartDispatcher(
  options?: UseMutationOptions<DispatcherStatus, Error, void>,
) {
  const qc = useQueryClient();
  return useMutation<DispatcherStatus, Error, void>({
    mutationFn: () => customFetch<DispatcherStatus>("/api/ai/dispatcher/start", { method: "POST" }),
    onSettled:  () => qc.invalidateQueries({ queryKey: DISPATCHER_STATUS_QUERY_KEY }),
    ...options,
  });
}

export function useStopDispatcher(
  options?: UseMutationOptions<DispatcherStatus, Error, void>,
) {
  const qc = useQueryClient();
  return useMutation<DispatcherStatus, Error, void>({
    mutationFn: () => customFetch<DispatcherStatus>("/api/ai/dispatcher/stop", { method: "POST" }),
    onSettled:  () => qc.invalidateQueries({ queryKey: DISPATCHER_STATUS_QUERY_KEY }),
    ...options,
  });
}

export function useTickDispatcher(
  options?: UseMutationOptions<DispatcherTickResult, Error, void>,
) {
  const qc = useQueryClient();
  return useMutation<DispatcherTickResult, Error, void>({
    mutationFn: () => customFetch<DispatcherTickResult>("/api/ai/dispatcher/tick", { method: "POST" }),
    onSettled:  () => qc.invalidateQueries({ queryKey: DISPATCHER_STATUS_QUERY_KEY }),
    ...options,
  });
}

export function useUpdateDispatcherSettings(
  options?: UseMutationOptions<DispatcherSettings, Error, Partial<DispatcherSettings>>,
) {
  const qc = useQueryClient();
  return useMutation<DispatcherSettings, Error, Partial<DispatcherSettings>>({
    mutationFn: (patch) =>
      customFetch<DispatcherSettings>("/api/ai/dispatcher/settings", {
        method:  "PATCH",
        body:    JSON.stringify(patch),
        headers: { "Content-Type": "application/json" },
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: DISPATCHER_SETTINGS_QUERY_KEY }),
    ...options,
  });
}
