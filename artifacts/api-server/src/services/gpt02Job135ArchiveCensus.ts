/**
 * DEV-only owner-controlled cross-archive evidence. Never authorization.
 * The runtime gets counts from a narrowly granted SECURITY DEFINER function,
 * not SELECT access to archived commands, instructions or response bodies.
 */
import {db} from "@workspace/db";
import {sql} from "drizzle-orm";

const deny=(reason:string)=>({
  available:false as const,reason,
  legacyUntaggedAttemptsExcluded:false as const,
  mayCreateCommand:false as const,mayDispatchWorker:false as const,mayCloseJob:false as const,
});

export function interpretGpt02Job135ArchiveCensus(row:Record<string,unknown>|undefined) {
  if(!row||row["parent_present"]!==true)
    return deny("ARCHIVE_PARENT_NOT_VERIFIED");
  const keys=[
    "old_archive_total","legacy_command_total","legacy_response_total",
    "archive_parent_tag_matches","archives_created_after_parent",
    "historical_sources_covered",
  ] as const;
  if(keys.some(k=>typeof row[k]!=="number"||!Number.isSafeInteger(row[k])||
      (row[k] as number)<0) ||
    row["historical_sources_covered"]!==3 ||
    row["legacy_untagged_attempts_excluded"]!==false ||
    row["may_create_command"]!==false ||
    row["may_dispatch_worker"]!==false ||
    row["may_close_job"]!==false ||
    !((row["parent_created_at"] instanceof Date &&
        Number.isFinite(row["parent_created_at"].getTime())) ||
      (typeof row["parent_created_at"]==="string" &&
        !Number.isNaN(Date.parse(row["parent_created_at"])))))
    return deny("ARCHIVE_CENSUS_MALFORMED");
  return {
    available:true as const,
    reason:"EXTERNAL_UNTAGGED_HISTORY_NOT_EXCLUDED" as const,
    legacyArchiveCommands:row["legacy_command_total"] as number,
    priorDevArchiveCommands:row["old_archive_total"] as number,
    legacyArchiveResponses:row["legacy_response_total"] as number,
    explicitParentArchiveMatches:row["archive_parent_tag_matches"] as number,
    archivedAfterParentCount:row["archives_created_after_parent"] as number,
    historicalSourcesCovered:3 as const,
    legacyUntaggedAttemptsExcluded:false as const,
    mayCreateCommand:false as const,mayDispatchWorker:false as const,mayCloseJob:false as const,
  };
}
export async function readGpt02Job135ArchiveCensus() {
  if(process.env["APP_ENV"]!=="development"||process.env["NODE_ENV"]!=="development")
    return deny("DEV_ONLY");
  try {
    const result=await db.execute(sql`SELECT * FROM ai_platform.gpt02_dev_job135_archive_census()`);
    return interpretGpt02Job135ArchiveCensus(result.rows?.[0]);
  } catch {
    return deny("ARCHIVE_CENSUS_READBACK_UNAVAILABLE");
  }
}
