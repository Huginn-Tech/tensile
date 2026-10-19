/**
 * The overview's blob stream, without a stutter and without a wait. The tip brings each block as it is committed,
 * a block's time apart, and that is already an even beat: a block that comes alone goes onto the grid the moment it
 * is in. Only blocks that come together (a read after a stall, or one that brought two blocks at once) are spread:
 * the first goes at once and each next one SPREAD_MS after the one before, so the grid, the map's burst and its pill
 * show them one at a time rather than in one jump; MAX or more waiting go out in one beat.
 *
 * - A block is never held for a beat of its own: it waits only while another went out less than SPREAD_MS ago.
 * - flush() lets everything out at once: the page was hidden, or the grid was held under the pointer.
 *
 * Every item goes out exactly once, in height order, in a beat with the rest of its block.
 */

/** ms between two blocks that came in together */
export const SPREAD_MS = 500;
const MAX = 4;

type Block<T> = { height: number; at: number; items: T[] };

export class Pacer<T> {
  private queue: Block<T>[] = [];
  private lastAt = -Infinity;
  private lastHeight = 0;

  /** an item of the block at height, come in at `at` (ms); a block already let out takes no more */
  offer(height: number, item: T, at: number): void {
    if (height <= this.lastHeight) {
      // a late blob of a block already shown: out with the next beat rather than lost
      const head = this.queue[0];
      if (head) head.items.push(item);
      else this.queue.push({ height: this.lastHeight, at, items: [item] });
      return;
    }
    let i = this.queue.findIndex((b) => b.height >= height);
    if (i < 0) i = this.queue.length;
    if (this.queue[i]?.height === height) this.queue[i].items.push(item);
    else this.queue.splice(i, 0, { height, at, items: [item] });
  }

  /** how many blocks wait */
  get waiting(): number {
    return this.queue.length;
  }

  /** when the next beat is due (ms), or null when nothing waits: as the head came in, unless a beat went out just before */
  due(): number | null {
    const head = this.queue[0];
    if (!head) return null;
    if (this.queue.length >= MAX) return head.at;
    return Math.max(head.at, this.lastAt + SPREAD_MS);
  }

  /** the beat due by now: the next block's items, or, MAX or more waiting, all of them together; [] when none is due */
  take(now: number): T[] {
    const due = this.due();
    if (due === null || due > now) return [];
    return this.out(this.queue.length >= MAX ? this.queue.length : 1, now);
  }

  /** everything at once */
  flush(now: number): T[] {
    return this.out(this.queue.length, now);
  }

  private out(n: number, now: number): T[] {
    const blocks = this.queue.splice(0, n);
    if (blocks.length === 0) return [];
    this.lastAt = now;
    this.lastHeight = Math.max(this.lastHeight, blocks[blocks.length - 1].height);
    return blocks.flatMap((b) => b.items);
  }
}
