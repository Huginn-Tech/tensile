/**
 * The countdown to Fibre's activation on a network that does not have it yet: when the activation block is expected,
 * from the blocks the page has seen. Until it has seen BLOCK_SPAN blocks of its own, a block is taken to last
 * BLOCK_MS_GUESS, Celestia's block time in October 2026; from then on, what those blocks took. The estimate is the
 * newest block's time plus the blocks still to come at that pace, so it moves a little with each block and never
 * runs ahead of the chain.
 */

/** Celestia's block time before the page has a measure of its own (mainnet and Mocha, October 2026: 2.9 s) */
export const BLOCK_MS_GUESS = 2890;
/** blocks seen before their own pace is trusted over the guess */
export const BLOCK_SPAN = 40;
/** blocks kept for the pace */
const KEEP = 600;

/** a block as the page saw it: its height and its time (ms since the epoch) */
export type Seen = { h: number; t: number };

/** seen with one more block: once per height, in height order, the oldest dropped past KEEP */
export function see(seen: Seen[], b: Seen): Seen[] {
  if (!Number.isFinite(b.h) || !Number.isFinite(b.t)) return seen;
  const last = seen[seen.length - 1];
  if (last && b.h <= last.h) return seen;
  const out = [...seen, b];
  return out.length > KEEP ? out.slice(out.length - KEEP) : out;
}

/** ms a block lasts: the seen blocks' own pace once they span BLOCK_SPAN blocks, else BLOCK_MS_GUESS */
export function blockMs(seen: Seen[]): number {
  if (seen.length < 2) return BLOCK_MS_GUESS;
  const a = seen[0], b = seen[seen.length - 1];
  const span = b.h - a.h;
  if (span < BLOCK_SPAN || b.t <= a.t) return BLOCK_MS_GUESS;
  return (b.t - a.t) / span;
}

/** when the block at target is expected (ms since the epoch), from the newest seen block; null before any */
export function expectedAt(target: number, seen: Seen[]): number | null {
  const last = seen[seen.length - 1];
  if (!last) return null;
  return last.t + Math.max(0, target - last.h) * blockMs(seen);
}

/** a span of ms as whole days, hours, minutes and seconds, never below zero */
export function parts(ms: number): { d: number; h: number; m: number; s: number } {
  const t = Math.max(0, Math.floor(ms / 1000));
  return { d: Math.floor(t / 86400), h: Math.floor((t % 86400) / 3600), m: Math.floor((t % 3600) / 60), s: t % 60 };
}
