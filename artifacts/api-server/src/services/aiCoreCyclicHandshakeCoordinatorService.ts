import {
  cyclicHandshakeSchema, cyclicResultSchema, canContinueCycle, planRoutineSop,
  type CyclicHandshake, type CyclicResult,
} from "./aiCoreCyclicHandshakeProtocolService.js";

/** Persist all session transitions transactionally; no in-memory fallback. */
export interface CyclicSessionStore {
  get(sessionId: string): Promise<{ handshake: CyclicHandshake; result: CyclicResult | null } | null>;
  insertHandshakeOnce(handshake: CyclicHandshake): Promise<"inserted" | "duplicate" | "conflict">;
  attachVerifiedResultOnce(result: CyclicResult): Promise<"inserted" | "duplicate" | "conflict">;
}
export interface TrustedAndroidResultVerifier {
  /** Must verify signed bridge receipt, device pairing, job scope and durable callback/ACK. */
  verify(result: CyclicResult): Promise<boolean>;
}
export interface PairedDeviceAuthorizer {
  /** Must check fresh pairing, DEV environment and assigned job ownership. */
  isAuthorized(handshake: CyclicHandshake): Promise<boolean>;
}

/** Server-side cycle coordinator. Never trusts client claims of VERIFIED or ACK. */
export class AiCoreCyclicHandshakeCoordinator {
  constructor(
    private readonly store: CyclicSessionStore,
    private readonly pairing: PairedDeviceAuthorizer,
    private readonly verifier: TrustedAndroidResultVerifier,
  ) {}

  async handshake(input: unknown) {
    const request = cyclicHandshakeSchema.parse(input);
    if (!(await this.pairing.isAuthorized(request))) {
      return { accepted: false, reason: "device_or_job_not_authorized" } as const;
    }
    const existing = await this.store.get(request.session_id);
    if (existing && (existing.handshake.job_id !== request.job_id ||
        existing.handshake.device_id !== request.device_id)) {
      return { accepted: false, reason: "session_binding_conflict" } as const;
    }
    const saved = await this.store.insertHandshakeOnce(request);
    if (saved === "conflict") return { accepted: false, reason: "event_conflict" } as const;
    return { accepted: true, reason: saved, sop: planRoutineSop(request) } as const;
  }

  async receiveVerifiedResult(input: unknown) {
    const result = cyclicResultSchema.parse(input);
    const existing = await this.store.get(result.session_id);
    if (!existing || existing.handshake.job_id !== result.job_id ||
        existing.handshake.device_id !== result.device_id) {
      return { accepted: false, reason: "unknown_or_mismatched_session" } as const;
    }
    if (result.receipt_status !== "VERIFIED" || !result.callback_verified ||
        !result.ack_verified || result.evidence_refs.length === 0) {
      return { accepted: false, reason: "unverified_receipt" } as const;
    }
    if (!(await this.verifier.verify(result))) {
      return { accepted: false, reason: "trusted_verification_failed" } as const;
    }
    const saved = await this.store.attachVerifiedResultOnce(result);
    return { accepted: saved !== "conflict", reason: saved } as const;
  }

  async continue(input: unknown) {
    const request = cyclicHandshakeSchema.parse(input);
    const stored = await this.store.get(request.session_id);
    if (!stored?.result || !canContinueCycle(request, stored.result) ||
        stored.handshake.job_id !== request.job_id ||
        stored.handshake.device_id !== request.device_id) {
      return { continued: false, reason: "verified_result_and_ack_required" } as const;
    }
    if (!(await this.pairing.isAuthorized(request))) {
      return { continued: false, reason: "device_or_job_not_authorized" } as const;
    }
    return { continued: true, sop: planRoutineSop(request), next: "await_authorized_job" } as const;
  }
}
