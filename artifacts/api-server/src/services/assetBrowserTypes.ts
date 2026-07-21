/**
 * assetBrowserTypes.ts — Shared type contracts for Asset Browser backend (Team 14)
 */

export interface AssetBrowserItem {
  id: number;
  title: string;
  fileName: string;
  assetType: string;
  category: string;
  categoryLabel: string;
  sourceId: string;
  availability: "available" | "archived" | "unavailable";
  previewUrl: string | null;
  mimeType: string | null;
  fileSizeBytes: number | null;
  version: number;
  tags: string[];
  uploadedBy: string | null;
  tenantKey: string;
  projectId: string | null;
  createdAt: string;
  updatedAt: string;
  previewExpired: boolean;
}

export interface AssetBrowserResult {
  items: AssetBrowserItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AssetBrowserFilter {
  /** Tenant owner — sha256 hash of customer email. Required unless platform-admin cross-tenant. */
  emailHash?: string;
  search?: string;
  category?: string;
  assetType?: string;
  sourceId?: string;
  tags?: string[];
  showArchived?: boolean;
  favoritedOnly?: boolean;
  projectId?: string;
  sort?: "newest" | "oldest" | "name" | "size";
  page?: number;
  pageSize?: number;
}

export interface AssetBrowserSource {
  id: string;
  label: string;
  requiresAdmin: boolean;
}
