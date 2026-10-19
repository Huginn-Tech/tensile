// mapflash.ts (npm test; node --test): which blobs flash the overview map's places, and when. The flash follows the
// recent blobs' grid: only blobs that just came into it flash, each once, with the endorsers the latest blob's card
// counts; a block's blobs flash once together; nothing flashes on load, after the page was hidden, or for a record
// that answers for a blob the grid does not show. The module is TypeScript with no imports, so the test compiles it
// with the project's own TypeScript.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const load = (file) => {
  const src = readFileSync(new URL(file, import.meta.url), "utf8");
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
};
const { Flasher, endorsersOf, placesOf, onArrival, announce } = await load("./mapflash.ts");

// a validator set of 90: the first 70 hold rows, and of those the ones a blob's seed picks signed
const VALS = Array.from({ length: 90 }, (_, i) => (i + 1).toString(16).padStart(40, "0"));
/** a blob's record and its row on the grid, consistent: attested_with_rows is what its record says */
function blob(n, height, signed = 65) {
  const hash = n.toString(16).padStart(64, "0");
  const assignments = VALS.map((v, i) => ({
    validator_address: i % 3 === 0 ? v.toUpperCase() : v,
    row_count: i < 70 ? 10 + i : 0,
    // a validator with no rows may sign too; the card does not count it
    attested: i < 70 ? (i + n) % 70 < signed : i % 2 === 0,
  }));
  const card = assignments.filter((a) => a.row_count > 0 && a.attested === true).length;
  return { row: { promise_hash: hash, settlement_height: height, attested_with_rows: card }, assignments };
}
const sorted = (xs) => [...xs].sort();

test("a blob's endorsers are the validators its card counts: with rows, signature verified", () => {
  const b = blob(7, 100, 65);
  const es = endorsersOf(b.assignments);
  assert.equal(es.length, b.row.attested_with_rows, "the flash and the card's \"N of M validators\" count the same validators");
  assert.equal(es.length, 65);
  assert.ok(es.every((e) => e === e.toLowerCase()), "addresses in lower case, as /v1/validators' address");
  assert.deepEqual(endorsersOf([{ validator_address: "AA", row_count: 0, attested: true }, { validator_address: "bb", row_count: 3, attested: null }]), [],
    "no rows, or a signature not recorded: not an endorser");
});

test("one blob per block: it flashes as the grid shows it, with its endorsers, once", () => {
  const f = new Flasher();
  const b = blob(1, 100);
  // the grid's move asks for its record; the list brought it, so the page records it in the same turn
  const { ask, flash: none } = f.arrive({ id: 1, blobs: [b.row], live: true }, true);
  assert.deepEqual(ask, [b.row.promise_hash]);
  assert.equal(none, null, "not before its record");
  const flash = f.record(b.row.promise_hash, endorsersOf(b.assignments));
  assert.ok(flash, "the flash goes with the grid's move");
  assert.deepEqual(flash.moves, [1]);
  assert.deepEqual(flash.blobs.map((x) => x.hash), [b.row.promise_hash]);
  assert.equal(flash.blobs[0].endorsers, flash.blobs[0].card);
  assert.deepEqual(sorted(flash.endorsers), sorted(endorsersOf(b.assignments)));
  // the same blob again (a later read of the grid holds it still): nothing
  assert.deepEqual(f.arrive({ id: 2, blobs: [b.row], live: true }, true), { ask: [], flash: null });
});

test("several blobs in one block: one flash for all of them, once every record is in", () => {
  const f = new Flasher();
  const bs = [blob(11, 200, 60), blob(12, 200, 62), blob(13, 200, 64), blob(14, 200, 66)];
  const { ask, flash } = f.arrive({ id: 1, blobs: bs.map((b) => b.row), live: true }, true);
  assert.deepEqual(ask, bs.map((b) => b.row.promise_hash), "each record asked once");
  assert.equal(flash, null, "not before the records are in");
  for (const b of bs.slice(0, 3)) assert.equal(f.record(b.row.promise_hash, endorsersOf(b.assignments)), null);
  const done = f.record(bs[3].row.promise_hash, endorsersOf(bs[3].assignments));
  assert.ok(done);
  assert.deepEqual(done.blobs.map((x) => x.hash), bs.map((b) => b.row.promise_hash), "exactly the blobs the grid brought in");
  const union = new Set(bs.flatMap((b) => endorsersOf(b.assignments)));
  assert.deepEqual(sorted(done.endorsers), sorted(union), "the union of their endorsers");
  for (const x of done.blobs) assert.equal(x.endorsers, x.card);
  assert.equal(f.record(bs[3].row.promise_hash, endorsersOf(bs[3].assignments)), null, "never twice");
});

test("a record that answers after the grid moved flashes then; one for a blob the grid does not show never does", () => {
  const f = new Flasher();
  const a = blob(21, 300), stray = blob(22, 301);
  assert.equal(f.arrive({ id: 1, blobs: [a.row], live: true }, true).flash, null);
  assert.equal(f.record(stray.row.promise_hash, endorsersOf(stray.assignments)), null, "the grid has not shown it");
  const late = f.record(a.row.promise_hash, endorsersOf(a.assignments));
  assert.deepEqual(late?.blobs.map((x) => x.hash), [a.row.promise_hash], "only the blob the grid showed");
});

test("moves flash in the grid's order: a later move whose record is in first waits, and both flash as one", () => {
  const f = new Flasher();
  const a = blob(31, 400), b = blob(32, 401);
  f.arrive({ id: 1, blobs: [a.row], live: true }, true);
  f.arrive({ id: 2, blobs: [b.row], live: true }, true);
  assert.equal(f.record(b.row.promise_hash, endorsersOf(b.assignments)), null, "the earlier move still waits");
  const both = f.record(a.row.promise_hash, endorsersOf(a.assignments));
  assert.deepEqual(both?.moves, [1, 2]);
  assert.deepEqual(both?.blobs.map((x) => x.height), [400, 401]);
});

test("nothing on load, nothing replayed after the page was hidden; the next block flashes", () => {
  const f = new Flasher();
  const old = blob(41, 500), late = blob(42, 501), hidden1 = blob(43, 502), hidden2 = blob(44, 503), next = blob(45, 505);
  // the grid's first read: not live
  assert.deepEqual(f.arrive({ id: 0, blobs: [old.row], live: true }, false), { ask: [], flash: null });
  // a move whose record was out when the page was hidden: dropped
  f.arrive({ id: 1, blobs: [late.row], live: true }, true);
  f.hidden();
  assert.equal(f.record(late.row.promise_hash, endorsersOf(late.assignments)), null, "no flash queued while hidden");
  // shown again: before the tip has answered, nothing is asked for or flashes
  assert.deepEqual(f.arrive({ id: 2, blobs: [hidden1.row], live: true }, true), { ask: [], flash: null });
  // the tip answers at 504: what settled at or below it came while the page was hidden
  f.back(504);
  assert.deepEqual(f.arrive({ id: 3, blobs: [hidden2.row], live: true }, true), { ask: [], flash: null });
  // the next block flashes
  const { ask, flash } = f.arrive({ id: 4, blobs: [next.row], live: true }, true);
  assert.deepEqual(ask, [next.row.promise_hash]);
  assert.equal(flash, null);
  assert.deepEqual(f.record(next.row.promise_hash, endorsersOf(next.assignments))?.moves, [4]);
  // and a page that is hidden at the move flashes nothing for it
  const later = blob(46, 506);
  assert.deepEqual(f.arrive({ id: 5, blobs: [later.row], live: true }, false), { ask: [], flash: null });
});

test("a record that does not answer leaves its blob out of the endorsers, said so, and the move still flashes", () => {
  const f = new Flasher();
  const a = blob(51, 600), b = blob(52, 600);
  f.arrive({ id: 1, blobs: [a.row, b.row], live: true }, true);
  f.record(a.row.promise_hash, null);
  const fl = f.record(b.row.promise_hash, endorsersOf(b.assignments));
  assert.deepEqual(fl?.blobs.map((x) => x.endorsers), [null, b.row.attested_with_rows]);
  assert.deepEqual(sorted(fl.endorsers), sorted(endorsersOf(b.assignments)));
});

test("every endorser with a place on the map flashes it, each place once; the others are counted", () => {
  const es = ["a1", "a2", "b1", "c1", "x9"];
  const placeOf = new Map([["a1", "Paris"], ["a2", "Paris"], ["b1", "Tokyo"], ["c1", "Ohio"]]);
  const p = placesOf(es, placeOf);
  assert.deepEqual([...p.places.keys()].sort(), ["Ohio", "Paris", "Tokyo"]);
  assert.equal(p.places.get("Paris"), 2, "a place counts the endorsers it holds");
  assert.equal(p.placed, 4);
  assert.equal(p.unplaced, 1);
  assert.equal(p.placed + p.unplaced, es.length, "none invented, none dropped");
});

test("the grid's moves reach the map through announce", () => {
  const got = [];
  const off = onArrival((a) => got.push(a.id));
  announce({ id: 7, blobs: [] });
  off();
  announce({ id: 8, blobs: [] });
  assert.deepEqual(got, [7]);
});

// A stream as mainnet may send it: a block every few seconds with one to five blobs, records answering out of order
// and late, the odd block whose blobs reach the grid in two reads, and the page hidden for twenty blocks: every blob
// the grid showed live flashes exactly once, never a blob it did not show, at most one flash per move, and each
// blob's endorsers are its card's.
test("a long stream: every live blob flashes once, with its card's endorsers, and nothing else does", () => {
  let seed = 3;
  const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const f = new Flasher();
  const shown = new Set(), expect = new Set(), flashed = new Set();
  const records = new Map();
  let pending = [], backlog = [];
  let moves = 0, flashes = 0, n = 1000;
  const take = (fl) => {
    if (!fl) return;
    flashes++;
    assert.ok(fl.blobs.length > 0);
    for (const x of fl.blobs) {
      assert.ok(shown.has(x.hash), "a flashed blob is on the grid");
      assert.equal(flashed.has(x.hash), false, "never twice");
      flashed.add(x.hash);
      if (x.endorsers !== null) assert.equal(x.endorsers, x.card, "the card's count");
    }
  };
  // the records due by `by` answer, earliest first; one in fifty does not answer
  const answer = (by) => {
    pending.sort((x, y) => x.at - y.at);
    while (pending.length && pending[0].at <= by) {
      const p = pending.shift();
      take(f.record(p.hash, rnd() < 0.02 ? null : endorsersOf(records.get(p.hash).assignments)));
    }
  };
  for (let h = 1; h <= 400; h++) {
    const k = 1 + Math.floor(rnd() * 5);
    const bs = Array.from({ length: k }, () => blob(n++, h, 55 + Math.floor(rnd() * 12)));
    for (const b of bs) records.set(b.row.promise_hash, b);
    if (h === 150) {
      // hidden: what was still waiting never flashes, and the grid and the tip rest
      for (const x of expect) if (!flashed.has(x)) expect.delete(x);
      f.hidden();
    }
    if (h >= 150 && h < 170) { backlog.push(...bs); answer(h + 1); continue; }
    const rows = (bs_) => bs_.map((b) => b.row).reverse();
    if (h === 170) {
      // shown again: the grid's first read brings what came meanwhile, before the tip's first answer, which names
      // this block; nothing of it flashes
      const all = rows([...backlog, ...bs]);
      for (const r of all) shown.add(r.promise_hash);
      assert.deepEqual(f.arrive({ id: ++moves, blobs: all, live: true }, true), { ask: [], flash: null });
      f.back(h);
      backlog = [];
      answer(h + 1);
      continue;
    }
    // most blocks reach the grid in one read; about one in ten in two, its first blob alone first
    const parts = k > 1 && rnd() < 0.1 ? [bs.slice(0, 1), bs.slice(1)] : [bs];
    for (const part of parts) {
      const rs = rows(part);
      for (const r of rs) { shown.add(r.promise_hash); expect.add(r.promise_hash); }
      const { ask, flash } = f.arrive({ id: ++moves, blobs: rs, live: true }, true);
      take(flash);
      for (const a of ask) pending.push({ hash: a, at: h + rnd() * 1.2 });
    }
    answer(h + 1);
  }
  answer(Infinity);
  assert.deepEqual(sorted(flashed), sorted(expect), "every blob the grid showed live flashed, and only those");
  assert.ok(flashes > 0 && flashes <= moves, `${flashes} flashes over ${moves} moves`);
});
