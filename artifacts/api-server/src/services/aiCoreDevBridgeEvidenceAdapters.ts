import type { CyclicHandshake, CyclicResult } from "./aiCoreCyclicHandshakeProtocolService.js";
import type { PairedDeviceAuthorizer, TrustedAndroidResultVerifier } from "./aiCoreCyclicHandshakeCoordinatorService.js";

/**
 * A trusted server-side DB connection must implement this reader.
 * Do not expose it to callers or use an anonymous Supabase API key.
 */
export interface DevBridgeEvidenceReader {
  getJob(jobId: string): Promise<{
    id: string;
    source: string;
    source_session_id: string | null;
    status: string;
    callback_received_at: string | null;
    result_verified_at: string | null;
  } | null>;
  getJobEvents(jobId: string): Promise<readonly {
    event_id: string;
    kind: string;
    sender: string;
  }[]>;
  /** Fresh registry lookup, not an assertion from a request body. */
  isCurrentlyPaired(deviceId: string): Promise<boolean>;
}

function validDevJob(job: NonNullable<Awaited<ReturnType<DevBridgeEvidenceReader["getJob"]>>>, deviceId: string): boolean {
  return job.source === "OPENCLAW" &&
    job.source_session_id === `android-dev:${deviceId}`;
}

export class DevBridgePairingAdapter implements PairedDeviceAuthorizer {
  constructor(private readonly reader: DevBridgeEvidenceReader) {}
  async isAuthorized(handshake: CyclicHandshake): Promise<boolean> {
    if (handshake.environment !== "DEV") return false;
    const job = await this.reader.getJob(handshake.job_id);
    return !!job && validDevJob(job, handshake.device_id) &&
      await this.reader.isCurrentlyPaired(handshake.device_id);
  }
}

export class DevBridgeVerifiedResultAdapter implements TrustedAndroidResultVerifier {
  constructor(private readonly reader: DevBridgeEvidenceReader) {}
  async verify(result: CyclicResult): Promise<boolean> {
    if (result.environment !== "DEV") return false;
    const job = await this.reader.getJob(result.job_id);
    if (!job || !validDevJob(job, result.device_id) ||
        job.status !== "COMPLETED" ||
        !job.callback_received_at || !job.result_verified_at ||
        !(await this.reader.isCurrentlyPaired(result.device_id))) return false;
    const events = await this.reader.getJobEvents(result.job_id);
    const ack = events.filter(event => event.kind === "CALLBACK_ACK");
    const recorded = events.filter(event => event.kind === "RESULT_RECORDED");
    return ack.length === 1 && ack[0]?.sender === "android-dev-database-verifier" &&
      recorded.some(event => event.sender === "openclaw-android-auto-consumer-dev") &&
      result.evidence_refs.includes(ack[0].event_id) &&
      recorded.some(event => result.evidence_refs.includes(event.event_id));
  }
}
