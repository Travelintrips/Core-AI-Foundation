/**
 * Team 15 — Version Timeline pure utility functions.
 * All functions here are side-effect-free and unit-testable.
 *
 * INTEGRATION NOTE: `adaptProjectVersion` and `adaptTemplateVersion` are the
 * Team 09 integration points. Replace them with Team 09's canonical resolver
 * once that contract stabilises — the rest of this file stays unchanged.
 */

import type {
  VersionTimelineEntry,
  VersionComparisonRequest,
  ResourceType,
  VersionAvailability,
  VersionSource,
} from "./types";

// ── Raw API shapes (what the existing endpoints return) ───────────────────────

export interface RawProjectVersion {
  id: number;
  projectId: number;
  versionNumber: number;
  label?: string | null;
  elementCount: number;
  createdAt: string;
}

export interface RawTemplateVersion {
  id: number;
  templateId: number;
  versionNumber: number;
  status: string;
  changelog?: string | null;
  createdBy?: string | null;
  createdAt: string;
  publishedAt?: string | null;
}

// ── Adapters (Team 09 integration boundary) ───────────────────────────────────

/** Derive availability from a template status string. */
function templateAvailability(status: string): VersionAvailability {
  if (status === "archived") return "deprecated";
  if (status === "deleted") return "deleted";
  return "available";
}

/** Derive version source from a project version label. */
function projectSource(label?: string | null): VersionSource {
  if (!label) return "design_project";
  if (label.toLowerCase().startsWith("restored")) return "restore";
  if (label.toLowerCase().includes("ai")) return "ai_generated";
  return "manual";
}

export function adaptProjectVersion(
  v: RawProjectVersion,
  currentVersionId?: number,
): VersionTimelineEntry {
  return {
    id: v.id,
    resourceId: v.projectId,
    resourceType: "project" as ResourceType,
    versionNumber: v.versionNumber,
    isCurrent:
      currentVersionId !== undefined
        ? v.id === currentVersionId
        : false,
    source: projectSource(v.label),
    actor: { displayName: "System" },
    changeSummary: {
      elementCount: v.elementCount,
      label: v.label ?? undefined,
    },
    status: "saved",
    availability: "available",
    createdAt: v.createdAt,
    branchLabel: null,
  };
}

export function adaptTemplateVersion(
  v: RawTemplateVersion,
  activeVersionId?: number,
): VersionTimelineEntry {
  return {
    id: v.id,
    resourceId: v.templateId,
    resourceType: "template" as ResourceType,
    versionNumber: v.versionNumber,
    isCurrent:
      activeVersionId !== undefined
        ? v.id === activeVersionId
        : v.status === "published",
    source: "manual" as VersionSource,
    actor: { displayName: v.createdBy ?? "Unknown" },
    changeSummary: {
      changelog: v.changelog ?? undefined,
    },
    status: v.status,
    availability: templateAvailability(v.status),
    createdAt: v.createdAt,
    publishedAt: v.publishedAt,
    branchLabel: null,
  };
}

// ── Sorting ───────────────────────────────────────────────────────────────────

/** Sort entries newest-first (descending by createdAt, then by versionNumber). */
export function sortVersionsChronological(
  entries: VersionTimelineEntry[],
): VersionTimelineEntry[] {
  return [...entries].sort((a, b) => {
    const timeDiff =
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    if (timeDiff !== 0) return timeDiff;
    return b.versionNumber - a.versionNumber;
  });
}

// ── Pagination ────────────────────────────────────────────────────────────────

export const PAGE_SIZE = 10;

export function paginateEntries(
  entries: VersionTimelineEntry[],
  page: number,
  pageSize: number = PAGE_SIZE,
): VersionTimelineEntry[] {
  const start = (page - 1) * pageSize;
  return entries.slice(start, start + pageSize);
}

export function totalPages(total: number, pageSize: number = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

// ── Comparison validation ─────────────────────────────────────────────────────

export type ComparisonValidationResult =
  | { ok: true; request: VersionComparisonRequest }
  | { ok: false; error: string };

export function validateComparisonRequest(
  a: VersionTimelineEntry | null,
  b: VersionTimelineEntry | null,
): ComparisonValidationResult {
  if (!a || !b) {
    return { ok: false, error: "Select exactly two versions to compare." };
  }
  if (a.id === b.id) {
    return { ok: false, error: "Cannot compare a version with itself. Select two different versions." };
  }
  if (a.resourceId !== b.resourceId || a.resourceType !== b.resourceType) {
    return { ok: false, error: "Both versions must belong to the same resource." };
  }
  // Put the older version as base (lower version number)
  const [base, target] =
    a.versionNumber < b.versionNumber ? [a, b] : [b, a];
  return {
    ok: true,
    request: {
      resourceId: base.resourceId,
      resourceType: base.resourceType,
      baseVersionId: base.id,
      targetVersionId: target.id,
    },
  };
}

// ── Restore guard ─────────────────────────────────────────────────────────────

/** Returns true only when restore is permitted for this resource type and entry. */
export function canRestore(
  entry: VersionTimelineEntry,
  hasPermission: boolean,
): boolean {
  if (!hasPermission) return false;
  if (entry.isCurrent) return false; // already current
  if (entry.availability !== "available") return false;
  return entry.resourceType === "project"; // only project restore is wired to an endpoint
}

// ── Formatting ────────────────────────────────────────────────────────────────

export function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

export function formatTimestampReadable(iso: string): string {
  // Screenreader-friendly: "July 21, 2026 at 10:30 AM"
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "long",
    timeStyle: "short",
  }).format(d);
}

// ── Availability label ────────────────────────────────────────────────────────

export function availabilityLabel(availability: VersionAvailability): string {
  switch (availability) {
    case "deprecated": return "Deprecated";
    case "deleted": return "Deleted";
    case "unavailable": return "Unavailable";
    default: return "";
  }
}
