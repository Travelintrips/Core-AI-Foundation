// @vitest-environment happy-dom

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CODING_RUN_POLL_INTERVAL_MS,
  useCodingTaskPolling,
} from "./codingWorkspacePolling";

describe("useCodingTaskPolling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("polls active runs and stops after the run becomes terminal", () => {
    const onPoll = vi.fn();
    const { rerender } = renderHook(
      ({ active }: { active: boolean }) => useCodingTaskPolling(active, onPoll),
      { initialProps: { active: true } },
    );

    act(() => {
      vi.advanceTimersByTime(CODING_RUN_POLL_INTERVAL_MS);
    });
    expect(onPoll).toHaveBeenCalledTimes(1);

    rerender({ active: false });
    act(() => {
      vi.advanceTimersByTime(CODING_RUN_POLL_INTERVAL_MS * 2);
    });
    expect(onPoll).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});