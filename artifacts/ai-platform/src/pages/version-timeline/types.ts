/**
 * Team 15 — Version Timeline local adapter types.
 *
 * INTEGRATION NOTE: These types form a narrow adapter boundary.
 * When Team 09's canonical version history contract becomes available,
 * replace the `adaptProjectVersion` / `adaptTemplateVersion` functions in
 * utils.ts with Team 09's resolver — this file should not need to change.
 *
 * Team 16: `status` on VersionTimelineEntry carries the review status string.
 * Team 18: `branchLabel` can hold annotation-version compatibility badges.
 * Team 11: use `VersionSelection` to propagate the chosen version outward.
 */

export type VersionSource =
  | "design_project"
  | "design_template"
  | "manual"
  | "ai_generated"
  | "restore"
  | "unknown";

export type VersionAvailability = "available" | "unavailable" | "deprecated" | "deleted";

export type ResourceType = "project" | "template";

export interface VersionActor {
  id?: string;
  displayName: string;
  role?: string;
}

export interface VersionChangeSummary {
  elementCount?: number;
  changelog?: string;
  /** Short human-readable label (e.g. "Restored v3", "Initial draft") */
  label?: string;
}

export interface VersionTimelineEntry {
  id: number;
  resourceId: number;
  resourceType: ResourceType;
  versionNumber: number;
  /** True when this is the currently active / published version. */
  isCurrent: boolean;
  source: VersionSource;
  actor: VersionActor;
  changeSummary: VersionChangeSummary;
  /** Raw status string from the underlying resource (e.g. "draft", "published", "saved"). */
  status: string;
  availability: VersionAvailability;
  createdAt: string;
  publishedAt?: string | null;
  /** Branch or variation label when the contract supports it. */
  branchLabel?: string | null;
}

export interface VersionSelection {
  entry: VersionTimelineEntry;
}

export interface VersionComparisonRequest {
  resourceId: number;
  resourceType: ResourceType;
  baseVersionId: number;
  targetVersionId: number;
}

export interface VersionRestoreRequest {
  resourceId: number;
  resourceType: ResourceType;
  versionId: number;
  /** Optimistic concurrency guard: version number at the moment the user initiated restore. */
  expectedVersionNumber: number;
}
