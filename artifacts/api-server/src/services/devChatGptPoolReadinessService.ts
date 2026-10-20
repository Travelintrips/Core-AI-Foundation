/**
 * Redacted, informational GPT account readiness for the AI Task dashboard.
 * Neither configured bindings nor OpenClaw presence prove an authenticated
 * ChatGPT session. This service NEVER grants a claim or dispatches a browser.
 */
import type { DevWakeRuntimeConfig } from "./devChatGptWakeBindingService.js";

export type DevGptReadiness = {
  alias: "GPT02" | "GPT03";
  state: "NOT_CONFIGURED" | "DISABLED" | "CONFIGURED_UNVERIFIED";
  executor: "DELL" | "OTHER_UNVERIFIED" | null;
  executorOnline: boolean;
  dispatchReady: false;
  reason: string;
};

export function describeDevGptReadiness(
  config: Pick<DevWakeRuntimeConfig, "enabled" | "bindings" | "bindingConfigInvalid"> | null,
  eligibleExecutorIds: ReadonlySet<string>,
): DevGptReadiness[] {
  return (["GPT02", "GPT03"] as const).map(alias => {
    const binding = config?.bindings.find(row => row.accountAlias === alias);
    const executor = binding?.workerId === "openclaw-dell-chatgpt-wake-dev" ? "DELL" as const :
      binding ? "OTHER_UNVERIFIED" as const : null;
    const executorOnline = Boolean(binding && eligibleExecutorIds.has(binding.workerId));
    const common = { alias, executor, executorOnline, dispatchReady: false as const };
    if (!config || !config.enabled || config.bindingConfigInvalid) {
      return {
        ...common,
        state: "DISABLED" as const,
        reason: "Server DEV binding gate disabled or invalid; browser dispatch prohibited",
      };
    }
    if (!binding) {
      return {
        ...common,
        state: "NOT_CONFIGURED" as const,
        reason: "No active server-side account binding; separate login, owner and executor verification required",
      };
    }
    return {
      ...common,
      state: "CONFIGURED_UNVERIFIED" as const,
      reason: executorOnline
        ? "Executor heartbeat observed; authenticated browser session, signed receipt and free slot not yet verified"
        : "Account binding configured; executor presence or browser-session proof not confirmed",
    };
  });
}
