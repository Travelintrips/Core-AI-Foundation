/**
 * use-cp-review.ts — Company Profile V4.2C
 * React Query hooks for the Company Profile review experience.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

/** Lightweight fetch wrapper — throws on non-2xx with JSON error body */
async function customFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let message = `Request failed: ${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch { /* ignore */ }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CpReviewContext {
  reviewId:          number;
  projectId:         string;
  clientName:        string;
  reviewStatus:      string;
  brandName:         string;
  businessType:      string;
  documentReady:     boolean;
  documentVersion:   number | null;
  documentUrl:       string | null;
  watermarked:       boolean;
  filesUnlocked:     boolean;
  pageCount:         number | null;
  sectionsIncluded:  string[];
  sectionsSkipped:   string[];
  packageLevel:      string | null;
  pageTarget:        number | null;
  qcScore:           number | null;
  qcPassed:          boolean | null;
  qcDimensions:      Record<string, unknown> | null;
  qcWarnings:        string[];
  currentVersion:    CpVersion | null;
  totalVersions:     number;
  totalComments:     number;
  resolvedComments:  number;
  pendingComments:   number;
  comments:          CpComment[];
  createdAt:         string;
  sharedAt:          string | null;
  approvedAt:        string | null;
  rejectedAt:        string | null;
  revisionRequestedAt: string | null;
}

export interface CpComment {
  id:                number;
  reviewId:          number;
  projectId:         string;
  documentVersionId?: number;
  parentCommentId?:  number;
  pageNumber?:       number;
  positionX?:        number;
  positionY?:        number;
  sectionId?:        string;
  comment:           string;
  authorName:        string;
  authorType:        "client" | "admin";
  priority:          string;
  status:            string;
  resolvedBy?:       string;
  resolvedAt?:       string;
  createdAt:         string;
  updatedAt:         string;
  replies?:          CpComment[];
}

export interface CpVersion {
  id:               number;
  version:          number;
  versionLabel:     string;
  reason?:          string;
  revisionNotes?:   string;
  sectionsIncluded: string[];
  qcScore?:         number;
  qcPassed?:        boolean;
  qcDimensions?:    Record<string, unknown>;
  approved:         boolean;
  approvedAt?:      string;
  approvedBy?:      string;
  sentForReviewAt?: string;
  createdBy?:       string;
  createdAt:        string;
}

export interface CpVersionDiff {
  v1: { version: number; versionLabel: string; qcScore?: number };
  v2: { version: number; versionLabel: string; qcScore?: number };
  diff: {
    added:        string[];
    removed:      string[];
    unchanged:    string[];
    totalChanged: number;
  };
}

export interface CpDashboard {
  reviewId:            number;
  reviewStatus:        string;
  currentVersion:      string | null;
  totalVersions:       number;
  totalComments:       number;
  openComments:        number;
  resolvedComments:    number;
  pendingRevisions:    number;
  highPriorityPending: number;
  qcScore:             number | null;
  qcPassed:            boolean | null;
  filesUnlocked:       boolean;
  approvalStatus:      string;
  approvedAt:          string | null;
  sharedAt:            string | null;
  revisionRequestedAt: string | null;
}

// ── Query: get CP review context ──────────────────────────────────────────────

export const useGetPublicCpReview = (token: string) => {
  return useQuery({
    queryKey: ["cp-review", token],
    queryFn: async ({ signal }) =>
      customFetch<CpReviewContext>(`/api/public/cp-review/${token}`, { signal }),
    enabled: !!token,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data?.documentReady) return 5000; // poll until document is ready
      return false;
    },
  });
};

// ── Query: get versions ───────────────────────────────────────────────────────

export const useGetCpVersions = (token: string) => {
  return useQuery({
    queryKey: ["cp-review-versions", token],
    queryFn: async ({ signal }) =>
      customFetch<CpVersion[]>(`/api/public/cp-review/${token}/versions`, { signal }),
    enabled: !!token,
  });
};

// ── Query: compare versions ───────────────────────────────────────────────────

export const useCompareCpVersions = (
  token: string,
  v1: number | undefined,
  v2: number | undefined,
  options?: { enabled?: boolean },
) => {
  return useQuery({
    queryKey: ["cp-review-compare", token, v1, v2],
    queryFn: async ({ signal }) =>
      customFetch<CpVersionDiff>(
        `/api/public/cp-review/${token}/versions/compare?v1=${v1}&v2=${v2}`,
        { signal },
      ),
    enabled: (options?.enabled ?? false) && !!token && v1 !== undefined && v2 !== undefined && v1 !== v2,
  });
};

// ── Query: dashboard KPIs ─────────────────────────────────────────────────────

export const useGetCpReviewDashboard = (token: string) => {
  return useQuery({
    queryKey: ["cp-review-dashboard", token],
    queryFn: async ({ signal }) =>
      customFetch<CpDashboard>(`/api/public/cp-review/${token}/dashboard`, { signal }),
    enabled: !!token,
  });
};

// ── Mutation: add comment ─────────────────────────────────────────────────────

export const useAddCpPageComment = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      token,
      data,
    }: {
      token: string;
      data: {
        comment:     string;
        authorName:  string;
        pageNumber?:        number;
        positionX?:         number;
        positionY?:         number;
        sectionId?:         string;
        parentCommentId?:   number;
        priority?:          string;
        documentVersionId?: number;
      };
    }) =>
      customFetch<CpComment>(`/api/public/cp-review/${token}/comments`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(data),
      }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["cp-review", variables.token] });
    },
  });
};

// ── Mutation: patch comment (edit/resolve/reopen) ─────────────────────────────

export const usePatchCpPageComment = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      token,
      commentId,
      data,
    }: {
      token:     string;
      commentId: number;
      data: { comment?: string; status?: string };
    }) =>
      customFetch<CpComment>(`/api/public/cp-review/${token}/comments/${commentId}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(data),
      }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["cp-review", variables.token] });
    },
  });
};

// ── Mutation: delete comment ──────────────────────────────────────────────────

export const useDeleteCpPageComment = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ token, commentId }: { token: string; commentId: number }) =>
      customFetch<{ success: boolean; deleted: number }>(
        `/api/public/cp-review/${token}/comments/${commentId}`,
        { method: "DELETE" },
      ),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["cp-review", variables.token] });
    },
  });
};

// ── Mutation: approve with checkbox ──────────────────────────────────────────

export const useApproveCpReview = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      token,
      data,
    }: {
      token: string;
      data: { confirmed: true };
    }) =>
      customFetch<{ success: boolean; status: string }>(
        `/api/public/cp-review/${token}/approve`,
        {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify(data),
        },
      ),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["cp-review", variables.token] });
      queryClient.invalidateQueries({ queryKey: ["cp-review-dashboard", variables.token] });
    },
  });
};

// ── Mutation: request revision ────────────────────────────────────────────────

export const useRequestCpRevision = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      token,
      data,
    }: {
      token: string;
      data: {
        notes:             string;
        priority?:         string;
        selectedPages?:    number[];
        selectedSections?: string[];
      };
    }) =>
      customFetch<{ success: boolean; status: string; pages: number[]; sections: string[] }>(
        `/api/public/cp-review/${token}/request-revision`,
        {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify(data),
        },
      ),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["cp-review", variables.token] });
      queryClient.invalidateQueries({ queryKey: ["cp-review-dashboard", variables.token] });
    },
  });
};
