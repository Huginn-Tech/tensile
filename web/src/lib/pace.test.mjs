// pace.ts (npm test; node --test): the overview's blob stream with no wait and no stutter. A block that comes alone
// goes out the moment it is in; blocks that come together go out one at a time, SPREAD_MS apart, or in one beat when
// many wait; every blob once and in order. The module is TypeScript with no imports, so the test compiles it with the
// project's own TypeScript.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const load = (file) => {
  const src = readFileSync(new URL(file, import.meta.url), "utf8");
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
};
const { Pacer, SPREAD_MS } = await load("./pace.ts");

/**
 * Runs a stream through a pacer in 25 ms steps: arrivals is [ms, height, item][], in the order they come in.
 * Returns the beats: [ms, items].
 */
function run(p, arrivals, until) {
  const beats = [];
  const todo = [...arrivals];
  for (let now = 0; now <= until; now += 25) {
    while (todo.length && todo[0][0] <= now) {
      const [at, h, item] = todo.shift();
      p.offer(h, item, at);
    }
    const out = p.take(now);
    if (out.length) beats.push([now, out]);
  }
  return beats;
}

test("a block that comes alone goes out the moment it is in: no block of the tip's stream waits", () => {
  let seed = 7;
  const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const p = new Pacer();
  const arrivals = [];
  for (let h = 1; h <= 60; h++) {
    // a block about every 2.9 s, as the tip's stream brings them, give or take 300 ms
    const at = Math.round((h * 2900 + (rnd() - 0.5) * 600) / 25) * 25;
    const k = 1 + Math.floor(rnd() * 3);
    for (let i = 0; i < k; i++) arrivals.push([at, h, `${h}.${i}`]);
  }
  arrivals.sort((a, b) => a[0] - b[0]);
  const beats = run(p, arrivals, 62 * 2900);
  assert.equal(beats.length, 60, "a beat a block");
  for (const [t, items] of beats) {
    const h = Number(items[0].split(".")[0]);
    assert.ok(items.every((x) => x.startsWith(`${h}.`)), "a beat of one block");
    assert.equal(t, arrivals.find(([, hh]) => hh === h)[0], `block ${h} out as it came in`);
  }
  assert.deepEqual(beats.flatMap(([, items]) => items), arrivals.map(([, , it]) => it), "each once, in order");
});

test("blocks that come together go out SPREAD_MS apart, one at a time; many at once in one beat", () => {
  const p = new Pacer();
  for (const h of [1, 2, 3]) p.offer(h, `b${h}`, 1000);
  assert.deepEqual(run(p, [], 3000), [[1000, ["b1"]], [1000 + SPREAD_MS, ["b2"]], [1000 + 2 * SPREAD_MS, ["b3"]]]);
  const q = new Pacer();
  for (let h = 1; h <= 5; h++) q.offer(h, `b${h}`, 0);
  assert.deepEqual(q.take(0), ["b1", "b2", "b3", "b4", "b5"], "a backlog in one beat");
  assert.equal(q.waiting, 0);
});

test("a block after a quiet spell goes out as soon as it is in", () => {
  const p = new Pacer();
  const beats = run(p, [[1000, 10, "a"], [60000, 30, "b"]], 61000);
  assert.deepEqual(beats, [[1000, ["a"]], [60000, ["b"]]]);
});

test("flush lets everything out at once; a late blob of a block let out goes with the next beat", () => {
  const p = new Pacer();
  p.offer(1, "a", 0);
  p.offer(2, "b", 0);
  p.offer(2, "c", 0);
  assert.deepEqual(p.flush(10), ["a", "b", "c"]);
  assert.equal(p.waiting, 0);
  p.offer(2, "late", 20);
  p.offer(3, "d", 20);
  assert.equal(p.due(), 10 + SPREAD_MS, "spread from the flush");
  assert.deepEqual(p.take(p.due()), ["late"]);
  assert.deepEqual(p.take(p.due()), ["d"]);
});
