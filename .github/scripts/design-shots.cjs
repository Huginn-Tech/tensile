// design-shots.cjs <mainnet out> <shots dir> <mocha out>: serves a MAINNET build of the site (no network label, the
// other site = the live Mocha site) from <mainnet out>, passes /api/* through to the live Mocha API, and answers 404
// for one real Mocha blob, transaction, publisher and validator, so each page finds nothing here and asks the live
// Mocha site, which has them: the "This is on Mocha" line. Photographs each page and the header search at 1440 and 375,
// both themes, plus a hash found nowhere (no line). Dumps the <head> titles and preview tags of both builds into
// notes.txt. Runs only in the Design shots workflow, on a throwaway branch that is never merged.
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { chromium } = require(path.join(process.env.PW_DIR, "node_modules", "playwright-core"));

const [root, out, mochaRoot] = process.argv.slice(2).map((p) => path.resolve(p));
const LIVE = "tensile.huginn.tech";
const PORT = 4173;
const BASE = `http://127.0.0.1:${PORT}`;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2", ".txt": "text/plain" };

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) {
    const up = https.request({ host: LIVE, path: req.url, method: req.method, headers: { accept: req.headers.accept || "*/*", "user-agent": "tensile-design-shots" } }, (r) => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    });
    up.on("error", () => { res.writeHead(502); res.end(); });
    req.on("close", () => up.destroy());
    return up.end();
  }
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p.endsWith("/")) p += "index.html";
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});

// real Mocha records (the Celestia docs' example blob, its settlement transaction and blob ID, an escrow deposit, the
// docs' publisher, a validator), each answered 404 by this site's /api so the page asks the live Mocha site
const PROMISE = "481498948d4e9ee30ad214ab22d1d2005c7c218e9db95dabfd5b4e42d5e88a95";
const TX = "ADD4C5190131D0AFB55AF3341B347700B2ADEC2B128FAF3C7CA06495852C5C16";
const ID = "AJ+0/lcm8YgL/06EFKHMnnMaQfJp/ChDQskMk7rkd8FQ";
const COMMITMENT = "9fb4fe5726f1880bff4e8414a1cc9e731a41f269fc284342c90c93bae477c150";
const DEPOSIT = "0B5273D779CEC9D2FC9534077BD1AC45904AC7E82C9AF6B9ECB98255756B0B30";
const PUBLISHER = "celestia1las83d0dt9gew3faq2mxp2gtupq5drclee9snr";
const VALOPER = "celestiavaloper19jz75rcp26a6tkch208qm2wmt2ekk4a272cvlx";
const NOWHERE = "11".repeat(32);
const HIDE = [PROMISE, TX, COMMITMENT, DEPOSIT, PUBLISHER, VALOPER].map((s) => s.toLowerCase());

const PAGES = [
  ["blob-hash", `/blob/?hash=${PROMISE}`],
  ["blob-tx", `/blob/?tx=${TX}`],
  ["blob-id", `/blob/?id=${encodeURIComponent(ID)}`],
  ["tx", `/tx/?hash=${DEPOSIT}`],
  ["publisher", `/publisher/?addr=${PUBLISHER}`],
  ["validator", `/validator/?addr=${VALOPER}`],
  ["blobs-list", `/blobs/?blob=${TX.toLowerCase()}`],
];
const SEARCHES = [["search-tx", TX], ["search-validator", VALOPER], ["search-publisher", PUBLISHER], ["search-nowhere", NOWHERE]];
const notes = [];

const getJson = (p) => new Promise((ok) => {
  https.get({ host: LIVE, path: p, headers: { "user-agent": "tensile-design-shots" } }, (r) => {
    let s = ""; r.on("data", (d) => (s += d)); r.on("end", () => { try { ok(JSON.parse(s)); } catch { ok(null); } });
  }).on("error", () => ok(null));
});

/** the <title> and the description, Open Graph and Twitter tags of a built page, one per line */
function head(file) {
  if (!fs.existsSync(file)) return [`(no ${file})`];
  const html = fs.readFileSync(file, "utf8");
  const h = html.slice(0, html.indexOf("</head>") > 0 ? html.indexOf("</head>") : 20000);
  const lines = [];
  const t = /<title>([^<]*)<\/title>/.exec(h);
  lines.push(`<title>${t ? t[1] : "(none)"}</title>`);
  for (const m of h.matchAll(/<meta [^>]*>|<link rel="canonical"[^>]*>/g)) if (/og:|twitter:|name="description"|canonical/.test(m[0])) lines.push(m[0]);
  return lines;
}

async function shoot(browser, theme, W, H, control) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, colorScheme: theme });
  await ctx.addInitScript((t) => { try { localStorage.setItem("theme", t); } catch {} }, theme);
  // this site's API has none of the real Mocha records above
  await ctx.route((u) => u.host === `127.0.0.1:${PORT}` && u.pathname.startsWith("/api/v1/") && HIDE.some((h) => (u.pathname + u.search).toLowerCase().includes(h)),
    (route) => route.fulfill({ status: 404, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: '{"error":"not found"}' }));
  const page = await ctx.newPage();
  const tag = `${W} ${theme}`;
  page.on("pageerror", (e) => notes.push(`${tag} page error: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") notes.push(`${tag} console: ${m.text().slice(0, 200)}`); });
  // every request to the other site, by the page that made it
  let asks = [];
  page.on("request", (r) => { if (new URL(r.url()).host === LIVE) asks.push(r.url().replace(`https://${LIVE}`, "")); });

  const measure = () => page.evaluate(() => {
    const line = document.querySelector("a.go-other");
    const box = line?.closest("p, td, .hs-note");
    return {
      line: box ? box.textContent.trim() : null, href: line ? line.getAttribute("href") : null,
      notice: [...document.querySelectorAll("main .notice")].map((n) => n.textContent.trim().slice(0, 80)),
      wide: document.documentElement.scrollWidth, title: document.title,
      lineBox: box ? box.getBoundingClientRect().toJSON() : null,
      h1: document.querySelector("main h1")?.textContent.trim() ?? null,
    };
  });

  for (const [name, p] of PAGES) {
    asks = [];
    await page.goto(BASE + p, { waitUntil: "domcontentloaded" });
    const t0 = Date.now();
    try { await page.waitForSelector("a.go-other", { timeout: 25000 }); } catch { notes.push(`${name} ${tag}: NO LINE`); }
    const ms = Date.now() - t0;
    await page.waitForTimeout(700);
    if (name === "blobs-list") await page.evaluate(() => { const el = document.querySelector(".lg-empty"); el?.scrollIntoView({ block: "center" }); });
    await page.waitForTimeout(200);
    const m = await measure();
    notes.push(`${name} ${tag}: h1 "${m.h1}" | line "${m.line}" -> ${m.href} (${ms} ms) | notices ${JSON.stringify(m.notice)} | page width ${m.wide} | asked Mocha ${asks.length}x: ${asks.join(" ")}`);
    await page.screenshot({ path: path.join(out, `${name}-${W}-${theme}.png`) });
  }

  // a hash found nowhere: the notice as today, no line
  asks = [];
  await page.goto(`${BASE}/blob/?hash=${NOWHERE}`, { waitUntil: "domcontentloaded" });
  try { await page.waitForSelector("main .notice", { timeout: 25000 }); } catch { notes.push(`nowhere ${tag}: NO NOTICE`); }
  await page.waitForTimeout(1500);
  let m = await measure();
  notes.push(`nowhere ${tag}: h1 "${m.h1}" | line ${m.line === null ? "none" : `"${m.line}"`} | notices ${JSON.stringify(m.notice)} | page width ${m.wide} | asked Mocha ${asks.length}x: ${asks.join(" ")}`);
  await page.screenshot({ path: path.join(out, `nowhere-${W}-${theme}.png`) });

  // a blob this site has: the other site is never asked
  if (control) {
    asks = [];
    await page.goto(`${BASE}/blob/?hash=${control}`, { waitUntil: "domcontentloaded" });
    try { await page.waitForSelector(".bd-title, main h1", { timeout: 25000 }); } catch { /* noted below */ }
    await page.waitForTimeout(3000);
    m = await measure();
    notes.push(`found-here ${tag}: blob ${control.slice(0, 10)} h1 "${m.h1}" | line ${m.line === null ? "none" : `"${m.line}"`} | asked Mocha ${asks.length}x`);
  }

  // the header search: what it says for each, the panel open
  for (const [name, q] of SEARCHES) {
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".hs input", { timeout: 30000 });
    asks = [];
    await page.click(".hs input");
    await page.fill(".hs input", q);
    const want = name === "search-nowhere" ? ".hs-note:not(:has(.hs-wait))" : ".hs-note a.go-other";
    try { await page.waitForSelector(want, { timeout: 25000 }); } catch { notes.push(`${name} ${tag}: NO ${name === "search-nowhere" ? "NOTE" : "LINE"}`); }
    await page.waitForTimeout(600);
    const s = await page.evaluate(() => {
      const n = document.querySelector(".hs-note"), a = n?.querySelector("a");
      const dd = document.querySelector(".hs-dd");
      return { note: n?.textContent.trim() ?? null, href: a?.getAttribute("href") ?? null, dd: dd?.getBoundingClientRect().toJSON(), wide: document.documentElement.scrollWidth,
        cut: n ? n.scrollWidth > n.clientWidth + 1 : null };
    });
    notes.push(`${name} ${tag}: note "${s.note}" -> ${s.href} | cut ${s.cut} | page width ${s.wide} | asked Mocha ${asks.length}x: ${asks.join(" ")}`);
    await page.screenshot({ path: path.join(out, `${name}-${W}-${theme}.png`) });
  }

  if (W === 1440 && theme === "dark") {
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    const t = await page.evaluate(() => ({ title: document.title, og: document.querySelector('meta[property="og:title"]')?.content, tw: document.querySelector('meta[name="twitter:title"]')?.content, img: document.querySelector('meta[property="og:image"]')?.content }));
    notes.push(`mainnet build, live page: document.title "${t.title}" | og:title "${t.og}" | twitter:title "${t.tw}" | og:image ${t.img}`);
  }
  await ctx.close();
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  for (const [name, dir] of [["Mocha build (web/.env.production)", mochaRoot], ["mainnet build (label empty, other site Mocha)", root]]) {
    notes.push(`--- ${name}: head of /`);
    notes.push(...head(path.join(dir, "index.html")));
    for (const p of ["api", "methodology"]) notes.push(`/${p}/ ${head(path.join(dir, p, "index.html"))[0]}`);
    notes.push(`public images: ${["og.png", "og-mocha.png"].map((f) => `${f} ${fs.existsSync(path.join(dir, f)) ? "present" : "MISSING"}`).join(", ")}`);
  }
  notes.push("--- mainnet build, pages answered 404 here for real Mocha records");
  const newest = await getJson("/api/v1/blobs?limit=1");
  const control = newest?.blobs?.[0]?.promise_hash ?? null;
  await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
  const browser = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", args: ["--hide-scrollbars"] });
  for (const theme of ["dark", "light"]) { await shoot(browser, theme, 1440, 900, control); await shoot(browser, theme, 375, 812, control); }
  await browser.close();
  server.close();
  fs.writeFileSync(path.join(out, "notes.txt"), notes.join("\n") + "\n");
  console.log(notes.join("\n"));
})().catch((e) => { console.error(e); fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, "notes.txt"), notes.join("\n") + `\nFAILED: ${e.stack}\n`); process.exit(1); });
