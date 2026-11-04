// Port of hooks/useNow.ts as a Solid primitive (#27).
//
// createNow returns an accessor that re-reads the clock every 60 seconds and
// refreshes immediately when the tab becomes visible again, so countdown text
// recomputed from the signal never goes stale after a background tab wakes.

import { createSignal, onCleanup, type Accessor } from "solid-js";

const REFRESH_INTERVAL_MS = 60_000;

export function createNow(): Accessor<number> {
  const [now, setNow] = createSignal(Date.now());

  const intervalId = window.setInterval(() => {
    setNow(Date.now());
  }, REFRESH_INTERVAL_MS);

  const handleVisibilityChange = () => {
    if (document.visibilityState === "visible") {
      setNow(Date.now());
    }
  };

  document.addEventListener("visibilitychange", handleVisibilityChange);

  onCleanup(() => {
    window.clearInterval(intervalId);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
  });

  return now;
}
