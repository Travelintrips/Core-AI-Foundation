/**
 * historyAdapter.ts — Customer-safe project history (canonical event feed).
 *
 * Reads canonical events via the existing canonicalEventService, filters to
 * customer-safe events, and maps them to the CWHistoryEvent DTO.
 * IDOR: caller must pass in a project already verified to belong to clientEmail.
 *
 * getEventsForProject(projectId: string, internalProjectId: number) — second
 * arg is the integer PK, not a limit object. Limit applied after fetch.
 */
import {
  getEventsForProject,
  filterForActivityFeed,
} from "../canonicalEventService.js";
import type { ProjectHistory, CWHistoryEvent } from "./types.js";

const SEVERITY_MAP: Record<string, CWHistoryEvent["severity"]> = {
  info:    "info",
  success: "success",
  warning: "warning",
  error:   "error",
  debug:   "info",
};

export async function getProjectHistory(
  projectId: string,       // text UUID — creative_projects.project_id
  projectNumber: string,
  internalProjectId: number, // creative_projects.id (integer PK) — required by getEventsForProject
  limitParam?: number,
): Promise<ProjectHistory> {
  const limit = Math.min(limitParam ?? 50, 100);

  let allEvents = await getEventsForProject(projectId, internalProjectId);
  const customerEvents = filterForActivityFeed(allEvents).slice(0, limit);

  const events: CWHistoryEvent[] = customerEvents.map((e) => ({
    id:        e.eventId,
    eventType: e.eventType,
    title:     e.publicMessage ?? e.eventType.replace(/_/g, " "),
    message:   e.publicMessage ?? "",
    severity:  SEVERITY_MAP[e.severity ?? "info"] ?? "info",
    createdAt: String(e.createdAt),
  }));

  return {
    projectNumber,
    events,
    total: events.length,
  };
}
