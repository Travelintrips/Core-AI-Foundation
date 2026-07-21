/**
 * nullDesignIdGenerator.ts — Deterministic ID generator for testing
 * TEAM 02 OWNED — feature/team-02-universal-design-engine
 */
import type { DesignIdGenerator } from "../ports.js";

export class NullDesignIdGenerator implements DesignIdGenerator {
  private counter = 1;

  newId(): string {
    return `id-${this.counter++}`;
  }

  eventId(projectId: string, eventType: string, stageKey: string | null, occurredAt: Date): string {
    // Deterministic: same inputs → same output
    const parts = [projectId, eventType, stageKey ?? "", occurredAt.toISOString()].join("|");
    // Simple deterministic hash for tests (not cryptographic)
    let hash = 5381;
    for (let i = 0; i < parts.length; i++) {
      hash = (hash * 33) ^ parts.charCodeAt(i);
    }
    return `evt-${Math.abs(hash >>> 0).toString(16)}`;
  }
}
