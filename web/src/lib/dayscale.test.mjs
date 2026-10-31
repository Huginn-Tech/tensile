// dayscale.ts (npm test; node --test): the Blobs chart's days. Log only when one day runs far past an ordinary one, a
// zero has no height, the unit is an ordinary day's. The module is TypeScript with no imports, so the test compiles it
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
const { dayScale, namedDays, LOG_AT } = await load("./dayscale.ts");
const MIB = 2 ** 20;

// Mocha's days on record: one day of 8,472 among days of tens and hundreds
const mocha = [132, 21, 0, 8472, 0, 0, 2, 6, 0, 74, 12, 163, 24, 30, 34, 24, 1, 65, 97, 98, 91, 88, 0, 63, 266, 212, 58, 254, 337, 260, 113, 107, 95, 86, 111, 60];

test("days of a size stay on a plain scale", () => {
  const s = dayScale([3, 0, 0, 1, 0], "n");
  assert.equal(s.log, false);
  assert.equal(s.at(3) / s.at(1), 3);
  assert.equal(s.busy.size, 0);
  assert.deepEqual(s.ticks.map((t) => t.label), ["1", "2", "3"]);
});

test("log starts at the threshold, not under it", () => {
  const ordinary = [10, 10, 10, 10, 10, 10, 10];
  assert.equal(dayScale([...ordinary, 10 * LOG_AT - 1], "n").log, false);
  assert.equal(dayScale([...ordinary, 10 * LOG_AT], "n").log, true);
});

test("one busy day no longer flattens the rest", () => {
  const s = dayScale(mocha, "n");
  assert.equal(s.log, true);
  assert.equal(s.at(0), 0);
  assert.equal(s.at(8472), 1);
  assert.ok(s.at(1) > 0.05, "the smallest day stands clear of the baseline");
  assert.ok(s.at(337) < 0.7, "the next day is well under the peak");
  assert.deepEqual([...s.busy], [3]);
  assert.deepEqual(s.ticks.map((t) => t.label), ["1", "10", "100", "1,000"]);
});

test("heights rise with the value and never pass the plot", () => {
  for (const vals of [mocha, [3, 1], [0.5, 900, 12, 4, 7, 2, 1]]) {
    const s = dayScale(vals, "n"), sorted = [...vals].sort((a, b) => a - b).map(s.at);
    sorted.forEach((h, i) => { assert.ok(h >= 0 && h <= 1); if (i) assert.ok(h >= sorted[i - 1]); });
  }
});

test("the unit is an ordinary day's, so a small day keeps its digits", () => {
  const days = [424, 956, 0, 135497, 0, 0, 0.5, 640, 0, 1939, 172, 9077, 6, 38.5, 8.5, 6, 0.25, 1597, 2174, 2364, 2001, 1785, 0, 1587, 1647, 301, 84, 63.5, 159].map((x) => x * MIB);
  const s = dayScale(days, "bytes");
  assert.equal(s.unit, "MiB");
  assert.equal(s.short(6 * MIB), "6");
  assert.equal(s.short(0.25 * MIB), "0.25");
  assert.equal(s.short(2364 * MIB), "2,364");
  assert.ok(s.busy.has(3), "the peak prints in its own unit");
  assert.deepEqual(s.ticks.map((t) => t.label), ["1", "10", "100", "1,000", "10K", "100K"]);
});

test("a scale of terabytes does not read in millions of MiB", () => {
  const s = dayScale([3, 2, 4, 3, 5].map((x) => x * 2 ** 40), "bytes");
  assert.equal(s.unit, "TiB");
  assert.deepEqual(s.ticks.map((t) => t.label), ["2.5", "5"]);
});

test("fees read in TIA", () => {
  const s = dayScale([28_520_000, 720_000], "fees");
  assert.equal(s.unit, "TIA");
  assert.equal(s.short(28_520_000), "28.5");
  assert.equal(s.short(720_000), "0.72");
});

test("a period with nothing draws nothing", () => {
  const s = dayScale([0, 0, 0], "n");
  assert.equal(s.log, false);
  assert.equal(s.at(0), 0);
});

test("a day only a little past the fence is not singled out", () => {
  // 40 is past the fence (26) but under 1.6 times the round top of the rest (30); 2,000 stands apart
  const s = dayScale([26, 26, 26, 26, 26, 26, 26, 26, 40, 2000], "n");
  assert.equal(s.log, true);
  assert.deepEqual([...s.busy], [9]);
});

test("the days named under the bars thin out on round days", () => {
  const month = Array.from({ length: 30 }, (_, i) => i + 1);
  assert.equal(namedDays(month, 30).length, 30);
  assert.deepEqual(namedDays(month, 10).map((i) => month[i]), [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29]);
  assert.deepEqual(namedDays(month, 5).map((i) => month[i]), [1, 5, 10, 15, 20, 25]);
  assert.deepEqual(namedDays(month, 4).map((i) => month[i]), [1, 10, 20]);
  assert.deepEqual(namedDays(month, 1.5).map((i) => month[i]), [1, 15]);
  assert.deepEqual(namedDays(month, 0.1).map((i) => month[i]), [1]);
});
