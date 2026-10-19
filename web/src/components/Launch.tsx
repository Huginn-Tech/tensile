"use client";
import { useEffect, useRef, useState } from "react";
import { useTip, onTip } from "@/lib/tip";
import { int } from "@/lib/api";
import { OTHER_SITE } from "@/lib/site";
import { Mark, CelestiaMark } from "@/components/Chrome";
import { see, expectedAt, parts, type Seen } from "@/lib/countdown";

/**
 * Fibre's activation block on this site's network (NEXT_PUBLIC_ACTIVATION_HEIGHT), for a site that goes up before
 * Fibre is live there. Unset or 0, as on Mocha, the site is the site.
 */
const TARGET = Math.floor(Number(process.env.NEXT_PUBLIC_ACTIVATION_HEIGHT || 0)) || 0;

/**
 * The whole site, or, on a network whose Fibre is still to come, a countdown to its activation block in its place.
 * The countdown is what the build draws, so a reader never sees an explorer of a Fibre that is not there yet; the
 * explorer takes its place by itself, on the open page too, as soon as the observer reports Fibre live on the chain
 * (/v1/tip's fibre_active, which the collector reads from the chain's app version). The page's one tip drives both,
 * so it asks nothing of its own.
 */
export default function Launch({ children }: { children: React.ReactNode }) {
  return TARGET > 0 ? <Gate>{children}</Gate> : <>{children}</>;
}

function Gate({ children }: { children: React.ReactNode }) {
  const [live, setLive] = useState(false);
  useEffect(() => onTip((f) => { if (f.data?.fibre_active) setLive(true); }), []);
  return live ? <>{children}</> : <Countdown />;
}

const UTC = (t: number) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" }).format(t) + " UTC";
const LOCAL = (t: number) => new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", timeZoneName: "short" }).format(t);
const two = (n: number) => String(n).padStart(2, "0");

/**
 * The countdown: the time left as a clock and when it is expected (in UTC and the reader's own time); under them the
 * chain as a track running to the activation block, with the newest block, the activation block and the blocks to go
 * on it (Track), all from the tip as each block comes; then what opens here, and the way to Fibre on the other network
 * meanwhile. The clock counts each second to the expected time (lib/countdown.ts), which each block sets anew.
 */
function Countdown() {
  const tip = useTip();
  const d = tip.data;
  const seen = useRef<Seen[]>([]);
  const [now, setNow] = useState<number | null>(null);
  // each new block, seen
  const h = d?.height, bt = d?.block_time;
  useEffect(() => {
    if (h && bt) seen.current = see(seen.current, { h, t: Date.parse(bt) });
  }, [h, bt]);
  // the clock, on the second
  useEffect(() => {
    let t: number | undefined;
    const tick = () => { setNow(Date.now()); t = window.setTimeout(tick, 1000 - (Date.now() % 1000) + 5); };
    tick();
    return () => window.clearTimeout(t);
  }, []);

  // the observer's clock against the reader's (the tip's server_time), so a reader's wrong clock moves nothing
  const skew = d?.server_time && tip.fetchedAt ? Date.parse(d.server_time) - Date.parse(tip.fetchedAt) : 0;
  const at = d && now != null ? expectedAt(TARGET, seen.current) : null;
  const left = at != null && now != null ? at - (now + skew) : null;
  const p = left != null ? parts(left) : null;
  const togo = h ? Math.max(0, TARGET - h) : null;
  const reached = togo === 0;
  // the expected minute, as a reader reads a time
  const atMin = at != null ? Math.round(at / 60000) * 60000 : null;
  const units: [string, string][] = p
    ? [...(p.d > 0 ? [[String(p.d), p.d === 1 ? "day" : "days"] as [string, string]] : []), [two(p.h), "hours"], [two(p.m), "minutes"], [two(p.s), "seconds"]]
    : [["00", "hours"], ["00", "minutes"], ["00", "seconds"]];
  const said = p ? `${p.d ? `${p.d} days ` : ""}${p.h} hours ${p.m} minutes left` : "Connecting";

  return (
    <div className="lc">
      <header className="lc-top">
        <a className="lc-brand" href="/" aria-label="Tensile"><Mark size={20} /><span>Tensile</span></a>
        {OTHER_SITE && <a className="lc-other" href={OTHER_SITE.origin}>Tensile on {OTHER_SITE.label} <span aria-hidden="true">→</span></a>}
      </header>
      <main className="lc-main">
        <p className="lc-eyebrow"><CelestiaMark size={15} />Celestia mainnet</p>
        <h1 className="lc-h">{reached ? "Fibre is activating" : "Fibre goes live on Celestia mainnet"}</h1>
        <div className={`lc-clock${reached ? " done" : ""}`} role="timer" aria-label={said}>
          {units.map(([n, w], i) => (
            <div className="lc-unit" key={w}>
              {i > 0 && <span className="lc-sep" aria-hidden="true">:</span>}
              <span className="lc-cell">
                <span className={`lc-num${p ? "" : " wait"}`} aria-hidden="true">{n}</span>
                <span className="lc-lab" aria-hidden="true">{w}</span>
              </span>
            </div>
          ))}
        </div>
        <p className="lc-when">
          {reached ? "The activation block is in." : atMin != null
            ? <>Expected around <b>{UTC(atMin)}</b><span className="lc-loc">{LOCAL(atMin)} your time</span></>
            : <>Expected around <b className="wait">Oct 00, 00:00 UTC</b></>}
        </p>
        <Track h={h ?? null} togo={togo} />
        <p className="lc-note">
          {reached
            ? "Tensile opens here as soon as the chain reports Fibre live."
            : "From that block on, this is Tensile's explorer for Fibre on mainnet: blobs, publishers, escrow, Fibre providers, validators and their endorsements, in real time. It opens here by itself."}
        </p>
        {OTHER_SITE && <p className="lc-links"><a className="lc-btn" href={OTHER_SITE.origin}>Explore Fibre on {OTHER_SITE.label} now <span aria-hidden="true">→</span></a></p>}
      </main>
    </div>
  );
}

/** the track's layout, from its width: where the newest block sits, the step between blocks, the road's length */
type Geom = { s0: number; P: number; tipX: number; L: number; r: number; end: number; rail: number; K: number };

/**
 * The chain as a track: its blocks run in from the left, one square a block, the newest lit and ringed under the
 * clock; the blocks still to come recede from it towards the activation block, each a step smaller, so the whole
 * distance meets at one point on a horizon, and in the last blocks the activation block walks in. A new block steps
 * in as one 620 ms move of two layers (the chain slides one place left, the road grows one step about its far
 * point), then the track is drawn again where the move left it; nothing moves between blocks. Several blocks at
 * once, a hidden page or reduced motion draw it again without a move. The squares are drawn into their layers
 * directly, not by React, so a block costs one write of each layer.
 */
function Track({ h, togo }: { h: number | null; togo: number | null }) {
  const tr = useRef<HTMLElement>(null), past = useRef<HTMLDivElement>(null), next = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null), dst = useRef<HTMLDivElement>(null), dstSq = useRef<HTMLDivElement>(null);
  const gap = useRef<HTMLDivElement>(null), gapLine = useRef<HTMLDivElement>(null), gapLab = useRef<HTMLDivElement>(null);
  const gapEnd = useRef<HTMLDivElement>(null), cur = useRef<HTMLDivElement>(null);
  const G = useRef<Geom | null>(null);
  const drawn = useRef(0);
  const settle = useRef<number | undefined>(undefined);

  const xAt = (g: Geom, k: number) => g.end - g.L * Math.pow(g.r, k);
  const sAt = (g: Geom, k: number) => g.s0 * Math.pow(g.r, k);
  const sq = (g: Geom, x: number, s: number, cls: string, extra = "") =>
    `<i class="sq ${cls}" style="width:${s.toFixed(2)}px;height:${s.toFixed(2)}px;border-radius:${Math.max(1, s / 4).toFixed(2)}px;transform:translate(${(x - s / 2).toFixed(2)}px,${(g.rail - s / 2).toFixed(2)}px);${extra}"></i>`;

  const geom = () => {
    const t = tr.current, n = next.current, o = ring.current;
    if (!t || !n || !o) return;
    const W = t.clientWidth, narrow = W < 720;
    const s0 = narrow ? 18 : 28, P = narrow ? 24 : 37;
    const tipX = Math.round(narrow ? W * 0.24 : W / 2);
    const L = narrow ? W - tipX - 34 : Math.min(480, W - tipX - 140);
    const r = 1 - P / L;
    const rail = parseFloat(getComputedStyle(t).getPropertyValue("--rail")) || 84;
    // the road ends where a step is under half a pixel
    const K = Math.ceil(Math.log(0.5 / s0) / Math.log(r));
    G.current = { s0, P, tipX, L, r, end: tipX + L, rail, K };
    t.style.setProperty("--s0", s0 + "px");
    t.classList.toggle("narrow", narrow);
    t.style.setProperty("--fade", Math.round(tipX * 0.82) + "px");
    n.style.transformOrigin = `${tipX + L}px ${rail}px`;
    const rs = s0 + 9;
    o.style.width = o.style.height = rs + "px";
    o.style.transform = `translate(${tipX - rs / 2}px, ${rail - rs / 2}px)`;
    cur.current?.style.setProperty("--x", tipX + "px");
  };

  // the activation block's square and the dimension line from the newest block to it
  const placeDest = (g: Geom, at: number) => {
    const left = Math.max(0, TARGET - at), reached = left === 0;
    const x = reached ? g.tipX - (at - TARGET) * g.P : xAt(g, left);
    const s = reached ? g.s0 : Math.max(g.s0 * 0.72, sAt(g, left));
    const k = s / 28;
    if (dst.current) {
      dst.current.style.transform = `translate(${x.toFixed(2)}px, ${g.rail}px)`;
      dst.current.style.visibility = reached && x < -20 ? "hidden" : "";
    }
    if (dstSq.current) {
      dstSq.current.style.transform = `scale(${k.toFixed(4)})`;
      // its ring as thick as the newest block's, whatever the square's scale
      dstSq.current.style.boxShadow = `0 0 0 ${(3 / k).toFixed(2)}px var(--paper), 0 0 0 ${(4.5 / k).toFixed(2)}px var(--celestia)`;
    }
    const w = Math.max(0, x - g.tipX);
    if (gap.current) gap.current.style.transform = `translateX(${g.tipX.toFixed(2)}px)`;
    if (gapLine.current) gapLine.current.style.transform = `scaleX(${(w / 1000).toFixed(5)})`;
    if (gapLab.current) gapLab.current.style.transform = `translateX(${(w / 2 - gapLab.current.offsetWidth / 2).toFixed(2)}px)`;
    if (gapEnd.current) gapEnd.current.style.transform = `translateX(${w.toFixed(2)}px)`;
    tr.current?.classList.toggle("near", x - g.tipX < 200);
  };

  const draw = (at: number) => {
    const g = G.current, a = past.current, b = next.current;
    if (!g || !a || !b) return;
    const left = Math.max(0, TARGET - at);
    // the chain: the newest under the clock, the older ones to its left
    let s = "";
    for (let j = Math.ceil(g.tipX / g.P) + 2; j >= 0; j--) s += sq(g, g.tipX - j * g.P, g.s0, (j === 0 ? "tip" : "") + (at - j === TARGET ? " act" : ""));
    a.innerHTML = s;
    // the road: the blocks still to come, each a step smaller and fainter, up to the activation block
    s = "";
    for (let k = 1, n = Math.min(left - 1, g.K); k <= n; k++) s += sq(g, xAt(g, k), sAt(g, k), "slot", `opacity:${Math.max(0.28, 1 - (k / g.K) * 0.72).toFixed(3)}`);
    b.innerHTML = s;
    placeDest(g, at);
  };

  // one block in: the chain slides one place left, the road grows one step about its far point; then drawn again
  const step = (at: number) => {
    const g = G.current, a = past.current, b = next.current, t = tr.current;
    if (!g || !a || !b || !t) return;
    window.clearTimeout(settle.current);
    a.classList.add("go"); b.classList.add("go");
    a.style.transform = `translateX(${-g.P}px)`;
    b.style.transform = `scale(${(1 / g.r).toFixed(5)})`;
    a.lastElementChild?.classList.remove("tip");
    const first = b.firstElementChild as HTMLElement | null;
    if (first) { first.classList.add("in"); first.style.opacity = "1"; }
    placeDest(g, at);
    settle.current = window.setTimeout(() => {
      a.classList.remove("go"); b.classList.remove("go");
      a.style.transform = ""; b.style.transform = "";
      draw(drawn.current);
    }, (parseFloat(getComputedStyle(t).getPropertyValue("--step")) || 620) + 40);
  };

  // the layout, and again whenever the track's width changes
  useEffect(() => {
    const t = tr.current;
    if (!t) return;
    geom();
    if (drawn.current) draw(drawn.current);
    let rz: number | undefined;
    const ro = new ResizeObserver(() => { window.clearTimeout(rz); rz = window.setTimeout(() => { geom(); if (drawn.current) draw(drawn.current); }, 120); });
    ro.observe(t);
    return () => { ro.disconnect(); window.clearTimeout(rz); window.clearTimeout(settle.current); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // each block: one step when it is the next one and the page can move, else drawn again
  useEffect(() => {
    if (!h) return;
    const before = drawn.current;
    drawn.current = h;
    let still = false;
    try { still = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { /* it moves */ }
    if (before && h === before + 1 && !still && !document.hidden && h <= TARGET) step(h);
    else draw(h);
  }, [h]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="tr" ref={tr} aria-label="The chain to the activation block">
      <div className="tr-pastwrap"><div className="tr-grp" ref={past} /></div>
      <div className="tr-grp" ref={next} />
      <div className="tr-now" ref={ring} aria-hidden="true" />
      <div className="tr-tk tr-cur" ref={cur}><span className="tr-k">Current block</span><span className={`tr-v${h ? "" : " wait"}`}>{h ? int(h) : "00,000,000"}</span></div>
      <div className="tr-gap" ref={gap} aria-hidden="true">
        <div className="tr-gap-end" /><div className="tr-gap-end" ref={gapEnd} />
        <div className="tr-gap-line" ref={gapLine} />
        <div className="tr-gap-lab" ref={gapLab}><b>{togo != null ? int(togo) : "00,000"}</b> blocks to go</div>
      </div>
      <div className="tr-dst" ref={dst}>
        <div className="tr-dst-sq" ref={dstSq} />
        <div className="tr-tk">
          <span className="tr-k">Activation block</span><span className="tr-v">{int(TARGET)}</span>
          {togo != null && togo > 0 && <span className="tr-n"><b>{int(togo)}</b> {togo === 1 ? "block" : "blocks"} to go</span>}
        </div>
      </div>
    </section>
  );
}
