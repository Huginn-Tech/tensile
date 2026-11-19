// pillpick.ts (npm test; node --test): who the overview map's pill names. The newest beat's endorsers (the union over
// its blobs) one at a time, a shuffled order, each once, the last staying; a new beat takes the pill at once with one
// of its own; a beat without known endorsers waits for them, the pill keeping what it names; a new or changed endpoint
// holds the pill for 12 s and the endorsers come back after. The module is TypeScript with no imports, so the test compiles it with the project's
// own TypeScript.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const load = (file) => {
  const src = readFileSync(new URL(file, import.meta.url), "utf8");
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
};
const { PillPicker, HOLD_MS, ROTATE_MS, FRESH_MS, missed } = await load("./pillpick.ts");

const seeded = (s) => () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
const set = (p, n, from = 0) => Array.from({ length: n }, (_, i) => `${p}${String(from + i).padStart(2, "0")}`);
const who = (pk, now = 0) => { const s = pk.show(now); return s && s.kind === "endorser" ? s.who : s?.kind; };
/** n names in a row, ticking between them */
const run = (pk, n) => { const out = []; for (let i = 0; i < n; i++) { if (i) pk.tick(i * ROTATE_MS); out.push(who(pk)); } return out; };

test("a beat's endorsers are named in a shuffled order, each once, and the last stays until the next beat", () => {
  const pk = new PillPicker(seeded(3));
  const es = set("a", 60);
  pk.beat("b1", "2026-10-19T10:00:00Z", es);
  assert.deepEqual(pk.names, [who(pk)], "the name shown alone, for the pill's width");
  const named = run(pk, 60);
  assert.equal(new Set(named).size, 60, "no repeats within the beat");
  assert.deepEqual([...named].sort(), es, "every endorser, and only them");
  assert.notDeepEqual(named, es, "shuffled, not in the record's order");
  assert.deepEqual(pk.names, [named[59]], "the round over, the last name alone");
  for (let i = 0; i < 300; i++) pk.tick(i * ROTATE_MS);
  assert.equal(who(pk), named[59], "one round: the last named stays, minutes on");
  // an endorser known only later is named next, then stays
  pk.beat("b1", "2026-10-19T10:00:00Z", [...es, "late"]);
  pk.tick(0);
  assert.equal(who(pk), "late");
  pk.tick(0);
  assert.equal(who(pk), "late");
  const s = pk.show(0);
  assert.deepEqual(s, { kind: "endorser", who: s.who, key: "b1", at: "2026-10-19T10:00:00Z" });
});

test("a beat of several blobs names the union of their endorsers, each once; the block's time is the age", () => {
  const pk = new PillPicker(seeded(11));
  // three blobs of one block, their endorsers overlapping as validators that sign every blob do
  const blobs = [set("v", 60, 0), set("v", 60, 5), set("v", 58, 10)];
  const union = [...new Set(blobs.flat())].sort();
  pk.beat("newest-of-3", "2026-10-19T10:00:03Z", union);
  const named = run(pk, union.length);
  assert.deepEqual([...named].sort(), union, "the union, as the map bursts it");
  assert.equal(new Set(named).size, union.length, "no repeats until the next beat");
  assert.equal(pk.show(0).at, "2026-10-19T10:00:03Z");
  // its records answering one by one: the ones not known yet join the names still to come, none twice
  const grow = new PillPicker(seeded(4));
  grow.beat("k", "t", blobs[0]);
  const early = run(grow, 10);
  grow.beat("k", "t", union);
  const rest = run(grow, union.length - 10 + 1).slice(1);
  assert.deepEqual([...early, ...rest].sort(), union, "every endorser of the union once, the late ones too");
});

test("a new beat takes the pill at once, with one of its own endorsers, and goes through its own set", () => {
  const pk = new PillPicker(seeded(9));
  pk.beat("b1", "t1", set("a", 10));
  pk.tick(0);
  pk.tick(0);
  const es2 = set("b", 8);
  pk.beat("b2", "t2", es2);
  const first = pk.show(0);
  assert.equal(first.key, "b2");
  assert.ok(es2.includes(first.who), "an endorser of the new beat");
  const named = run(pk, 8);
  assert.deepEqual([...named].sort(), es2, "its whole set, once each");
  pk.beat("b2", "t2", set("b", 8));
  assert.equal(who(pk), named[7], "the same beat again changes nothing");
});

test("a beat without known endorsers is not named until its records answer; the pill keeps what it names", () => {
  const pk = new PillPicker(seeded(1));
  pk.beat("b1", "t1", null);
  assert.deepEqual(pk.show(0), { kind: "wait" }, "nothing named yet: it waits, empty");
  pk.tick(0);
  assert.deepEqual(pk.show(0), { kind: "wait" });
  pk.beat("b1", "t1", ["v1", "v2"]);
  assert.ok(["v1", "v2"].includes(who(pk)), "its endorsers once known");
  assert.equal(pk.show(0).key, "b1");
  pk.tick(0);
  const before = who(pk);
  pk.beat("b2", "t2", null);
  assert.equal(who(pk), before, "a newer beat, its endorsers not known: the name stays");
  assert.equal(pk.show(0).key, "b1", "and its beat with it");
  pk.beat("b2", "t2", []);
  assert.equal(pk.show(0).key, "b1", "none known: still the name before");
  pk.beat("b2", "t2", ["n1"]);
  assert.deepEqual(pk.show(0), { kind: "endorser", who: "n1", key: "b2", at: "t2" }, "taken up once known");
  // an endpoint seen before any beat is taken up is named over the wait once its hold is over
  const ep = new PillPicker(seeded(2));
  ep.beat("b1", "t1", null);
  ep.endpoint({ address: "x" }, 0);
  assert.equal(ep.show(HOLD_MS + 1).kind, "endpoint");
});

test("a new or changed endpoint holds the pill for HOLD_MS; the endorsers come back where they were, a new beat's if one came", () => {
  const pk = new PillPicker(seeded(5));
  const ev = { address: "x", outcome: "changed" };
  assert.equal(pk.show(0), null, "nothing yet");
  pk.beat("b1", "t1", set("a", 5));
  pk.tick(0);
  const before = who(pk);
  pk.endpoint(ev, 1000);
  assert.deepEqual(pk.show(1000), { kind: "endpoint", ev });
  pk.tick(4000);
  pk.tick(7000);
  assert.deepEqual(pk.show(1000 + HOLD_MS - 1), { kind: "endpoint", ev }, "held, and the names wait");
  assert.equal(who(pk, 1000 + HOLD_MS), before, "back where it was");
  pk.endpoint(ev, 20000);
  pk.beat("b2", "t2", ["n1", "n2", "n3"]);
  assert.equal(pk.show(20000 + 100).kind, "endpoint", "a new beat does not cut the hold short");
  assert.ok(["n1", "n2", "n3"].includes(who(pk, 20000 + HOLD_MS)), "the new beat's after it");
  // with no beat at all, the newest endpoint is the pill's whatever its age
  const bare = new PillPicker(seeded(2));
  bare.endpoint(ev, 0);
  assert.deepEqual(bare.show(10 * HOLD_MS), { kind: "endpoint", ev });
});

test("what the page opened with names one endorser, still, and an endorser known later does not start a round", () => {
  const pk = new PillPicker(seeded(7));
  const es = set("o", 40);
  pk.beat("b0", "t0", es, false);
  const first = who(pk);
  assert.ok(es.includes(first), "one of its endorsers");
  for (let i = 0; i < 100; i++) pk.tick(i * ROTATE_MS);
  assert.equal(who(pk), first, "still, however long the page stays open");
  assert.deepEqual(pk.names, [first], "one name, for the pill's width");
  pk.beat("b0", "t0", [...es, "late"], false);
  pk.tick(0);
  assert.equal(who(pk), first);
  // not known at first: named once it is, and still
  const pk2 = new PillPicker(seeded(8));
  pk2.beat("b0", "t0", null, false);
  assert.equal(pk2.show(0).kind, "wait");
  pk2.beat("b0", "t0", ["v1", "v2", "v3"], false);
  const one = who(pk2);
  pk2.tick(0); pk2.tick(0);
  assert.equal(who(pk2), one);
  // the next block while the page is open goes round as before
  pk.beat("b1", "t1", set("n", 5));
  assert.equal(new Set(run(pk, 5)).size, 5);
});

test("a page hidden in the middle of a round keeps the name shown: nothing rolls on when it is shown again", () => {
  const pk = new PillPicker(seeded(11));
  const es = set("h", 30);
  pk.beat("b0", "t0", es);
  const seen = run(pk, 5), last = seen.at(-1);
  pk.rest();
  assert.equal(who(pk), last, "the name on screen as the page went away");
  assert.deepEqual(pk.names, [last]);
  for (let i = 0; i < 100; i++) assert.equal(pk.tick(i * ROTATE_MS), false, "no name after it");
  assert.equal(who(pk), last);
  // the same beat with more endorsers known starts no round
  pk.beat("b0", "t0", [...es, "late"]);
  assert.equal(pk.tick(0), false);
  assert.equal(who(pk), last);
  // a beat that settles once the page is shown again goes round as before
  const next = set("n", 6);
  pk.beat("b1", "t1", next);
  assert.deepEqual([...run(pk, 6)].sort(), next);
  // nothing named yet: nothing to keep
  const empty = new PillPicker(seeded(12));
  empty.rest();
  assert.equal(empty.show(0), null);
});

test("a beat that settled while the page was hidden is not news; one that settles as it is shown again is", () => {
  const shown = Date.parse("2026-11-15T10:10:00Z");
  assert.equal(missed("2026-11-15T10:00:00Z", shown, 0), true, "ten minutes before the page came back");
  assert.equal(missed("2026-11-15T10:09:44Z", shown, 0), true, "just over FRESH_MS before");
  assert.equal(missed(new Date(shown - FRESH_MS + 1).toISOString(), shown, 0), false, "within FRESH_MS: its block's time runs behind");
  assert.equal(missed("2026-11-15T10:10:05Z", shown, 0), false, "after the page came back");
  assert.equal(missed("2026-11-15T10:00:00Z", 0, 0), false, "a page never hidden missed nothing");
  assert.equal(missed("", shown, 0), false, "no time on the block: taken as news, as before");
  // the observer's clock ahead of the reader's by a minute: the block's time is read against the observer's
  assert.equal(missed("2026-11-15T10:10:30Z", shown, 60000), true);
  assert.equal(missed("2026-11-15T10:10:50Z", shown, 60000), false);
  // named still, as what the page opened with
  const pk = new PillPicker(seeded(13));
  const es = set("m", 20);
  pk.beat("old", "t0", es, false);
  const one = who(pk);
  for (let i = 0; i < 50; i++) pk.tick(i * ROTATE_MS);
  assert.equal(who(pk), one);
});

test("a beat still fresh when the page is shown again goes its round from the name shown", () => {
  const pk = new PillPicker(seeded(11));
  const es = set("w", 30);
  pk.beat("b1", "2026-11-19T10:00:00Z", es, false); // it came behind the tab: one name, still
  const first = who(pk);
  pk.tick(0);
  assert.equal(who(pk), first, "at rest while hidden");
  pk.wake("other", es);
  pk.tick(0);
  assert.equal(who(pk), first, "another beat's wake is not this one's");
  pk.wake("b1", es);
  assert.equal(who(pk), first, "the name shown stays first");
  const named = run(pk, 30);
  assert.deepEqual([...named].sort(), es, "every endorser, each once");
  pk.wake("b1", es);
  pk.tick(0);
  assert.equal(who(pk), named[29], "a round under way or over is not started again");
  // a round cut short by hiding the page goes on with those not named yet on a fresh return
  const p2 = new PillPicker(seeded(5));
  p2.beat("b2", "2026-11-19T10:00:00Z", es);
  const before = run(p2, 3);
  p2.rest();
  const at = who(p2);
  assert.equal(at, before[2]);
  p2.wake("b2", es);
  const again = run(p2, 28);
  assert.equal(again[0], at, "from the name it rested on");
  assert.deepEqual([...before.slice(0, 2), ...again].sort(), es, "the rest of them, none named twice");
  p2.tick(0);
  assert.equal(who(p2), again[27], "and it ends there");
  // a round that ran to its end is not run again
  const p3 = new PillPicker(seeded(8));
  p3.beat("b3", "2026-11-19T10:00:00Z", es);
  const all = run(p3, 30);
  p3.rest();
  p3.wake("b3", es);
  p3.tick(0);
  assert.equal(who(p3), all[29], "it stays on its last name");
  // hidden and shown twice within the fresh time: still none named twice
  const p4 = new PillPicker(seeded(2));
  p4.beat("b4", "2026-11-19T10:00:00Z", es);
  const a1 = run(p4, 4);
  p4.rest(); p4.wake("b4", es);
  const a2 = run(p4, 5);
  p4.rest(); p4.rest(); p4.wake("b4", es);
  const a3 = run(p4, 23);
  assert.deepEqual([...a1.slice(0, 3), ...a2.slice(0, 4), ...a3].sort(), es, "each once across two returns");
});

test("the same beat fed again after a return adds no name already shown", () => {
  const pk = new PillPicker(seeded(4));
  const es = set("r", 12);
  pk.beat("b", "2026-11-19T10:00:00Z", es);
  const a = run(pk, 4);
  pk.rest();
  pk.wake("b", es);
  pk.beat("b", "2026-11-19T10:00:00Z", es);
  const b = run(pk, 9);
  assert.deepEqual([...a.slice(0, 3), ...b].sort(), es, "each once");
  pk.tick(0);
  assert.equal(who(pk), b[8], "and the round ends");
});
