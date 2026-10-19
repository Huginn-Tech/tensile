/**
 * What the overview map's pill names, one validator at a time: an endorser of the newest beat of blobs, "B-Harvest
 * endorsed the latest blob · 12 s ago". A beat is one block's blobs as the grid takes them in; its endorsers are the
 * union of theirs, the very places that burst on the map (lib/mapflash.ts, endorsersOf on each blob's record). They
 * are named in a shuffled order, each once, a new one every ROTATE_MS, and round again (shuffled anew) until the next
 * beat; a new beat takes the pill at once, with one of its own endorsers picked at random. A beat whose endorsers are
 * not known yet (its records have not answered, or none endorsed) is named plainly as settled; endorsers that become
 * known later join the names still to come. A validator's new or changed endpoint takes the pill for HOLD_MS when it
 * happens; the endorsers come back after, where they were.
 */

/** ms between two endorsers named */
export const ROTATE_MS = 1000;
/** ms a new or changed endpoint holds the pill */
export const HOLD_MS = 12000;

export type Shown<E> =
  | { kind: "endorser"; who: string; key: string; at: string }
  | { kind: "settled"; key: string; at: string }
  | { kind: "endpoint"; ev: E }
  | null;

/** a fresh order of xs: Fisher-Yates with rand; never starting with `not`, when it can help it */
function shuffle(xs: string[], rand: () => number, not?: string): string[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  if (a.length > 1 && a[0] === not) [a[0], a[1]] = [a[1], a[0]];
  return a;
}

export class PillPicker<E> {
  private key = "";
  private at = "";
  private order: string[] | null = null;
  private i = 0;
  private ep: E | null = null;
  private epUntil = 0;
  private rand: () => number;

  constructor(rand: () => number = Math.random) {
    this.rand = rand;
  }

  /** the endorsers of the beat named now, all of them (for the pill to keep its width for the longest name) */
  get names(): string[] {
    return this.order ?? [];
  }

  /**
   * The newest beat: a key for it (its newest blob's promise hash), when its block settled, and the union of its blobs'
   * endorsers as far as they are known (null while none is). A new beat is named at once, by a random endorser; the
   * same beat with more endorsers known adds them, shuffled, after the one named now.
   */
  beat(key: string, at: string, endorsers: string[] | null): void {
    if (key === this.key) {
      const fresh = (endorsers ?? []).filter((e) => !this.order?.includes(e));
      if (fresh.length === 0) return;
      if (this.order === null) { this.order = shuffle(fresh, this.rand); this.i = 0; return; }
      this.order.splice(this.i + 1, 0, ...shuffle(fresh, this.rand));
      return;
    }
    this.key = key;
    this.at = at;
    this.order = endorsers && endorsers.length ? shuffle(endorsers, this.rand) : null;
    this.i = 0;
  }

  /** a validator's new or changed endpoint, as it happens: the pill is its for HOLD_MS from now */
  endpoint(ev: E, now: number): void {
    this.ep = ev;
    this.epUntil = now + HOLD_MS;
  }

  /** the next endorser (every ROTATE_MS); round again, shuffled anew, after the last; not while an endpoint holds the pill */
  tick(now: number): void {
    if (now < this.epUntil || !this.order) return;
    this.i++;
    if (this.i >= this.order.length) {
      this.order = shuffle(this.order, this.rand, this.order[this.order.length - 1]);
      this.i = 0;
    }
  }

  /** what the pill names now */
  show(now: number): Shown<E> {
    if (this.ep && now < this.epUntil) return { kind: "endpoint", ev: this.ep };
    if (this.key) {
      return this.order ? { kind: "endorser", who: this.order[this.i], key: this.key, at: this.at } : { kind: "settled", key: this.key, at: this.at };
    }
    return this.ep ? { kind: "endpoint", ev: this.ep } : null;
  }
}
