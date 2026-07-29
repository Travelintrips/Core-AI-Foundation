/**
 * use-review-workspace.ts — Team 16
 *
 * React Query hooks for the universal Review Workspace.
 *
 * B5B migration: removed VITE_ADMIN_API_KEY.  All requests now use
 * session-cookie auth via the shared apiFetch from @/lib/apiFetch.
 * No direct DB access from the frontend.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/apiFetch";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ReviewPermission =
  | "can_approve"
  | "can_reject"
  | "can_request_revision"
  | "can_sign_off"
  | "can_remove_sign_off"
  | "can_cancel"
  | "can_set_due_date"
  | "can_manage_checklist";

export type WorkspaceStatus =
  | "pending"
  | "in_review"
  | "approved"
  | "rejected"
  | "revision_requested"
  | "expired"
  | "canceled"
  | "revoked"
  | "superseded";

export interface WorkspaceMeta {
  id: number;
  reviewId: number;
  dueDate: string | null;
  internalSignedOff: boolean;
  internalSignedOffBy: string | null;
  internalSignedOffAt: string | null;
  checklistState: Record<string, { completedAt: string; completedBy: string }>;
  cancelReason: string | null;
  cancelledBy: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceReview {
  id: number;
  projectId: string;
  clientName: string;
  clientEmail: string | null;
  clientPhone: string | null;
  status: string;
  wsStatus: WorkspaceStatus;
  tokenExpiresAt: string;
  sharedAt: string | null;
  viewedAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  revisionRequestedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceSummary {
  review: WorkspaceReview;
  project: { brandName: string; businessType: string; projectId: string } | null;
  meta: WorkspaceMeta | null;
  permissions: ReviewPermission[];
  commentCount: number;
}

export interface ChecklistItem {
  id: string;
  label: string;
  description?: string;
  required: boolean;
  source: "core" | "workflow" | "plugin" | "service_policy";
  domain?: string;
  completedAt: string | null;
  completedBy: string | null;
}

export interface HistoryEvent {
  id: string;
  eventType: string;
  label: string;
  actor: string;
  actorType: "client" | "internal" | "agent" | "system";
  occurredAt: string;
  notes?: string;
}

export interface ProjectReviewEntry {
  review: WorkspaceReview;
  meta: WorkspaceMeta | null;
  wsStatus: WorkspaceStatus;
  permissions: ReviewPermission[];
}

// ── Query keys ────────────────────────────────────────────────────────────────

export const reviewWorkspaceKeys = {
  all: ["review-workspace"] as const,
  summary: (reviewId: number) => ["review-workspace", "summary", reviewId] as const,
  checklist: (reviewId: number) => ["review-workspace", "checklist", reviewId] as const,
  history: (reviewId: number) => ["review-workspace", "history", reviewId] as const,
  projectReviews: (projectId: string) => ["review-workspace", "project-reviews", projectId] as const,
};

// ── Hooks ─────────────────────────────────────────────────────────────────────

export function useWorkspaceSummary(reviewId: number | null) {
  return useQuery({
    queryKey: reviewId ? reviewWorkspaceKeys.summary(reviewId) : ["review-workspace", "noop"],
    queryFn: () =>
      apiFetch<WorkspaceSummary>(`/api/review-workspace/reviews/${reviewId}/summary`),
    enabled: reviewId != null,
    retry: false,
    staleTime: 30_000,
  });
}

export function useWorkspaceChecklist(reviewId: number | null) {
  return useQuery({
    queryKey: reviewId ? reviewWorkspaceKeys.checklist(reviewId) : ["review-workspace", "checklist-noop"],
    queryFn: () =>
      apiFetch<{ reviewId: number; items: ChecklistItem[] }>(
        `/api/review-workspace/reviews/${reviewId}/checklist`,
      ),
    enabled: reviewId != null,
    staleTime: 30_000,
  });
}

export function useReviewHistory(reviewId: number | null) {
  return useQuery({
    queryKey: reviewId ? reviewWorkspaceKeys.history(reviewId) : ["review-workspace", "history-noop"],
    queryFn: () =>
      apiFetch<{ reviewId: number; history: HistoryEvent[] }>(
        `/api/review-workspace/reviews/${reviewId}/history`,
      ),
    enabled: reviewId != null,
    staleTime: 30_000,
  });
}

export function useProjectReviews(projectId: string | null) {
  return useQuery({
    queryKey: projectId ? reviewWorkspaceKeys.projectReviews(projectId) : ["review-workspace", "project-noop"],
    queryFn: () =>
      apiFetch<ProjectReviewEntry[]>(
        `/api/review-workspace/projects/${projectId}/reviews`,
      ),
    enabled: projectId != null,
    staleTime: 30_000,
  });
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export function useToggleChecklistItem(reviewId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, completed, completedBy }: { itemId: string; completed: boolean; completedBy?: string }) =>
      apiFetch<{ reviewId: number; items: ChecklistItem[] }>(
        `/api/review-workspace/reviews/${reviewId}/checklist/${itemId}`,
        { method: "PATCH", body: JSON.stringify({ completed, completedBy }) },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: reviewWorkspaceKeys.checklist(reviewId) });
    },
  });
}

export function useSetDueDate(reviewId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dueDate: string | null) =>
      apiFetch<{ reviewId: number; meta: WorkspaceMeta }>(
        `/api/review-workspace/reviews/${reviewId}/due-date`,
        { method: "PATCH", body: JSON.stringify({ dueDate }) },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: reviewWorkspaceKeys.summary(reviewId) });
    },
  });
}

export function useInternalSignOff(reviewId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (signedOffBy: string) =>
      apiFetch<{ reviewId: number; meta: WorkspaceMeta }>(
        `/api/review-workspace/reviews/${reviewId}/internal-sign-off`,
        { method: "POST", body: JSON.stringify({ signedOffBy }) },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: reviewWorkspaceKeys.summary(reviewId) });
      void qc.invalidateQueries({ queryKey: reviewWorkspaceKeys.history(reviewId) });
    },
  });
}

export function useRemoveSignOff(reviewId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{ reviewId: number; meta: WorkspaceMeta }>(
        `/api/review-workspace/reviews/${reviewId}/internal-sign-off`,
        { method: "DELETE", body: "" },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: reviewWorkspaceKeys.summary(reviewId) });
    },
  });
}

export function useCancelReview(reviewId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ reason, cancelledBy }: { reason: string; cancelledBy?: string }) =>
      apiFetch<{ success: boolean; wsStatus: string; review: WorkspaceReview; meta: WorkspaceMeta }>(
        `/api/review-workspace/reviews/${reviewId}/cancel`,
        { method: "POST", body: JSON.stringify({ reason, cancelledBy }) },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: reviewWorkspaceKeys.summary(reviewId) });
      void qc.invalidateQueries({ queryKey: reviewWorkspaceKeys.history(reviewId) });
    },
  });
}
