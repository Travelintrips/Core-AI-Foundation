/**
 * Phase 5.2 — Cluster API hooks (manual, not generated).
 * Follows the same conventions as the generated api.ts hooks.
 */

import {
  useQuery,
  useMutation,
  type UseQueryOptions,
  type UseMutationOptions,
  type QueryKey,
  type UseQueryResult,
} from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ClusterStatus {
  clusterId: string;
  totalWorkers: number;
  onlineWorkers: number;
  idleWorkers: number;
  busyWorkers: number;
  staleWorkers: number;
  offlineWorkers: number;
  totalCapacity: number;
  usedCapacity: number;
  capacityPct: number;
  nodes: string[];
}

export interface WorkerCapacityItem {
  id: number;
  workerName: string;
  workerType: string;
  status: string;
  clusterId: string;
  nodeId: string;
  region: string;
  capabilities: string[];
  maxConcurrentJobs: number;
  runningJobs: number;
  availableSlots: number;
  leaseValid: boolean;
  leaseExpiresAt: string | null;
  lastHeartbeat: string;
}

export interface RebalanceResult {
  staleWorkers: number;
  recoveredJobs: number;
}

export interface RecoverStaleResult {
  staleWorkers: number[];
  recoveredJobs: number;
}

// ── Query key factories ────────────────────────────────────────────────────────

export const getClusterStatusQueryKey = () => [`/api/ai/cluster/status`] as const;
export const getClusterWorkersQueryKey = () => [`/api/ai/cluster/workers`] as const;

// ── Fetchers ──────────────────────────────────────────────────────────────────

export const getClusterStatus = (): Promise<ClusterStatus[]> =>
  customFetch<ClusterStatus[]>(`/api/ai/cluster/status`);

export const getClusterWorkers = (): Promise<WorkerCapacityItem[]> =>
  customFetch<WorkerCapacityItem[]>(`/api/ai/cluster/workers`);

export const rebalanceCluster = (): Promise<RebalanceResult> =>
  customFetch<RebalanceResult>(`/api/ai/cluster/rebalance`, { method: "POST" });

export const recoverStaleWorkers = (): Promise<RecoverStaleResult> =>
  customFetch<RecoverStaleResult>(`/api/ai/cluster/recover-stale`, { method: "POST" });

// ── Query hooks ────────────────────────────────────────────────────────────────

export function useGetClusterStatus<TData = ClusterStatus[], TError = unknown>(
  options?: { query?: UseQueryOptions<ClusterStatus[], TError, TData> },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getClusterStatusQueryKey();
  const queryFn = ({ signal }: { signal?: AbortSignal }) =>
    getClusterStatus();
  const q = useQuery({ queryKey, queryFn, ...queryOptions }) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  q.queryKey = queryKey;
  return q;
}

export function useGetClusterWorkers<TData = WorkerCapacityItem[], TError = unknown>(
  options?: { query?: UseQueryOptions<WorkerCapacityItem[], TError, TData> },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getClusterWorkersQueryKey();
  const queryFn = ({ signal }: { signal?: AbortSignal }) =>
    getClusterWorkers();
  const q = useQuery({ queryKey, queryFn, ...queryOptions }) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  q.queryKey = queryKey;
  return q;
}

// ── Mutation hooks ────────────────────────────────────────────────────────────

export const useRebalanceCluster = <TError = unknown, TContext = unknown>(
  options?: { mutation?: UseMutationOptions<RebalanceResult, TError, void, TContext> },
) =>
  useMutation<RebalanceResult, TError, void, TContext>({
    mutationFn: rebalanceCluster,
    ...options?.mutation,
  });

export const useRecoverStaleWorkers = <TError = unknown, TContext = unknown>(
  options?: { mutation?: UseMutationOptions<RecoverStaleResult, TError, void, TContext> },
) =>
  useMutation<RecoverStaleResult, TError, void, TContext>({
    mutationFn: recoverStaleWorkers,
    ...options?.mutation,
  });
