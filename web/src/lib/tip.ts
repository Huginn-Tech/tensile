"use client";
import { useEffect, useState } from "react";
import { API_BASE, TIP_MS, subscribe, type Fetch, type Tip, type TipBlobs, type TipEndpointEvent } from "@/lib/api";
import { createTipFeed, streamsOver, type Feed } from "@/lib/tipfeed-core";

/**
 * The page's one tip: every reader of /v1/tip (the header's block, the recent blobs, the lists' live rows, the
 * searches that wait for a blob) reads it here, so a page opens one stream, /v1/tip/stream, and polls /v1/tip only
 * while that is not delivering (tipfeed-core.ts has the rules). It answers in useApi's shape.
 */
let feed: Feed | null = null;
function tipFeed(): Feed {
  if (!feed) {
    feed = createTipFeed({
      url: `${API_BASE}/v1/tip/stream`,
      poll: (fn) => subscribe(`${TIP_MS}|/v1/tip`, "/v1/tip", TIP_MS, fn as (f: Fetch<unknown>) => void),
      open: typeof EventSource === "undefined" || !streamsOver(pageProtocol()) ? undefined : (url) => {
        const es = new EventSource(url);
        return { addEventListener: (type, fn) => es.addEventListener(type, (e) => fn(e as MessageEvent)), close: () => es.close() };
      },
      doc: typeof document === "undefined" ? undefined : document,
    });
  }
  return feed;
}

/** the protocol the page came over ("h2", "h3", "http/1.1"), "" where the browser does not say (streamsOver) */
function pageProtocol(): string {
  try {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    return nav?.nextHopProtocol ?? "";
  } catch {
    return "";
  }
}

/**
 * /v1/tip as useApi("/v1/tip", TIP_MS) gave it: the newest block and the newest blob on record. The polling rendered
 * its readers every second whether the tip had changed or not, and the ages some print ("12s ago", from Date.now() at
 * render) count on that, so a reader is still rendered every TIP_MS while the page is shown.
 */
export function useTip(): Fetch<Tip> {
  const [state, setState] = useState<Fetch<Tip>>({ data: null, error: null, loading: true, fetchedAt: null });
  const [, setTick] = useState(0);
  useEffect(() => tipFeed().subscribe(setState), []);
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) setTick((n) => n + 1); }, TIP_MS);
    return () => clearInterval(t);
  }, []);
  return state;
}

/**
 * The promise hash of the newest blob on record (/v1/tip's latest_blob), null until the tip has named one. It reads
 * the page's tip, so it asks nothing of its own, and it renders its page only when the blob changes, not at every
 * answer: what a page that waits for a blob to be recorded asks again on.
 */
export function useNewestBlob(): string | null {
  const [newest, setNewest] = useState<string | null>(null);
  useEffect(() => tipFeed().subscribe((f) => setNewest(f.data?.latest_blob?.promise_hash ?? null)), []);
  return newest;
}

/**
 * The page's tip as each answer comes, without a render: for a reader that only acts on what changed (the overview
 * map's burst, which asks for a newly named blob's record at once). Returns the unsubscribe.
 */
export function onTip(fn: (f: Fetch<Tip>) => void): () => void {
  return tipFeed().subscribe(fn);
}

/** a new blob's rows as the page's stream brings them, without a render: the overview's grid. Returns the unsubscribe. */
export function onBlobs(fn: (b: TipBlobs) => void): () => void {
  return tipFeed().onBlobs(fn);
}

/** how far past its block's stamp a blob may be heard of and still be news; older, the page caught up on it */
const HEARD_MS = 15000;

/**
 * When a blob settled, in ms on the observer's clock. A blob settles when its block is committed, about a block after
 * the stamp its settlement_time carries, so the moment a page heard of it (heard, on the same clock) is the nearest
 * measure of it. A page that did not hear of it takes the stamp and one block, the average over the blocks since by the
 * page's tip; the stamp alone when the tip is at that block.
 */
export function settledAt(stamp: string, height: number, heard?: number): number {
  const t = Date.parse(stamp);
  if (heard !== undefined && heard >= t && heard - t < HEARD_MS) return heard;
  const tip = tipFeed().last();
  const blocks = tip?.block_time ? tip.height - height : 0;
  return blocks > 0 ? t + (Date.parse(tip!.block_time!) - t) / blocks : t;
}

/**
 * The newest endpoint registration or change of any validator (/v1/tip's latest_endpoint_event): undefined until the
 * tip has answered, null while it names none. Like useNewestBlob it reads the page's tip and renders its page only when
 * the event changes; a failed answer keeps the last one.
 */
export function useEndpointEvent(): TipEndpointEvent | null | undefined {
  const [ev, setEv] = useState<TipEndpointEvent | null | undefined>(undefined);
  useEffect(() => tipFeed().subscribe((f) => {
    if (!f.data) return;
    const next = f.data.latest_endpoint_event ?? null;
    setEv((cur) => (cur !== undefined && endpointEventKey(cur) === endpointEventKey(next) ? cur : next));
  }), []);
  return ev;
}

/** what tells two endpoint events apart: the validator, its block, what it did, the host, and the name it goes by */
export function endpointEventKey(e: TipEndpointEvent | null | undefined): string {
  return e ? [e.address, e.height, e.outcome, e.host, e.moniker ?? ""].join("|") : "";
}
