/** DEV-only durable callback receipt ledger. No HTTP handler, no outbound sends. */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { BridgeViolation } from "./dev-gpt02-gateway-bridge.mjs";

const fail = code => { throw new BridgeViolation(code); };
const hex64 = /^[a-f0-9]{64}$/;
const sha = value => createHash("sha256").update(value).digest("hex");
export class DevGatewayCallbackLedger {
  constructor(filename) {
    if (!path.isAbsolute(filename ?? "") || !filename.endsWith(".sqlite") || filename.includes("\0"))
      fail("GATEWAY_CALLBACK_LEDGER_PATH_INVALID");
    mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(filename, { timeout: 5000 });
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000");
    this.db.exec("CREATE TABLE IF NOT EXISTS gateway_callback_receipts (event_id TEXT PRIMARY KEY, command_id TEXT NOT NULL, digest TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP)");
    this.insert = this.db.prepare("INSERT OR IGNORE INTO gateway_callback_receipts(event_id,command_id,digest,payload) VALUES(?,?,?,?)");
    this.read = this.db.prepare("SELECT command_id,digest,payload FROM gateway_callback_receipts WHERE event_id=?");
    try { chmodSync(filename, 0o600); } catch { /* Windows handles ACL separately */ }
  }
  close() { this.db.close(); }
  async acceptVerifiedEvidence(evidence, receipt) {
    if (evidence?.verified !== true || evidence.transport !== "openclaw-gateway" ||
        !hex64.test(evidence.eventId ?? "") || receipt?.eventId !== evidence.eventId ||
        receipt.commandId !== evidence.commandId || receipt.runId !== evidence.runId ||
        receipt.sessionKey !== evidence.sessionKey ||
        receipt.signature == null || typeof receipt.signature !== "string" ||
        typeof receipt.assistantResponseHash !== "string" ||
        typeof evidence.signingKeyId !== "string")
      fail("GATEWAY_LEDGER_EVIDENCE_INVALID");
    const value = {
      eventId: evidence.eventId, commandId: evidence.commandId,
      runId: evidence.runId, sessionKey: evidence.sessionKey,
      assistantResponseHash: receipt.assistantResponseHash,
      signingKeyId: evidence.signingKeyId, attestationVerified: true,
    };
    // Include complete immutable receipt fingerprint (not just its response).
    const digest = sha(JSON.stringify(receipt));
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.insert.run(value.eventId, value.commandId, digest, JSON.stringify(value));
      const row = this.read.get(value.eventId);
      if (!row || row.command_id !== value.commandId || row.digest !== digest)
        fail("GATEWAY_CALLBACK_REPLAY_CONFLICT");
      const stored = JSON.parse(row.payload);
      if (Object.keys(value).some(k => stored[k] !== value[k])) fail("GATEWAY_CALLBACK_ROW_DIVERGED");
      this.db.exec("COMMIT");
      return stored;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }
  // This ledger intentionally cannot create Final ACKs. AI Core must commit
  // those separately using its authenticated server transaction.
  async readFinalAck() { return null; }
}
