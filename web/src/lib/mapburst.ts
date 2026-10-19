/**
 * The overview map's burst, drawn: what the places of a beat's endorsers do (lib/mapflash.ts says which places). It
 * takes the logic of a block explorer's live map, not its look: the land, the badges and the colours stay the map's.
 *
 * - Pop: each place's badge squeezes a little, swells to 1.2x filled with its own ring colour (a lone dot swells and
 *   brightens instead), and settles back, in POP_MS. On the badge itself, once.
 * - Ring: one thin ring per place leaves the badge's rim and slows as it goes (ease-out-quart) over RING_MS, light
 *   (--cm-burst-hi: white on the dark map) for its first third and then the map's teal (--cm-live), fading as
 *   (1 - t)^2.5; a place of many endorsers sends it further and a little brighter. Every ring is on one canvas under
 *   the badges, drawn at most FPS times a second and only while a ring is out.
 * - Warmth: each place keeps a little, a soft teal under its badge that halves every HALF_MS; a burst adds to it, so a
 *   place that endorses block after block stays warm. It steps down once a second (STEP_MS) rather than animating:
 *   at its strength a step is not seen, and a map of twenty places animating for half a minute cost a sixth of a core.
 *
 * Nothing here touches the land or its material layer, and between bursts only the warmth's step runs, while any
 * place is warm. The page decides when a burst may run at all: not with reduced motion, not while hidden (stop()
 * clears what is out).
 */

/** a place of the burst and how many of the beat's endorsers it holds */
export type BurstPlace = { id: string; n: number };
/** where a place is now, in the canvas's CSS px, its badge's radius, and its badge and warmth elements */
export type Where = (id: string) => { x: number; y: number; r: number; badge: HTMLElement | null; trace: HTMLElement | null; one: boolean } | null;

export const POP_MS = 420;
export const RING_MS = 1300;
export const HALF_MS = 8000;
const STEP_MS = 1000;
const FPS = 30;

type Ring = { id: string; n: number; t0: number };

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const smooth = (a: number, b: number, v: number) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const easeOutQuart = (t: number) => 1 - (1 - t) ** 4;

/** "#8fe3ea", "rgb(143, 227, 234)" -> [143, 227, 234]; teal when unreadable */
function rgb(c: string): [number, number, number] {
  const s = c.trim();
  const h = /^#([0-9a-f]{6})$/i.exec(s);
  if (h) return [parseInt(h[1].slice(0, 2), 16), parseInt(h[1].slice(2, 4), 16), parseInt(h[1].slice(4, 6), 16)];
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(s);
  return m ? [+m[1], +m[2], +m[3]] : [51, 179, 191];
}

/** a place's warmth: h at t (ms), halving every HALF_MS from there; a burst adds 0.3 and a little more for many endorsers */
export function warmthAt(w: { h: number; t: number } | undefined, now: number): number {
  return w ? w.h * 0.5 ** ((now - w.t) / HALF_MS) : 0;
}
export function warmer(w: { h: number; t: number } | undefined, n: number, now: number): { h: number; t: number } {
  return { h: Math.min(1, warmthAt(w, now) + 0.3 + 0.07 * Math.sqrt(n)), t: now };
}

export class Burst {
  private rings: Ring[] = [];
  private warmth = new Map<string, { h: number; t: number }>();
  private raf = 0;
  private drawn = 0;
  private step: ReturnType<typeof setInterval> | undefined;
  private ctx: CanvasRenderingContext2D | null;
  private dpr = 1;
  private teal: [number, number, number] = [51, 179, 191];
  private hi: [number, number, number] = [255, 255, 255];
  private canvas: HTMLCanvasElement;
  private where: Where;

  constructor(canvas: HTMLCanvasElement, where: Where) {
    this.canvas = canvas;
    this.where = where;
    this.ctx = canvas.getContext("2d");
  }

  /** the canvas's size in CSS px, at the screen's resolution */
  size(w: number, h: number, dpr: number): void {
    this.dpr = dpr;
    const W = Math.round(w * dpr), H = Math.round(h * dpr);
    if (this.canvas.width !== W) this.canvas.width = W;
    if (this.canvas.height !== H) this.canvas.height = H;
    if (this.rings.length === 0) this.ctx?.clearRect(0, 0, W, H);
  }

  /** a beat's places: each pops, sends its ring and warms, now */
  fire(places: BurstPlace[], now = performance.now()): void {
    if (places.length === 0) return;
    const cs = getComputedStyle(this.canvas);
    this.teal = rgb(cs.getPropertyValue("--cm-live") || "#33b3bf");
    this.hi = rgb(cs.getPropertyValue("--cm-burst-hi") || "#ffffff");
    for (const p of places) {
      const at = this.where(p.id);
      if (!at) continue;
      if (at.badge) this.pop(at.badge, at.one);
      const w = warmer(this.warmth.get(p.id), p.n, now);
      this.warmth.set(p.id, w);
      if (at.trace) at.trace.style.opacity = w.h.toFixed(3);
      this.rings = this.rings.filter((r) => r.id !== p.id);
      this.rings.push({ id: p.id, n: p.n, t0: now });
    }
    if (!this.raf) this.raf = requestAnimationFrame(this.frame);
    if (this.step === undefined) this.step = setInterval(this.cool, STEP_MS);
  }

  /** what is out goes: the page was hidden, or the map went away; the warmth stays, and steps down from where it is */
  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.rings = [];
    this.ctx?.clearRect(0, 0, this.canvas.width, this.canvas.height);
    clearInterval(this.step);
    this.step = undefined;
  }

  private pop(badge: HTMLElement, one: boolean) {
    if (one) {
      badge.animate([
        { transform: "scale(1)", filter: "brightness(1)" },
        { transform: "scale(0.96)", filter: "brightness(1.15)", offset: 0.1 },
        { transform: "scale(1.35)", filter: "brightness(1.9)", offset: 0.4 },
        { transform: "scale(1)", filter: "brightness(1)" },
      ], { duration: POP_MS, easing: "ease-out" });
      return;
    }
    const fill = getComputedStyle(badge).getPropertyValue("--cm-ring").trim() || "#33b3bf";
    const ink = getComputedStyle(this.canvas).getPropertyValue("--cm-open-ink").trim() || "#04171a";
    badge.animate([
      { transform: "scale(1)" },
      { transform: "scale(0.96)", backgroundColor: fill, offset: 0.1 },
      { transform: "scale(1.2)", backgroundColor: fill, offset: 0.4 },
      { transform: "scale(1)", backgroundColor: fill, offset: 0.6 },
      { transform: "scale(1)" },
    ], { duration: POP_MS, easing: "ease-out" });
    // the figure in the fill's ink while the fill is on, back at once when the fill is half gone, never mid-way grey
    badge.animate([{ color: ink, offset: 0.1 }, { color: ink, offset: 0.8, easing: "steps(1, start)" }], { duration: POP_MS, easing: "ease-out" });
  }

  /** a step of the warmth, once a second while any place is warm */
  private cool = () => {
    const now = performance.now();
    for (const [id, w] of this.warmth) {
      const h = warmthAt(w, now);
      const el = this.where(id)?.trace;
      if (h < 0.03) {
        this.warmth.delete(id);
        if (el) el.style.opacity = "0";
      } else if (el) el.style.opacity = h.toFixed(3);
    }
    if (this.warmth.size === 0) { clearInterval(this.step); this.step = undefined; }
  };

  private frame = (now: number) => {
    const ctx = this.ctx;
    this.rings = this.rings.filter((r) => now - r.t0 < RING_MS);
    if (!ctx) { this.raf = 0; return; }
    if (this.rings.length === 0) {
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.raf = 0;
      return;
    }
    this.raf = requestAnimationFrame(this.frame);
    // at most FPS draws a second: the rings are thin and slow enough, and every draw is the canvas's layer drawn again
    if (now - this.drawn < 1000 / FPS - 4) return;
    this.drawn = now;
    const d = this.dpr;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const [tr, tg, tb] = this.teal, [hr, hg, hb] = this.hi;
    for (const ring of this.rings) {
      const at = this.where(ring.id);
      if (!at) continue;
      const t = clamp((now - ring.t0) / RING_MS, 0, 1);
      const reach = 9 + 4.5 * Math.sqrt(ring.n);
      const radius = at.r + 1 + reach * easeOutQuart(t);
      const alpha = (1 - t) ** 2.5 * Math.min(0.7, 0.32 + 0.07 * Math.sqrt(ring.n));
      if (alpha < 0.01) continue;
      const w = smooth(0, 0.35, t);
      const c = [hr + (tr - hr) * w, hg + (tg - hg) * w, hb + (tb - hb) * w].map(Math.round).join(", ");
      ctx.beginPath();
      ctx.arc(at.x * d, at.y * d, radius * d, 0, 2 * Math.PI);
      ctx.strokeStyle = `rgba(${c}, ${alpha.toFixed(3)})`;
      ctx.lineWidth = (1.4 - 0.5 * t) * d;
      ctx.stroke();
    }
  };
}
