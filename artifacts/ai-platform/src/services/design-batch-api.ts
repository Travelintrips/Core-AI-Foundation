/**
 * Design Batch API — Frontend service layer (Phase 6A/6B)
 *
 * Wraps all /api/ai/design-render-batches and /api/ai/design-templates endpoints
 * with typed fetch calls and admin-key auth.
 */

const API_BASE = "";

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const key = import.meta.env.VITE_ADMIN_API_KEY;
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      ...(opts?.body ? { "Content-Type": "application/json" } : {}),
      ...(key ? { "x-admin-api-key": key } : {}),
      ...(opts?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const b = await res.json(); if (b?.error) msg = b.error; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

// ── Types ──────────────────────────────────────────────────────────────────────

export interface DesignTemplate {
  id: number;
  name: string;
  description?: string | null;
  category?: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface DesignTemplateVersion {
  id: number;
  templateId: number;
  versionNumber: number;
  status: string;
  canvasWidth: number;
  canvasHeight: number;
  variables: TemplateVariableMeta[];
  createdAt: string;
}

export interface TemplateVariableMeta {
  key: string;
  label: string;
  type: "text" | "number" | "currency" | "image" | "color" | "url" | "date" | "boolean";
  required?: boolean;
  defaultValue?: string | number | boolean;
  validation?: { maxLength?: number; minLength?: number; min?: number; max?: number; pattern?: string };
}

export interface DesignRenderBatch {
  id: number;
  tenantId: string;
  templateId: number;
  templateVersionId: number;
  name: string;
  status: "draft" | "queued" | "processing" | "completed" | "failed" | "cancelled";
  totalItems: number;
  completedItems: number;
  failedItems: number;
  requestedFormat: string;
  requestedWidth?: number | null;
  requestedHeight?: number | null;
  requestedBy: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
}

export interface DesignRenderItem {
  id: number;
  batchId: number;
  rowIndex: number;
  status: "queued" | "processing" | "completed" | "failed";
  outputUrl?: string | null;
  outputStoragePath?: string | null;
  errorMessage?: string | null;
  renderDurationMs?: number | null;
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface BatchListResult {
  items: DesignRenderBatch[];
  total: number;
  page: number;
  pageSize: number;
}

export interface BatchItemsResult {
  items: DesignRenderItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateBatchPayload {
  templateId: number;
  templateVersionId: number;
  name: string;
  format: "png" | "jpg" | "webp" | "pdf";
  width?: number;
  height?: number;
  /** Normalized valid rows keyed by variable key */
  items: Record<string, string | number | boolean | null>[];
  idempotencyKey?: string;
}

export interface AiTemplateAssistRequest {
  prompt: string;
  sizePreset?: "instagram-square" | "instagram-portrait" | "instagram-landscape" | "a4" | "custom";
  canvasWidth?: number;
  canvasHeight?: number;
  industry?: string;
  brandColors?: string[];
  desiredVariables?: string[];
  language?: string;
}

export interface AiTemplateProposal {
  summary: string;
  assumptions: string[];
  variables: TemplateVariableMeta[];
  template: {
    name: string;
    description?: string;
    category?: string;
    canvas: { width: number; height: number; unit: "px"; backgroundColor?: string };
    elements: unknown[];
    variables: TemplateVariableMeta[];
  };
  warnings: string[];
}

export interface AiAssistResult {
  proposal: AiTemplateProposal;
  templateId: number;
  versionId: number;
  draftSaved: boolean;
  aiMeta: { provider: string; model: string; inputTokens: number; outputTokens: number };
}

// ── Template API ───────────────────────────────────────────────────────────────

export const templateApi = {
  list: (params?: { status?: string; category?: string; page?: number; pageSize?: number }) => {
    const q = new URLSearchParams();
    if (params?.status)   q.set("status", params.status);
    if (params?.category) q.set("category", params.category);
    if (params?.page)     q.set("page", String(params.page));
    if (params?.pageSize) q.set("pageSize", String(params.pageSize));
    return apiFetch<{ items: DesignTemplate[]; total: number }>(`/api/ai/design-templates?${q}`);
  },

  get: (id: number) => apiFetch<DesignTemplate>(`/api/ai/design-templates/${id}`),

  listVersions: (templateId: number) =>
    apiFetch<{ items: DesignTemplateVersion[] }>(`/api/ai/design-templates/${templateId}/versions`),

  getVersion: (templateId: number, versionId: number) =>
    apiFetch<DesignTemplateVersion>(`/api/ai/design-templates/${templateId}/versions/${versionId}`),

  aiAssist: (body: AiTemplateAssistRequest) =>
    apiFetch<AiAssistResult>("/api/ai/design-templates/ai-assist", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  aiPresets: () =>
    apiFetch<{ presets: { id: string; label: string; width: number | null; height: number | null }[] }>(
      "/api/ai/design-templates/ai-assist/presets",
    ),
};

// ── Batch API ──────────────────────────────────────────────────────────────────

export const batchApi = {
  list: (params?: { page?: number; pageSize?: number; status?: string }) => {
    const q = new URLSearchParams();
    if (params?.page)     q.set("page", String(params.page));
    if (params?.pageSize) q.set("pageSize", String(params.pageSize));
    if (params?.status)   q.set("status", params.status);
    return apiFetch<BatchListResult>(`/api/ai/design-render-batches?${q}`);
  },

  get: (id: number) => apiFetch<DesignRenderBatch>(`/api/ai/design-render-batches/${id}`),

  create: (payload: CreateBatchPayload) =>
    apiFetch<DesignRenderBatch>("/api/ai/design-render-batches", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  start: (id: number) =>
    apiFetch<{ status: string }>(`/api/ai/design-render-batches/${id}/start`, { method: "POST" }),

  cancel: (id: number) =>
    apiFetch<{ status: string }>(`/api/ai/design-render-batches/${id}/cancel`, { method: "POST" }),

  retryFailed: (id: number) =>
    apiFetch<{ status: string }>(`/api/ai/design-render-batches/${id}/retry-failed`, { method: "POST" }),

  getItems: (id: number, params?: { page?: number; pageSize?: number; status?: string }) => {
    const q = new URLSearchParams();
    if (params?.page)     q.set("page", String(params.page));
    if (params?.pageSize) q.set("pageSize", String(params.pageSize));
    if (params?.status)   q.set("status", params.status);
    return apiFetch<BatchItemsResult>(`/api/ai/design-render-batches/${id}/items?${q}`);
  },

  requestZip: (id: number) =>
    apiFetch<{ jobId: number; status: string }>(`/api/ai/design-render-batches/${id}/zip`, { method: "POST" }),
};
