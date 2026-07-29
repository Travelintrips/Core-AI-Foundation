/**
 * Design Template Library — typed API client.
 *
 * All fetch logic lives here. Components use these functions directly or
 * via TanStack Query. Never inline fetch calls in page components.
 *
 * API base: "" (relative) so Vite proxies /api/* to the api-server port.
 *
 * B5B migration: removed VITE_ADMIN_API_KEY / x-admin-api-key header injection.
 * Browser requests now use session-cookie auth via the shared apiFetch utility.
 */

import type {
  DesignTemplate,
  TemplateListResponse,
  TemplateVersionsResponse,
  PreviewDataResponse,
  RenderedPreview,
} from "../types/design-template-ui";
import { apiFetch } from "@/lib/apiFetch";

// ── Template Library ──────────────────────────────────────────────────────────

export interface ListTemplatesParams {
  status?: string;
  category?: string;
  page?: number;
  pageSize?: number;
}

export async function listTemplates(params: ListTemplatesParams = {}): Promise<TemplateListResponse> {
  const qs = new URLSearchParams();
  if (params.status && params.status !== "all") qs.set("status", params.status);
  if (params.category) qs.set("category", params.category);
  if (params.page) qs.set("page", String(params.page));
  if (params.pageSize) qs.set("pageSize", String(params.pageSize));
  return apiFetch<TemplateListResponse>(`/api/ai/design-templates?${qs.toString()}`);
}

export async function getTemplate(id: number): Promise<DesignTemplate> {
  return apiFetch<DesignTemplate>(`/api/ai/design-templates/${id}`);
}

export interface CreateTemplateInput {
  name: string;
  description?: string;
  category?: string;
}

export async function createTemplate(input: CreateTemplateInput): Promise<DesignTemplate> {
  return apiFetch<DesignTemplate>("/api/ai/design-templates", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export interface UpdateTemplateInput {
  name?: string;
  description?: string;
  category?: string;
  status?: "draft" | "archived";
}

export async function updateTemplate(id: number, input: UpdateTemplateInput): Promise<DesignTemplate> {
  return apiFetch<DesignTemplate>(`/api/ai/design-templates/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function duplicateTemplate(id: number): Promise<DesignTemplate> {
  return apiFetch<DesignTemplate>(`/api/ai/design-templates/${id}/duplicate`, {
    method: "POST",
  });
}

// ── Version Management ────────────────────────────────────────────────────────

export async function listVersions(templateId: number): Promise<TemplateVersionsResponse> {
  return apiFetch<TemplateVersionsResponse>(`/api/ai/design-templates/${templateId}/versions`);
}

export async function publishVersion(templateId: number, versionId: number): Promise<unknown> {
  return apiFetch(`/api/ai/design-templates/${templateId}/publish`, {
    method: "POST",
    body: JSON.stringify({ versionId }),
  });
}

// ── Preview ───────────────────────────────────────────────────────────────────

export async function getPreviewData(templateId: number): Promise<PreviewDataResponse> {
  return apiFetch<PreviewDataResponse>(`/api/ai/design-templates/${templateId}/preview`);
}

/**
 * renderPreview — renders a template as an image blob.
 *
 * Uses a direct fetch (not the JSON apiFetch helper) because the response is
 * a binary image, not JSON.  Still uses credentials: "include" and no API key.
 */
export async function renderPreview(
  templateId: number,
  data: Record<string, unknown>,
  opts: { format?: "png" | "jpg" | "webp"; templateVersionId?: number } = {},
): Promise<RenderedPreview> {
  const res = await fetch(`/api/ai/design-templates/${templateId}/preview`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      // x-admin-api-key intentionally omitted — session cookie is the credential
    },
    body: JSON.stringify({
      data,
      format: opts.format ?? "png",
      ...(opts.templateVersionId != null ? { templateVersionId: opts.templateVersionId } : {}),
    }),
  });

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const b = await res.json();
      if (b?.error) msg = b.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }

  const blob = await res.blob();
  return {
    objectUrl: URL.createObjectURL(blob),
    warnings: parseInt(res.headers.get("X-Render-Warnings") ?? "0", 10),
    canvasWidth: res.headers.get("X-Canvas-Width") ?? "?",
    canvasHeight: res.headers.get("X-Canvas-Height") ?? "?",
  };
}
