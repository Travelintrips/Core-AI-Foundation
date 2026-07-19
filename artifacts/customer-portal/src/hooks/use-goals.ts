/**
 * React Query hooks for Goal-Based Discovery — Team 03
 */

import { useQuery } from "@tanstack/react-query";
import { fetchGoals, fetchGoalDetail } from "@/lib/goalDiscoveryApi";
import type { GoalSummary, GoalDetail } from "@/lib/goalDiscoveryApi";

export type { GoalSummary, GoalDetail };

/** Fetch all available goals (goal browse page). */
export function useGoals() {
  return useQuery<GoalSummary[], Error>({
    queryKey: ["goals"],
    queryFn: ({ signal }) => fetchGoals(signal),
    staleTime: 5 * 60 * 1000, // 5 min — goals rarely change
  });
}

/** Fetch a single goal with its eligible services (goal detail page). */
export function useGoalDetail(slug: string | undefined) {
  return useQuery<GoalDetail | null, Error>({
    enabled: Boolean(slug),
    queryKey: ["goals", slug],
    queryFn: ({ signal }) => fetchGoalDetail(slug!, signal),
    staleTime: 5 * 60 * 1000,
  });
}
