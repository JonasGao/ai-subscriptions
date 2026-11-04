// Parity port of __tests__/useNow.test.ts (5 cases): the 60-second time
// signal primitive. React hooks become a Solid signal factory; the observable
// behaviour (initial tick, minute cadence, visibility refresh, disposal) is
// unchanged.

import { createRoot } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNow } from "./useNow";

function mountNow() {
  let now!: () => number;
  const dispose = createRoot((dispose) => {
    now = createNow();
    return dispose;
  });
  return { now, dispose };
}

function setVisibility(state: "hidden" | "visible") {
  Object.defineProperty(document, "visibilityState", {
    value: state,
    configurable: true,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

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
    const { now } = mountNow();
    expect(now()).toBe(start);
  });

  it("updates every 60 seconds", () => {
    const start = Date.now();
    vi.setSystemTime(start);
    const { now } = mountNow();
    expect(now()).toBe(start);

    vi.advanceTimersByTime(60_000);
    expect(now()).toBe(start + 60_000);

    vi.advanceTimersByTime(60_000);
    expect(now()).toBe(start + 120_000);
  });

  it("does not update before 60 seconds", () => {
    const start = Date.now();
    vi.setSystemTime(start);
    const { now } = mountNow();
    expect(now()).toBe(start);

    vi.advanceTimersByTime(59_999);
    expect(now()).toBe(start);
  });

  it("updates immediately on visibility change to visible", () => {
    const start = Date.now();
    vi.setSystemTime(start);
    const { now } = mountNow();
    expect(now()).toBe(start);

    // Simulate time passing without the interval firing.
    vi.setSystemTime(start + 30_000);

    // Hidden state must not trigger an update.
    setVisibility("hidden");
    expect(now()).toBe(start);

    // Visible state refreshes immediately.
    setVisibility("visible");
    expect(now()).toBe(start + 30_000);
  });

  it("cleans up interval and listener on dispose", () => {
    const start = Date.now();
    vi.setSystemTime(start);
    const clearIntervalSpy = vi.spyOn(window, "clearInterval");
    const removeEventListenerSpy = vi.spyOn(document, "removeEventListener");

    const { dispose } = mountNow();
    dispose();

    expect(clearIntervalSpy).toHaveBeenCalled();
    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      "visibilitychange",
      expect.any(Function)
    );
  });
});
