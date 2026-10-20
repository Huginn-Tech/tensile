"use client";
import { useSyncExternalStore } from "react";

/**
 * The width under which globals.css lays the site out for a phone. What only the phone layout does (a validator row
 * that opens in place, the header's tabs that tuck away, ten endorsers before "Show all") asks usePhone, so the desktop
 * page keeps every element and every behaviour it had.
 */
export const PHONE = "(max-width: 720px)";

let query: MediaQueryList | null = null;
function phoneQuery(): MediaQueryList {
  if (!query) query = window.matchMedia(PHONE);
  return query;
}
const subscribe = (on: () => void) => {
  const q = phoneQuery();
  q.addEventListener("change", on);
  return () => q.removeEventListener("change", on);
};

/** whether the window is phone width: false in the prerendered page and while it hydrates, then the window's answer */
export function usePhone(): boolean {
  return useSyncExternalStore(subscribe, () => phoneQuery().matches, () => false);
}
