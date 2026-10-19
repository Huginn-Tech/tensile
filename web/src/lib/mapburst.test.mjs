// mapburst.ts (npm test; node --test): a place's warmth, the part of the burst that outlasts it. It halves every 8 s,
// each burst adds to it, it never passes 1, and a place that endorses every block stays warm while one that stops
// cools to nothing in about half a minute. The drawing itself needs a page; the module is TypeScript with no imports,
// so the test compiles it with the project's own TypeScript and uses only its pure part.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const load = (file) => {
  const src = readFileSync(new URL(file, import.meta.url), "utf8");
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
};
const { warmthAt, warmer, HALF_MS } = await load("./mapburst.ts");

test("warmth halves every HALF_MS and a burst adds to what is left", () => {
  assert.equal(warmthAt(undefined, 0), 0);
  const w = warmer(undefined, 1, 0);
  assert.ok(Math.abs(w.h - 0.37) < 1e-9, `${w.h}`);
  assert.ok(Math.abs(warmthAt(w, HALF_MS) - w.h / 2) < 1e-9);
  assert.ok(Math.abs(warmthAt(w, 2 * HALF_MS) - w.h / 4) < 1e-9);
  const again = warmer(w, 1, HALF_MS);
  assert.ok(Math.abs(again.h - (w.h / 2 + 0.37)) < 1e-9);
  assert.ok(warmer(undefined, 26, 0).h > w.h, "a place of many endorsers warms more");
});

test("a place that endorses every 2.9 s block stays warm, capped at 1; one that stops cools to nothing in about 30 s", () => {
  let w;
  for (let t = 0; t < 120000; t += 2900) w = warmer(w, 26, t);
  assert.equal(w.h, 1, "capped");
  let sparse;
  for (let t = 0; t < 120000; t += 60000) sparse = warmer(sparse, 1, t);
  assert.ok(sparse.h < 0.5, `a place that endorses once a minute stays faint: ${sparse.h}`);
  assert.ok(warmthAt(w, w.t + 4 * HALF_MS) < 0.07, "four halvings on");
});
