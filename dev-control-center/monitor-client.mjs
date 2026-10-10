/**
 * Authenticated DEV dashboard read adapter.
 * Never stores tokens, never uses production API fallback.
 * Backend must expose /api/dev-center behind established same-origin session auth.
 */
export const VALID_JOB_STATES = Object.freeze(["QUEUED","WAITING_FOR_WORKER","RUNNING","BLOCKED","FAILED","COMPLETED","CANCELLED"]);
export function normalizeJobs(payload) {
 if (!payload || !Array.isArray(payload.jobs)) throw new Error("INVALID_JOBS_RESPONSE");
 return payload.jobs.slice(0,50).filter(j=>j && typeof j.id==="string" && VALID_JOB_STATES.includes(j.status))
 .map(j=>({id:j.id,application:String(j.application||"Unknown").slice(0,100),status:j.status,updatedAt:j.updatedAt||null}));
}
export async function readCodingJobs(fetchImpl=fetch) {
 const response=await fetchImpl("/api/dev-center/jobs",{
   method:"GET",credentials:"same-origin",cache:"no-store",headers:{"Accept":"application/json"}
 });
 if (response.status===401 || response.status===403) throw new Error("AUTH_REQUIRED");
 if (!response.ok) throw new Error("MONITOR_UNAVAILABLE");
 return normalizeJobs(await response.json());
}
export function canOperate({principal,job,operation}) {
 if (!principal || !Array.isArray(principal.roles) || !principal.roles.includes("dev.control")) return false;
 if (!job || !VALID_JOB_STATES.includes(job.status)) return false;
 if (operation==="stop") return ["QUEUED","WAITING_FOR_WORKER","RUNNING"].includes(job.status);
 if (operation==="retry") return ["FAILED","BLOCKED"].includes(job.status);
 if (operation==="restart") return ["COMPLETED","CANCELLED"].includes(job.status);
 return false;
}
