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
  useEffect(() => {
    // A page that waited on the countdown opens within 3 s of the news, at a time of its own: the stream tells every
    // open page in the same instant, and all of them asking for the explorer's data at once would be more than the
    // site's proxy lets through together. A page opened once Fibre is live opens at once.
    let waited = false, t: number | undefined;
    const off = onTip((f) => {
      if (!f.data) return;
      if (!f.data.fibre_active) { waited = true; return; }
      if (t === undefined) t = window.setTimeout(() => setLive(true), waited ? Math.random() * 3000 : 0);
    });
    return () => { off(); window.clearTimeout(t); };
  }, []);
  return live ? <>{children}</> : <Countdown />;
}

const UTC = (t: number) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" }).format(t) + " UTC";
const LOCAL = (t: number) => new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", timeZoneName: "short" }).format(t);
const two = (n: number) => String(n).padStart(2, "0");

/**
 * The countdown: the time left as a clock, under it the chain's newest block, the activation block, the blocks to go
 * and when it is expected (in UTC and the reader's own time), all from the tip as each block comes; then what opens
 * here, and the way to Fibre on the other network meanwhile. The clock counts each second to the expected time
 * (lib/countdown.ts), which each block sets anew.
 */
function Countdown() {
  const tip = useTip();
  const d = tip.data;
  const seen = useRef<Seen[]>([]);
  const [beat, setBeat] = useState(0);
  const [now, setNow] = useState<number | null>(null);
  // each new block: seen, and the dot beside the height lights once
  const h = d?.height, bt = d?.block_time;
  useEffect(() => {
    if (!h || !bt) return;
    const before = seen.current[seen.current.length - 1]?.h ?? 0;
    seen.current = see(seen.current, { h, t: Date.parse(bt) });
    if (before && (seen.current[seen.current.length - 1]?.h ?? 0) > before) setBeat((n) => n + 1);
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
  // the clock at zero before the block: the chain is slower than its pace said, and the block is due any moment
  const due = left != null && left <= 0 && !reached;
  // the expected minute, as a reader reads a time
  const atMin = at != null ? Math.round(at / 60000) * 60000 : null;
  const units: [string, string][] = p
    ? [...(p.d > 0 ? [[String(p.d), p.d === 1 ? "day" : "days"] as [string, string]] : []), [two(p.h), "hours"], [two(p.m), "minutes"], [two(p.s), "seconds"]]
    : [["00", "hours"], ["00", "minutes"], ["00", "seconds"]];
  const said = due ? "Any moment" : p ? `${p.d ? `${p.d} days ` : ""}${p.h} hours ${p.m} minutes left` : "Connecting";
  // the other network's site at this page's own path: a link to this domain from before mainnet was a Mocha one
  const [path, setPath] = useState("");
  useEffect(() => { setPath(window.location.pathname + window.location.search); }, []);
  const other = OTHER_SITE ? OTHER_SITE.origin + (path === "/" ? "" : path) : "";

  return (
    <div className="lc">
      <header className="lc-top">
        <a className="lc-brand" href="/" aria-label="Tensile"><Mark size={20} /><span>Tensile</span></a>
        {OTHER_SITE && <a className="lc-other" href={other}>Tensile on {OTHER_SITE.label} <span aria-hidden="true">→</span></a>}
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
        <dl className="lc-facts">
          <div><dt>Current block</dt><dd>{h ? <><i key={beat} className={`bt-dot ok${beat ? " beat" : ""}`} aria-hidden="true" />{int(h)}</> : <span className="wait">00,000,000</span>}</dd></div>
          <div><dt>Activation block</dt><dd>{int(TARGET)}</dd></div>
          <div><dt>Blocks to go</dt><dd>{togo != null ? int(togo) : <span className="wait">00,000</span>}</dd></div>
          <div><dt>Expected around</dt><dd>{reached ? "Now" : due ? "Any moment" : atMin != null ? <>{UTC(atMin)}<small>{LOCAL(atMin)} your time</small></> : <span className="wait">Oct 00, 00:00 UTC</span>}</dd></div>
        </dl>
        <p className="lc-note">
          {reached
            ? "The activation block is in. Tensile opens here as soon as the chain reports Fibre live."
            : "From that block on, this is Tensile's explorer for Fibre on mainnet: blobs, publishers, escrow, Fibre providers, validators and their endorsements, in real time. It opens here by itself."}
        </p>
        {OTHER_SITE && <p className="lc-links"><a className="lc-btn" href={other}>Explore Fibre on {OTHER_SITE.label} now <span aria-hidden="true">→</span></a></p>}
      </main>
    </div>
  );
}
