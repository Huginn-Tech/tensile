// conveyor.ts (npm test; node --test): the recent-blobs grid takes a beat's blobs one place at a time. A lone blob
// slides as it did; several come in STEP_MS apart, within MAX_MS however many; the oldest comes into view first. The
// module is TypeScript with no imports, so the test compiles it with the project's own TypeScript.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const load = (file) => {
  const src = readFileSync(new URL(file, import.meta.url), "utf8");
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
};
const { slide, frames, enters, SLIDE_MS, STEP_MS, MAX_MS } = await load("./conveyor.ts");

test("a lone blob slides as it always did", () => {
  assert.deepEqual(slide(1, 10), { steps: 1, stepMs: SLIDE_MS, ms: SLIDE_MS });
  assert.deepEqual(slide(0, 10), { steps: 1, stepMs: SLIDE_MS, ms: SLIDE_MS });
});

test("a block of several comes in one place at a time, STEP_MS apart", () => {
  assert.deepEqual(slide(2, 10), { steps: 2, stepMs: STEP_MS, ms: 2 * STEP_MS });
  assert.deepEqual(slide(4, 10), { steps: 4, stepMs: STEP_MS, ms: 4 * STEP_MS });
});

test("however many, the slide stays within MAX_MS and moves at most a row", () => {
  for (let n = 2; n <= 60; n++) {
    const s = slide(n, 10);
    assert.ok(s.ms <= MAX_MS, `n=${n}: ${s.ms} ms`);
    assert.equal(s.steps, Math.min(n, 10));
    assert.equal(s.ms, s.steps * s.stepMs);
  }
});

test("the tape eases into each place, from the slide's reach back to its own", () => {
  const f = frames(slide(3, 10), 27);
  assert.deepEqual(f.map((k) => k.transform), ["translateX(-81px)", "translateX(-54px)", "translateX(-27px)", "translateX(0px)"]);
  assert.deepEqual(f.map((k) => k.offset), [0, 1 / 3, 2 / 3, 1]);
  assert.ok(f.every((k) => typeof k.easing === "string"));
  const one = frames(slide(1, 10), 27);
  assert.deepEqual(one.map((k) => k.transform), ["translateX(-27px)", "translateX(0px)"]);
});

test("the oldest of a beat comes into view first, the newest last; places past its reach at once", () => {
  const s = slide(4, 10);
  assert.deepEqual([3, 2, 1, 0].map((i) => enters(i, s)), [0, STEP_MS, 2 * STEP_MS, 3 * STEP_MS]);
  assert.equal(enters(4, s), 0);
  assert.equal(enters(0, slide(1, 10)), 0);
});
