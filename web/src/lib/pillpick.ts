/**
 * What the overview map's pill names, one validator at a time: an endorser of the newest beat of blobs, "B-Harvest
 * endorsed · 12 s ago". A beat is one block's blobs as the grid takes them in; its endorsers are the
 * union of theirs, the very places that burst on the map (lib/mapflash.ts, endorsersOf on each blob's record). They
 * are named in a shuffled order, each once, a new one every ROTATE_MS, and the last named stays until the next
 * beat: one round, never again; a new beat takes the pill at once, with one of its own endorsers picked at random.
 * What the page opened with is not news: it is named by one of its endorsers, still, with its age. A
 * beat is taken up once its endorsers are known (its records have answered); until then the pill keeps what it
 * names, or waits, empty, when it names nothing yet. Endorsers that become known later join the names still to come.
 * A validator's new or changed endpoint takes the pill for HOLD_MS when it happens; the endorsers come back after,
 * where they were.
 */

/** ms between two endorsers named */
export const ROTATE_MS = 1000;
/** ms a new or changed endpoint holds the pill */
export const HOLD_MS = 12000;

export type Shown<E> =
  | { kind: "endorser"; who: string; key: string; at: string }
  | { kind: "wait" }
  | { kind: "endpoint"; ev: E }
  | null;

/** a fresh order of xs: Fisher-Yates with rand */
function shuffle(xs: string[], rand: () => number): string[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class PillPicker<E> {
  private key = "";
  private at = "";
  private order: string[] | null = null;
  /** whether the beat came while the page was open; the one it opened with names one endorser and stays still */
  private live = true;
  private i = 0;
  private ep: E | null = null;
  private epUntil = 0;
  /** a beat came before any was taken up, its endorsers not known yet: the pill waits for them, empty */
  private waiting = false;
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
   * endorsers as far as they are known (null while none is). A new beat is named at once, by a random endorser, once
   * any of its endorsers is known; until then it is not taken up, and the pill keeps what it names. The same beat
   * with more endorsers known adds them, shuffled, after the one named now.
   */
  beat(key: string, at: string, endorsers: string[] | null, live = true): void {
    const order = this.order;
    if (key === this.key && order) {
      if (!this.live) return;
      const fresh = (endorsers ?? []).filter((e) => !order.includes(e));
      if (fresh.length) order.splice(this.i + 1, 0, ...shuffle(fresh, this.rand));
      return;
    }
    if (!endorsers || endorsers.length === 0) {
      if (!this.key) this.waiting = true;
      return;
    }
    this.key = key;
    this.at = at;
    this.live = live;
    this.order = live ? shuffle(endorsers, this.rand) : [endorsers[Math.floor(this.rand() * endorsers.length)]];
    this.i = 0;
    this.waiting = false;
  }

  /** a validator's new or changed endpoint, as it happens: the pill is its for HOLD_MS from now */
  endpoint(ev: E, now: number): void {
    this.ep = ev;
    this.epUntil = now + HOLD_MS;
  }

  /** the next endorser (every ROTATE_MS), until the last, which stays; not while an endpoint holds the pill */
  tick(now: number): void {
    if (now < this.epUntil || !this.order || this.i >= this.order.length - 1) return;
    this.i++;
  }

  /** what the pill names now */
  show(now: number): Shown<E> {
    if (this.ep && now < this.epUntil) return { kind: "endpoint", ev: this.ep };
    if (this.key && this.order) return { kind: "endorser", who: this.order[this.i], key: this.key, at: this.at };
    if (this.ep) return { kind: "endpoint", ev: this.ep };
    return this.waiting ? { kind: "wait" } : null;
  }
}
