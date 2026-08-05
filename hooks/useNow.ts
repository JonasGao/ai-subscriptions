import { useState, useEffect } from "react";

/**
 * Returns current timestamp (ms), updating every 60 seconds.
 * Also updates immediately when tab becomes visible again.
 * Use this to make formatNextResetTime re-calculate periodically.
 */
export function useNow(): number {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNow(Date.now());
    }, 60_000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        setNow(Date.now());
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return now;
}
