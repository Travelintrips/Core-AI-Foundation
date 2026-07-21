/**
 * nullDesignWorkflowResolver.ts — In-memory stub for testing
 * TEAM 02 OWNED — feature/team-02-universal-design-engine
 */
import type { DesignWorkflowResolver } from "../ports.js";
import type { DesignWorkflowDefinition } from "../types.js";

export class NullDesignWorkflowResolver implements DesignWorkflowResolver {
  private readonly registry = new Map<string, DesignWorkflowDefinition>();

  register(def: DesignWorkflowDefinition): void {
    this.registry.set(`${def.workflowId}@${def.version}`, def);
  }

  async resolve(workflowId: string, version: string): Promise<DesignWorkflowDefinition | undefined> {
    return this.registry.get(`${workflowId}@${version}`);
  }
}
