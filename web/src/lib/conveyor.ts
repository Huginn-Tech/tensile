/**
 * The overview's recent-blobs grid moves like a conveyor: the blobs a beat brings (a block's, all settled at one
 * moment) come in one at a time, STEP_MS apart, in one slide that eases at each place, rather than in one jump of
 * several places. A lone blob slides in SLIDE_MS as it always did. The first place moves the moment the beat is drawn,
 * so nothing comes later than before; a beat of many shortens its steps so the whole slide stays within MAX_MS, well
 * inside a block, and the grid never falls behind the chain. Nothing is read for it: the grid's one read per block
 * brings the beat, and the slide is the tapes' transform alone.
 */

/** a lone blob's slide */
export const SLIDE_MS = 420;
/** one place of a beat of several */
export const STEP_MS = 150;
/** the longest slide, however many places */
export const MAX_MS = 1000;
/** each step's ease, the lone slide's own: quick off, settling into its place */
const EASE = "cubic-bezier(.2, .8, .2, 1)";

export type Slide = { steps: number; stepMs: number; ms: number };

/** the slide of a beat of n blobs on a grid cols wide: a row's tape moves at most cols places */
export function slide(n: number, cols: number): Slide {
  const steps = Math.max(1, Math.min(n, cols));
  if (steps === 1) return { steps, stepMs: SLIDE_MS, ms: SLIDE_MS };
  const stepMs = Math.min(STEP_MS, Math.floor(MAX_MS / steps));
  return { steps, stepMs, ms: steps * stepMs };
}

/** a row's tape over the slide, from `steps` places back to its place: one keyframe a place, each eased */
export function frames(s: Slide, pitch: number): Keyframe[] {
  return Array.from({ length: s.steps + 1 }, (_, k) => ({
    transform: `translateX(${-(s.steps - k) * pitch}px)`,
    offset: k / s.steps,
    easing: EASE,
  }));
}

/**
 * when the place i of the grid (0 the newest) comes into view after the slide starts, in ms: the oldest of the beat
 * first, the newest last; a place past the slide's reach is in view from the start
 */
export function enters(i: number, s: Slide): number {
  return i < s.steps ? (s.steps - 1 - i) * s.stepMs : 0;
}
