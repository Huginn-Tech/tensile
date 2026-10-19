// tipfeed-core.ts (npm test; node --test): the page's tip from the API's stream in front of the one-second polling,
// which takes over whenever the stream is not delivering. The module has type imports only, so the test compiles it
// with the project's own TypeScript and runs it on mocked timers against a fake EventSource, a fake of api.ts's polling
// and a page that can be hidden.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const load = (file) => {
  const src = readFileSync(new URL(file, import.meta.url), "utf8");
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
};

mock.timers.enable({ apis: ["setTimeout", "Date"] });
const { createTipFeed, retryMs, fresher } = await load("./tipfeed-core.ts");

const tip = (height, at) => JSON.stringify({ height, fibre_active: true, server_time: new Date(at).toISOString() });

// A page with its feed and one reader (seen); stop is that reader leaving. stream: false is a browser with no stream to
// open. poll.subs is whether the page polls, poll.asks how many times the polling was begun (each begins with an ask).
function setup({ stream = true } = {}) {
  const poll = { subs: 0, asks: 0, fn: null };
  poll.poll = (fn) => { poll.subs++; poll.asks++; poll.fn = fn; return () => { poll.subs--; }; };
  const src = { opened: [], cur() { return this.opened[this.opened.length - 1]; } };
  const open = (url) => {
    const s = {
      url, on: {}, closed: false,
      addEventListener(type, fn) { (this.on[type] ??= []).push(fn); },
      close() { this.closed = true; },
      send(type, data) { (this.on[type] ?? []).forEach((fn) => fn({ data })); },
    };
    src.opened.push(s);
    return s;
  };
  const doc = { hidden: false, on: [], addEventListener(type, fn) { this.on.push(fn); }, set(hidden) { this.hidden = hidden; this.on.forEach((fn) => fn()); } };
  const feed = createTipFeed({ url: "/api/v1/tip/stream", poll: poll.poll, open: stream ? open : undefined, doc, now: () => Date.now(), random: () => 0.5 });
  const seen = [];
  const stop = feed.subscribe((f) => seen.push(f));
  return { feed, poll, src, doc, seen, stop };
}

test("retryMs: 2 s doubling to a minute, spread a quarter either way", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 30].map((n) => retryMs(n)), [2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000]);
  assert.equal(retryMs(0), 2000);
  assert.equal(retryMs(1, 0), 1500);
  assert.equal(retryMs(1, 1), 2500);
});

test("fresher: an answer the server gave before the one on screen does not replace it", () => {
  const at = (server_time) => ({ height: 1, fibre_active: true, server_time });
  assert.equal(fresher(null, at("2026-10-19T10:00:00Z")), true);
  assert.equal(fresher(at("2026-10-19T10:00:01Z"), at("2026-10-19T10:00:00Z")), false);
  assert.equal(fresher(at("2026-10-19T10:00:00Z"), at("2026-10-19T10:00:00Z")), true);
  assert.equal(fresher(at("2026-10-19T10:00:00Z"), at("")), true);
});

test("the stream's first tip stops the polling, and every reader of the page has each tip from the one stream", () => {
  const { feed, poll, src, seen, stop } = setup();
  assert.equal(src.opened.length, 1);
  assert.equal(src.cur().url, "/api/v1/tip/stream");
  assert.equal(feed.phase(), "opening");
  assert.equal(poll.subs, 1, "the page polls while the stream opens");
  src.cur().send("tip", tip(100, Date.now()));
  assert.equal(feed.phase(), "live");
  assert.equal(poll.subs, 0, "a live stream stops the polling");
  assert.equal(seen.at(-1).data.height, 100);
  assert.equal(seen.at(-1).error, null);
  assert.equal(seen.at(-1).loading, false);
  assert.ok(seen.at(-1).fetchedAt);
  // a later reader has the tip at once, and the next one with the first
  const later = [];
  const off = feed.subscribe((f) => later.push(f));
  assert.equal(later.at(-1).data.height, 100);
  src.cur().send("tip", tip(101, Date.now()));
  assert.equal(seen.at(-1).data.height, 101);
  assert.equal(later.at(-1).data.height, 101);
  assert.equal(src.opened.length, 1, "one stream for the page");
  off();
  stop();
});

test("a stream that fails hands over to the polling at once, and is asked for again 2 s, 4 s and 8 s later", () => {
  const { feed, poll, src, stop } = setup();
  src.cur().send("tip", tip(1, Date.now()));
  src.cur().send("error");
  assert.equal(feed.phase(), "polling");
  assert.equal(src.cur().closed, true);
  assert.equal(poll.subs, 1, "polling again at once");
  for (const wait of [2000, 4000, 8000]) {
    const n = src.opened.length;
    mock.timers.tick(wait - 1);
    assert.equal(src.opened.length, n, `not before ${wait} ms`);
    mock.timers.tick(1);
    assert.equal(src.opened.length, n + 1, `asked for again after ${wait} ms`);
    assert.equal(poll.subs, 1, "the page polls until the stream delivers");
    // refused (a 503 at the cap, a 429), or no answer: EventSource says error
    src.cur().send("error");
    assert.equal(src.cur().closed, true);
  }
  stop();
});

test("a stream that sends nothing for 20 s, not even a ping, is taken for dead", () => {
  const { feed, poll, src, stop } = setup();
  src.cur().send("tip", tip(1, Date.now()));
  mock.timers.tick(15000);
  src.cur().send("ping", "{}");
  mock.timers.tick(19999);
  assert.equal(feed.phase(), "live", "a ping keeps it");
  mock.timers.tick(1);
  assert.equal(feed.phase(), "polling");
  assert.equal(src.cur().closed, true);
  assert.equal(poll.subs, 1);
  stop();
});

test("a stream that goes quiet twice in a row without staying live is given up: the polling alone, as before", () => {
  const { feed, poll, src, stop } = setup();
  src.cur().send("tip", tip(1, Date.now()));
  mock.timers.tick(20000);
  assert.equal(feed.phase(), "polling");
  mock.timers.tick(2000);
  assert.equal(src.opened.length, 2);
  src.cur().send("tip", tip(2, Date.now()));
  assert.equal(feed.phase(), "live");
  mock.timers.tick(20000);
  assert.equal(feed.phase(), "polling");
  mock.timers.tick(10 * 60000);
  assert.equal(src.opened.length, 2, "not asked for again");
  assert.equal(poll.subs, 1);
  stop();
});

test("a stream that had stayed live a minute starts its back-off afresh when it drops", () => {
  const { src, stop } = setup();
  src.cur().send("error");
  mock.timers.tick(2000);
  src.cur().send("error");
  mock.timers.tick(4000);
  src.cur().send("tip", tip(2, Date.now()));
  for (let i = 0; i < 5; i++) { mock.timers.tick(15000); src.cur().send("ping", "{}"); }
  const n = src.opened.length;
  src.cur().send("error");
  mock.timers.tick(2000);
  assert.equal(src.opened.length, n + 1, "asked for again after 2 s, not 8 s");
  stop();
});

test("while the page polls, an answer older than the tip on screen does not replace it, and a failure keeps the tip beside its error", () => {
  const { poll, src, seen, stop } = setup();
  const t0 = Date.now();
  src.cur().send("tip", tip(10, t0 + 5000));
  src.cur().send("error");
  // an answer the server gave before the stream's last tip
  poll.fn({ data: JSON.parse(tip(9, t0 + 4000)), error: null, loading: false, fetchedAt: "x" });
  assert.equal(seen.at(-1).data.height, 10);
  poll.fn({ data: null, error: "observer API unavailable", loading: false, fetchedAt: null, status: 502 });
  assert.equal(seen.at(-1).data.height, 10);
  assert.equal(seen.at(-1).error, "observer API unavailable");
  poll.fn({ data: JSON.parse(tip(11, t0 + 6000)), error: null, loading: false, fetchedAt: "y" });
  assert.equal(seen.at(-1).data.height, 11);
  assert.equal(seen.at(-1).error, null);
  stop();
});

test("a tip that cannot be read is a failure", () => {
  const { feed, poll, src, stop } = setup();
  src.cur().send("tip", "not json");
  assert.equal(feed.phase(), "polling");
  assert.equal(src.cur().closed, true);
  assert.equal(poll.subs, 1);
  stop();
});

test("with no stream to open (no EventSource, a page over HTTP/1), the page polls as it always did", () => {
  const { feed, poll, src, stop } = setup({ stream: false });
  assert.equal(feed.phase(), "polling");
  assert.equal(poll.subs, 1);
  mock.timers.tick(10 * 60000);
  assert.equal(src.opened.length, 0);
  assert.equal(poll.subs, 1);
  stop();
});

test("hidden a minute, the page lets its stream go and asks nothing; shown, it asks the tip at once and opens the stream", () => {
  const { feed, poll, src, doc, stop } = setup();
  src.cur().send("tip", tip(1, Date.now()));
  // hidden for half a minute and back: the stream stays, past the minute it would have been let go at
  doc.set(true);
  for (let i = 0; i < 2; i++) { mock.timers.tick(15000); src.cur().send("ping", "{}"); }
  doc.set(false);
  for (let i = 0; i < 3; i++) { mock.timers.tick(15000); src.cur().send("ping", "{}"); }
  assert.equal(feed.phase(), "live");
  assert.equal(src.opened.length, 1);
  // hidden for a minute: let go
  const asks = poll.asks;
  doc.set(true);
  for (let i = 0; i < 3; i++) { mock.timers.tick(15000); src.cur().send("ping", "{}"); }
  mock.timers.tick(14999);
  assert.equal(feed.phase(), "live");
  mock.timers.tick(1);
  assert.equal(feed.phase(), "asleep");
  assert.equal(src.cur().closed, true);
  assert.equal(poll.subs, 0);
  mock.timers.tick(10 * 60000);
  assert.equal(src.opened.length, 1, "nothing asked while hidden");
  assert.equal(poll.asks, asks);
  doc.set(false);
  assert.equal(poll.asks, asks + 1, "the tip asked at once");
  assert.equal(src.opened.length, 2);
  assert.equal(feed.phase(), "opening");
  stop();
});

test("the last reader leaving closes the stream a moment later; a reader back by then keeps it", () => {
  const { feed, poll, src, stop } = setup();
  src.cur().send("tip", tip(1, Date.now()));
  stop();
  mock.timers.tick(1000);
  const again = feed.subscribe(() => {});
  mock.timers.tick(5000);
  assert.equal(src.opened.length, 1);
  assert.equal(src.cur().closed, false);
  again();
  mock.timers.tick(2000);
  assert.equal(src.cur().closed, true);
  assert.equal(feed.phase(), "asleep");
  assert.equal(poll.subs, 0);
});
