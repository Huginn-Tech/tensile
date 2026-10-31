/**
 * The height scale of the Blobs chart, its hours as its days. A very busy day must
 * not flatten the quiet ones, so when the tallest bar runs far past an ordinary
 * one the bars stand on a log scale: each step of ten the same height, a zero
 * still a zero (no bar), and every day's figure printed over its bar. When the
 * days are of a size it is a plain linear scale, where 3 reads as three times 1.
 *
 * The figures are in one unit for the whole plot, an ordinary day's, so a small
 * day keeps its digits: 6 and 2,364 MiB, not 0.01 and 2.31 GiB. On a log scale a
 * day far over the rest is printed in full, in its own unit, which is why it is
 * named in `busy`: past Q3 + 3 IQR with six active days at least to call anything
 * ordinary, and past 1.6 times the round top of what is left.
 */
export type DayMeasure = "n" | "bytes" | "fees";

export type DayScale = {
  log: boolean;
  /** the plot's unit, for the chart's title: "MiB", "TIA", "" for a count */
  unit: string;
  /** a value's height, from 0 to 1 of the plot */
  at: (v: number) => number;
  /** the gridlines, lowest first: a value and its label */
  ticks: { v: number; label: string }[];
  /** the indexes of the days far over the rest */
  busy: Set<number>;
  /** a value as a figure in the plot's unit: "2,364", "6", "0.25" */
  short: (v: number) => string;
};

/** the tallest bar is at least this many ordinary ones: below it the bars are of a size */
export const LOG_AT = 5;

/** the day names under the bars keep this far apart */
const NAME_GAP = 18;

/** the day numbers worth naming, every one first, then round ones, thinner as the days multiply */
const THIN: ((d: number) => boolean)[] = [
  () => true,
  (d) => d % 2 === 1 && d < 31,
  (d) => d === 1 || (d % 5 === 0 && d < 30),
  (d) => d === 1 || d === 10 || d === 20,
  (d) => d === 1 || d === 15,
  (d) => d === 1,
];

const MIB = 2 ** 20, GIB = 2 ** 30, TIB = 2 ** 40;

const quantile = (s: number[], q: number): number => {
  const i = (s.length - 1) * q, lo = Math.floor(i);
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo);
};

const size = (b: number) =>
  b >= TIB ? { div: TIB, name: "TiB" } : b >= GIB ? { div: GIB, name: "GiB" } : b >= MIB ? { div: MIB, name: "MiB" } : { div: 1024, name: "KiB" };

/** an ordinary day's unit, unless that would run the scale past four digits */
function unitOf(measure: DayMeasure, top: number, med: number): { div: number; name: string } {
  if (measure === "n") return { div: 1, name: "" };
  if (measure === "fees") return { div: 1e6, name: "TIA" };
  const day = size(top >= MIB ? Math.max(MIB, Math.min(top, med)) : top);
  return top / day.div < 1e4 ? day : size(top);
}

/** the lowest round top over max in two or three steps; a count never steps by less than one */
function roundTop(max: number, whole: boolean): { top: number; step: number; k: number } {
  if (max <= 0) return { top: 1, step: 1, k: 1 };
  const mag = 10 ** Math.floor(Math.log10(max));
  let best: { top: number; step: number; k: number } | null = null;
  for (const m of [mag / 10, mag]) for (const s of [1, 2, 2.5, 5]) {
    const step = s * m;
    if (whole && (step < 1 || !Number.isInteger(step))) continue;
    const k = Math.ceil(max / step - 1e-9), top = k * step;
    if (k < 2 || k > 3) continue;
    if (!best || top < best.top - 1e-9 || (Math.abs(top - best.top) < 1e-9 && k > best.k)) best = { top, step, k };
  }
  return best ?? { top: max, step: max, k: 1 };
}

const group = (x: number) => Math.round(x).toLocaleString("en-US");
const tick = (x: number) => (x >= 1e6 ? `${+(x / 1e6).toFixed(1)}M` : x >= 1e4 ? `${+(x / 1e3).toFixed(1)}K` : (+x.toFixed(2)).toLocaleString("en-US"));

export function dayScale(vals: number[], measure: DayMeasure): DayScale {
  const act = vals.filter((v) => v > 0).sort((a, b) => a - b);
  const max = act.length > 0 ? act[act.length - 1] : 0, med = act.length > 0 ? quantile(act, 0.5) : 0;
  const log = max > 0 && max >= LOG_AT * med;
  // the days far over the rest, the least of them first: a day too near what is left to stand apart goes back among them
  let far: number[] = [];
  if (log && act.length >= 6) {
    const q1 = quantile(act, 0.25), q3 = quantile(act, 0.75), fence = q3 + 3 * (q3 - q1);
    far = vals.map((_, i) => i).filter((i) => vals[i] > fence).sort((a, b) => vals[a] - vals[b]);
  }
  const unitWithout = (busy: Set<number>) => {
    const rest = Math.max(0, ...vals.filter((_, i) => !busy.has(i)));
    return { rest, u: unitOf(measure, rest, med) };
  };
  while (far.length > 0) {
    const { rest, u } = unitWithout(new Set(far));
    if (vals[far[0]] > roundTop(rest / u.div, measure === "n").top * u.div * 1.6) break;
    far = far.slice(1);
  }
  const busy = new Set(far), u = unitWithout(busy).u;
  const short = (v: number): string => {
    if (v === 0) return "0";
    const x = v / u.div;
    return x >= 1e4 ? `${Math.round(x / 1e3)}K` : x >= 100 ? group(x) : x >= 1 ? (Number.isInteger(x) ? String(x) : x.toFixed(1)) : x >= 0.005 ? x.toFixed(2) : "<.01";
  };
  if (!log) {
    const t = roundTop(max / u.div, measure === "n");
    const ticks: DayScale["ticks"] = [];
    for (let k = 1; k <= t.k; k++) ticks.push({ v: k * t.step * u.div, label: tick(k * t.step) });
    return { log, unit: u.name, at: (v) => v / (t.top * u.div), ticks, busy, short };
  }
  // log(1 + v / low): the smallest day stands clear of the baseline and a zero has no height
  const low = act[0], f = (v: number) => Math.log10(1 + v / low), fm = f(max);
  const ticks: DayScale["ticks"] = [];
  for (let e = -2; e < 9; e++) {
    const v = 10 ** e * u.div;
    if (v >= low && v <= max * 1.001) ticks.push({ v, label: tick(10 ** e) });
  }
  return { log, unit: u.name, at: (v) => f(v) / fm, ticks, busy, short };
}

/** which of these days (day numbers, in order) to name under bars `slot` px apart */
export function namedDays(days: number[], slot: number): number[] {
  for (const rule of THIN) {
    const keep = days.flatMap((d, i) => (rule(d) ? [i] : []));
    if (keep.every((k, j) => j === 0 || slot * (k - keep[j - 1]) >= NAME_GAP)) return keep;
  }
  return [];
}
