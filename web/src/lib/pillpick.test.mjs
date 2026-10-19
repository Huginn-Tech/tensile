// pillpick.ts (npm test; node --test): who the overview map's pill names. The newest beat's endorsers (the union over
// its blobs) one at a time, a shuffled order, each once before any repeats; a new beat takes the pill at once with one
// of its own; a beat without known endorsers is named as settled; a new or changed endpoint holds the pill for 12 s and
// the endorsers come back after. The module is TypeScript with no imports, so the test compiles it with the project's
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
const { PillPicker, HOLD_MS, ROTATE_MS } = await load("./pillpick.ts");

const seeded = (s) => () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
const set = (p, n, from = 0) => Array.from({ length: n }, (_, i) => `${p}${String(from + i).padStart(2, "0")}`);
const who = (pk, now = 0) => { const s = pk.show(now); return s && s.kind === "endorser" ? s.who : s?.kind; };
/** n names in a row, ticking between them */
const run = (pk, n) => { const out = []; for (let i = 0; i < n; i++) { if (i) pk.tick(i * ROTATE_MS); out.push(who(pk)); } return out; };

test("a beat's endorsers are named in a shuffled order, each once, then round again without a repeat at the turn", () => {
  const pk = new PillPicker(seeded(3));
  const es = set("a", 60);
  pk.beat("b1", "2026-10-19T10:00:00Z", es);
  const named = run(pk, 60);
  assert.equal(new Set(named).size, 60, "no repeats within the beat");
  assert.deepEqual([...named].sort(), es, "every endorser, and only them");
  assert.notDeepEqual(named, es, "shuffled, not in the record's order");
  assert.deepEqual([...pk.names].sort(), es, "the pill's set, for its width");
  pk.tick(0);
  const next = [who(pk), ...run(pk, 60).slice(1)];
  assert.notEqual(next[0], named[59], "the next round does not start where the last ended");
  assert.equal(new Set(next).size, 60);
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

test("a beat without known endorsers is named as settled, until its records answer", () => {
  const pk = new PillPicker(seeded(1));
  pk.beat("b1", "t1", null);
  assert.deepEqual(pk.show(0), { kind: "settled", key: "b1", at: "t1" });
  pk.tick(0);
  assert.equal(pk.show(0).kind, "settled");
  pk.beat("b1", "t1", ["v1", "v2"]);
  assert.ok(["v1", "v2"].includes(who(pk)), "its endorsers once known");
  pk.beat("b2", "t2", []);
  assert.deepEqual(pk.show(0), { kind: "settled", key: "b2", at: "t2" }, "none endorsed: settled");
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
