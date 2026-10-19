/**
 * The overview map's endorsement flash, as the recent blobs drive it: when blobs come into the grid while the page is
 * open, the places of the validators that endorsed them burst, once, together (lib/mapburst.ts). This module is the rule,
 * without the page: which blobs flash, which validators count as their endorsers, and when.
 *
 * - The grid says which blobs just came in (Arrival, one per move of its squares; the blobs of one block come in one
 *   move), and only those flash: a blob the grid does not show never does, and none flashes twice.
 * - A blob's endorsers are those the latest blob's card counts ("N of M validators", the blob's attested_with_rows):
 *   the validators with rows whose signature on the settlement verified (endorsersOf).
 * - The endorsers come with the blobs, on the grid's own read of the list (/v1/blobs?endorsers=1): the page records
 *   them (record) as the move comes, so the move flashes at once, with the grid. A blob whose endorsers are not on the
 *   list (an API from before the field) is recorded as unknown and flashes nothing. The rule still lets a record
 *   come after its move, in the grid's order, moves whose records come in together flashing as one.
 * - Nothing flashes for the blobs on the grid when the page opens (the grid's first read is no move), with reduced
 *   motion (the map does not listen), or for a blob that settled while the page was hidden: hidden() drops what was
 *   waiting, and until back() names the chain's height once the page is shown again, and at or below that height
 *   for good, a blob is not flashed.
 * - On the map, every endorser with a place flashes it (placesOf); one with no place on the map (no endpoint, or none
 *   located) is counted, not drawn.
 */

/** an assignment of a blob's record (/v1/blobs/{hash}), the fields the rule reads */
export type Signer = { validator_address: string; row_count: number; attested: boolean | null };

/** a blob as the grid holds it (/v1/blobs), the fields the rule reads */
export type ArrivedBlob = {
  promise_hash: string; settlement_height: number; settlement_tx_index?: number; settlement_time?: string;
  attested_with_rows?: number | null; attested_voting_power?: number | null; total_voting_power?: number | null;
  /** its endorsers by consensus address, as /v1/blobs?endorsers=1 gives them; absent from an API before the field */
  endorsers?: string[] | null;
};

/**
 * one move of the grid: the blobs that just came in, newest first. live is false for what the grid shows without a
 * beat of its own: what it opened with (id 0, its newest blob), and what came while the page was hidden
 */
export type Arrival = { id: number; blobs: ArrivedBlob[]; live: boolean };

/** one blob of a flash: its endorsers on its record (null when the record did not answer) and on the card */
export type FlashBlob = { hash: string; height: number; endorsers: number | null; card: number | null };

/** one flash: the moves it covers, their blobs, and the union of their endorsers (consensus addresses, lower case) */
export type Flash = { moves: number[]; blobs: FlashBlob[]; endorsers: string[] };

/** the validators that endorsed a blob, as its card counts them: with rows, and their signature verified */
export function endorsersOf(assignments: Signer[]): string[] {
  const out = new Set<string>();
  for (const a of assignments) if (a.attested === true && a.row_count > 0) out.add(a.validator_address.toLowerCase());
  return [...out];
}

/**
 * The endorsers by whether the map has a place for them: placed are drawn (each place once, with how many of them it
 * holds), unplaced are counted. placeOf maps a validator's consensus address (lower case) to its place.
 */
export function placesOf(endorsers: string[], placeOf: Map<string, string>): { places: Map<string, number>; placed: number; unplaced: number } {
  const places = new Map<string, number>();
  let placed = 0;
  for (const e of endorsers) {
    const p = placeOf.get(e);
    if (p === undefined) continue;
    places.set(p, (places.get(p) ?? 0) + 1);
    placed++;
  }
  return { places, placed, unplaced: endorsers.length - placed };
}

/** the grid's moves, for the map: the recent blobs announce each one (announce), the map listens (onArrival) */
const listeners = new Set<(a: Arrival) => void>();
export function onArrival(fn: (a: Arrival) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
export function announce(a: Arrival): void {
  for (const fn of listeners) fn(a);
}

/** how many blobs the flasher remembers having seen or asked for: far more than the grid's fifty squares */
const MEMORY = 2000;

type Move = { id: number; blobs: ArrivedBlob[] };

function remember<T>(m: Map<string, T>, k: string, v: T) {
  m.delete(k);
  m.set(k, v);
  if (m.size > MEMORY) m.delete(m.keys().next().value as string);
}

/** the rule for one open page (the top of this module): what came in, what was asked for, what waits to flash */
export class Flasher {
  /** every blob the grid has brought in, live or not: none flashes twice */
  private seen = new Map<string, true>();
  /** the blobs whose record the flasher waits for, so none is asked twice */
  private asked = new Map<string, true>();
  /** the records in: each blob's endorsers, or null when its record did not answer */
  private got = new Map<string, string[] | null>();
  /** the moves waiting for records, oldest first */
  private waiting: Move[] = [];
  /** blobs settled at or below this height came while the page was hidden: Infinity from hidden() to back() */
  private floor = 0;

  /**
   * The grid moved: these blobs just came in. live is false when nothing may flash for them (the page is hidden).
   * Returns the records to ask for, and the flash due now, if every record of the moves before it and of this one is
   * in.
   */
  arrive(a: Arrival, live: boolean): { ask: string[]; flash: Flash | null } {
    const all = a.blobs.filter((b) => !this.seen.has(b.promise_hash));
    for (const b of all) remember(this.seen, b.promise_hash, true);
    const fresh = live ? all.filter((b) => b.settlement_height > this.floor) : [];
    if (fresh.length === 0) return { ask: [], flash: null };
    this.waiting.push({ id: a.id, blobs: fresh });
    const ask: string[] = [];
    for (const b of fresh) {
      if (this.asked.has(b.promise_hash)) continue;
      remember(this.asked, b.promise_hash, true);
      ask.push(b.promise_hash);
    }
    return { ask, flash: this.due() };
  }

  /** a blob's record answered (its endorsers, endorsersOf) or did not (null); returns the flash now due, if any */
  record(hash: string, endorsers: string[] | null): Flash | null {
    remember(this.got, hash, endorsers);
    return this.due();
  }

  /** the page was hidden: what was waiting never flashes, nor does a blob until back() */
  hidden(): void {
    this.waiting = [];
    this.floor = Infinity;
  }

  /** the tip's first answer once the page is shown again: blobs at or below its height settled while it was hidden */
  back(height: number): void {
    if (this.floor === Infinity) this.floor = height;
  }

  /** the moves at the head of the line whose records are all in, as one flash; null while the first still waits */
  private due(): Flash | null {
    let n = 0;
    while (n < this.waiting.length && this.waiting[n].blobs.every((b) => this.got.has(b.promise_hash))) n++;
    if (n === 0) return null;
    const moves = this.waiting.splice(0, n);
    const all = new Set<string>();
    const blobs: FlashBlob[] = [];
    for (const m of moves) {
      for (const b of m.blobs) {
        const es = this.got.get(b.promise_hash) ?? null;
        this.got.delete(b.promise_hash);
        if (es) for (const e of es) all.add(e);
        blobs.push({ hash: b.promise_hash, height: b.settlement_height, endorsers: es ? es.length : null, card: b.attested_with_rows ?? null });
      }
    }
    return { moves: moves.map((m) => m.id), blobs, endorsers: [...all] };
  }
}
