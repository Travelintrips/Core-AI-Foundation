// @vitest-environment happy-dom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CODING_RUN_POLL_INTERVAL_MS,
  useCodingTaskPolling,
} from "./codingWorkspacePolling";

describe("useCodingTaskPolling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it.each(["COMPLETED", "FAILED"])(
    "polls a RUNNING run and stops after it becomes %s",
    (terminalStatus) => {
    const onPoll = vi.fn();
    const { rerender } = renderHook(
      ({ active }: { active: boolean }) => useCodingTaskPolling(active, onPoll),
      { initialProps: { active: true } },
    );

    act(() => {
      vi.advanceTimersByTime(CODING_RUN_POLL_INTERVAL_MS);
    });
    expect(onPoll).toHaveBeenCalledTimes(1);

    // This is the page's derived `hasActiveRun` changing after the final
    // detail refetch returns a terminal run.
    rerender({ active: false });
    act(() => {
      vi.advanceTimersByTime(CODING_RUN_POLL_INTERVAL_MS * 2);
    });
    expect(onPoll).toHaveBeenCalledTimes(1);

    expect(terminalStatus).toMatch(/COMPLETED|FAILED/);
    },
  );

  it("clears the interval on unmount and never polls after navigation", () => {
    const onPoll = vi.fn();
    const { unmount } = renderHook(() => useCodingTaskPolling(true, onPoll));

    unmount();
    act(() => {
      vi.advanceTimersByTime(CODING_RUN_POLL_INTERVAL_MS * 2);
    });

    expect(onPoll).not.toHaveBeenCalled();
  });
});