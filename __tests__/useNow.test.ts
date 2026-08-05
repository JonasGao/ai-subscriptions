// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useNow } from "@/hooks/useNow";

describe("useNow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns current timestamp initially", () => {
    const start = Date.now();
    vi.setSystemTime(start);
    const { result } = renderHook(() => useNow());
    expect(result.current).toBe(start);
  });

  it("updates every 60 seconds", () => {
    const start = Date.now();
    vi.setSystemTime(start);
    const { result } = renderHook(() => useNow());
    expect(result.current).toBe(start);

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current).toBe(start + 60_000);

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current).toBe(start + 120_000);
  });

  it("does not update before 60 seconds", () => {
    const start = Date.now();
    vi.setSystemTime(start);
    const { result } = renderHook(() => useNow());
    expect(result.current).toBe(start);

    act(() => {
      vi.advanceTimersByTime(59_999);
    });
    expect(result.current).toBe(start);
  });

  it("updates immediately on visibility change to visible", () => {
    const start = Date.now();
    vi.setSystemTime(start);
    const { result } = renderHook(() => useNow());
    expect(result.current).toBe(start);

    // Simulate time passing without interval firing
    vi.setSystemTime(start + 30_000);

    // Hidden state should not trigger update
    act(() => {
      Object.defineProperty(document, "visibilityState", {
        value: "hidden",
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current).toBe(start);

    // Visible state should trigger update
    act(() => {
      Object.defineProperty(document, "visibilityState", {
        value: "visible",
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current).toBe(start + 30_000);
  });

  it("cleans up interval and listener on unmount", () => {
    const start = Date.now();
    vi.setSystemTime(start);
    const clearIntervalSpy = vi.spyOn(window, "clearInterval");
    const removeEventListenerSpy = vi.spyOn(document, "removeEventListener");

    const { unmount } = renderHook(() => useNow());
    unmount();

    expect(clearIntervalSpy).toHaveBeenCalled();
    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      "visibilitychange",
      expect.any(Function)
    );
  });
});
