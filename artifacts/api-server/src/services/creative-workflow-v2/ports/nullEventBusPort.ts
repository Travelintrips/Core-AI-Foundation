/**
 * nullEventBusPort — No-op EventBusPort for testing.
 *
 * Records all publish calls for assertion in tests.
 *
 * TEAM 1 OWNED — do not modify outside feature/01-creative-workflow.
 */

import type { EventBusPort, EventPublishInput, EventPublishResult } from "../../../types/creative-workflow-v2/ports.js";
import { randomUUID } from "crypto";

export class NullEventBusPort implements EventBusPort {
  private readonly _published: Array<EventPublishInput & { eventId: string }> = [];

  get published(): ReadonlyArray<EventPublishInput & { eventId: string }> {
    return this._published;
  }

  async publish(opts: EventPublishInput): Promise<EventPublishResult> {
    const eventId = randomUUID();
    this._published.push({ ...opts, eventId });
    return { eventId };
  }

  publishSafe(opts: EventPublishInput): void {
    this.publish(opts).catch(() => undefined);
  }
}
