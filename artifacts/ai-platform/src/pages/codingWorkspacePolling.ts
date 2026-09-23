import { useEffect } from "react";

export const CODING_RUN_POLL_INTERVAL_MS = 5000;

export function useCodingTaskPolling(
  enabled: boolean,
  onPoll: () => void,
): void {
  useEffect(() => {
    if (!enabled) return;

    const intervalId = window.setInterval(onPoll, CODING_RUN_POLL_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [enabled, onPoll]);
}