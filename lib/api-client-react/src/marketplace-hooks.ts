/**
 * Phase 8 — AI Skills Marketplace & Tool Ecosystem API hooks (manual, not generated).
 * Follows the same conventions as cluster-hooks.ts.
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryOptions,
  type UseMutationOptions,
  type QueryKey,
  type UseQueryResult,
} from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

// ── Types ─────────────────────────────────────────────────────────────────────

export type PackageType = "skill" | "tool";

export interface AiSkillPackage {
  id: number;
  skillCode: string;
  skillName: string;
  category: string | null;
  description: string | null;
  version: string;
  author: string | null;
  icon: string | null;
  status: string;
  requiredCapabilities: string[];
  requiredTools: string[];
  configurationSchema: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface AiToolPackage {
  id: number;
  toolCode: string;
  toolName: string;
  provider: string | null;
  version: string;
  category: string | null;
  apiType: string | null;
  authenticationType: string | null;
  status: string;
  configurationSchema: Record<string, unknown>;
  healthStatus: string;
  lastHealthCheckAt: string | null;
  rateLimitPerMinute: string | null;
  retryPolicy: string;
  capabilities: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AiInstalledPackage {
  id: number;
  tenantId: string;
  packageId: number;
  packageType: PackageType;
  installedVersion: string;
  enabled: boolean;
  configurationJson: Record<string, unknown>;
  installedAt: string;
  updatedAt: string;
  catalog: AiSkillPackage | AiToolPackage | null;
}

export interface MarketplaceAnalytics {
  totalSkillPackages: number;
  totalToolPackages: number;
  installedSkills: number;
  installedTools: number;
  enabledSkills: number;
  enabledTools: number;
  connectorHealth: Record<string, number>;
  versionDistribution: Record<string, number>;
}

// ── Query key factories ────────────────────────────────────────────────────────

export const getMarketplaceSkillsQueryKey = () => [`/api/ai/marketplace/skills`] as const;
export const getMarketplaceToolsQueryKey = () => [`/api/ai/marketplace/tools`] as const;
export const getMarketplaceInstalledQueryKey = (tenantId = "default") => [`/api/ai/marketplace/installed`, tenantId] as const;
export const getMarketplaceAnalyticsQueryKey = (tenantId = "default") => [`/api/ai/marketplace/analytics`, tenantId] as const;

// ── Fetchers ──────────────────────────────────────────────────────────────────

export const getMarketplaceSkills = (): Promise<AiSkillPackage[]> =>
  customFetch<AiSkillPackage[]>(`/api/ai/marketplace/skills`);

export const getMarketplaceTools = (): Promise<AiToolPackage[]> =>
  customFetch<AiToolPackage[]>(`/api/ai/marketplace/tools`);

export const getMarketplaceInstalled = (tenantId = "default"): Promise<AiInstalledPackage[]> =>
  customFetch<AiInstalledPackage[]>(`/api/ai/marketplace/installed?tenantId=${encodeURIComponent(tenantId)}`);

export const getMarketplaceAnalytics = (tenantId = "default"): Promise<MarketplaceAnalytics> =>
  customFetch<MarketplaceAnalytics>(`/api/ai/marketplace/analytics?tenantId=${encodeURIComponent(tenantId)}`);

export const installMarketplacePackage = (body: { tenantId?: string; packageType: PackageType; packageId: number; configuration?: Record<string, unknown> }): Promise<AiInstalledPackage> =>
  customFetch<AiInstalledPackage>(`/api/ai/marketplace/install`, { method: "POST", body: JSON.stringify(body) });

export const upgradeMarketplacePackage = (packageType: PackageType, id: number, tenantId = "default"): Promise<AiInstalledPackage> =>
  customFetch<AiInstalledPackage>(`/api/ai/marketplace/${packageType}/${id}/upgrade`, { method: "PATCH", body: JSON.stringify({ tenantId }) });

export const enableMarketplacePackage = (packageType: PackageType, id: number, tenantId = "default"): Promise<AiInstalledPackage> =>
  customFetch<AiInstalledPackage>(`/api/ai/marketplace/${packageType}/${id}/enable`, { method: "PATCH", body: JSON.stringify({ tenantId }) });

export const disableMarketplacePackage = (packageType: PackageType, id: number, tenantId = "default"): Promise<AiInstalledPackage> =>
  customFetch<AiInstalledPackage>(`/api/ai/marketplace/${packageType}/${id}/disable`, { method: "PATCH", body: JSON.stringify({ tenantId }) });

export const uninstallMarketplacePackage = (packageType: PackageType, id: number, tenantId = "default"): Promise<void> =>
  customFetch<void>(`/api/ai/marketplace/${packageType}/${id}?tenantId=${encodeURIComponent(tenantId)}`, { method: "DELETE" });

export const healthCheckTool = (id: number): Promise<AiToolPackage> =>
  customFetch<AiToolPackage>(`/api/ai/marketplace/tools/${id}/health-check`, { method: "POST" });

// ── Query hooks ────────────────────────────────────────────────────────────────

export function useGetMarketplaceSkills<TData = AiSkillPackage[], TError = unknown>(
  options?: { query?: UseQueryOptions<AiSkillPackage[], TError, TData> },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getMarketplaceSkillsQueryKey();
  const q = useQuery({ queryKey, queryFn: () => getMarketplaceSkills(), ...queryOptions }) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  q.queryKey = queryKey;
  return q;
}

export function useGetMarketplaceTools<TData = AiToolPackage[], TError = unknown>(
  options?: { query?: UseQueryOptions<AiToolPackage[], TError, TData> },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getMarketplaceToolsQueryKey();
  const q = useQuery({ queryKey, queryFn: () => getMarketplaceTools(), ...queryOptions }) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  q.queryKey = queryKey;
  return q;
}

export function useGetMarketplaceInstalled<TData = AiInstalledPackage[], TError = unknown>(
  tenantId = "default",
  options?: { query?: UseQueryOptions<AiInstalledPackage[], TError, TData> },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getMarketplaceInstalledQueryKey(tenantId);
  const q = useQuery({ queryKey, queryFn: () => getMarketplaceInstalled(tenantId), ...queryOptions }) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  q.queryKey = queryKey;
  return q;
}

export function useGetMarketplaceAnalytics<TData = MarketplaceAnalytics, TError = unknown>(
  tenantId = "default",
  options?: { query?: UseQueryOptions<MarketplaceAnalytics, TError, TData> },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getMarketplaceAnalyticsQueryKey(tenantId);
  const q = useQuery({ queryKey, queryFn: () => getMarketplaceAnalytics(tenantId), ...queryOptions }) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  q.queryKey = queryKey;
  return q;
}

// ── Mutation hooks ────────────────────────────────────────────────────────────

function useInvalidateMarketplace() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: getMarketplaceSkillsQueryKey() });
    qc.invalidateQueries({ queryKey: getMarketplaceToolsQueryKey() });
    qc.invalidateQueries({ queryKey: [`/api/ai/marketplace/installed`] });
    qc.invalidateQueries({ queryKey: [`/api/ai/marketplace/analytics`] });
  };
}

export const useInstallMarketplacePackage = <TError = unknown, TContext = unknown>(
  options?: { mutation?: UseMutationOptions<AiInstalledPackage, TError, Parameters<typeof installMarketplacePackage>[0], TContext> },
) => {
  const invalidate = useInvalidateMarketplace();
  return useMutation<AiInstalledPackage, TError, Parameters<typeof installMarketplacePackage>[0], TContext>({
    mutationFn: installMarketplacePackage,
    ...options?.mutation,
    onSuccess: (...args) => {
      invalidate();
      options?.mutation?.onSuccess?.(...args);
    },
  });
};

export const useUpgradeMarketplacePackage = <TError = unknown, TContext = unknown>(
  options?: { mutation?: UseMutationOptions<AiInstalledPackage, TError, { packageType: PackageType; id: number; tenantId?: string }, TContext> },
) => {
  const invalidate = useInvalidateMarketplace();
  return useMutation<AiInstalledPackage, TError, { packageType: PackageType; id: number; tenantId?: string }, TContext>({
    mutationFn: ({ packageType, id, tenantId }) => upgradeMarketplacePackage(packageType, id, tenantId),
    ...options?.mutation,
    onSuccess: (...args) => {
      invalidate();
      options?.mutation?.onSuccess?.(...args);
    },
  });
};

export const useEnableMarketplacePackage = <TError = unknown, TContext = unknown>(
  options?: { mutation?: UseMutationOptions<AiInstalledPackage, TError, { packageType: PackageType; id: number; tenantId?: string }, TContext> },
) => {
  const invalidate = useInvalidateMarketplace();
  return useMutation<AiInstalledPackage, TError, { packageType: PackageType; id: number; tenantId?: string }, TContext>({
    mutationFn: ({ packageType, id, tenantId }) => enableMarketplacePackage(packageType, id, tenantId),
    ...options?.mutation,
    onSuccess: (...args) => {
      invalidate();
      options?.mutation?.onSuccess?.(...args);
    },
  });
};

export const useDisableMarketplacePackage = <TError = unknown, TContext = unknown>(
  options?: { mutation?: UseMutationOptions<AiInstalledPackage, TError, { packageType: PackageType; id: number; tenantId?: string }, TContext> },
) => {
  const invalidate = useInvalidateMarketplace();
  return useMutation<AiInstalledPackage, TError, { packageType: PackageType; id: number; tenantId?: string }, TContext>({
    mutationFn: ({ packageType, id, tenantId }) => disableMarketplacePackage(packageType, id, tenantId),
    ...options?.mutation,
    onSuccess: (...args) => {
      invalidate();
      options?.mutation?.onSuccess?.(...args);
    },
  });
};

export const useUninstallMarketplacePackage = <TError = unknown, TContext = unknown>(
  options?: { mutation?: UseMutationOptions<void, TError, { packageType: PackageType; id: number; tenantId?: string }, TContext> },
) => {
  const invalidate = useInvalidateMarketplace();
  return useMutation<void, TError, { packageType: PackageType; id: number; tenantId?: string }, TContext>({
    mutationFn: ({ packageType, id, tenantId }) => uninstallMarketplacePackage(packageType, id, tenantId),
    ...options?.mutation,
    onSuccess: (...args) => {
      invalidate();
      options?.mutation?.onSuccess?.(...args);
    },
  });
};

export const useHealthCheckTool = <TError = unknown, TContext = unknown>(
  options?: { mutation?: UseMutationOptions<AiToolPackage, TError, number, TContext> },
) => {
  const invalidate = useInvalidateMarketplace();
  return useMutation<AiToolPackage, TError, number, TContext>({
    mutationFn: healthCheckTool,
    ...options?.mutation,
    onSuccess: (...args) => {
      invalidate();
      options?.mutation?.onSuccess?.(...args);
    },
  });
};
