/**
 * nullDesignExecutionDispatcher.ts — In-memory stub for testing
 * TEAM 02 OWNED — feature/team-02-universal-design-engine
 */
import type { DesignExecutionDispatcher, DesignDispatchInput } from "../ports.js";
import type { RequestContext } from "../../../security/requestContext.js";

export class NullDesignExecutionDispatcher implements DesignExecutionDispatcher {
  readonly dispatched: DesignDispatchInput[] = [];
  private jobCounter = 1;

  async dispatch(_ctx: RequestContext, input: DesignDispatchInput): Promise<string> {
    this.dispatched.push(input);
    return `job-${this.jobCounter++}`;
  }

  clear(): void {
    this.dispatched.length = 0;
  }
}
