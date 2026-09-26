"use client";

import { useSyncExternalStore } from "react";

const query = "(max-width: 47.99rem)";
function subscribe(callback: () => void): () => void {
  const media = window.matchMedia?.(query);
  media?.addEventListener("change", callback);
  return () => media?.removeEventListener("change", callback);
}

export function useCompactCalendar(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia?.(query).matches ?? false,
    () => false,
  );
}
