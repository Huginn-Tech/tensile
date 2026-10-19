"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { type Validator, type TipEndpointEvent, API_BASE, ago, utcWord, int } from "@/lib/api";
import { onTip, useEndpointEvent } from "@/lib/tip";
import { validatorHref } from "@/lib/addr";
import type { Hosting } from "@/lib/hosting";
import { FRAME, COUNTRIES, project, countryPoint } from "@/lib/map/project";
import { countryName } from "@/components/Flag";
import { Eye } from "@/components/Metrics";
import { type EndpointState, endpointState, readiness } from "@/components/Readiness";
import { Flasher, onArrival, placesOf, type Arrival, type ArrivedBlob, type Flash } from "@/lib/mapflash";
import { Burst, type BurstPlace, type Where, type Els } from "@/lib/mapburst";
import { PillPicker, HOLD_MS, ROTATE_MS } from "@/lib/pillpick";

/**
 * The overview's host map: every registered Fibre host of the bonded set,
 * placed by the city its address geolocates to (hosting.lat/lon) or, without
 * one, by its country's label point, over Natural Earth country outlines
 * (Equal Earth) drawn as land of one neutral shade: no grid, no outline of the
 * world, and no country coloured, so the only colour on the map is at its
 * places. While the map is at rest the land carries its material: a fine
 * grain, a coastline hairline and a short shadow.
 *
 * Every place is a disc ringed in its state's colour carrying its count; a
 * lone host is a solid dot. Hosts close together on screen share one badge
 * (badges never touch). A badge with an unreachable host carries an amber pip
 * on its rim, and one whose hosts all stopped answering turns amber; the map
 * shows reachability only, what was served is on each validator's page. Names
 * appear only on hover, focus or tap, in the place's popover (its unreachable
 * hosts first), and the other badges step back
 * while one is open. A badge that holds several places zooms in on them; the
 * corner buttons, a double click, a pinch on a trackpad and a drag (once
 * zoomed) move the view, each in one eased flight.
 *
 * Across the map's foot, two small pills: the stream at the left, the three
 * counts in the centre. With each beat of the recent blobs (a block's blobs,
 * as they come: lib/pace.ts) the places of the validators that endorsed
 * them burst on the map (lib/mapflash.ts, lib/mapburst.ts), and the pill
 * names them, one a second (lib/pillpick.ts); a validator's new or changed
 * endpoint (/v1/tip) takes the pill for 12 s, and its place bursts. The map has no heading
 * of its own: the counts say what
 * it shows, and the panel's one heading on the subject is "Current Fibre
 * providers" under it. The box (its shape set in the stylesheet) and the bar
 * are in the prerendered page and the land is drawn as soon as the box is
 * measured, all before the list arrives, so nothing moves when it does.
 */

type Host = { v: Validator; state: EndpointState; share: number; cc: string; city: string; loc: string; lon: number; lat: number; ux: number; uy: number; provider: string };
type Cluster = { id: string; hosts: Host[]; ux: number; uy: number; locs: number; ccs: string[] };
/** the visible part of the map, in map units: top-left corner and width (height follows the box) */
type View = { x: number; y: number; w: number };

const STATE_WORD: Record<EndpointState, string> = { reachable: "reachable", unreachable: "unreachable", none: "not checked yet" };
const STATE_VAR: Record<EndpointState, string> = { reachable: "var(--accent)", unreachable: "var(--hold)", none: "var(--pending)" };
const ORDER: EndpointState[] = ["reachable", "unreachable", "none"];

/** the home view's top is 72°N, above every city anyone hosts in; a phone's crop runs from there to 50°S */
const TOP = project(0, 72)[1], BOTTOM = project(0, -50)[1];
/**
 * the box's two shapes: a wide box is a low band (about 380 px tall at 1120 px wide), a box under
 * 560 px a taller crop. The stylesheet sets the same two shapes (.cm-atlas, by a container query on
 * .cm), so the box has its size before any script runs.
 */
const WIDE = 0.34, TALL = 0.56;
const MAX_ZOOM = 12;
/** the home view may step back until the world is this much narrower than the box, to keep every badge inside it */
const MAX_BACK = 1.4;
/** the room every badge of the home view keeps from the box's edges, in px: above, beside, and below (or above the bar) */
const ROOM_TOP = 28, ROOM_SIDE = 12, ROOM_FOOT = 8;
const ROOM_TOP_NARROW = 14;

/** a view inside the world; one at least as wide as the world (the home view, stepped back) is centred on it */
function clampView(v: View, a: number, maxW = FRAME.w): View {
  const w = Math.min(maxW, FRAME.h / a, Math.max(FRAME.w / MAX_ZOOM, v.w)), h = w * a;
  const x = w >= FRAME.w ? (FRAME.w - w) / 2 : Math.min(FRAME.w - w, Math.max(0, v.x));
  return { w, x, y: Math.min(FRAME.h - h, Math.max(0, v.y)) };
}
/** the view that shows every point, with room around them */
function fitView(pts: [number, number][], a: number, pad = 0.35, minW = FRAME.w / MAX_ZOOM): View {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const w = Math.max(minW, (x1 - x0) * (1 + 2 * pad), ((y1 - y0) * (1 + 2 * pad)) / a);
  return clampView({ w, x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - (w * a) / 2 }, a);
}

/**
 * The home view and its badges. It starts from the whole width of the world (a phone: a crop from
 * 72°N to 50°S, centred on the hosts) with its top at 72°N, and keeps every badge inside the box:
 * ROOM_TOP below the top edge, ROOM_SIDE from either side, and clear of the floating bar (bar: its
 * left, top and width in px, where it lies over the box) or ROOM_FOOT above the bottom. Where the
 * top at 72°N leaves a badge outside, the view moves north or south as far as the others allow;
 * where no position does, it steps back a little and tries again, until the world is MAX_BACK times
 * narrower than the box.
 */
function fitHome(hosts: Host[], a: number, width: number, bar: [number, number, number, number] | null, narrow: boolean): [View, Cluster[]] {
  const height = width * a;
  const w0 = Math.min(FRAME.w, (BOTTOM - TOP) / a);
  const xs = hosts.map((h) => h.ux), cx = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : FRAME.w / 2;
  const top = narrow ? ROOM_TOP_NARROW : ROOM_TOP;
  let last: [View, Cluster[]] | null = null;
  for (let i = 0; i <= 12; i++) {
    const w = Math.min(w0 * MAX_BACK, w0 / (1 - 0.03 * i));
    const s = width / w;
    const x = w >= FRAME.w ? (FRAME.w - w) / 2 : Math.min(FRAME.w - w, Math.max(0, cx - w / 2));
    const cs = cluster(hosts, s, narrow);
    // the band of view tops that keeps every badge in: lo from the badges that must stay above the foot, hi from those below the top
    let lo = -Infinity, hi = Infinity, fits = true;
    for (const c of cs) {
      const px = (c.ux - x) * s, rr = drawn(c.hosts.length, narrow) / 2;
      if (px - rr < ROOM_SIDE || px + rr > width - ROOM_SIDE) fits = false;
      const under = !!bar && px + rr > bar[0] - 6 && px - rr < bar[0] + bar[2] + 6;
      const foot = under ? bar![1] - 6 : height - ROOM_FOOT;
      hi = Math.min(hi, c.uy - (top + rr) / s);
      lo = Math.max(lo, c.uy - (foot - rr) / s);
    }
    const y = Math.min(hi, Math.max(lo, TOP));
    last = [clampView({ w, x, y: lo <= hi ? y : (lo + hi) / 2 }, a, w0 * MAX_BACK), cs];
    if (fits && lo <= hi) break;
  }
  return last!;
}

function providerOf(h?: Hosting): string {
  if (!h || h.status === "unresolved") return "";
  if (h.provider && h.provider !== "Other" && h.provider !== "Unknown") return h.provider;
  const org = (h.as_org ?? "").split(/\s+/)[0].replace(/^AS-/i, "").replace(/-ASN?(-\d+)?$/i, "").replace(/\d+$/, "");
  if (!org) return "";
  return org === org.toUpperCase() && org.length > 3 ? org.charAt(0) + org.slice(1).toLowerCase() : org;
}

const valLink = (v: Validator) => validatorHref(v.operator_address, v.cons_address || v.address);
const name = (v: Validator) => v.moniker || v.operator_address || v.address;
const fmtShare = (s: number) => { const p = s * 100; return p >= 0.1 ? `${p.toFixed(1)}%` : p > 0 ? "<0.1%" : "0%"; };

/** a badge's height in px: a little taller for more hosts, so a crowd reads as one; a lone host is a small dot */
const badgeH = (n: number, narrow: boolean) => (n === 1 ? (narrow ? 9 : 11) : narrow ? Math.round(17 + Math.min(6, 1.9 * Math.sqrt(n - 1))) : Math.round(21 + Math.min(8, 2.3 * Math.sqrt(n - 1))));
/** its width: square, or wider for a figure of three digits */
const badgeW = (n: number, narrow: boolean) => (n === 1 ? badgeH(1, narrow) : Math.max(badgeH(n, narrow), Math.round(String(n).length * (narrow ? 6.3 : 7.2) + (narrow ? 9 : 12))));
/** the room a badge takes, for the merging and for keeping clear of the bar */
const drawn = (n: number, narrow: boolean) => Math.max(badgeH(n, narrow), badgeW(n, narrow));

/** hosts -> clusters: one per place (city, else country), then merged while two badges would touch on screen */
function cluster(hosts: Host[], pxPerUnit: number, narrow: boolean): Cluster[] {
  const byLoc = new Map<string, Host[]>();
  for (const h of hosts) byLoc.set(h.loc, [...(byLoc.get(h.loc) ?? []), h]);
  type C = { hosts: Host[]; ux: number; uy: number };
  const mean = (hs: Host[], k: "ux" | "uy") => hs.reduce((s, h) => s + h[k], 0) / hs.length;
  let cs: C[] = [...byLoc.values()].map((hs) => ({ hosts: hs, ux: mean(hs, "ux"), uy: mean(hs, "uy") }));
  for (;;) {
    let best: [number, number, number] | null = null;
    for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
      const d = Math.hypot(cs[i].ux - cs[j].ux, cs[i].uy - cs[j].uy) * pxPerUnit;
      const need = (drawn(cs[i].hosts.length, narrow) + drawn(cs[j].hosts.length, narrow)) / 2 + 5;
      if (d < need && (!best || d - need < best[2])) best = [i, j, d - need];
    }
    if (!best) break;
    const a = cs[best[0]], b = cs[best[1]], na = a.hosts.length, nb = b.hosts.length;
    const merged: C = { hosts: [...a.hosts, ...b.hosts], ux: (a.ux * na + b.ux * nb) / (na + nb), uy: (a.uy * na + b.uy * nb) / (na + nb) };
    cs = cs.filter((_, i) => i !== best![0] && i !== best![1]).concat(merged);
  }
  // a place's hosts as its popover lists them: the unreachable first, so a badge opened for its amber pip shows them at
  // once, then the rest; each group by voting power
  return cs.map((c) => {
    const hosts = [...c.hosts].sort((x, y) => Number(y.state === "unreachable") - Number(x.state === "unreachable") || (y.v.voting_power || 0) - (x.v.voting_power || 0));
    const n = new Map<string, number>();
    for (const h of hosts) if (h.cc) n.set(h.cc, (n.get(h.cc) ?? 0) + 1);
    const ccs = [...n.entries()].sort((p, q) => q[1] - p[1]).map(([cc]) => cc);
    return { id: hosts.map((h) => h.v.address).sort().join(","), hosts, ux: c.ux, uy: c.uy, locs: new Set(hosts.map((h) => h.loc)).size, ccs };
  }).sort((x, y) => x.ux - y.ux);
}

/** every country once, all in the land's one shade: the land draws these, and at rest its material draws them again */
const LAND = COUNTRIES.map(([cc, d], i) => <path key={cc || i} d={d} />);

/** px: the side of the land's grain tile, which repeats without a seam */
const GRAIN = 96;
/**
 * The land's grain: one tile of soft white noise (each speck averaged a little with its four neighbours, wrapping so
 * the tile repeats without a seam), split into its light specks and its dark ones, so the stylesheet lays each on the
 * land's shade at its own strength in either theme. It is made at the screen's resolution, a speck to a device pixel;
 * on a 1x screen, where a speck is a whole CSS pixel, at a little over half.
 */
function grainTiles(dpr: number): { hi: string; lo: string } | null {
  const n = Math.round(GRAIN * dpr), k = dpr >= 1.5 ? 1 : 0.55;
  let s = 11;
  const w = new Float32Array(n * n);
  for (let i = 0; i < w.length; i++) w[i] = (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  const at = (i: number, j: number) => w[((j + n) % n) * n + ((i + n) % n)];
  const hi = document.createElement("canvas"), lo = document.createElement("canvas");
  hi.width = hi.height = lo.width = lo.height = n;
  const hx = hi.getContext("2d"), lx = lo.getContext("2d");
  if (!hx || !lx) return null;
  const hd = hx.createImageData(n, n), ld = lx.createImageData(n, n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    // -0.5 to 0.5: above the middle a light speck, below it a dark one
    const g = 0.7 * at(i, j) + 0.075 * (at(i - 1, j) + at(i + 1, j) + at(i, j - 1) + at(i, j + 1)) - 0.5;
    const o = (j * n + i) * 4, a = Math.min(255, Math.round(Math.abs(g) * 510 * k));
    hd.data[o] = hd.data[o + 1] = hd.data[o + 2] = 255;
    if (g > 0) hd.data[o + 3] = a; else ld.data[o + 3] = a;
  }
  hx.putImageData(hd, 0, 0);
  lx.putImageData(ld, 0, 0);
  return { hi: hi.toDataURL("image/png"), lo: lo.toDataURL("image/png") };
}

/** px: about how tall a place's popover is, to choose its side: its header, its list (it scrolls past 196 px) and its zoom button */
const popHeight = (n: number, split: boolean) => 58 + Math.min(196, n * 49) + (split ? 38 : 0);

/** what a badge is called: its city, its country, or its countries */
function placeLabel(c: Cluster): string {
  if (c.locs === 1 && c.hosts[0].city) return `${c.hosts[0].city}, ${countryName(c.hosts[0].cc)}`;
  if (c.ccs.length === 1) return countryName(c.ccs[0]);
  if (c.ccs.length === 2) return c.ccs.map(countryName).join(", ");
  return `${c.ccs.length} countries`;
}
/** a badge's places, most hosts first: its cities (or countries, where no city is known) */
function cityCounts(c: Cluster): [string, number][] {
  const n = new Map<string, number>();
  for (const h of c.hosts) { const k = h.city || countryName(h.cc); n.set(k, (n.get(k) ?? 0) + 1); }
  return [...n.entries()].sort((p, q) => q[1] - p[1] || p[0].localeCompare(q[0]));
}

/** a list that scrolls says which edges have more: the stylesheet fades those (data-more) */
function scrollFade(el: HTMLElement | null) {
  if (!el) return;
  const more = [el.scrollTop > 1 ? "top" : "", el.scrollTop + el.clientHeight < el.scrollHeight - 1 ? "bottom" : ""].filter(Boolean).join(" ");
  if (el.dataset.more !== more) el.dataset.more = more;
}

function reducedMotion(): boolean {
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
}

/** "22 h ago" for "22 h 52 min ago": the pill's clock needs the hour, not the minute */
const shortAgo = (t: string) => ago(t).replace(/(\d+ h) \d+ min/, "$1");

/** what tells one endpoint event from the next: the validator, its block, what it did and the host */
const eventId = (e: TipEndpointEvent) => `${e.address}|${e.height}|${e.outcome}|${e.host}`;

/** re-renders every ms, for an age on screen */
function useEvery(ms: number) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), ms);
    return () => window.clearInterval(t);
  }, [ms]);
}

/**
 * The pill's endpoint event: the validator, what it did and how long ago. One that comes while the page is open pops
 * its dot (pulse); the one the page opened with is simply there.
 */
function EventPill({ ev, pulse, v, place }: { ev: TipEndpointEvent; pulse: boolean; v?: Validator; place?: Host }) {
  useEvery(30000);
  const who = v ? name(v) : ev.moniker || ev.operator_address || ev.address;
  const did = ev.outcome === "changed" ? "changed its endpoint" : "registered its endpoint";
  return (
    <p className="cm-ev">
      <i className={`cm-ev-dot${pulse ? " pop" : ""}`} aria-hidden="true" />
      <span className="cm-ev-t" title={`${who} ${did}${place?.cc ? ` · ${countryName(place.cc)}` : ""}${place?.provider ? ` · ${place.provider}` : ""} · ${utcWord(ev.time)}`}>
        <Link href={v ? valLink(v) : validatorHref(ev.operator_address, ev.address)}>{who}</Link> {did}
      </span>
      <span className="cm-ev-ago">{shortAgo(ev.time)}</span>
    </p>
  );
}

/** a beat of the recent blobs as the pill names it: its newest blob, its block's time, its blobs, their endorsers (null while unknown), and whether it came while the page is open (live) or is what the grid opened with */
type PillBeat = { key: string; at: string; height: number; blobs: number; endorsers: string[] | null; live: boolean };

/** "12 s ago" under a minute, the pill's clock after, by the observer's clock (now: the reader's, corrected by the tip's skew) */
function secondsAgo(t: string, now: number): string {
  const s = Math.floor((now - Date.parse(t)) / 1000);
  if (!Number.isFinite(s)) return "";
  if (s < 1) return "just now";
  if (s < 60) return `${s} s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.floor(h / 24)} d ago`;
}

/** whether the reader asks for less motion, and again whenever that changes */
function useReducedMotion(): boolean {
  const [still, setStill] = useState(false);
  useEffect(() => {
    let mq: MediaQueryList;
    try { mq = window.matchMedia("(prefers-reduced-motion: reduce)"); } catch { return; }
    const on = () => setStill(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return still;
}

/**
 * The pill: an endorser of the newest beat at a time, "B-Harvest endorsed · 12 s ago", a new one each
 * ROTATE_MS in a shuffled order, each once (lib/pillpick.ts); with reduced motion one name a beat. The names
 * cross-fade in place, every name of the beat stacked in one cell, the cell easing to the width of the name shown. A
 * new beat takes the pill in the frame the grid moves, and its dot pops (not for what the grid opened with); a
 * validator's new or changed endpoint takes it for HOLD_MS (ev, at epAt) and pops it too. A beat whose endorsers are
 * not known is named plainly as settled.
 *
 * Under the pointer or with focus in it, the pill holds still, its beat and its name as they were, so the name can be
 * read, clicked or kept focused; let go, it shows the newest. Ages are by the observer's clock (skew, the tip's).
 *
 * For a block of several blobs the latest blob's card is the newest of them, its own endorsements; the burst and the
 * pill are the block's, the union of its blobs' endorsers. The pill counts nothing, so the two never disagree.
 */
function StreamPill({ beat, ev, epAt, nameOf, evVal, evHost, motion, skew }: {
  beat: PillBeat | null; ev: TipEndpointEvent | null | undefined; epAt: number;
  nameOf: (addr: string) => { name: string; href: string }; evVal?: Validator; evHost?: Host; motion: boolean; skew: () => number;
}) {
  const pick = useRef<PillPicker<TipEndpointEvent> | null>(null);
  if (!pick.current) pick.current = new PillPicker<TipEndpointEvent>();
  const pk = pick.current;
  const [, render] = useState(0);
  // held under the pointer or the focus: what it showed then, names and all
  const [held, setHeld] = useState(false);
  const shown = useRef<{ s: ReturnType<PillPicker<TipEndpointEvent>["show"]>; names: string[]; beat: PillBeat | null } | null>(null);
  const heldRef = useRef(held);
  heldRef.current = held;
  // fed before the paint, so a new beat is named in the frame the grid moves
  useLayoutEffect(() => {
    if (beat) { pk.beat(beat.key, beat.at, beat.endorsers, beat.live); render((n) => n + 1); }
  }, [beat, pk]);
  useLayoutEffect(() => {
    if (ev && epAt) { pk.endpoint(ev, epAt); render((n) => n + 1); }
  }, [epAt]); // eslint-disable-line react-hooks/exhaustive-deps
  // a name a second, with motion and while not held; the age on screen moves with it, or every 15 s without
  useEffect(() => {
    const t = window.setInterval(() => {
      if (motion && !heldRef.current) pk.tick(Date.now());
      render((n) => n + 1);
    }, motion ? ROTATE_MS : 15000);
    return () => window.clearInterval(t);
  }, [pk, motion]);
  // the names' cell as wide as the name shown, after every render: one measure a second
  const whoRef = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = whoRef.current, on = el?.querySelector<HTMLElement>(":scope > .on");
    if (el && on) el.style.width = `${Math.ceil(on.getBoundingClientRect().width)}px`;
  });
  const now = Date.now();
  const live = { s: pk.show(now) ?? (ev ? { kind: "endpoint" as const, ev } : null), names: [...pk.names], beat };
  if (!held || !shown.current) shown.current = live;
  const { s, names, beat: b } = held && shown.current ? shown.current : live;
  const hold = {
    onPointerEnter: () => setHeld(true),
    onPointerLeave: (e: React.PointerEvent<HTMLElement>) => { if (!e.currentTarget.contains(document.activeElement)) setHeld(false); },
    onFocus: () => setHeld(true),
    onBlur: (e: React.FocusEvent<HTMLElement>) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setHeld(false); },
  };
  const ago = (t: string) => secondsAgo(t, now + skew());
  // nothing to name yet: a placeholder until the tip answers; once it has, and names no blob and no endpoint, no pill
  // (a network whose Fibre has just gone live)
  if (!s) return ev === undefined ? <p className="cm-ev"><span className="cm-ev-t wait">{" "}</span></p> : null;
  if (s.kind === "endpoint") return <EventPill key={eventId(s.ev)} ev={s.ev} pulse={epAt > 0 && now - epAt < HOLD_MS} v={evVal} place={evHost} />;
  const many = (b?.blobs ?? 1) > 1, at = b ? ` at height ${int(b.height)}` : "";
  if (s.kind === "settled") {
    return (
      <p className="cm-ev" {...hold}>
        <i key={s.key} className={`cm-ev-dot${b?.live ? " pop" : ""}`} aria-hidden="true" />
        <span className="cm-ev-t" title={`${many ? `${b!.blobs} blobs` : "A blob"} settled${at} · ${utcWord(s.at)}`}>
          <Link href={`/blob/?hash=${s.key}`}>{many ? `${b!.blobs} blobs` : "The latest blob"}</Link> settled
        </span>
        <span className="cm-ev-ago">{ago(s.at)}</span>
      </p>
    );
  }
  const who = nameOf(s.who);
  return (
    <p className="cm-ev" {...hold}>
      <i key={s.key} className={`cm-ev-dot${b?.live ? " pop" : ""}`} aria-hidden="true" />
      <span className="cm-ev-t" title={`${who.name} endorsed ${many ? "blobs" : "the blob"}${at} · settled ${utcWord(s.at)}`}>
        <span className="cm-ev-who" ref={whoRef}>
          {names.map((w) => (w === s.who
            ? <span key={w} className="on"><Link href={who.href}>{who.name}</Link></span>
            : <span key={w} aria-hidden="true">{nameOf(w).name}</span>))}
        </span>
        {" "}endorsed
      </span>
      <span className="cm-ev-ago">{ago(s.at)}</span>
    </p>
  );
}

/**
 * The map's bursts (lib/mapburst.ts on the canvas fx), driven by the recent blobs' moves (lib/mapflash.ts): each move
 * is heard (onMove, for the pill, every time), and the endorsers of the blobs it brought in, which the grid's own read
 * carries (/v1/blobs?endorsers=1), burst their places with the move. Of a move that brings several blocks (a stall's
 * catch-up) only the newest block bursts; the older are marked seen. Nothing bursts with reduced motion (motion
 * false; it is heard again when that changes), while the page is hidden, or for what it missed meanwhile once it is
 * shown again (the tip's height then, from the page's one tip). Returns a ref whose fire() bursts other places (a new
 * endpoint's).
 */
function useBurst(fx: React.RefObject<HTMLCanvasElement | null>, motion: boolean, where: Where, els: Els, owners: () => Map<string, string>, onMove: (a: Arrival) => void) {
  const api = useRef<{ fire: (places: BurstPlace[]) => void; burst: Burst | null }>({ fire: () => {}, burst: null });
  const latest = useRef({ where, els, owners, onMove });
  latest.current = { where, els, owners, onMove };
  useEffect(() => {
    const burst = motion && fx.current ? new Burst(fx.current, (id) => latest.current.where(id), (id) => latest.current.els(id)) : null;
    api.current = { burst, fire: (places) => { if (burst && !document.hidden) burst.fire(places); } };
    if (burst && fx.current) burst.size(fx.current.clientWidth, fx.current.clientHeight, window.devicePixelRatio || 1);
    const f = new Flasher();
    let backAt = 0;
    const show = (fl: Flash | null) => {
      if (!fl || !burst || document.hidden || fl.endorsers.length === 0) return;
      const { places } = placesOf(fl.endorsers, latest.current.owners());
      burst.fire([...places].map(([id, n]) => ({ id, n })));
    };
    const off = onArrival((a) => {
      latest.current.onMove(a);
      if (a.blobs.length === 0) return;
      const top = a.blobs.reduce((m, b) => Math.max(m, b.settlement_height), 0);
      const older = a.blobs.filter((b) => b.settlement_height < top), block = a.blobs.filter((b) => b.settlement_height === top);
      if (older.length) f.arrive({ id: a.id, blobs: older, live: false }, false);
      const { ask, flash } = f.arrive({ id: a.id, blobs: block, live: a.live }, a.live && !document.hidden);
      // the grid's read brought each blob's endorsers: recorded at once, so the move flashes in its own frame
      let fl = flash;
      for (const h of ask) fl = f.record(h, block.find((b) => b.promise_hash === h)?.endorsers ?? null) ?? fl;
      show(fl);
    });
    // the page's tip (lib/tip.ts), without a render of its own: the chain's height once the page is shown again
    const offTip = onTip((fr) => {
      if (backAt && fr.data && fr.fetchedAt && Date.parse(fr.fetchedAt) >= backAt) {
        f.back(fr.data.height);
        backAt = 0;
      }
    });
    const onVis = () => {
      if (document.hidden) { f.hidden(); burst?.stop(); }
      else { backAt = Date.now(); burst?.wake(); }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      off();
      offTip();
      burst?.stop();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [fx, motion]);
  return api;
}

export default function HostMap({ rows }: { rows: Validator[] | null }) {
  const loading = !rows;
  const r = readiness(rows ?? []);
  const total = r.total;

  const { hosts, unplaced } = useMemo(() => {
    const hs: Host[] = [];
    let un = 0;
    for (const v of r.registered) {
      const g = v.hosting;
      const cc = (g?.country ?? "").toUpperCase();
      const hasLL = !!g && typeof g.lat === "number" && typeof g.lon === "number";
      const ll = hasLL ? [g!.lon!, g!.lat!] as [number, number] : countryPoint(cc);
      if (!ll) { un++; continue; }
      const [ux, uy] = project(ll[0], ll[1]);
      const city = hasLL ? (g!.city ?? "") : "";
      // One place per named city: DB-IP gives districts of one city (and hosts in it) slightly different points.
      const loc = city ? `${cc}/${city}` : hasLL ? `${ll[1].toFixed(1)},${ll[0].toFixed(1)}` : `cc:${cc}`;
      hs.push({ v, state: endpointState(v), share: total > 0 ? (v.voting_power || 0) / total : 0, cc, city, loc, lon: ll[0], lat: ll[1], ux, uy, provider: providerOf(v.hosting) });
    }
    return { hosts: hs, unplaced: un };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  // ---- size: the box holds its shape in CSS (aspect-ratio), so measuring it never shifts the layout ----
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    // the exact width, as the stylesheet's container query sees it
    const measure = () => setWidth(el.getBoundingClientRect().width);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const narrow = width > 0 && width < 560;
  const aspect = narrow ? TALL : WIDE;
  const height = width * aspect;

  // the floating bar, where it lies over the map: measured, so no badge is left under it
  const bar = useRef<HTMLDivElement>(null);
  const [barAt, setBarAt] = useState<[number, number, number, number] | null>(null);
  useLayoutEffect(() => {
    const a = box.current?.getBoundingClientRect(), b = bar.current?.getBoundingClientRect();
    let at: [number, number, number, number] | null = null;
    if (a && b && b.top < a.bottom && b.bottom > a.top) at = [Math.round(b.left - a.left), Math.round(b.top - a.top), Math.round(b.width), Math.round(Math.min(b.bottom, a.bottom) - b.top)];
    if (JSON.stringify(at) !== JSON.stringify(barAt)) setBarAt(at);
  });

  // the home view keeps every badge inside the box and clear of the bar (see fitHome)
  const [home, homeClusters] = useMemo((): [View, Cluster[]] => {
    if (!width) { const w = Math.min(FRAME.w, (BOTTOM - TOP) / aspect); return [clampView({ w, x: (FRAME.w - w) / 2, y: TOP }, aspect), []]; }
    return fitHome(hosts, aspect, width, barAt, narrow);
  }, [hosts, barAt, width, narrow, aspect]);
  /** a view at least as wide as home's, or as the world: the home view itself */
  const isHome = (w: number) => w >= Math.min(home.w, FRAME.w) - 1;

  // ---- view: where the map is looking, flown toward a target ----
  const [view, setView] = useState<View>(home);
  const [target, setTarget] = useState<View>(home);
  const viewRef = useRef(view);
  viewRef.current = view;
  const targetRef = useRef(target);
  targetRef.current = target;
  const raf = useRef(0);
  const homeKey = `${aspect}|${Math.round(home.x)}|${Math.round(home.y)}|${Math.round(home.w)}`;
  useLayoutEffect(() => { cancelAnimationFrame(raf.current); setView(home); setTarget(home); }, [homeKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = (to: View) => {
    const t = isHome(to.w) ? home : clampView(to, aspect), from = viewRef.current;
    setTarget(t);
    cancelAnimationFrame(raf.current);
    if (reducedMotion()) { setView(t); return; }
    const t0 = performance.now();
    const fcx = from.x + from.w / 2, fcy = from.y + (from.w * aspect) / 2, tcx = t.x + t.w / 2, tcy = t.y + (t.w * aspect) / 2;
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / 460), e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      const w = from.w * Math.pow(t.w / from.w, e), cx = fcx + (tcx - fcx) * e, cy = fcy + (tcy - fcy) * e;
      setView(p < 1 ? { w, x: cx - w / 2, y: cy - (w * aspect) / 2 } : t);
      if (p < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  const moving = view !== target;
  const zoomed = target.w < home.w - 1;
  const scale = width > 0 ? width / view.w : 0;
  const toPx = (ux: number, uy: number): [number, number] => [(ux - view.x) * scale, (uy - view.y) * scale];

  // Badges merge by the zoom the view is heading to, so they do not re-merge mid-flight.
  const clusters = useMemo(() => (target.w === home.w ? homeClusters : cluster(hosts, width / target.w, narrow)), [homeClusters, home.w, hosts, width, target.w, narrow]);

  // ---- drag to pan, once zoomed in ----
  const drag = useRef<{ id: number; x: number; y: number; v: View; moved: boolean } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (!zoomed || e.button !== 0 || (e.target as Element).closest(".cm-pin, .cm-tools")) return;
    cancelAnimationFrame(raf.current);
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, v: viewRef.current, moved: false };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 3) return;
    d.moved = true;
    const s = width / d.v.w;
    const nv = clampView({ w: d.v.w, x: d.v.x - dx / s, y: d.v.y - dy / s }, aspect);
    setView(nv); setTarget(nv);
  };
  const onPointerUp = (e: React.PointerEvent) => { if (drag.current?.id === e.pointerId) drag.current = null; };

  /** zoom by f about a point of the box (px), the centre by default */
  const zoomAt = (f: number, px = width / 2, py = height / 2) => {
    const t = targetRef.current, s = width / t.w, ux = t.x + px / s, uy = t.y + py / s, w = t.w / f;
    go({ w, x: ux - (px / width) * w, y: uy - (py / width) * w });
  };
  const onDoubleClick = (e: React.MouseEvent) => {
    if ((e.target as Element).closest(".cm-pin, .cm-tools")) return;
    const b = box.current!.getBoundingClientRect();
    zoomAt(2, e.clientX - b.left, e.clientY - b.top);
  };
  // a pinch on a trackpad arrives as a wheel with ctrlKey: zoom about the pointer, following the fingers.
  // A plain wheel is left to the page, so the map never takes the page's scroll.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const b = el.getBoundingClientRect(), px = e.clientX - b.left, py = e.clientY - b.top;
      const t = viewRef.current, s = b.width / t.w, ux = t.x + px / s, uy = t.y + py / s;
      const w0 = Math.min(home.w, t.w * Math.exp(e.deltaY * 0.01));
      const nv = isHome(w0) ? home : clampView({ w: w0, x: ux - (px / b.width) * w0, y: uy - (py / b.width) * w0 }, aspect);
      cancelAnimationFrame(raf.current);
      setView(nv); setTarget(nv);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [home, aspect]);

  // ---- the badges are one stop in the tab order: the arrow keys walk them, west to east ----
  const [roving, setRoving] = useState<string | null>(null);
  const walk = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : e.key === "Home" ? -Infinity : e.key === "End" ? Infinity : 0;
    if (!step) return;
    const all = [...(e.currentTarget.closest("ul")?.querySelectorAll<HTMLButtonElement>(".cm-b") ?? [])];
    const i = all.indexOf(e.currentTarget);
    const j = step === -Infinity ? 0 : step === Infinity ? all.length - 1 : Math.min(all.length - 1, Math.max(0, i + step));
    all[j]?.focus();
    e.preventDefault();
  };

  // ---- the open place (hover, focus, tap) ----
  const [open, setOpen] = useState<string | null>(null);
  const closeT = useRef<number | undefined>(undefined);
  const openNow = (id: string) => { window.clearTimeout(closeT.current); setOpen(id); };
  const closeSoon = () => { window.clearTimeout(closeT.current); closeT.current = window.setTimeout(() => setOpen(null), 160); };
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null); };
    const onDown = (e: PointerEvent) => { if (!(e.target as Element)?.closest?.(".cm-pin")) setOpen(null); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("pointerdown", onDown); };
  }, [open]);
  const canSplit = (c: Cluster) => c.locs > 1 && target.w > FRAME.w / MAX_ZOOM + 1;
  const activate = (c: Cluster) => {
    if (canSplit(c)) {
      // Zoom until the places in this badge come apart: at least twice as close, at most the zoom limit.
      const fit = fitView(c.hosts.map((h) => [h.ux, h.uy]), aspect);
      const w = Math.min(fit.w, target.w / 2);
      setOpen(null);
      go({ w, x: fit.x + fit.w / 2 - w / 2, y: fit.y + (fit.w * aspect) / 2 - (w * aspect) / 2 });
    } else openNow(c.id);
  };

  // ---- the pill: the endorsers of each beat of the recent blobs, as it comes (the grid's newest block when the page
  // opens), their union over the block's blobs as the grid's read gave them; and a validator's new or changed endpoint
  // (/v1/tip), which holds the pill for 12 s when it comes while the page is open and is under 30 s old ----
  const calm = useReducedMotion();
  const [beatNow, setBeatNow] = useState<PillBeat | null>(null);
  // the observer's clock against the reader's (the tip's server_time), for the pill's ages and an endpoint's
  const skew = useRef(0);
  useEffect(() => onTip((f) => {
    if (f.data?.server_time && f.fetchedAt) skew.current = Date.parse(f.data.server_time) - Date.parse(f.fetchedAt);
  }), []);
  const ev = useEndpointEvent();
  const evKey = ev ? eventId(ev) : "";
  const firstEv = useRef<string | null>(null);
  if (ev !== undefined && firstEv.current === null) firstEv.current = evKey;
  const evFresh = !!ev && evKey !== firstEv.current;
  const evVal = ev ? (rows ?? []).find((v) => v.address.toLowerCase() === ev.address) : undefined;
  const evHost = ev ? hosts.find((h) => h.v.address.toLowerCase() === ev.address) : undefined;

  // ---- the burst: where each place is now, for the canvas; its elements, kept; which place each validator's host is in ----
  const fx = useRef<HTMLCanvasElement>(null);
  const pinEls = useRef(new Map<string, HTMLLIElement>());
  const pinParts = useRef(new Map<string, { li: HTMLLIElement; badge: HTMLElement | null; pop: HTMLElement | null; trace: HTMLElement | null }>());
  const spots = useRef(new Map<string, { x: number; y: number; r: number; one: boolean }>());
  const owners = useRef(new Map<string, string>());
  const where: Where = (id) => spots.current.get(id) ?? null;
  const els: Els = (id) => {
    const li = pinEls.current.get(id);
    // a place gone from the map takes its parts with it, so a page left open for days keeps no element it dropped
    if (!li) { pinParts.current.delete(id); return null; }
    let parts = pinParts.current.get(id);
    if (!parts || parts.li !== li) {
      parts = { li, badge: li.querySelector<HTMLElement>(".cm-badge"), pop: li.querySelector<HTMLElement>(".cm-badge-pop"), trace: li.querySelector<HTMLElement>(".cm-trace") };
      pinParts.current.set(id, parts);
    }
    return parts;
  };
  const unionOf = (blobs: ArrivedBlob[]): string[] | null => {
    const lists = blobs.map((b) => b.endorsers).filter((e): e is string[] => Array.isArray(e));
    return lists.length ? [...new Set(lists.flat())] : null;
  };
  const burst = useBurst(fx, !calm, where, els, () => owners.current, (a) => {
    // a stall's older blocks come onto the grid unnamed; the pill names the newest block of a move
    if (a.blobs.length === 0 || (!a.live && a.id !== 0)) return;
    const top = a.blobs.reduce((m, b) => Math.max(m, b.settlement_height), 0);
    const block = a.blobs.filter((b) => b.settlement_height === top);
    const nb = block.reduce((m, b) => ((b.settlement_tx_index ?? 0) > (m.settlement_tx_index ?? 0) ? b : m));
    const beat: PillBeat = { key: nb.promise_hash, at: nb.settlement_time ?? "", height: top, blobs: block.length, endorsers: unionOf(block), live: a.live };
    setBeatNow(beat);
    // what the grid opened with was read without its endorsers: its newest block's, once
    if (a.id === 0 && beat.endorsers === null) {
      fetch(`${API_BASE}/v1/blobs?before_height=${top + 1}&limit=20&endorsers=1`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          const list = Array.isArray(j?.blobs) ? (j.blobs as ArrivedBlob[]).filter((b) => b.settlement_height === top) : [];
          const es = unionOf(list);
          if (es) setBeatNow((p) => (p && p.key === beat.key ? { ...p, endorsers: es } : p));
        }, () => {});
    }
  });
  const nameOf = (addr: string) => {
    const v = (rows ?? []).find((x) => x.address.toLowerCase() === addr);
    return v ? { name: name(v), href: valLink(v) } : { name: `${addr.slice(0, 8)}…`, href: validatorHref(undefined, addr) };
  };
  // a new or changed endpoint that comes while the page is open: the pill for 12 s, and its place bursts; one older
  // than 30 s when seen (the page was hidden, or the observer caught up) is not news, and only waits its turn
  const [epAt, setEpAt] = useState(0);
  useEffect(() => {
    if (!evFresh || !ev) return;
    if (Date.now() + skew.current - Date.parse(ev.time) > 30000) return;
    setEpAt(Date.now());
    const id = owners.current.get(ev.address);
    if (id) burst.current.fire([{ id, n: 1 }]);
  }, [evKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- the countries hosting someone, for the counts; and whether any host is still to be checked, for the key ----
  const hosted = useMemo(() => new Set(hosts.map((h) => h.cc)), [hosts]);
  const unchecked = hosts.some((h) => h.state === "none");

  // ---- the land's material: its grain tiles, made for the screen's resolution (again when the window moves to a screen
  // of another), and the view it is drawn for: the one the map last came to rest at. While the map moves only the plain
  // land moves with it; 140 ms after the last step the material is drawn for the new view and fades in. ----
  const [grain, setGrain] = useState<{ hi: string; lo: string; dpr: number } | null>(null);
  useEffect(() => {
    let mq: MediaQueryList | undefined;
    const make = () => {
      const dpr = window.devicePixelRatio || 1, t = grainTiles(dpr);
      setGrain(t && { ...t, dpr });
      mq?.removeEventListener("change", make);
      mq = window.matchMedia(`(resolution: ${dpr}dppx)`);
      mq.addEventListener("change", make);
    };
    make();
    return () => mq?.removeEventListener("change", make);
  }, []);
  const [rest, setRest] = useState<View | null>(null);
  const [still, setStill] = useState(false);
  useEffect(() => {
    setStill(false);
    const t = window.setTimeout(() => { setRest(viewRef.current); setStill(true); }, 140);
    return () => window.clearTimeout(t);
  }, [view, width]);
  /** closer than half the home view: country borders show, faintly, and the grain steps back */
  const near = target.w < home.w / 2;

  // ---- badges on screen ----
  const placed = width > 0 ? clusters.map((c) => {
    const [x, y] = toPx(c.ux, c.uy);
    const n = c.hosts.length, bw = badgeW(n, narrow), bh = badgeH(n, narrow);
    return { c, x, y, bw, bh, hit: Math.max(24, bw + 4, bh + 4) };
  }).filter((p) => p.x >= p.bw / 2 - 2 && p.x <= width - p.bw / 2 + 2 && p.y >= p.bh / 2 - 2 && p.y <= height - p.bh / 2 + 2) : [];

  // ---- counts ----
  const countries = hosted.size - (hosted.has("") ? 1 : 0);
  const providers = new Set(r.registered.map((v) => providerOf(v.hosting)).filter(Boolean)).size;
  const counts: [number, string, string][] = [
    [hosts.length + unplaced, "Fibre providers", "Fibre provider"],
    [countries, "countries", "country"],
    [providers, "hosting providers", "hosting provider"],
  ];

  // ---- the land's material at rest: its grain (tied to the world's origin on the device's pixel grid, so it never
  // resamples and a pan carries it with the land), its coastline under it and its shadow under that ----
  let material: React.ReactNode = null;
  if (grain && rest && width > 0) {
    const s = width / rest.w, u = 1 / s, t = GRAIN * u;
    const gx = rest.x + (Math.round(-rest.x * s * grain.dpr) / grain.dpr) * u, gy = rest.y + (Math.round(-rest.y * s * grain.dpr) / grain.dpr) * u;
    material = (
      <svg className={`cm-mat${still ? "" : " moving"}`} viewBox={`${rest.x} ${rest.y} ${rest.w} ${rest.w * aspect}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
        <defs>
          <pattern id="cm-grain" className="cm-grain" patternUnits="userSpaceOnUse" x={gx} y={gy} width={t} height={t}>
            <rect width={t} height={t} />
            <image className="hi" href={grain.hi} width={t} height={t} preserveAspectRatio="none" />
            <image className="lo" href={grain.lo} width={t} height={t} preserveAspectRatio="none" />
          </pattern>
        </defs>
        <g className="shade" transform={`translate(0 ${(1.4 * u).toFixed(3)})`}>{LAND}</g>
        <g className="coast">{LAND}</g>
        <g className="fill">{LAND}</g>
      </svg>
    );
  }

  // ---- the burst's places as drawn now: each badge's centre and radius, and the place each validator's host is in ----
  spots.current = new Map(placed.map((p) => [p.c.id, { x: p.x, y: p.y, r: Math.max(p.bw, p.bh) / 2, one: p.c.hosts.length === 1 }]));
  owners.current = new Map(placed.flatMap((p) => p.c.hosts.map((h) => [h.v.address.toLowerCase(), p.c.id] as [string, string])));
  useEffect(() => {
    burst.current.burst?.size(width, height, window.devicePixelRatio || 1);
  }, [width, height, burst]);

  return (
    <section className="cm" aria-label="Map of Fibre providers">
      <div className={`cm-atlas${zoomed ? " zoomed" : ""}${near ? " near" : ""}${open ? " has-open" : ""}`} ref={box}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}>
        <div className="cm-vp">
          {/* drawn once the box is measured: the prerendered page holds the box, not the 100 kB of outlines */}
          {width > 0 && (
            <svg className="cm-land" viewBox={`${view.x} ${view.y} ${view.w} ${view.w * aspect}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
              {LAND}
            </svg>
          )}
          {material}
        </div>
        {/* no heading of its own: the counts on the bar say what the map shows, and "Current Fibre providers" below is the one heading */}
        <div className="cm-title">
          <p className="cm-key" title="Observed by Tensile: whether each registered host answered its latest endpoint check">
            <Eye />
            <span><i className="k-ok" />reachable</span>
            <span><i className="k-hold" />unreachable</span>
            {unchecked && <span><i className="k-none" />not checked yet</span>}
          </p>
        </div>
        {/* the bursts' rings, under the badges: drawn only while one is out (lib/mapburst.ts) */}
        <canvas className="cm-fx" ref={fx} aria-hidden="true" />
        <ul className="cm-pins" aria-label="Fibre providers by location">
          {placed.map(({ c, x, y, bw, bh, hit }) => {
            const isOpen = open === c.id;
            const place = placeLabel(c);
            const tally = ORDER.map((s) => [s, c.hosts.filter((h) => h.state === s).length] as const).filter(([, n]) => n > 0);
            const unreach = c.hosts.filter((h) => h.state === "unreachable").length;
            const none = c.hosts.filter((h) => h.state === "none").length;
            const n = c.hosts.length;
            const tone = unreach === n ? "hold" : none === n ? "none" : "ok";
            const split = canSplit(c);
            const multi = c.ccs.length > 1;
            const one = n === 1;
            const cities = c.locs > 1 ? cityCounts(c) : [];
            // beside the badge and ending above the bar, so it never covers the counts (its list scrolls instead), on whichever
            // of its four sides covers the fewest other places; a tie keeps the side with room, right in the west, below in the north
            let pop: React.CSSProperties | null = null;
            if (isOpen && !moving && narrow) pop = { left: -x + 8, top: height - y + 14, width: width - 16 };
            else if (isOpen && !moving) {
              const edge = Math.max(bh, 24) / 2, floor = barAt ? Math.min(height, barAt[1]) : height, h = popHeight(n, split);
              const sides = (["right", "left"] as const).flatMap((hz) => (["below", "above"] as const).map((vt) => {
                const maxHeight = Math.max(220, vt === "below" ? floor - (y - edge) - 8 : y + edge - 10), ph = Math.min(h, maxHeight);
                const x0 = hz === "right" ? x + bw / 2 + 12 : x - bw / 2 - 12 - 300, y0 = vt === "below" ? y - edge : y + edge - ph;
                const fits = x0 >= 8 && x0 + 300 <= width - 8 && (vt === "below" ? y0 + ph <= floor - 4 : y0 >= 4);
                const covers = placed.filter((q) => q.c !== c && q.x + q.bw / 2 + 4 > x0 && q.x - q.bw / 2 - 4 < x0 + 300 && q.y + q.bh / 2 + 4 > y0 && q.y - q.bh / 2 - 4 < y0 + ph).length;
                const away = Number(hz !== (x > width * 0.6 ? "left" : "right")) + Number(vt !== (y <= height * 0.5 ? "below" : "above"));
                return { hz, vt, maxHeight, fits, covers, away };
              }));
              const s = sides.filter((q) => q.fits).sort((p, q) => p.covers - q.covers || p.away - q.away)[0] ?? sides.find((q) => q.away === 0)!;
              pop = { [s.hz === "right" ? "left" : "right"]: bw / 2 + 12, [s.vt === "below" ? "top" : "bottom"]: -edge, width: 300, maxHeight: s.maxHeight };
            }
            return (
              <li key={c.id} className={`cm-pin${one ? " one" : ""}${isOpen ? " open" : ""}`} ref={(el) => { if (el) pinEls.current.set(c.id, el); else pinEls.current.delete(c.id); }}
                style={{ transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`, zIndex: isOpen ? 30 : undefined }}
                onMouseEnter={() => openNow(c.id)} onMouseLeave={closeSoon}>
                {/* the place's warmth from its bursts, under its badge (lib/mapburst.ts) */}
                <i className="cm-trace" aria-hidden="true" style={{ width: Math.max(bw, bh) + (narrow ? 12 : 18), height: Math.max(bw, bh) + (narrow ? 12 : 18), left: -(Math.max(bw, bh) + (narrow ? 12 : 18)) / 2, top: -(Math.max(bw, bh) + (narrow ? 12 : 18)) / 2 }} />
                <button type="button" className="cm-b" aria-expanded={split ? undefined : isOpen} aria-describedby="cm-pins-keys"
                  aria-label={`${place}${cities.length ? ` (${cities.map(([k, m]) => (m > 1 ? `${k} ${m}` : k)).join(", ")})` : ""}: ${n} Fibre provider${one ? "" : "s"}, ${tally.map(([s, k]) => `${k} ${STATE_WORD[s]}`).join(", ")}${split ? ". Zoom in" : ""}`}
                  style={{ width: hit, height: hit }}
                  tabIndex={c.id === (placed.some((q) => q.c.id === roving) ? roving : placed[0]?.c.id) ? 0 : -1}
                  onFocus={() => { setRoving(c.id); openNow(c.id); }} onKeyDown={walk} onClick={() => activate(c)}>
                  <span className="cm-badge" data-tone={tone} style={{ width: bw, height: bh }}><i className="cm-badge-pop" aria-hidden="true" />{one ? null : n}</span>
                  {unreach > 0 && tone !== "hold" && <i className="cm-pip hold" aria-hidden="true" style={{ left: `calc(50% + ${(bw * 0.3536 - 3.5).toFixed(1)}px)`, top: `calc(50% - ${(bh * 0.3536 + 3.5).toFixed(1)}px)` }} />}
                </button>
                {pop && (
                  <div className="cm-pop" style={pop} role="group" aria-label={place}>
                    <p className="cm-pop-h">
                      {c.ccs.length > 2 ? <b>{n} Fibre providers</b> : <><b>{place}</b><span>{n} provider{one ? "" : "s"}</span></>}
                    </p>
                    <ul ref={scrollFade} onScroll={(e) => scrollFade(e.currentTarget)}>
                      {c.hosts.map((h) => (
                        <li key={h.v.address}>
                          <i className="cm-dot" style={{ background: STATE_VAR[h.state] }} title={STATE_WORD[h.state]} />
                          <Link href={valLink(h.v)} className="cm-name">{name(h.v)}</Link>
                          <span className="cm-share">{fmtShare(h.share)}</span>
                          <span className="cm-meta">
                            {[multi ? h.cc : "", h.provider, c.locs > 1 && h.city ? h.city : multi && !h.city ? countryName(h.cc) : "", h.state !== "reachable" ? STATE_WORD[h.state] : ""].filter(Boolean).join(" · ")}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {split && <button type="button" className="cm-zoomin" onClick={() => activate(c)}>Zoom in</button>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <span id="cm-pins-keys" className="sr-only">Arrow keys move between places.</span>
        <div className="cm-tools" role="group" aria-label="Map view">
          <button type="button" aria-label="Zoom in" disabled={target.w <= FRAME.w / MAX_ZOOM + 1} onClick={() => zoomAt(2)}>
            <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
          <button type="button" aria-label="Zoom out" disabled={!zoomed} onClick={() => zoomAt(0.5)}>
            <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
          {zoomed && (
            <button type="button" aria-label="Whole map" onClick={() => go(home)}>
              <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2.2 4.4V2.2h2.2M7.6 2.2h2.2v2.2M9.8 7.6v2.2H7.6M4.4 9.8H2.2V7.6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          )}
        </div>
      </div>

      {/* two pills across the map's foot: the stream at the left (the blobs' beats, or a validator's endpoint), the three
          counts in the centre */}
      <div className="cm-bar" ref={bar}>
        <StreamPill beat={beatNow} ev={ev} epAt={epAt} nameOf={nameOf} evVal={evVal} evHost={evHost} motion={!calm} skew={() => skew.current} />
        <ul className="cm-counts" aria-busy={loading || undefined}>
          {counts.map(([n, many, one]) => (
            <li key={many}><b className={loading ? "wait" : undefined}>{loading ? "00" : int(n)}</b><span>{n === 1 && !loading ? one : many}</span></li>
          ))}
        </ul>
      </div>
    </section>
  );
}
