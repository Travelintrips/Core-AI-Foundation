/**
 * nullDesignAuditSink.ts — In-memory stub for testing
 * TEAM 02 OWNED — feature/team-02-universal-design-engine
 */
import type { DesignAuditSink, DesignAuditEntry } from "../ports.js";

export class NullDesignAuditSink implements DesignAuditSink {
  readonly entries: DesignAuditEntry[] = [];

  async record(entry: DesignAuditEntry): Promise<void> {
    this.entries.push(entry);
  }

  clear(): void {
    this.entries.length = 0;
  }
}
