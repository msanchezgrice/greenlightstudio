"use client";

import { useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";

type Props = {
  intervalMs?: number;
  /** When true, polls at the fast rate (activeIntervalMs). */
  hasActiveWork?: boolean;
  /** Fast-poll interval when work is in progress. Defaults to 4000ms. */
  activeIntervalMs?: number;
};

export function LiveRefresh({
  intervalMs = 8000,
  hasActiveWork = false,
  activeIntervalMs = 4000,
}: Props) {
  const router = useRouter();
  const visible = useRef(true);
  const rate = hasActiveWork ? activeIntervalMs : intervalMs;

  const refresh = useCallback(() => {
    if (visible.current) router.refresh();
  }, [router]);

  useEffect(() => {
    function onVisibility() {
      visible.current = document.visibilityState === "visible";
      if (visible.current) refresh();
    }
    document.addEventListener("visibilitychange", onVisibility);
    const timer = setInterval(refresh, rate);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      clearInterval(timer);
    };
  }, [refresh, rate]);

  return null;
}
