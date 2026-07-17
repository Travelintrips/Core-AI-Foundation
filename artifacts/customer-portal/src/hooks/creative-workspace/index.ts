/**
 * Creative Workspace hooks (Team 2).
 * All hooks call /api/public/customer/creative-workspace/:token/... endpoints.
 * No admin key required — token-protected public routes.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  BriefStatus,
  CWNotification,
  CWOverview,
  DeliverableBundle,
  NotificationSummary,
  ProductionProgress,
  ProjectHistory,
  RevisionHistory,
} from "./types";

// Re-export types so consumers can import from one place
export type {
  BriefStatus,
  BriefField,
  CWNotification,
  NotificationSeverity,
  CWOverview,
  CWStats,
  CWProjectCard,
  CWUrgentAction,
  DeliverableBundle,
  CWDeliverable,
  CWZipBundle,
  NotificationSummary,
  ProductionProgress,
  ProductionStage,
  StageStatus,
  ProjectHistory,
  CWHistoryEvent,
  RevisionHistory,
  CWRevisionEntry,
} from "./types";

// ── Fetch helper ──────────────────────────────────────────────────────────────

async function cwFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let msg = `Request failed: ${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

const BASE = (token: string) => `/api/public/customer/creative-workspace/${token}`;

// ── Overview ──────────────────────────────────────────────────────────────────

export function useCWOverview(token: string) {
  return useQuery({
    queryKey: ["cw2-overview", token],
    queryFn: ({ signal }) => cwFetch<CWOverview>(`${BASE(token)}/overview`, { signal }),
    enabled: !!token,
    staleTime: 30_000,
  });
}

// ── Projects ──────────────────────────────────────────────────────────────────

export type CWProjectsFilters = {
  search?: string;
  status?: string;
  sort?: "newest" | "oldest" | "delivery_date";
};

export function useCWProjects(token: string, filters: CWProjectsFilters = {}) {
  const params = new URLSearchParams();
  if (filters.search)  params.set("search", filters.search);
  if (filters.status)  params.set("status", filters.status);
  if (filters.sort)    params.set("sort", filters.sort);
  const qs = params.toString();

  return useQuery({
    queryKey: ["cw2-projects", token, filters],
    queryFn: ({ signal }) =>
      cwFetch<{ items: Array<Record<string, unknown>>; total: number }>(
        `${BASE(token)}/projects${qs ? `?${qs}` : ""}`,
        { signal },
      ),
    enabled: !!token,
    staleTime: 30_000,
  });
}

// ── Brief status ──────────────────────────────────────────────────────────────

export function useCWBriefStatus(token: string, projectNumber: string) {
  return useQuery({
    queryKey: ["cw2-brief", token, projectNumber],
    queryFn: ({ signal }) =>
      cwFetch<BriefStatus>(`${BASE(token)}/projects/${projectNumber}/brief`, { signal }),
    enabled: !!token && !!projectNumber,
    staleTime: 60_000,
  });
}

// ── Production progress ───────────────────────────────────────────────────────

export function useCWProgress(token: string, projectNumber: string) {
  return useQuery({
    queryKey: ["cw2-progress", token, projectNumber],
    queryFn: ({ signal }) =>
      cwFetch<ProductionProgress>(`${BASE(token)}/projects/${projectNumber}/progress`, { signal }),
    enabled: !!token && !!projectNumber,
    staleTime: 15_000,
    refetchInterval: (query) => {
      // Poll more aggressively for active projects
      const data = query.state.data;
      if (!data) return false;
      const active = data.projectStatus &&
        !["completed", "failed", "cancelled", "waiting_payment"].includes(data.projectStatus);
      return active ? 20_000 : false;
    },
  });
}

// ── Deliverables ──────────────────────────────────────────────────────────────

export function useCWDeliverables(token: string, projectNumber: string) {
  return useQuery({
    queryKey: ["cw2-deliverables", token, projectNumber],
    queryFn: ({ signal }) =>
      cwFetch<DeliverableBundle>(`${BASE(token)}/projects/${projectNumber}/deliverables`, { signal }),
    enabled: !!token && !!projectNumber,
    staleTime: 30_000,
  });
}

// ── Revisions ─────────────────────────────────────────────────────────────────

export function useCWRevisions(token: string, projectNumber: string) {
  return useQuery({
    queryKey: ["cw2-revisions", token, projectNumber],
    queryFn: ({ signal }) =>
      cwFetch<RevisionHistory>(`${BASE(token)}/projects/${projectNumber}/revisions`, { signal }),
    enabled: !!token && !!projectNumber,
    staleTime: 30_000,
  });
}

// ── Project history ───────────────────────────────────────────────────────────

export function useCWHistory(token: string, projectNumber: string, limit = 50) {
  return useQuery({
    queryKey: ["cw2-history", token, projectNumber, limit],
    queryFn: ({ signal }) =>
      cwFetch<ProjectHistory>(
        `${BASE(token)}/projects/${projectNumber}/history?limit=${limit}`,
        { signal },
      ),
    enabled: !!token && !!projectNumber,
    staleTime: 60_000,
  });
}

// ── Notifications ─────────────────────────────────────────────────────────────

export function useCWNotifications(token: string) {
  return useQuery({
    queryKey: ["cw2-notifications", token],
    queryFn: ({ signal }) =>
      cwFetch<NotificationSummary>(`${BASE(token)}/notifications`, { signal }),
    enabled: !!token,
    staleTime: 20_000,
    refetchInterval: 60_000,
  });
}

export function useCWMarkNotificationRead(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      cwFetch<{ ok: boolean }>(`${BASE(token)}/notifications/${id}/read`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cw2-notifications", token] }),
  });
}

export function useCWMarkAllRead(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      cwFetch<{ ok: boolean; markedCount: number }>(
        `${BASE(token)}/notifications/read-all`,
        { method: "POST" },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cw2-notifications", token] }),
  });
}
