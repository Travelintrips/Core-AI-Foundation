/**
 * use-asset-browser.ts — Data-fetching hook for the Universal Asset Browser (Team 14)
 *
 * Fetches from the admin asset-browser API endpoint using session-cookie auth.
 *
 * B5B migration: removed VITE_ADMIN_API_KEY / x-admin-api-key header injection.
 * All requests now use credentials: "include" via the shared apiFetch from @/lib/apiFetch.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/apiFetch";
import type { AssetFilter, AssetSort, AssetPage, AssetSummary } from "./types";

// ── Query key factory ─────────────────────────────────────────────────────────

export const assetBrowserKeys = {
  all: ["asset-browser"] as const,
  list: (filter: AssetFilter, sort: AssetSort, page: number, pageSize: number) =>
    ["asset-browser", "list", filter, sort, page, pageSize] as const,
  detail: (id: number) => ["asset-browser", "detail", id] as const,
  sources: () => ["asset-browser", "sources"] as const,
};

// ── Param builder ─────────────────────────────────────────────────────────────

function buildParams(
  filter: AssetFilter,
  sort: AssetSort,
  page: number,
  pageSize: number,
): URLSearchParams {
  const p = new URLSearchParams();
  if (filter.search) p.set("search", filter.search);
  if (filter.category) p.set("category", filter.category);
  if (filter.assetType) p.set("assetType", filter.assetType);
  if (filter.sourceId) p.set("sourceId", filter.sourceId);
  if (filter.tags.length) p.set("tags", filter.tags.join(","));
  if (filter.showArchived) p.set("archived", "true");
  if (filter.favoritedOnly) p.set("favorited", "true");
  if (filter.projectId) p.set("projectId", filter.projectId);
  p.set("sort", sort.field);
  p.set("page", String(page));
  p.set("pageSize", String(pageSize));
  return p;
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

export interface UseAssetBrowserOptions {
  filter: AssetFilter;
  sort: AssetSort;
  page?: number;
  pageSize?: number;
  enabled?: boolean;
}

export function useAssetBrowser(options: UseAssetBrowserOptions) {
  const {
    filter,
    sort,
    page = 1,
    pageSize = 24,
    enabled = true,
  } = options;

  return useQuery({
    queryKey: assetBrowserKeys.list(filter, sort, page, pageSize),
    queryFn: async (): Promise<AssetPage> => {
      const params = buildParams(filter, sort, page, pageSize);
      return apiFetch<AssetPage>(`/api/ai/asset-browser/assets?${params.toString()}`);
    },
    enabled,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}

export function useAssetDetail(id: number | null) {
  return useQuery({
    queryKey: assetBrowserKeys.detail(id ?? -1),
    queryFn: () => apiFetch<AssetSummary>(`/api/ai/asset-browser/assets/${id}`),
    enabled: id !== null && id > 0,
  });
}

export function useAssetBrowserSources() {
  return useQuery({
    queryKey: assetBrowserKeys.sources(),
    queryFn: () => apiFetch<{ sources: Array<{ id: string; label: string }> }>("/api/ai/asset-browser/sources"),
    staleTime: 60_000,
  });
}

export function useAssetArchiveMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, archive }: { id: number; archive: boolean }) =>
      apiFetch<AssetSummary>(`/api/ai/asset-browser/assets/${id}/archive`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archive }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: assetBrowserKeys.all });
    },
  });
}

export function useRequestUploadUrl() {
  return useMutation({
    mutationFn: async (file: File): Promise<{ uploadURL: string; objectPath: string }> => {
      const res = await fetch("/api/storage/uploads/request-url", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: file.name,
          size: file.size,
          contentType: file.type || "application/octet-stream",
        }),
      });
      if (!res.ok) throw new Error("Gagal membuat URL upload");
      return res.json() as Promise<{ uploadURL: string; objectPath: string }>;
    },
  });
}
