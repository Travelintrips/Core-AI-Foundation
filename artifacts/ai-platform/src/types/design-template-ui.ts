/**
 * Design Template Library — UI-layer TypeScript types.
 *
 * These mirror the DB row shapes returned by /api/ai/design-templates/*.
 * Dates come back as ISO strings from JSON serialisation.
 */

export interface DesignTemplate {
  id: number;
  tenantId: string;
  name: string;
  slug: string;
  description: string | null;
  category: string | null;
  status: "draft" | "published" | "archived";
  activeVersionId: number | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface DesignTemplateVersion {
  id: number;
  tenantId: string;
  templateId: number;
  versionNumber: number;
  schemaVersion: string;
  templateJson: Record<string, unknown>;
  changelog: string | null;
  createdBy: string;
  publishedAt: string | null;
  createdAt: string;
}

export interface TemplateVariable {
  key: string;
  label: string;
  type: "text" | "number" | "currency" | "image" | "color" | "url" | "date" | "boolean";
  required?: boolean;
  defaultValue?: string | number | boolean;
  validation?: {
    maxLength?: number;
    minLength?: number;
    min?: number;
    max?: number;
    pattern?: string;
  };
}

export interface TemplateCanvas {
  width: number;
  height: number;
  unit: "px";
  backgroundColor?: string;
}

export interface TemplateJson {
  schemaVersion: string;
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  category?: string;
  canvas: TemplateCanvas;
  elements: unknown[];
  variables: TemplateVariable[];
  metadata: { createdBy: string; createdAt: string; updatedAt: string; version: number };
}

export interface TemplateListResponse {
  templates: DesignTemplate[];
  total: number;
  page: number;
  pageSize: number;
}

export interface TemplateVersionsResponse {
  versions: DesignTemplateVersion[];
}

export interface PreviewDataResponse {
  template: DesignTemplate;
  version: DesignTemplateVersion;
  templateJson: TemplateJson;
  sampleData: Record<string, unknown>;
}

export interface RenderedPreview {
  objectUrl: string;
  warnings: number;
  canvasWidth: string;
  canvasHeight: string;
}

export type TemplateStatus = "draft" | "published" | "archived";
