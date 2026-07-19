/**
 * React Query hooks for Discovery Experience — Team 03
 *
 * Goals (Team 02) and Solution Collections (Team 04).
 *
 * Navigation contract: service.serviceId → /services/${serviceId}
 * serviceCode is metadata only, never used for routing.
 */

import { useQuery } from "@tanstack/react-query";
import {
  fetchGoals,
  fetchGoalDetail,
  fetchCollections,
  fetchCollectionDetail,
} from "@/lib/discoveryApi";
import type {
  GoalSummary,
  GoalDetail,
  CollectionSummary,
  CollectionDetail,
} from "@/lib/discoveryApi";

export type { GoalSummary, GoalDetail, CollectionSummary, CollectionDetail };

// ── Goal hooks ────────────────────────────────────────────────────────────────

/** Fetch all active goals for the goals browse page. */
export function useGoals() {
  return useQuery<GoalSummary[], Error>({
    queryKey: ["goals"],
    queryFn: ({ signal }) => fetchGoals(signal),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Fetch a single goal with its commercially eligible services.
 * Disabled when slug is undefined.
 */
export function useGoalDetail(slug: string | undefined) {
  return useQuery<GoalDetail | null, Error>({
    enabled: Boolean(slug),
    queryKey: ["goals", slug],
    queryFn: ({ signal }) => fetchGoalDetail(slug!, signal),
    staleTime: 5 * 60 * 1000,
  });
}

// ── Collection hooks (Team 04) ─────────────────────────────────────────────────

/** Fetch all public active solution collections. */
export function useCollections() {
  return useQuery<CollectionSummary[], Error>({
    queryKey: ["solution-collections"],
    queryFn: ({ signal }) => fetchCollections(signal),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Fetch a single public solution collection with its eligible services.
 * Disabled when slug is undefined.
 */
export function useCollectionDetail(slug: string | undefined) {
  return useQuery<CollectionDetail | null, Error>({
    enabled: Boolean(slug),
    queryKey: ["solution-collections", slug],
    queryFn: ({ signal }) => fetchCollectionDetail(slug!, signal),
    staleTime: 5 * 60 * 1000,
  });
}
