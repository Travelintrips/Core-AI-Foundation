/**
 * nullDesignProjectRepository.ts — In-memory stub for testing
 * TEAM 02 OWNED — feature/team-02-universal-design-engine
 */
import type { DesignProjectRepository } from "../ports.js";
import type { DesignProjectSession } from "../types.js";
import type { RequestContext } from "../../../security/requestContext.js";

export class NullDesignProjectRepository implements DesignProjectRepository {
  private readonly store = new Map<string, DesignProjectSession>();

  async findById(_ctx: RequestContext, projectId: string): Promise<DesignProjectSession | undefined> {
    const stored = this.store.get(projectId);
    if (!stored) return undefined;
    // Deep-clone processedIdempotencyKeys so tests don't share state
    return {
      ...stored,
      processedIdempotencyKeys: new Set(stored.processedIdempotencyKeys),
    };
  }

  async save(_ctx: RequestContext, session: DesignProjectSession): Promise<void> {
    this.store.set(session.projectId, {
      ...session,
      processedIdempotencyKeys: new Set(session.processedIdempotencyKeys),
    });
  }

  /** Test helper — seed a session directly */
  seed(session: DesignProjectSession): void {
    this.store.set(session.projectId, {
      ...session,
      processedIdempotencyKeys: new Set(session.processedIdempotencyKeys),
    });
  }

  clear(): void {
    this.store.clear();
  }
}
