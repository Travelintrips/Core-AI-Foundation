/**
 * Shared frontend types for the Material Library UI.
 * Mirror of server types — kept minimal so the frontend doesn't import server code.
 */

export type MaterialStatus = "active" | "inactive" | "deprecated" | "unavailable" | "draft";
export type MaterialSource = "platform" | "tenant" | "plugin" | "uploaded" | "external";
export type MaterialSort =
  | "name_asc"
  | "name_desc"
  | "created_desc"
  | "created_asc"
  | "updated_desc"
  | "category_asc";

export interface MaterialPreview {
  previewUrl: string | null;
  thumbnailUrl: string | null;
  altText: string;
  swatchColor: string | null;
  additionalSwatches: string[];
}

export interface MaterialCompatibility {
  compatibleDomains: string[];
  compatibleCategories?: string[];
  compatibilityNote?: string;
}

export interface MaterialDefinition {
  materialId: string;
  tenantId: string | null;
  name: string;
  categoryId: string;
  description: string;
  status: MaterialStatus;
  source: MaterialSource;
  preview: MaterialPreview;
  properties: Record<string, unknown>;
  tags: string[];
  compatibility: MaterialCompatibility;
  createdAt: string;
  updatedAt: string;
  version: number;
  extensions: Record<string, unknown>;
  pluginId?: string;
  readOnly: boolean;
}

export interface MaterialCategory {
  categoryId: string;
  name: string;
  description?: string;
  parentId?: string | null;
  sortOrder: number;
  applicableDomains: string[];
  stability: "stable" | "beta" | "experimental" | "deprecated";
  capabilities: string[];
}

export interface MaterialSearchFilter {
  q?: string;
  categoryIds?: string[];
  tags?: string[];
  source?: MaterialSource;
  domain?: string;
  status?: MaterialStatus;
  includeInactive?: boolean;
  platformOnly?: boolean;
}

export interface MaterialListResult {
  items: MaterialDefinition[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}
