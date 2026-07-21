/**
 * nullDesignEventPublisher.ts — In-memory stub for testing
 * TEAM 02 OWNED — feature/team-02-universal-design-engine
 */
import type { DesignEventPublisher } from "../ports.js";
import type { DesignEvent } from "../types.js";
import type { RequestContext } from "../../../security/requestContext.js";

export class NullDesignEventPublisher implements DesignEventPublisher {
  readonly published: DesignEvent[] = [];

  async publish(_ctx: RequestContext, events: DesignEvent[]): Promise<void> {
    this.published.push(...events);
  }

  clear(): void {
    this.published.length = 0;
  }
}
