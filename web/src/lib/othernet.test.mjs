// othernet-core.ts (npm test; node --test): the site's name in its titles, the other network's site as a build reads
// it, and which page there a record that is not here opens, against a stub of the other site's API that answers as the
// observer API does. The modules are TypeScript with type imports only, so the test compiles them with the project's
// own TypeScript.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import ts from "typescript";

const load = (file) => {
  const src = readFileSync(new URL(file, import.meta.url), "utf8");
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
};
const { siteName, previewImage, otherSiteOf, findOther } = await load("./othernet-core.ts");
const { findBlobs } = await load("./blobfind-core.ts");
const { blobKey } = await load("./blobkey.ts");

test("the site's name carries its network's after Tensile, and mainnet's is plain Tensile", () => {
  assert.equal(siteName("Mocha"), "Tensile Mocha");
  assert.equal(siteName(" Mocha \n"), "Tensile Mocha");
  for (const none of ["", "  ", undefined, null]) assert.equal(siteName(none), "Tensile");
  // the titles as the layout and the pages build them
  assert.equal(`${siteName("Mocha")} · Real-time Celestia Fibre explorer`, "Tensile Mocha · Real-time Celestia Fibre explorer");
  assert.equal(`${siteName("Mocha")} · Celestia Fibre explorer`, "Tensile Mocha · Celestia Fibre explorer");
  assert.equal(`${siteName("")} · Real-time Celestia Fibre explorer`, "Tensile · Real-time Celestia Fibre explorer");
  assert.equal(`API · ${siteName("Mocha")} · Celestia Fibre`, "API · Tensile Mocha · Celestia Fibre");
});

test("a network with a name has its own preview image, and the Mocha build's is there", () => {
  assert.equal(previewImage("Mocha"), "/og-mocha.png");
  assert.equal(previewImage(" Mocha "), "/og-mocha.png");
  for (const none of ["", " ", undefined, null]) assert.equal(previewImage(none), "/og.png");
  // the name web/.env.production gives the Mocha build, and the image it picks, in public/
  const env = readFileSync(new URL("../../.env.production", import.meta.url), "utf8");
  const label = /^NEXT_PUBLIC_NETWORK_LABEL=(.*)$/m.exec(env)?.[1].trim();
  assert.equal(label, "Mocha");
  for (const img of [previewImage(label), previewImage("")]) assert.ok(existsSync(new URL(`../../public${img}`, import.meta.url)), img);
});

test("the other network's site is an origin and a name, both set, or none", () => {
  const mocha = { origin: "https://tensile-mocha.huginn.tech", label: "Mocha" };
  assert.deepEqual(otherSiteOf("https://tensile-mocha.huginn.tech", "Mocha"), mocha);
  assert.deepEqual(otherSiteOf(" https://tensile-mocha.huginn.tech/ ", " Mocha "), mocha);
  assert.deepEqual(otherSiteOf("https://Tensile-Mocha.huginn.tech", "Mocha"), mocha);
  assert.deepEqual(otherSiteOf("http://127.0.0.1:3000", "Mocha"), { origin: "http://127.0.0.1:3000", label: "Mocha" });
  for (const [url, label] of [
    ["", "Mocha"], ["https://tensile-mocha.huginn.tech", ""], [undefined, undefined], ["https://tensile-mocha.huginn.tech", undefined],
    ["tensile-mocha.huginn.tech", "Mocha"], ["ftp://tensile-mocha.huginn.tech", "Mocha"], ["https://tensile-mocha.huginn.tech/api", "Mocha"],
    ["https://tensile-mocha.huginn.tech/?x=1", "Mocha"], ["https://tensile-mocha.huginn.tech/#x", "Mocha"], ["https://u:p@tensile-mocha.huginn.tech", "Mocha"],
    ["https://a.huginn.tech https://b.huginn.tech", "Mocha"], ["not a url", "Mocha"],
  ]) assert.equal(otherSiteOf(url, label), null, `${url} ${label}`);
});

// the other site's API: the Celestia docs' example blob, its settlement transaction and its blob ID, a deposit that
// settled no blob, a transaction that failed in a block, a commitment two blobs share, a publisher and a validator
const SITE = { origin: "https://tensile-mocha.huginn.tech", label: "Mocha" };
const PROMISE = "481498948d4e9ee30ad214ab22d1d2005c7c218e9db95dabfd5b4e42d5e88a95";
const TX = "add4c5190131d0afb55af3341b347700b2adec2b128faf3c7ca06495852c5c16";
const ID = "AJ+0/lcm8YgL/06EFKHMnnMaQfJp/ChDQskMk7rkd8FQ";
const COMMITMENT = "9fb4fe5726f1880bff4e8414a1cc9e731a41f269fc284342c90c93bae477c150";
const DEPOSIT = "0b5273d779cec9d2fc9534077bd1ac45904ac7e82c9af6b9ecb98255756b0b30";
const FAILED = "2f9bb8f9f45408918797f115ba51fc7cedb27bc6531ec371c08dec143e78f5de";
const SHARED = "22".repeat(32);
const PUBLISHER = "celestia1las83d0dt9gew3faq2mxp2gtupq5drclee9snr";
const VALOPER = "celestiavaloper19jz75rcp26a6tkch208qm2wmt2ekk4a272cvlx";
const blob = (promise_hash, commitment, tx, height) => ({ promise_hash, commitment, settlement_tx_hash: tx, settlement_height: height, settlement_tx_index: 0 });
const RECORD = [blob(PROMISE, COMMITMENT, TX, 1113071), blob("11".repeat(32), SHARED, "b1".repeat(32), 2000), blob("12".repeat(32), SHARED, "b2".repeat(32), 2001)];
const failedTx = { height: 1200, time: "2026-10-01T00:00:00Z", code: 11, ante_passed: true, messages: [] };

/** the other site, answering at origin/api/v1 as the observer API does; asked: every address it was asked, in order */
function otherApi({ down = false } = {}) {
  const asked = [];
  const get = async (url) => {
    asked.push(url);
    if (down) throw new TypeError("Failed to fetch");
    const prefix = `${SITE.origin}/api/v1/`;
    assert.ok(url.startsWith(prefix), url);
    const u = new URL(url);
    const p = u.pathname.slice("/api/v1/".length), q = u.searchParams;
    const json = (status, body) => ({ ok: status < 300, status, json: async () => body });
    if (p.startsWith("blobs/")) {
      const b = RECORD.find((r) => r.promise_hash === p.slice(6));
      return b ? json(200, { blob: b }) : json(404, { error: "not found" });
    }
    if (p === "blobs") {
      const limit = Number(q.get("limit") ?? 50);
      if (q.has("commitment")) { const m = RECORD.filter((r) => r.commitment === q.get("commitment")); return json(200, { blobs: m.slice(0, limit), total: m.length, commitment: q.get("commitment") }); }
      if (q.has("tx")) {
        const m = RECORD.filter((r) => r.settlement_tx_hash === q.get("tx"));
        return json(200, { blobs: m.slice(0, limit), total: m.length, tx: q.get("tx"), ...(q.get("tx") === FAILED ? { failed_tx: failedTx } : {}) });
      }
    }
    if (p.startsWith("txs/")) return [TX, DEPOSIT, FAILED].includes(p.slice(4)) ? json(200, { tx_hash: p.slice(4) }) : json(404, { error: "not found" });
    if (p === `publishers/${PUBLISHER}`) return json(200, { publisher: { publisher: PUBLISHER } });
    if (p === `validators/${VALOPER}`) return json(200, { validator: { operator_address: VALOPER } });
    return json(404, { error: "not found" });
  };
  return { asked, deps: { get, find: findBlobs } };
}

test("a record the other site has opens the same page there, its query kept", async () => {
  const api = otherApi();
  assert.equal(await findOther(SITE, [{ route: `/v1/blobs/${PROMISE}` }], `/blob/?hash=${PROMISE}`, api.deps), `${SITE.origin}/blob/?hash=${PROMISE}`);
  assert.equal(await findOther(SITE, [{ route: `/v1/txs/${DEPOSIT}` }], `/tx/?hash=${DEPOSIT.toUpperCase()}`, api.deps), `${SITE.origin}/tx/?hash=${DEPOSIT.toUpperCase()}`);
  assert.equal(await findOther(SITE, [{ route: `/v1/publishers/${PUBLISHER}?window=all` }], `/publisher/?addr=${PUBLISHER}`, api.deps), `${SITE.origin}/publisher/?addr=${PUBLISHER}`);
  assert.equal(await findOther(SITE, [{ route: `/v1/validators/${VALOPER}?window=24h` }], `/validator/?addr=${VALOPER}&tab=endpoints`, api.deps), `${SITE.origin}/validator/?addr=${VALOPER}&tab=endpoints`);
  // the other site's own API, at its /api, by the same route the page asked here
  assert.deepEqual(api.asked.slice(0, 2), [`${SITE.origin}/api/v1/blobs/${PROMISE}`, `${SITE.origin}/api/v1/txs/${DEPOSIT}`]);
});

test("a blob identifier is asked as the page here asked it: a settlement transaction, a blob ID, a failure in a block", async () => {
  const api = otherApi();
  const tx = blobKey(TX.toUpperCase()), id = blobKey(ID);
  assert.equal(await findOther(SITE, [{ blob: tx, as: ["tx"] }], `/blob/?tx=${TX.toUpperCase()}`, api.deps), `${SITE.origin}/blob/?tx=${TX.toUpperCase()}`);
  assert.equal(await findOther(SITE, [{ blob: id, as: ["commitment"] }], `/blob/?id=${encodeURIComponent(ID)}`, api.deps), `${SITE.origin}/blob/?id=${encodeURIComponent(ID)}`);
  assert.equal(await findOther(SITE, [{ blob: blobKey(FAILED), as: ["tx"] }], `/blob/?tx=${FAILED}`, api.deps), `${SITE.origin}/blob/?tx=${FAILED}`);
  // asked only as what the page asked: the promise hash is not a transaction's
  assert.equal(await findOther(SITE, [{ blob: blobKey(PROMISE), as: ["tx"] }], `/blob/?tx=${PROMISE}`, api.deps), null);
});

test("the search's lookup opens a lone blob's page, the list of several, or the transaction's", async () => {
  const api = otherApi();
  const looks = (hex) => [{ blob: blobKey(hex), as: ["promise", "commitment", "tx"], href: `/blobs/?blob=${hex}`, one: true }, { route: `/v1/txs/${hex}`, href: `/tx/?hash=${hex}` }];
  assert.equal(await findOther(SITE, looks(TX), "/", api.deps), `${SITE.origin}/blob/?hash=${PROMISE}`);
  assert.equal(await findOther(SITE, looks(PROMISE), "/", api.deps), `${SITE.origin}/blob/?hash=${PROMISE}`);
  assert.equal(await findOther(SITE, looks(SHARED), "/", api.deps), `${SITE.origin}/blobs/?blob=${SHARED}`);
  // a transaction that settled no blob is the second look's
  assert.equal(await findOther(SITE, looks(DEPOSIT), "/", api.deps), `${SITE.origin}/tx/?hash=${DEPOSIT}`);
  assert.equal(await findOther(SITE, [{ blob: blobKey(ID), as: ["promise", "commitment", "tx"], href: `/blobs/?blob=${encodeURIComponent(ID)}`, one: true }], "/", api.deps),
    `${SITE.origin}/blob/?hash=${PROMISE}`);
});

test("a record the other site does not have, or a site that does not answer, opens nothing", async () => {
  const none = "33".repeat(32);
  for (const api of [otherApi(), otherApi({ down: true })]) {
    assert.equal(await findOther(SITE, [{ route: `/v1/blobs/${none}` }], `/blob/?hash=${none}`, api.deps), null);
    assert.equal(await findOther(SITE, [{ route: `/v1/validators/${VALOPER.replace("9jz", "8jz")}?window=24h` }], "/validator/", api.deps), null);
    assert.equal(await findOther(SITE, [{ blob: blobKey(none), as: ["promise", "commitment", "tx"], one: true }, { route: `/v1/txs/${none}` }], "/", api.deps), null);
  }
  // a refusal or an outage is not a record either
  const refusing = { get: async () => ({ ok: false, status: 429, json: async () => ({}) }), find: findBlobs };
  assert.equal(await findOther(SITE, [{ route: `/v1/publishers/${PUBLISHER}?window=all` }], "/publisher/", refusing), null);
  assert.equal(await findOther(SITE, [{ blob: blobKey(TX), as: ["tx"] }], "/blob/", refusing), null);
});
