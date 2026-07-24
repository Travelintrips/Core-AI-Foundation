/**
 * Design Template Editor — API Service
 *
 * Wraps all backend calls for the design template engine.
 * Uses the same apiFetch pattern as design-studio-editor.tsx.
 */

import type { DesignTemplate } from "@/state/design-editor/types";

const API_BASE = "";

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const key = import.meta.env.VITE_ADMIN_API_KEY;
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    credentials: "include",
    headers: {
      ...(opts?.body && !(opts.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...(key ? { "x-admin-api-key": key } : {}),
      ...(opts?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const b = await res.json();
      if (b?.error) msg = b.error;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

// ── Response types ─────────────────────────────────────────────────────────────

export interface ApiTemplate {
  id: number;
  tenantId: string;
  name: string;
  slug: string;
  description?: string;
  category?: string;
  status: string;
  activeVersionId?: number;
  thumbnailUrl?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApiTemplateVersion {
  id: number;
  templateId: number;
  tenantId: string;
  versionNumber: number;
  schemaVersion: string;
  templateJson: DesignTemplate;
  changelog?: string;
  createdBy: string;
  createdAt: string;
  publishedAt?: string;
}

export interface ApiTemplateWithVersion extends ApiTemplate {
  version?: ApiTemplateVersion;
}

export interface ApiPreviewResult {
  /** base64 PNG or URL depending on backend implementation */
  previewUrl?: string;
  previewDataUrl?: string;
  message?: string;
}

// ── API calls ─────────────────────────────────────────────────────────────────

export const designEditorApi = {
  /** Fetch template metadata */
  getTemplate: (id: string | number): Promise<ApiTemplate> =>
    apiFetch(`/api/ai/design-templates/${id}`),

  /** Fetch list of versions for a template */
  listVersions: (id: string | number): Promise<{ items: ApiTemplateVersion[] }> =>
    apiFetch(`/api/ai/design-templates/${id}/versions`),

  /** Fetch a specific version's JSON */
  getVersion: (templateId: string | number, versionId: string | number): Promise<ApiTemplateVersion> =>
    apiFetch(`/api/ai/design-templates/${templateId}/versions/${versionId}`),

  /**
   * Save draft: creates a new version with the provided template JSON.
   * Never modifies an existing published version.
   */
  saveDraft: (
    templateId: string | number,
    templateJson: DesignTemplate,
    changelog?: string,
  ): Promise<ApiTemplateVersion> =>
    apiFetch(`/api/ai/design-templates/${templateId}/versions`, {
      method: "POST",
      body: JSON.stringify({ templateJson, changelog: changelog ?? "Draft save" }),
    }),

  /**
   * Publish the latest version.
   * Only callable after saveDraft — never edits a published version in place.
   */
  publish: (templateId: string | number, versionId: string | number): Promise<ApiTemplate> =>
    apiFetch(`/api/ai/design-templates/${templateId}/publish`, {
      method: "POST",
      body: JSON.stringify({ versionId }),
    }),

  /**
   * Request a backend preview render.
   * Calls POST /api/ai/design-templates/:id/preview with current template JSON.
   */
  preview: (
    templateId: string | number,
    templateJson: DesignTemplate,
    sampleData: Record<string, unknown>,
  ): Promise<ApiPreviewResult> =>
    apiFetch(`/api/ai/design-templates/${templateId}/preview`, {
      method: "POST",
      body: JSON.stringify({ templateJson, sampleData }),
    }),

  /** Update template metadata (name, description, category) */
  updateTemplate: (id: string | number, patch: Partial<Pick<ApiTemplate, "name" | "description" | "category">>): Promise<ApiTemplate> =>
    apiFetch(`/api/ai/design-templates/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
};
