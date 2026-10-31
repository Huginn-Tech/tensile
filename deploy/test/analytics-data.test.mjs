// analytics-data.mjs (node --test; web's npm test runs it), run as it is in production against a fake observer API: what
// a first run reads and writes, what a later run reads again, and what a run that fails leaves behind.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../analytics-data.mjs", import.meta.url));

const blob = (height, t) => ({
  settlement_time: new Date(t * 1000).toISOString(), settlement_height: height, settlement_tx_index: 0, blob_size: 1024, publisher: height % 2 ? "celestia1aaaaaaaaaaaaaaaa" : "celestia1bbbbbbbbbbbbbbbb",
  charge: { fee_utia: 10 }, attested_voting_power: 2, total_voting_power: 3, reconstructable: { status: "recoverable" }, namespace: "00000000" + Buffer.from("krews").toString("hex"),
});
const validator = (n, extra = {}) => ({
  operator_address: `celestiavaloper1${n}`, moniker: `v${n}`, voting_power: 10, host: "h", reachable: true, readiness: "ready", obligations: { total: 4, served: 4, broken: 0 }, signing: { assigned: 2, signed: 2 },
  hosting: { provider: "Other", as_org: "SERVERS-COM", asn: 7979, country: "DE", city: "Berlin", lat: 52.52, lon: 13.4 }, ...extra,
});

// Newest first, as the API lists them.
let blobs, asked, broken;
const NOW = 1_800_000_000;
function answer(req, res) {
  const u = new URL(req.url, "http://x"), p = u.pathname;
  asked.push(p + u.search);
  const send = (v) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(v)); };
  if (broken && p === broken) { res.writeHead(500); return res.end(); }
  if (p === "/v1/blobs") {
    const before = +(u.searchParams.get("before_height") ?? Infinity);
    return send({ blobs: blobs.filter((b) => b.settlement_height < before).slice(0, 100) });
  }
  if (p === "/v1/validators") return send({ computed_at: "2026-10-31T00:00:00Z", validators: [validator(1), validator(2, { host: "", hosting: null })] });
  if (p.startsWith("/v1/validators/")) return send({ validator: { reachability_window: { num: 9, den: 10 }, endpoint_since: "2026-10-01T00:00:00Z" }, endpoint_history: [{ outcome: "registered" }] });
  if (p === "/v1/tip") return send({ height: 42 });
  if (p === "/v1/hosting") return send({ sources: { looked_up_at: "2026-10-31T00:00:00Z" } });
  if (p === "/v1/params") return send({ price_formula: { base_gas: 1 }, protocol: {}, current: { effective_from_time: "2026-09-24T00:00:00Z" } });
  if (p === "/v1/market") return send({ window: { name: u.searchParams.get("window") }, settlements: blobs.length, daily: [], withdrawal_queue: {} });
  if (p === "/v1/publishers") return send({ publishers: [{ publisher: "celestia1aaaaaaaaaaaaaaaa", namespaces: [{ namespace: "00000000" + Buffer.from("krews").toString("hex") }] }] });
  res.writeHead(404);
  res.end();
}

let api, port, dir;
before(async () => {
  api = http.createServer(answer);
  await new Promise((ok) => api.listen(0, "127.0.0.1", ok));
  port = api.address().port;
});
after(() => api.close());
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "analytics-"));
  blobs = Array.from({ length: 250 }, (_, i) => blob(1000 - i, NOW - i * 3600));
  asked = [];
  broken = null;
});

const run = () => new Promise((ok) => {
  const c = spawn(process.execPath, [SCRIPT], { env: { ...process.env, API_LISTEN: `127.0.0.1:${port}`, NETWORK: "testnet", STATE_DIRECTORY: dir }, stdio: "ignore" });
  c.on("close", ok);
});
const data = () => JSON.parse(readFileSync(path.join(dir, "data.json"), "utf8"));

test("a first run reads every page and writes one file", async () => {
  assert.equal(await run(), 0);
  const d = data();
  assert.equal(d.net, "testnet");
  assert.equal(d.usage.settlements.length, 250);
  assert.deepEqual(d.usage.settlements[0], [NOW, 1024, 0, 10, 0.6667, "recoverable", "krews"]);
  assert.deepEqual(d.usage.addresses.sort(), ["celestia1aaaaaaaaaaaaaaaa", "celestia1bbbbbbbbbbbbbbbb"]);
  assert.equal(asked.filter((p) => p.startsWith("/v1/blobs")).length, 3);
  assert.equal(d.data.totals.hosts, 1);
  assert.equal(d.data.totals.no_host_validators, 1);
  assert.equal(d.data.providers[0].name, "Servers.com");
  assert.equal(d.data.fibre_live_at, "2026-09-24T00:00:00Z");
  assert.equal(d.data.validators[0].moves, 1);
  rmSync(dir, { recursive: true, force: true });
});

test("a later run reads the newest page and leaves validators' pages for the hour", async () => {
  assert.equal(await run(), 0);
  blobs = [blob(1001, NOW + 60), ...blobs];
  asked = [];
  assert.equal(await run(), 0);
  assert.equal(data().usage.settlements.length, 251);
  assert.deepEqual(asked.filter((p) => p.startsWith("/v1/blobs")), ["/v1/blobs?limit=100"]);
  assert.equal(asked.filter((p) => p.startsWith("/v1/validators/")).length, 0);
  rmSync(dir, { recursive: true, force: true });
});

test("a settlement's last day is read again, so an availability that moved does not stay old", async () => {
  blobs = blobs.map((b) => ({ ...b, reconstructable: { status: "pending" } }));
  assert.equal(await run(), 0);
  blobs = blobs.map((b) => ({ ...b, reconstructable: { status: "recoverable" } }));
  assert.equal(await run(), 0);
  const rows = data().usage.settlements;
  assert.equal(rows.length, 250);
  assert.equal(rows[0][5], "recoverable");
  assert.equal(rows[249][5], "pending");
  rmSync(dir, { recursive: true, force: true });
});

test("a run that cannot read something fails and leaves the last file", async () => {
  assert.equal(await run(), 0);
  const before = statSync(path.join(dir, "data.json")).mtimeMs;
  broken = "/v1/market";
  assert.notEqual(await run(), 0);
  assert.equal(statSync(path.join(dir, "data.json")).mtimeMs, before);
  assert.equal(data().usage.settlements.length, 250);
  rmSync(dir, { recursive: true, force: true });
});
