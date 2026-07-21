/**
 * nullDesignArtifactRepository.ts — In-memory stub for testing
 * TEAM 02 OWNED — feature/team-02-universal-design-engine
 */
import type { DesignArtifactRepository } from "../ports.js";
import type { DesignArtifactRef } from "../types.js";
import type { RequestContext } from "../../../security/requestContext.js";

export class NullDesignArtifactRepository implements DesignArtifactRepository {
  private counter = 1;

  async attach(
    _ctx: RequestContext,
    _projectId: string,
    _stageKey: string,
    artifactType: string,
    isRevision: boolean,
  ): Promise<DesignArtifactRef> {
    return {
      artifactId: `artifact-${this.counter++}`,
      artifactType,
      version: isRevision ? 2 : 1,
      attachedAt: new Date(),
      isRevision,
    };
  }
}
