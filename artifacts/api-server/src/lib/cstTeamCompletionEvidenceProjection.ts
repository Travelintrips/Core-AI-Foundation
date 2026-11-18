/** Exact, read-only CST-DEV model completion evidence projection.
 * No signer, worker dispatch, role mutation or live event creation.
 * Persisted event is NOT delivered/subscribed; audit is NOT a QA Final ACK.
 */
export type CompletionJobRow = {
  id: number;
  job_code: string;
  status: string;
  job_type: string;
  request_id: string | null;
  model_id: string | null;
  has_result: boolean;
};
export type CompletionJobAuditRow = {
  resource_id: string | null;
  worker_id: string | null;
};
export type CompletionWorkerRow = {
  id: number;
  worker_name: string;
  provider_slug: string | null;
  runtime_kind: string | null;
  model_id: string | null;
};
export type CompletionEventRow = {
  event_id: string;
  event_type: string;
  source_module: string;
  source_id: string | null;
  status: string;
  correlation_id: string;
  payload_job_id: string | null;
  payload_worker_id: string | null;
  payload_job_code: string | null;
  payload_job_type: string | null;
};
export type CompletionEventAuditRow = {
  resource_id: string | null;
  correlation_id: string | null;
  event_type: string | null;
  source_module: string | null;
};
export type CompletionEvidence = {
  mode: "CST_DEV_READ_ONLY_PERSISTENCE_NOT_DELIVERY";
  jobId: number;
  status: "blocked" | "job_not_completed" | "completed_event_missing" |
    "event_binding_invalid" | "event_audit_missing" |
    "event_and_audit_persisted";
  jobCompleted: boolean;
  jobAuditBound: boolean;
  eventPersisted: boolean;
  eventAuditPersisted: boolean;
  subscriberDeliveryVerified: false;
  independentQaVerified: false;
  cryptographicAttestationVerified: false;
  finalAckVerified: false;
  blockers: string[];
};
export function projectCstModelCompletionEvidence(input: {
  job: CompletionJobRow | null;
  jobAudits: CompletionJobAuditRow[];
  worker: CompletionWorkerRow | null;
  events: CompletionEventRow[];
  eventAudits: CompletionEventAuditRow[];
}): CompletionEvidence {
  const { job, jobAudits, worker, events, eventAudits } = input;
  const jobId = job?.id ?? 0;
  const base = {
    mode: "CST_DEV_READ_ONLY_PERSISTENCE_NOT_DELIVERY" as const,
    jobId, subscriberDeliveryVerified: false as const,
    independentQaVerified: false as const,
    cryptographicAttestationVerified: false as const,
    finalAckVerified: false as const,
  };
  const sourceBound = Boolean(job && Number.isSafeInteger(job.id) && job.id > 0 &&
    job.job_type === "ollama_model_invocation" &&
    /^cst-ai-team-company1-dev:pilot-[a-f0-9]{20}$/.test(job.request_id ?? "") &&
    job.model_id === "qwen2.5:3b" && typeof job.job_code === "string" &&
    job.job_code.length > 0 && worker && worker.worker_name.startsWith("cst-dev-dell-onejob-") &&
    worker.provider_slug === "ollama" &&
    worker.runtime_kind === "ollama_remote_pull" &&
    worker.model_id === job.model_id &&
    jobAudits.length === 1 && jobAudits[0].resource_id === String(job.id) &&
    jobAudits[0].worker_id === String(worker.id));
  if (!sourceBound) return { ...base, status: "blocked",
    jobCompleted: false, jobAuditBound: false, eventPersisted: false,
    eventAuditPersisted: false, blockers: ["JOB_OR_WORKER_IDENTITY_NOT_VERIFIED"] };
  const completed = job!.status === "completed" && job!.has_result === true;
  if (!completed) return { ...base, status: "job_not_completed",
    jobCompleted: false, jobAuditBound: true, eventPersisted: false,
    eventAuditPersisted: false, blockers: ["MODEL_JOB_NOT_COMPLETED"] };
  if (events.length === 0) return { ...base, status: "completed_event_missing",
    jobCompleted: true, jobAuditBound: true, eventPersisted: false,
    eventAuditPersisted: false, blockers: ["JOB_COMPLETION_EVENT_MISSING"] };
  const ev = events[0];
  const eventBound = events.length === 1 && Boolean(ev) &&
    ev.event_type === "job.completed" && ev.source_module === "job-engine" &&
    ev.source_id === String(job!.id) &&
    ["published", "processed"].includes(ev.status) &&
    ev.payload_job_id === String(job!.id) &&
    ev.payload_worker_id === String(worker!.id) &&
    ev.payload_job_code === job!.job_code &&
    ev.payload_job_type === job!.job_type &&
    typeof ev.event_id === "string" && ev.event_id.length > 0 &&
    typeof ev.correlation_id === "string" && ev.correlation_id.length > 0;
  if (!eventBound) return { ...base, status: "event_binding_invalid",
    jobCompleted: true, jobAuditBound: true, eventPersisted: false,
    eventAuditPersisted: false, blockers: ["EVENT_JOB_WORKER_OR_CARDINALITY_MISMATCH"] };
  const audit = eventAudits[0];
  const auditBound = eventAudits.length === 1 && Boolean(audit) &&
    audit.resource_id === ev.event_id && audit.correlation_id === ev.correlation_id &&
    audit.event_type === "job.completed" && audit.source_module === "job-engine";
  if (!auditBound) return { ...base, status: "event_audit_missing",
    jobCompleted: true, jobAuditBound: true, eventPersisted: true,
    eventAuditPersisted: false, blockers: ["COMPLETION_EVENT_AUDIT_MISSING"] };
  return { ...base, status: "event_and_audit_persisted",
    jobCompleted: true, jobAuditBound: true, eventPersisted: true,
    eventAuditPersisted: true,
    blockers: ["SUBSCRIBER_DELIVERY_NOT_VERIFIED", "INDEPENDENT_QA_FINAL_ACK_NOT_VERIFIED"] };
}
