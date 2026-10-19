import type { Fetch, Tip } from "@/lib/api";

/**
 * The tip (/v1/tip) for every reader on a page: the API's stream of it (/v1/tip/stream, server-sent events) in front of
 * the polling every page did before, once a second, which takes over whenever the stream is not delivering, so the
 * stream can only make a page faster, never leave it behind. tip.ts wires this to the page; this module is the part
 * with no React, no EventSource and no fetch of its own, for its test (tipfeed.test.mjs). Type imports only.
 *
 *  - opening: the stream is asked for, and the page polls meanwhile. Its first tip makes it live, and the polling stops.
 *  - live: the tips come from the stream, a tip or a ping at least every STALL_MS (the API pings every 15 s).
 *  - a failure (the stream cannot be opened, is refused, ends or errs, sends a tip that cannot be read, or nothing for
 *    STALL_MS): the stream is closed and the page polls again at once; the stream is asked for again after retryMs,
 *    2 s doubling to a minute, from 2 s again once a stream had stayed live STEADY_MS. A stream that goes quiet twice
 *    in a row without staying live that long is given up for the page's life (a proxy holding its events back would
 *    otherwise leave the page a tip behind for STALL_MS at every try): the polling alone, as before.
 *  - hidden for HIDDEN_MS: the stream is closed and nothing is asked. Shown again, the tip is asked at once (the
 *    polling's first ask) and the stream opened again.
 *  - no stream to open (no EventSource, or a page served over HTTP/1, where a stream would hold one of the browser's
 *    six connections to the site for as long as the page is open): the polling alone, as before.
 */

/** no tip and no ping for this long: the stream is taken for dead */
export const STALL_MS = 20000;
/** hidden this long, the page lets its stream go */
export const HIDDEN_MS = 60000;
export const RETRY_MIN_MS = 2000;
export const RETRY_MAX_MS = 60000;
/** a stream live this long starts its back-off afresh when it drops */
export const STEADY_MS = 60000;
/** how long the feed outlives its last reader, so a reader that comes back at once (a remount) finds it open */
export const LINGER_MS = 2000;

/**
 * How long before the stream is asked for again after its n-th failure in a row (n from 1): 2 s doubling to a minute,
 * spread a quarter either way by jitter (0 to 1), so the pages one restart dropped do not all come back at once.
 */
export function retryMs(n: number, jitter = 0.5): number {
  const ms = Math.min(RETRY_MIN_MS * 2 ** Math.min(Math.max(n, 1) - 1, 10), RETRY_MAX_MS);
  return Math.round(ms * (0.75 + 0.5 * Math.min(Math.max(jitter, 0), 1)));
}

/**
 * Whether next may replace prev: not when the server answered it before prev, a polled answer that crossed a newer
 * event of the stream (the header's block would step back one). Without a time to compare, it may.
 */
export function fresher(prev: Tip | null, next: Tip): boolean {
  if (!prev) return true;
  const a = Date.parse(prev.server_time), b = Date.parse(next.server_time);
  return !(Number.isFinite(a) && Number.isFinite(b) && b < a);
}

export type Phase = "polling" | "opening" | "live" | "asleep";

/** what the feed needs of an EventSource */
export type Source = { addEventListener(type: string, fn: (e: { data?: unknown }) => void): void; close(): void };

export type Deps = {
  /** the stream's address */
  url: string;
  /** subscribes to the polling of /v1/tip, api.ts's stream of it at TIP_MS; returns the unsubscribe */
  poll: (fn: (f: Fetch<Tip>) => void) => () => void;
  /** opens a stream; absent where there is none to open (no EventSource, a page served over HTTP/1) */
  open?: (url: string) => Source;
  /** the page, for its visibility */
  doc?: { hidden: boolean; addEventListener(type: "visibilitychange", fn: () => void): void };
  now?: () => number;
  random?: () => number;
};

export type Feed = {
  /** every answer to fn, as useApi's streams give them; the current one at once when there is one */
  subscribe(fn: (f: Fetch<Tip>) => void): () => void;
  phase(): Phase;
};

export function createTipFeed(deps: Deps): Feed {
  const now = deps.now ?? Date.now;
  const random = deps.random ?? Math.random;
  const subs = new Set<(f: Fetch<Tip>) => void>();
  let last: Fetch<Tip> = { data: null, error: null, loading: true, fetchedAt: null };
  let phase: Phase = "asleep";
  let started = false;
  let src: Source | null = null;
  let unpoll: (() => void) | null = null;
  // fails: failures in a row, for the back-off; stalls: quiet streams in a row, for giving up; liveSince: when the
  // stream went live
  let fails = 0, stalls = 0, liveSince = 0, givenUp = false;
  let stall: ReturnType<typeof setTimeout> | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let hide: ReturnType<typeof setTimeout> | null = null;
  let linger: ReturnType<typeof setTimeout> | null = null;

  const emit = () => subs.forEach((fn) => fn(last));
  const startPoll = () => { if (!unpoll) unpoll = deps.poll(onPoll); };
  const stopPoll = () => { if (unpoll) { const u = unpoll; unpoll = null; u(); } };
  const closeSource = () => {
    if (stall) { clearTimeout(stall); stall = null; }
    if (src) {
      const s = src;
      src = null;
      try { s.close(); } catch { /* closed already */ }
    }
  };
  const clear = (t: ReturnType<typeof setTimeout> | null) => { if (t) clearTimeout(t); return null; };

  // A polled answer, while the stream is not live: as useApi would show it, but an answer older than the one shown
  // (fresher) does not replace it, and a failure keeps the tip on screen beside its error.
  function onPoll(f: Fetch<Tip>) {
    if (phase === "live" || phase === "asleep") return;
    if (f.data && (!last.data || fresher(last.data, f.data))) last = f;
    else if (f.error) last = last.data ? { ...last, error: f.error, loading: false, status: f.status } : f;
    else return;
    emit();
  }

  // the stream's sign of life: a tip or a ping, each of which puts the stall off again
  const beat = () => {
    if (stall) clearTimeout(stall);
    stall = setTimeout(() => fail(true), STALL_MS);
  };

  function fail(quiet = false) {
    if (phase !== "opening" && phase !== "live") return;
    const steady = phase === "live" && now() - liveSince >= STEADY_MS;
    closeSource();
    fails = steady ? 1 : fails + 1;
    stalls = !quiet ? 0 : steady ? 1 : stalls + 1;
    phase = "polling";
    startPoll();
    if (stalls >= 2) { givenUp = true; return; }
    retry = setTimeout(openStream, retryMs(fails, random()));
  }

  function openStream() {
    retry = null;
    phase = "polling";
    startPoll();
    if (!deps.open || givenUp) return;
    let s: Source;
    try { s = deps.open(deps.url); } catch { phase = "opening"; return fail(); }
    src = s;
    phase = "opening";
    // only the stream open now is heard: one closed and replaced says nothing more
    const mine = (fn: (e: { data?: unknown }) => void) => (e: { data?: unknown }) => { if (src === s) fn(e); };
    s.addEventListener("tip", mine((e) => {
      let tip: Tip | null = null;
      try { tip = JSON.parse(String(e.data)) as Tip; } catch { /* below */ }
      if (!tip || typeof tip !== "object" || typeof tip.height !== "number") return fail();
      beat();
      if (phase === "opening") { phase = "live"; liveSince = now(); stopPoll(); }
      if (last.data && !fresher(last.data, tip)) return;
      last = { data: tip, error: null, loading: false, fetchedAt: new Date(now()).toISOString() };
      emit();
    }));
    s.addEventListener("ping", mine(beat));
    s.addEventListener("error", mine(() => fail()));
    beat();
  }

  const sleep = () => {
    hide = null;
    if (!started) return;
    closeSource();
    retry = clear(retry);
    stopPoll();
    phase = "asleep";
  };
  const wake = () => {
    if (!started || phase !== "asleep") return;
    fails = 0;
    openStream();
  };
  deps.doc?.addEventListener("visibilitychange", () => {
    if (deps.doc?.hidden) { if (!hide) hide = setTimeout(sleep, HIDDEN_MS); }
    else { hide = clear(hide); wake(); }
  });

  const start = () => {
    started = true;
    fails = 0;
    openStream();
    if (deps.doc?.hidden && !hide) hide = setTimeout(sleep, HIDDEN_MS);
  };
  const stop = () => {
    started = false;
    closeSource();
    retry = clear(retry);
    hide = clear(hide);
    stopPoll();
    phase = "asleep";
  };

  return {
    subscribe(fn) {
      subs.add(fn);
      linger = clear(linger);
      if (!started) start();
      if (!last.loading) fn(last);
      return () => {
        subs.delete(fn);
        if (subs.size === 0 && started && !linger) {
          linger = setTimeout(() => { linger = null; if (subs.size === 0) stop(); }, LINGER_MS);
        }
      };
    },
    phase: () => phase,
  };
}
