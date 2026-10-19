// countdown.ts (npm test; node --test): when Fibre's activation block is expected, from the blocks the page saw. The
// guess until enough blocks are seen, their own pace after; the newest block's time plus what is left; never below
// zero. The module is TypeScript with no imports, so the test compiles it with the project's own TypeScript.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const load = (file) => {
  const src = readFileSync(new URL(file, import.meta.url), "utf8");
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
};
const { see, blockMs, expectedAt, parts, BLOCK_MS_GUESS, BLOCK_SPAN } = await load("./countdown.ts");

const run = (from, n, ms, t0 = 1_000_000) => {
  let s = [];
  for (let i = 0; i < n; i++) s = see(s, { h: from + i, t: t0 + i * ms });
  return s;
};

test("a block is seen once, in height order", () => {
  let s = see([], { h: 10, t: 100 });
  s = see(s, { h: 10, t: 200 });
  s = see(s, { h: 9, t: 300 });
  s = see(s, { h: NaN, t: 300 });
  s = see(s, { h: 11, t: 400 });
  assert.deepEqual(s, [{ h: 10, t: 100 }, { h: 11, t: 400 }]);
});

test("the guess until BLOCK_SPAN blocks are seen, their own pace after", () => {
  assert.equal(blockMs([]), BLOCK_MS_GUESS);
  assert.equal(blockMs(run(100, BLOCK_SPAN, 3000)), BLOCK_MS_GUESS);
  assert.equal(blockMs(run(100, BLOCK_SPAN + 1, 3000)), 3000);
  assert.equal(blockMs(run(100, 300, 2500)), 2500);
});

test("the activation is expected the newest block's time plus the blocks left at that pace", () => {
  assert.equal(expectedAt(500, []), null);
  const s = run(100, 101, 3000); // heights 100..200, 3 s apart
  assert.equal(expectedAt(500, s), s[s.length - 1].t + 300 * 3000);
  // reached or passed: the newest block's own time
  assert.equal(expectedAt(150, s), s[s.length - 1].t);
});

test("a span splits into days, hours, minutes and seconds, never below zero", () => {
  assert.deepEqual(parts(((26 * 60 + 3) * 60 + 9) * 1000 + 999), { d: 1, h: 2, m: 3, s: 9 });
  assert.deepEqual(parts(-5000), { d: 0, h: 0, m: 0, s: 0 });
});
