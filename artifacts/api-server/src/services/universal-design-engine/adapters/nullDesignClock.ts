/**
 * nullDesignClock.ts — Fixed-time clock for deterministic tests
 * TEAM 02 OWNED — feature/team-02-universal-design-engine
 */
import type { DesignClock } from "../ports.js";

export class NullDesignClock implements DesignClock {
  private current: Date;

  constructor(fixed?: Date) {
    this.current = fixed ?? new Date("2025-01-01T00:00:00.000Z");
  }

  now(): Date {
    return new Date(this.current);
  }

  /** Advance time by milliseconds for ordering tests */
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}
