/**
 * DEV-only transactional SQLite ledger for Gateway bridge events.
 * Requires one uniquely keyed event and compare-and-swap lifecycle changes.
 * No remote APIs, no browser access, no synthetic ACK generation.
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import path from "node:path";

const KEY = /^[a-f0-9]{64}$/;
const STATUS = new Set([
  "RESERVED", "SUBMITTED", "SUBMISSION_UNKNOWN", "REPLY_VERIFIED",
  "CALLBACK_UNKNOWN", "CALLBACK_ACCEPTED", "FINAL_ACK", "REJECTED",
]);
export class LedgerConflict extends Error {
  constructor(code) { super(code); this.code = code; this.name = "LedgerConflict"; }
}
function invariant(ok, code) { if (!ok) throw new LedgerConflict(code); }
function validRecord(key, payload) {
  invariant(KEY.test(key) && payload && typeof payload === "object" &&
    !Array.isArray(payload) && payload.key === key &&
    typeof payload.status === "string" && STATUS.has(payload.status),
  "INVALID_LEDGER_RECORD");
}
export class DevGatewaySqliteStore {
  constructor(dbPath) {
    invariant(typeof dbPath === "string" && path.isAbsolute(dbPath) &&
      dbPath.endsWith(".sqlite") && !dbPath.includes("\0"),
    "INVALID_DEV_LEDGER_PATH");
    mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(dbPath, { timeout: 5000 });
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA synchronous = FULL");
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.db.exec("CREATE TABLE IF NOT EXISTS gateway_events (" +
      "key TEXT PRIMARY KEY NOT NULL, status TEXT NOT NULL, " +
      "payload TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, " +
      "updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
    try { chmodSync(dbPath, 0o600); } catch { /* Windows ACL enforced separately */ }
    this.insert = this.db.prepare(
      "INSERT OR IGNORE INTO gateway_events(key,status,payload,version) VALUES(?,?,?,1)");
    this.select = this.db.prepare(
      "SELECT status,payload,version FROM gateway_events WHERE key=?");
    this.update = this.db.prepare(
      "UPDATE gateway_events SET status=?,payload=?,version=version+1,updated_at=CURRENT_TIMESTAMP " +
      "WHERE key=? AND status=? AND version=?");
  }
  close() { this.db.close(); }
  _atomically(callback) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = callback();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  async reserve(key, record) {
    validRecord(key, record);
    invariant(record.status === "RESERVED", "LEDGER_RESERVATION_INVALID");
    return this._atomically(() => {
      const inserted = this.insert.run(key, record.status, JSON.stringify(record));
      const existing = this.select.get(key);
      invariant(existing && existing.payload, "LEDGER_READBACK_FAILED");
      const parsed = JSON.parse(existing.payload);
      validRecord(key, parsed);
      invariant(existing.status === parsed.status, "LEDGER_DATA_DIVERGENCE");
      return { created: inserted.changes === 1, record: parsed };
    });
  }
  async read(key) {
    invariant(typeof key === "string" && KEY.test(key), "INVALID_EVENT_KEY");
    const row = this.select.get(key);
    invariant(row && row.payload, "LEDGER_RECORD_MISSING");
    const parsed = JSON.parse(row.payload);
    validRecord(key, parsed);
    invariant(row.status === parsed.status, "LEDGER_DATA_DIVERGENCE");
    return parsed;
  }
  async transition(key, from, to, patch = {}) {
    invariant(typeof key === "string" && KEY.test(key) &&
      STATUS.has(from) && STATUS.has(to) &&
      patch && typeof patch === "object" && !Array.isArray(patch) &&
      !Object.hasOwn(patch, "status") && !Object.hasOwn(patch, "key"),
    "INVALID_LEDGER_TRANSITION");
    return this._atomically(() => {
      const previous = this.select.get(key);
      invariant(previous && previous.status === from, "LEDGER_STATE_CHANGED");
      const record = JSON.parse(previous.payload);
      validRecord(key, record);
      invariant(record.status === from, "LEDGER_DATA_DIVERGENCE");
      const next = { ...record, ...patch, status: to };
      validRecord(key, next);
      const changed = this.update.run(to, JSON.stringify(next), key, from, previous.version);
      invariant(changed.changes === 1, "LEDGER_CAS_FAILED");
      return next;
    });
  }
}
