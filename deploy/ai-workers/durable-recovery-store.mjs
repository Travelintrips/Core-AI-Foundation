import { DatabaseSync } from "node:sqlite";

export class DurableRecoveryStore {
  constructor(path) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS recovery_state (
        command_id TEXT PRIMARY KEY,
        checkpoint_sha TEXT NOT NULL,
        resume_attempts INTEGER NOT NULL DEFAULT 0,
        approval_pending INTEGER NOT NULL DEFAULT 0,
        lease_owner TEXT,
        lease_expires_at INTEGER,
        completed INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  checkpoint(commandId, checkpointSha, { approvalPending = false } = {}) {
    if (!commandId || !checkpointSha) throw new Error("commandId and checkpointSha are required");
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO recovery_state(command_id, checkpoint_sha, approval_pending, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(command_id) DO UPDATE SET
        checkpoint_sha=excluded.checkpoint_sha,
        approval_pending=excluded.approval_pending,
        updated_at=excluded.updated_at
      WHERE recovery_state.completed=0
    `).run(String(commandId), String(checkpointSha), approvalPending ? 1 : 0, now);
    return this.get(commandId);
  }

  get(commandId) {
    const row = this.db.prepare("SELECT * FROM recovery_state WHERE command_id = ?").get(String(commandId));
    if (!row) return null;
    return {
      commandId: row.command_id,
      checkpointSha: row.checkpoint_sha,
      resumeAttempts: Number(row.resume_attempts),
      approvalPending: Boolean(row.approval_pending),
      completed: Boolean(row.completed),
      leaseOwner: row.lease_owner || null,
      leaseExpiresAt: row.lease_expires_at == null ? null : Number(row.lease_expires_at),
    };
  }

  claimResume(commandId, owner, leaseMs = 120000) {
    const now = Date.now();
    const expires = now + Math.max(1000, Number(leaseMs) || 120000);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db.prepare("SELECT * FROM recovery_state WHERE command_id = ?").get(String(commandId));
      if (!row || row.completed || row.approval_pending || !row.checkpoint_sha) {
        this.db.exec("ROLLBACK");
        return null;
      }
      if (row.lease_owner && Number(row.lease_expires_at || 0) > now) {
        this.db.exec("ROLLBACK");
        return null;
      }
      const result = this.db.prepare(`
        UPDATE recovery_state
        SET lease_owner=?, lease_expires_at=?, resume_attempts=resume_attempts+1, updated_at=?
        WHERE command_id=? AND completed=0
          AND (lease_owner IS NULL OR lease_expires_at IS NULL OR lease_expires_at <= ?)
      `).run(String(owner), expires, now, String(commandId), now);
      if (Number(result.changes || 0) !== 1) {
        this.db.exec("ROLLBACK");
        return null;
      }
      this.db.exec("COMMIT");
      return this.get(commandId);
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch {}
      throw error;
    }
  }

  complete(commandId, owner) {
    const result = this.db.prepare(`
      UPDATE recovery_state SET completed=1, lease_owner=NULL, lease_expires_at=NULL, updated_at=?
      WHERE command_id=? AND lease_owner=? AND completed=0
    `).run(Date.now(), String(commandId), String(owner));
    return Number(result.changes || 0) === 1;
  }

  close() { this.db.close(); }
}
