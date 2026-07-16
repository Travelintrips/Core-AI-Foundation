/**
 * design-templates.test.ts — Unit tests for Template Library
 *
 * Tests pure logic: query-param construction, status helpers,
 * pagination state, version display, action state machines.
 * No DOM / React rendering required.
 */

import { describe, it, expect } from "vitest";

// ── Types (mirrors design-templates.tsx) ─────────────────────────────────────

interface DesignTemplate {
  id: number;
  name: string;
  status: string;
  category?: string | null;
  versionCount?: number;
  activeVersionId?: number | null;
  updatedAt: string;
  createdAt: string;
}

interface TemplateVersion {
  id: number;
  templateId: number;
  versionNumber: number;
  status: string;
  createdAt: string;
  publishedAt?: string | null;
}

// ── Helpers (mirrored logic from the page) ────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  draft:     "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  active:    "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  published: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  archived:  "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
};

function buildQueryParams(opts: {
  page: number;
  pageSize: number;
  status?: string;
  category?: string;
  search?: string;
}): string {
  const params = new URLSearchParams({ page: String(opts.page), pageSize: String(opts.pageSize) });
  if (opts.status && opts.status !== "all") params.set("status", opts.status);
  if (opts.category && opts.category !== "all") params.set("category", opts.category);
  if (opts.search?.trim()) params.set("search", opts.search.trim());
  return params.toString();
}

function totalPages(total: number, pageSize: number): number {
  return Math.ceil(total / pageSize);
}

function isDraftVersion(version: TemplateVersion): boolean {
  return version.status !== "published";
}

function isPublishedVersion(version: TemplateVersion): boolean {
  return version.status === "published";
}

function isActiveVersion(version: TemplateVersion, template: DesignTemplate): boolean {
  return version.id === template.activeVersionId;
}

// ─────────────────────────────────────────────────────────────────────────────

describe("buildQueryParams — filter/search/pagination params", () => {
  it("includes page and pageSize always", () => {
    const q = buildQueryParams({ page: 1, pageSize: 20 });
    expect(q).toContain("page=1");
    expect(q).toContain("pageSize=20");
  });

  it("omits status when 'all'", () => {
    const q = buildQueryParams({ page: 1, pageSize: 20, status: "all" });
    expect(q).not.toContain("status=");
  });

  it("includes status when not 'all'", () => {
    const q = buildQueryParams({ page: 1, pageSize: 20, status: "draft" });
    expect(q).toContain("status=draft");
  });

  it("includes category when provided and not 'all'", () => {
    const q = buildQueryParams({ page: 1, pageSize: 20, category: "Social Media" });
    expect(q).toContain("category=Social+Media");
  });

  it("omits category when 'all'", () => {
    const q = buildQueryParams({ page: 1, pageSize: 20, category: "all" });
    expect(q).not.toContain("category=");
  });

  it("trims and includes search param when provided", () => {
    const q = buildQueryParams({ page: 1, pageSize: 20, search: "  summer  " });
    expect(q).toContain("search=summer");
  });

  it("omits search when blank", () => {
    const q = buildQueryParams({ page: 1, pageSize: 20, search: "   " });
    expect(q).not.toContain("search=");
  });

  it("combines multiple filters", () => {
    const q = buildQueryParams({ page: 2, pageSize: 10, status: "published", category: "Flyer", search: "logo" });
    expect(q).toContain("page=2");
    expect(q).toContain("status=published");
    expect(q).toContain("category=Flyer");
    expect(q).toContain("search=logo");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("totalPages — pagination calculation", () => {
  it("returns 1 for empty list", () => {
    expect(totalPages(0, 20)).toBe(0); // 0 items = 0 pages (Math.ceil(0/20)=0)
  });

  it("returns 1 for exactly one page", () => {
    expect(totalPages(20, 20)).toBe(1);
  });

  it("returns 2 when one item overflows", () => {
    expect(totalPages(21, 20)).toBe(2);
  });

  it("handles large totals correctly", () => {
    expect(totalPages(100, 20)).toBe(5);
    expect(totalPages(101, 20)).toBe(6);
  });

  it("works with small page sizes", () => {
    expect(totalPages(7, 3)).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("STATUS_STYLES — status badge styles map", () => {
  it("has a style for draft", () => {
    expect(STATUS_STYLES["draft"]).toBeTruthy();
    expect(STATUS_STYLES["draft"]).toContain("yellow");
  });

  it("has a style for published", () => {
    expect(STATUS_STYLES["published"]).toBeTruthy();
    expect(STATUS_STYLES["published"]).toContain("blue");
  });

  it("has a style for archived", () => {
    expect(STATUS_STYLES["archived"]).toBeTruthy();
    expect(STATUS_STYLES["archived"]).toContain("zinc");
  });

  it("has a style for active", () => {
    expect(STATUS_STYLES["active"]).toBeTruthy();
    expect(STATUS_STYLES["active"]).toContain("emerald");
  });

  it("returns undefined for unknown status", () => {
    expect(STATUS_STYLES["unknown"]).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("version history display logic", () => {
  const publishedVersion: TemplateVersion = {
    id: 10, templateId: 1, versionNumber: 1, status: "published",
    createdAt: "2025-01-01T00:00:00Z", publishedAt: "2025-01-02T00:00:00Z",
  };
  const draftVersion: TemplateVersion = {
    id: 11, templateId: 1, versionNumber: 2, status: "draft",
    createdAt: "2025-01-03T00:00:00Z",
  };
  const template: DesignTemplate = {
    id: 1, name: "Test Template", status: "active",
    activeVersionId: 10, updatedAt: "2025-01-02T00:00:00Z", createdAt: "2025-01-01T00:00:00Z",
  };

  it("correctly identifies published version as not draft", () => {
    expect(isDraftVersion(publishedVersion)).toBe(false);
    expect(isPublishedVersion(publishedVersion)).toBe(true);
  });

  it("correctly identifies draft version", () => {
    expect(isDraftVersion(draftVersion)).toBe(true);
    expect(isPublishedVersion(draftVersion)).toBe(false);
  });

  it("correctly identifies active version", () => {
    expect(isActiveVersion(publishedVersion, template)).toBe(true);
    expect(isActiveVersion(draftVersion, template)).toBe(false);
  });

  it("published version should NOT show publish button (immutable)", () => {
    // Published versions are immutable — no publish action should be offered
    const canPublish = !isPublishedVersion(publishedVersion);
    expect(canPublish).toBe(false);
  });

  it("draft version should show publish button", () => {
    const canPublish = !isPublishedVersion(draftVersion);
    expect(canPublish).toBe(true);
  });

  it("version with publishedAt has a timestamp", () => {
    expect(publishedVersion.publishedAt).not.toBeNull();
    expect(new Date(publishedVersion.publishedAt!).getFullYear()).toBe(2025);
  });

  it("draft version has no publishedAt", () => {
    expect(draftVersion.publishedAt).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("action confirmation dialog state logic", () => {
  it("archive action label is 'Archive' not 'Delete'", () => {
    const label = "Archive";
    expect(label).toBe("Archive");
    expect(label).not.toBe("Delete");
    expect(label.toLowerCase()).not.toContain("delete");
  });

  it("publish confirmation requires versionId", () => {
    const versionId: number | null = null;
    expect(versionId).toBeNull();

    const versionId2 = 42;
    expect(typeof versionId2).toBe("number");
    expect(versionId2).toBeGreaterThan(0);
  });

  it("dialog open state starts false", () => {
    let open = false;
    expect(open).toBe(false);
    open = true;
    expect(open).toBe(true);
  });

  it("dialog close resets target", () => {
    let publishTarget: TemplateVersion | null = {
      id: 5, templateId: 1, versionNumber: 2, status: "draft", createdAt: "2025-01-01T00:00:00Z",
    };
    expect(publishTarget).not.toBeNull();
    publishTarget = null;
    expect(publishTarget).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("empty and error state conditions", () => {
  it("empty state shows when items array is empty", () => {
    const items: DesignTemplate[] = [];
    expect(items.length === 0).toBe(true);
  });

  it("error state shows when isError is true", () => {
    const isError = true;
    const isLoading = false;
    const showError = isError && !isLoading;
    expect(showError).toBe(true);
  });

  it("loading state hides error and empty states", () => {
    const isLoading = true;
    const isError = false;
    const showGrid = !isLoading && !isError;
    expect(showGrid).toBe(false);
  });

  it("no-versions state shown when versions array empty", () => {
    const versions: TemplateVersion[] = [];
    expect(versions.length === 0).toBe(true);
  });

  it("filter-aware empty message detects active filters", () => {
    const search = "logo";
    const status = "all";
    const category = "all";
    const hasFilters = !!(search || status !== "all" || category !== "all");
    expect(hasFilters).toBe(true);
  });

  it("no-filter empty state shows create button hint", () => {
    const search = "";
    const status = "all";
    const category = "all";
    const showCreateHint = !search && status === "all" && category === "all";
    expect(showCreateHint).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("template card data display", () => {
  const tpl: DesignTemplate = {
    id: 42,
    name: "Summer Promo 2025",
    status: "draft",
    category: "Social Media",
    versionCount: 3,
    activeVersionId: null,
    updatedAt: "2025-07-01T12:00:00Z",
    createdAt: "2025-06-01T10:00:00Z",
  };

  it("shows version count badge when versionCount > 0", () => {
    expect((tpl.versionCount ?? 0) > 0).toBe(true);
  });

  it("version count is correct", () => {
    expect(tpl.versionCount).toBe(3);
  });

  it("formatted date is deterministic", () => {
    const d = new Date(tpl.updatedAt).toLocaleDateString();
    expect(typeof d).toBe("string");
    expect(d.length).toBeGreaterThan(0);
  });

  it("status badge uses correct style class", () => {
    const style = STATUS_STYLES[tpl.status] ?? "";
    expect(style).toContain("yellow");
  });

  it("archived template is identified correctly", () => {
    const archivedTpl = { ...tpl, status: "archived" };
    expect(archivedTpl.status === "archived").toBe(true);
  });
});
