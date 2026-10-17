"use client";
import { useState } from "react";
import Link from "next/link";
import { type Validator, int, shortMid } from "@/lib/api";
import { validatorHref } from "@/lib/addr";
import Info from "@/components/Info";
import { endpointState, readiness } from "@/components/Readiness";

/** ⅔ set from the text face's own numerals, on its baseline: the font's fraction glyph falls back heavier and off the line */
export function Frac() {
  return <b className="ov-frac"><span className="ov-frac-n">2</span><span className="ov-frac-s">⁄</span><span className="ov-frac-d">3</span></b>;
}

/* the dial: an open ring of 240°, its opening at the foot, angles from the top and clockwise */
const SPAN = 240, A0 = -SPAN / 2;
const SW = 6; // the ring's width, as the latest blob's bar is tall
const TILE = 6; // a validator this long (px) or longer is a stretch of its own, the shorter ones run together
const GAP = 1.5; // after a stretch of its own, before the next

type Tone = "on" | "hold" | "off";
type Seg = { v: Validator; tone: Tone; l0: number; l1: number; big: boolean };

/** the ring's geometry at outer radius R: its box, its centre line's length, and the path along it between two lengths */
function ring(R: number) {
  const rc = R - SW / 2, len = (rc * SPAN * Math.PI) / 180, cx = R + 2, cy = R + 2;
  const at = (deg: number, r: number): [number, number] => {
    const a = (deg * Math.PI) / 180;
    return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
  };
  const deg = (l: number) => A0 + (l / len) * SPAN;
  const arc = (l0: number, l1: number) => {
    const d0 = deg(l0), d1 = deg(l1), [x0, y0] = at(d0, rc), [x1, y1] = at(d1, rc);
    return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${rc} ${rc} 0 ${d1 - d0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  };
  // the box reaches down past the ring's ends to hold the share's second line, which sits in the opening
  return { R, len, cx, cy, at, deg, arc, w: 2 * R + 4, h: cy + 54 };
}

/**
 * Current Fibre providers: the share of voting power held by validators with
 * a Fibre provider registered, in the middle of a dial: the bonded set once
 * round an open ring, one stretch per validator, as long as its voting power,
 * those with a Fibre provider first and lit, largest first, the ones whose
 * host did not answer this observer's latest check after them in amber, then
 * the others. The ⅔ a blob needs to settle is a needle across it. A validator
 * long enough to read on its own is a stretch of its own; the long tail of
 * small ones runs together, one stretch per tone, so it reads calm and not as
 * hatching. Pointing at the ring names the validator under it in the middle,
 * however short its stretch. Under the dial, one line per part that is not a
 * working Fibre provider, each only when there is one, in columns. Every
 * stretch is a validator and every length a share of the chain's own records
 * (x/staking, x/valaddr); see Readiness.tsx.
 *
 * The dial's size depends only on how many lines stand under it, so it has its
 * size before any data; without rows yet it is one quiet ring with a
 * placeholder, and nothing around it moves when the list arrives.
 */
export default function CurrentProviders({ rows }: { rows: Validator[] | null }) {
  const r = rows ? readiness(rows) : null;
  const ready = !!r && r.total > 0;
  const { pct, regPower = 0, quorum = 0, total = 0 } = r ?? {};
  const [pick, setPick] = useState<string | null>(null);

  const byPower = (a: Validator, b: Validator) => (b.voting_power || 0) - (a.voting_power || 0);
  const reg = new Set(ready ? r!.registered.map((v) => v.address) : []);
  const up = ready ? r!.registered.filter((v) => endpointState(v) !== "unreachable").sort(byPower) : [];
  const down = ready ? r!.registered.filter((v) => endpointState(v) === "unreachable").sort(byPower) : [];
  const unchecked = up.filter((v) => endpointState(v) === "none");
  const off = ready ? r!.bonded.filter((v) => !reg.has(v.address)).sort(byPower) : [];

  // three lines under the dial take a smaller ring, so the window keeps its height
  const g = ring(ready && down.length > 0 && unchecked.length > 0 ? 80 : 92);
  let at = 0;
  const segs: Seg[] = ready ? [...up, ...down, ...off].map((v) => {
    const l0 = at;
    at += ((v.voting_power || 0) * g.len) / total;
    const tone: Tone = !reg.has(v.address) ? "off" : endpointState(v) === "unreachable" ? "hold" : "on";
    return { v, tone, l0, l1: at, big: at - l0 >= TILE };
  }) : [];
  // what is drawn: a stretch per validator long enough to read, one per run of shorter ones of a tone
  const runs: { tone: Tone; l0: number; l1: number; big: boolean }[] = [];
  for (const s of segs) {
    const last = runs[runs.length - 1];
    if (!s.big && last && !last.big && last.tone === s.tone) last.l1 = s.l1;
    else runs.push({ tone: s.tone, l0: s.l0, l1: s.l1, big: s.big });
  }
  const end = (l0: number, l1: number, gap: boolean) => Math.max(l0 + 0.6, gap && l1 - l0 > 2 * GAP ? l1 - GAP : l1);
  const p = pick ? segs.find((s) => s.v.address === pick) ?? null : null;
  const lq = total > 0 ? Math.min(1, Math.max(0, quorum / total)) * g.len : 0;
  const [nx0, ny0] = g.at(g.deg(lq), g.R - SW - 5), [nx1, ny1] = g.at(g.deg(lq), g.R + 4);
  const [qx, qy] = g.at(g.deg(lq), g.R - SW - 8);
  const [sx, sy] = g.at(A0, g.R - SW / 2), [ex, ey] = g.at(A0 + SPAN, g.R - SW / 2);
  const capTone = (s?: Seg) => `cp-cap ${s?.tone ?? "off"}${p && s && p === s ? " lit" : ""}`;
  const name = (v: Validator) => v.moniker || shortMid(v.operator_address || v.address, 18, 4);
  const standing = (s: Seg) => s.tone === "off" ? "no Fibre provider" : s.tone === "hold" ? "unreachable"
    : endpointState(s.v) === "none" ? "not checked yet" : "Fibre provider";
  // the pointer names the validator under it; a touch keeps it named until the next touch elsewhere on the dial
  const onOver = (e: React.PointerEvent<SVGSVGElement>) => setPick((e.target as Element).getAttribute("data-a"));
  const onLeave = (e: React.PointerEvent<SVGSVGElement>) => { if (e.pointerType !== "touch") setPick(null); };

  const power = (vs: Validator[]) => vs.reduce((n, v) => n + (v.voting_power || 0), 0);
  // a part of the stake on one line of the key: its swatch and name, its share, how many validators, each in a column
  const part = (sw: string, label: string, vs: Validator[], opens = false) => <>
    <span className="cp-k"><i className={`cp-sw${sw ? ` ${sw}` : ""}`} aria-hidden="true" />{label}</span>
    <span className="cp-v">{pct!(power(vs))}</span>
    <span className="cp-n">· {int(vs.length)} validator{vs.length === 1 ? "" : "s"}</span>
    {opens && <i className="cp-chev" aria-hidden="true" />}
  </>;

  return (
    <div className="cp" aria-busy={!ready || undefined}>
      <h2 id="readiness-h" className="ov-eyebrow">
        Current Fibre providers
        <Info label="Current Fibre providers"><p>Share of the stake held by validators with a Fibre provider. A blob needs signatures from ⅔ of the stake to settle.</p><p>The ring is the whole bonded stake. Each stretch is one validator, as long as its voting power: those with a Fibre provider first, largest first; point at one to see its name and share. Amber: its host did not answer Tensile&rsquo;s latest check.</p></Info>
      </h2>
      <div className={`cp-dial${p ? " pick" : ""}`} style={{ width: g.w, height: g.h }} role="img"
        aria-label={ready ? `${pct!(regPower)} of voting power with a Fibre provider, ${int(r!.registered.length)} of ${int(r!.bonded.length)} validators${down.length ? `, ${int(down.length)} of them unreachable` : ""}; ${pct!(quorum)} needed` : "Loading"}>
        {/* drawn anew when the rows arrive, so the ring sweeps in once */}
        <svg key={ready ? "on" : "wait"} className={`cp-ring${ready ? " on" : ""}`} width={g.w} height={g.h} viewBox={`0 0 ${g.w} ${g.h}`} aria-hidden="true" focusable="false"
          style={{ "--cy": `${g.cy}px` } as React.CSSProperties}
          onPointerOver={ready ? onOver : undefined} onPointerDown={ready ? onOver : undefined} onPointerLeave={ready ? onLeave : undefined}>
          {ready ? <>
            {runs.map((s, k) => (
              <path key={`${s.tone}${s.l0}`} className={`cp-seg ${s.tone}`} d={g.arc(s.l0, end(s.l0, s.l1, k < runs.length - 1))} strokeWidth={SW} />
            ))}
            <circle className={capTone(segs[0])} cx={sx} cy={sy} r={SW / 2} />
            <circle className={capTone(segs[segs.length - 1])} cx={ex} cy={ey} r={SW / 2} />
            {p && <path className={`cp-pt ${p.tone}`} d={g.arc(p.l0, Math.max(p.l0 + 1.5, end(p.l0, p.l1, p.big)))} strokeWidth={SW} />}
            <line className="cp-halo" x1={nx0} y1={ny0} x2={nx1} y2={ny1} />
            <line className="cp-needle" x1={nx0} y1={ny0} x2={nx1} y2={ny1} />
            {/* the pointer's targets: one per validator, its whole stretch and wider than the ring */}
            {segs.map((s) => (
              <path key={s.v.address} className="cp-hit" data-a={s.v.address} d={g.arc(s.l0, Math.max(s.l1, s.l0 + 0.5))} strokeWidth={SW + 16} />
            ))}
          </> : <path className="cp-seg cp-load" d={g.arc(0, g.len)} strokeWidth={SW} strokeLinecap="round" />}
        </svg>
        {ready && <span className="cp-q" style={{ left: qx, top: qy }}><Frac /> needed</span>}
        <p className="cp-read" style={{ top: g.cy - 28 }}>
          <b className={`ov-fig${ready ? "" : " cp-wait"}`}>{p ? pct!(p.v.voting_power || 0) : ready ? pct!(regPower) : "00.0%"}</b>
          <span>{p ? <b>{name(p.v)}</b> : ready ? "of voting power" : ""}</span>
          <span>{p ? standing(p) : ready ? <><b>{int(r!.registered.length)}</b> of {int(r!.bonded.length)} validators</> : ""}</span>
        </p>
      </div>
      {/* the parts of the stake that are not a working provider, one line each, the unreachable first: it opens the
          names of its validators, each a link to its page */}
      <ul className="cp-rest">
        {ready ? <>
          {down.length > 0 && <li>
            <Info label="Unreachable" className="cp-it" title="Show the unreachable validators" trigger={part("hold", "unreachable", down, true)}>
              <ul className="cp-names">
                {down.map((v) => (
                  <li key={v.address}>
                    <Link href={validatorHref(v.operator_address, v.address)}>{name(v)}</Link>
                    <span>{pct!(v.voting_power || 0)}</span>
                  </li>
                ))}
              </ul>
            </Info>
          </li>}
          <li><span className="cp-it">{part("", "no Fibre provider", off)}</span></li>
          {unchecked.length > 0 && <li><span className="cp-it">{part("none", "not checked yet", unchecked)}</span></li>}
        </> : <li className="cp-none" />}
      </ul>
    </div>
  );
}
