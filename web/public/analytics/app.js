// The Analytics page: the site's own component (components/Analytics.tsx) calls this with a shadow root and the file
// the timer writes (deploy/analytics-data.mjs). Its class names are its own, so it stays behind the shadow boundary
// and the site's styles and these stay out of each other's way. Returns the function that takes it down again.
window.TensileAnalytics = (shadow, file) => {
"use strict";
const { net, usage: U0, data: D0 } = file;
const USAGE = { [net]: U0 }, DATA = { [net]: D0 };
const stop = new AbortController();
const siteTheme = () => (document.documentElement.dataset.theme === "light" ? "light" : "dark");
shadow.host.dataset.theme = siteTheme();
shadow.querySelector("#page").innerHTML = `<main class="page">
<div class="bar"><h1>Analytics</h1><div class="seg" id="seg-win" role="group" aria-label="Period for usage, cost and publishers"></div></div>

<section class="sec" id="top" aria-label="Usage">
    <div class="grid">
      <article class="card tile main" data-tile="data">
        <h3>Data settled<span data-f="sub"></span></h3>
        <p class="hero"><b data-f="data"></b><span data-f="count"></span></p>
        <svg class="plot" data-c="data" aria-hidden="true"></svg>
      </article>
      <article class="card tile" data-tile="new">
        <h3>New publishers</h3>
        <p class="fig" data-f="new"></p>
        <svg class="plot" data-c="new" aria-hidden="true"></svg>
      </article>
      <article class="card tile" data-tile="rate">
        <h3>TIA per MiB</h3>
        <p class="fig" data-f="rate"></p>
        <svg class="plot" data-c="rate" aria-hidden="true"></svg>
      </article>
      <article class="card tile" data-tile="escrow">
        <h3>Escrow used since launch</h3>
        <p class="fig" data-f="escrow"></p>
        <svg class="plot" data-c="escrow" aria-hidden="true"></svg>
      </article>
      <article class="card tile" data-tile="days">
        <h3>Active days</h3>
        <p class="fig" data-f="days"></p>
        <svg class="plot" data-c="days" aria-hidden="true"></svg>
      </article>
    </div>
  </section>

<section class="sec" id="cost" aria-label="What a blob costs">
    <article class="card">
      <h3>What a blob costs</h3>
      <p class="key"></p>
      <p class="fig" data-f="head"></p>
      <svg class="plot" role="img" tabindex="0"></svg>
    </article>
  </section>

<section class="sec" id="publishers" aria-label="Publishers">
    <div class="sec-h"><h2>Publishers</h2><p></p></div>
    <div class="card pb-card">
      <div class="pb-share">
        <div class="pb-top"><div class="pb-labels"></div><div class="ctl pb-of"><span class="ctl-l">Bar shows</span><div class="seg" role="group" aria-label="Bar shows"></div></div></div>
        <div class="pb-bar" role="img"></div>
      </div>
      <div class="pb-wrap">
        <table class="pb-t">
          <colgroup><col class="c-who"><col><col class="c-data"><col class="c-mib"><col class="c-avg"><col class="c-days"><col class="c-left"><col class="c-since"></colgroup>
          <thead><tr></tr></thead>
          <tbody></tbody>
          <tfoot>
            <tr class="pb-key"><td>Height, data per hour</td><td class="a"><div class="pb-rule"></div></td><td colspan="6"></td></tr>
          </tfoot>
        </table>
        <div class="pb-notes"></div>
        <i class="pb-x"></i>
        <i class="pb-ring"></i>
      </div>
    </div>
  </section>

<section class="sec" id="hosting" aria-label="Hosting">
    <div class="sec-h">
      <h2>Hosting</h2><p></p>
      <div class="ctl">
        <span class="ctl-l">Ring and table by</span>
        <div class="seg" id="hs-by" role="group" aria-label="Ring and table by"></div>
        <span class="ctl-l">Size all by</span>
        <div class="seg" id="hs-weigh" role="group" aria-label="Size all by"></div>
      </div>
    </div>
    <div class="card hs">
      <div class="band">
        <div class="who">
          <div class="say"><p class="say-who"></p></div>
          <div class="whobox">
            <div class="ringbox">
              <svg class="ring" viewBox="0 0 500 500" role="img" aria-label="Share of voting power"></svg>
              <div class="centre"></div>
            </div>
            <svg class="ldrs" aria-hidden="true"></svg>
            <div class="names"></div>
          </div>
        </div>
        <div class="where">
          <div class="say"><p class="say-where"></p><div class="mkey"></div></div>
          <div class="mp">
            <canvas aria-hidden="true"></canvas><svg role="img"></svg>
            <div class="mside"><div class="mhd"></div><div class="mreg"></div></div>
          </div>
        </div>
      </div>
      <div class="how">
        <div class="say"><p class="say-how"></p><div class="say-r"><button type="button" class="clear" hidden>Clear picks</button><span>Click rows to compare, up to 3</span></div></div>
      </div>
      <div class="tb">
        <div class="tb-list"></div>
        <div class="tb-vs"></div>
      </div>
      <div class="notes"></div>
    </div>
  </section>

<footer class="foot" id="foot"></footer>
</main>
<div id="tip" role="tooltip"></div>`;

// Shared by every area. The rules for using it are in CONTRACT.md.
const M = (() => {
"use strict";

/* ---------- dom ---------- */
const $ = (s, r = shadow) => r.querySelector(s), $$ = (s, r = shadow) => [...r.querySelectorAll(s)];
const SVGNS = "http://www.w3.org/2000/svg";
const el = (t, a = {}, p) => { const e = document.createElementNS(SVGNS, t); for (const k in a) e.setAttribute(k, a[k]); if (p) p.appendChild(e); return e; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
const root = shadow.host;
// For canvas, which cannot read var(): takes "--x" or "var(--x)", resolved for the current theme.
const token = (name) => getComputedStyle(root).getPropertyValue(name.replace(/^var\((.+)\)$/, "$1")).trim();

/* ---------- format ---------- */
const pct = (x, d = 1) => (x * 100).toFixed(d) + "%";
// One decimal; 100% is the only whole figure. One floor for tiny values everywhere.
const sharePct = (x) => (x === 1 ? "100%" : x > 0 && x < .0001 ? "<0.01%" : x > 0 && x < .001 ? pct(x, 2) : x < 1 && x >= .9995 ? ">99.9%" : pct(x));
// One decimal down a column, whole numbers included, so the points stack.
const readyPct = (x) => (x >= 1 ? "100.0%" : x >= .9995 ? ">99.9%" : x > 0 && x < .0001 ? "<0.01%" : x > 0 && x < .001 ? pct(x, 2) : pct(x));
const int = (v) => Math.round(v).toLocaleString("en-US");
// Mainnet has windows with exactly one settlement or publisher.
const count = (n, word) => `${int(n)} ${word}${n === 1 ? "" : "s"}`;
// With no d, three figures and no trailing zeros.
const bytes = (b, d) => {
  const [v, unit] = b >= 2 ** 30 ? [b / 2 ** 30, "GiB"] : b >= 2 ** 20 ? [b / 2 ** 20, "MiB"] : [b / 2 ** 10, "KiB"];
  return `${d == null ? +v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2) : v.toFixed(d)} ${unit}`;
};
// An exact size, one rule for every table and tooltip: two decimals in MiB and GiB, none in KiB, zeros kept.
const size = (b) => bytes(b, b >= 2 ** 20 ? 2 : 0);
// Rounds whole utia half up: toFixed would turn 47.105 into 47.10 and break 47.11 = 28.52 + 18.59.
// With no d, the page's one money rule: three decimals under 1 TIA, two under 1,000, none above.
const moneyD = (u) => (u < 1e5 ? 3 : u < 1e9 ? 2 : 0);
const tiaN = (u, d) => {
  if (d == null && !u) return "0";
  if (d == null && u < 500) return "<0.001";
  const dd = d ?? moneyD(u);
  return (Math.round(u / 10 ** (6 - dd)) / 10 ** dd).toLocaleString("en-US", { minimumFractionDigits: dd, maximumFractionDigits: dd });
};
const tia = (u, d) => tiaN(u, d) + " TIA";
// Both ends in the lower end's decimals.
const tiaRange = (a, b) => { const d = moneyD(a); return a === b ? tia(a, d) : `${tiaN(a, d)}–${tia(b, d)}`; };
const day = (s, y) => new Date(s + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: y ? "numeric" : undefined, timeZone: "UTC" });
const dayOf = (t) => new Date(t * 1e3).toISOString().slice(0, 10);
const stamp = (s) => new Date(s).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" }) + " UTC";

/* ---------- state and events ---------- */
// Under 30 days old a chain's 30d and All are the same view, so the shorter name is not offered.
const young = (net) => (Date.parse(USAGE[net].read_at) - Date.parse(DATA[net].fibre_live_at)) / 864e5 < 30;
const state = { net, theme: root.dataset.theme === "light" ? "light" : "dark", win: "all", lit: null, pinned: [] };
let chosen = false;
const subs = new Map();
const on = (ev, fn) => { if (!subs.has(ev)) subs.set(ev, new Set()); subs.get(ev).add(fn); return () => subs.get(ev).delete(fn); };
// One failing listener must not stop the others.
const emit = (ev, ...a) => (subs.get(ev) || []).forEach((fn) => { try { fn(...a); } catch (e) { console.error(`${ev} listener failed:`, e); } });

function set(key, val) {
  if (!(key in state)) throw new Error("unknown state: " + key);
  const prev = state[key];
  if (val === prev) return;
  state[key] = val;
  if (key === "net") { state.lit = null; state.pinned = []; state.win = !chosen || (state.win === "30d" && young(val)) ? "all" : state.win; }
  if (key === "theme") root.dataset.theme = val;
  emit(key, val, prev);
}
const lit = (name) => set("lit", name ?? null);
const MAX_PINS = 3;
// Adds or removes a provider; a fourth pin drops the oldest.
const pin = (name) => { const p = state.pinned; set("pinned", p.includes(name) ? p.filter((x) => x !== name) : [...p, name].slice(-MAX_PINS)); };

// An area's render runs at boot and on net, theme and win, with that word as its argument.
const area = (name, render) => { for (const ev of ["boot", "net", "theme", "win"]) on(ev, () => { try { render(ev); } catch (e) { console.error(`${name} render failed on ${ev}:`, e); } }); };

/* ---------- data: N() is hosting, U() is usage ---------- */
const N = () => DATA[state.net];
const U = () => USAGE[state.net];
const market = () => U().market[state.win];

/* ---------- colour: one hue, so rank carries identity; a provider's step is its rank on the network shown ---------- */
const TAIL = "var(--tail)";
// Ranks 1 to 5 hold 0.09 L apart at 3:1 in both themes. Past that a number names the rank, not a shade.
const RANKS = 5;
// Label ink on a filled mark: whichever of the two reads better on it, by contrast.
const lum = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };
const inkOn = (name) => { const f = hexOf(name), [dark, light] = [hexOf("--ink"), hexOf("--card")]; return ratio(f, dark) >= ratio(f, light) ? "var(--ink)" : "var(--card)"; };
// A token's own hex, following var() chains such as --p1: var(--u1).
const hexOf = (name) => { const v = token(name); return v.startsWith("var(") ? hexOf(v) : v.length === 4 ? "#" + [...v.slice(1)].map((c) => c + c).join("") : v; };

/* ---------- usage for the current window, worked out once per network and window ---------- */
const memo = new Map();
const once = (what, make) => { const k = `${state.net} ${state.win} ${what}`; if (!memo.has(k)) memo.set(k, make()); return memo.get(k); };
// [start, end] in unix seconds. Before launch there was no Fibre, so those days are not quiet ones: no axis opens earlier. The API opens "all" at year 1.
const span = () => once("span", () => {
  const w = market().window;
  return [Math.floor(Math.max(Date.parse(N().fibre_live_at), Date.parse(w.start)) / 1e3), Math.ceil(Date.parse(w.end) / 1e3)];
});
// Publishers with a settlement in the window, by data; the API's list also holds accounts that only hold escrow.
// An account keeps its name in every window, so the name comes from the since-launch list.
const pubs = () => once("pubs", () => { const named = new Map(U().publishers.all.map((a) => [a.address, a.name])); return U().publishers[state.win].filter((p) => p.settlements > 0).sort((a, b) => b.bytes - a.bytes || (a.address < b.address ? -1 : 1))
  .map((p, i) => { const name = named.get(p.address) || p.name; return { ...p, name, display: name || p.short, rank: i + 1, colour: i < RANKS ? `var(--u${i + 1})` : TAIL }; }); });
const settled = () => once("settled", () => {
  const u = U(), [t0, t1] = span(), by = new Map(pubs().map((p) => [p.address, p])), out = [];
  for (const [t, size, i, fee, share, status, ns] of u.settlements) if (t >= t0 && t <= t1) out.push({ t, size, fee, share, status, ns, pub: by.get(u.addresses[i]) });
  return out;
});
const fee = (size) => { const f = U().params.price_formula; return (f.base_gas + f.gas_per_chunk * Math.ceil(size / f.chunk_bytes)) * f.utia_per_gas; };
const perMib = (size) => fee(size) / (size / 2 ** 20);
// Dates on one even step, counted back from the last day, so every time axis on the page lands on the same days.
const dayTicks = (most = 6) => { const { days } = activeDays(), step = [1, 2, 5, 7, 14, 28, 56].find((k) => (days.length - 1) / k < most) ?? 91, out = []; for (let i = days.length - 1; i >= 0; i -= step) out.unshift(days[i]); return out; };
const DAY = 86400;
const LAST = { "7d": 7, "30d": 30 };
// The last 7 or 30 UTC days, today included, or every day since launch, so 7d is 7 and the part-day a window opens on never counts as a day.
// Launch day stays: nothing came before it. p is a pubs() row or a folded row with .list; none means everyone. t is the day's noon, held inside span().
const activeDays = (p) => {
  const who = p && new Set((p.list || [p]).map((x) => x.address));
  return once(`days ${who ? [...who] : ""}`, () => {
    const [t0, t1] = span(), by = new Map(), days = [], last = Math.floor(t1 / DAY), n = LAST[state.win];
    const first = Math.max(Math.floor(t0 / DAY), n ? last - n + 1 : 0);
    for (const r of settled()) {
      if (who && !who.has(r.pub.address)) continue;
      const k = dayOf(r.t), d = by.get(k) || by.set(k, { settlements: 0, bytes: 0, fees: 0 }).get(k);
      d.settlements += 1; d.bytes += r.size; d.fees += r.fee;
    }
    for (let i = first; i <= last; i++) { const s = i * DAY; days.push({ day: dayOf(s), i: i - first, t: Math.min(t1, Math.max(t0, s + DAY / 2)), settlements: 0, bytes: 0, fees: 0, ...by.get(dayOf(s)) }); }
    return { days, active: days.filter((d) => d.settlements).length, total: days.length };
  });
};
// Fees ÷ data per active day, in utia per MiB. joined: the day before settled too, the only case a line may reach back.
const dailyRate = () => once("rate", () => activeDays().days.filter((d) => d.settlements).map((d, i, a) => ({ ...d, rate: d.fees / (d.bytes / 2 ** 20), joined: i > 0 && Date.parse(d.day) - Date.parse(a[i - 1].day) === DAY * 1e3 })));
// Accounts whose first settlement ever falls in the window, oldest first: pubs() rows plus t.
const newPublishers = () => once("new", () => {
  const [t0, t1] = span(), by = new Map(pubs().map((p) => [p.address, p]));
  return U().publishers.all.map((a) => ({ ...by.get(a.address), t: Math.floor(Date.parse(a.first_settlement_at) / 1e3) })).filter((p) => p.t >= t0 && p.t <= t1).sort((a, b) => a.t - b.t);
});
// Since launch, whatever the window. A timed-out promise is charged like a settled one, so paid holds both. gap is what the ledger leaves unexplained.
const escrowFlow = () => {
  const a = U().market.all, deposited = a.deposits.utia, paid = a.fees_utia + a.timed_out_utia, held = a.escrow_held_utia, withdrawn = a.withdrawn.utia;
  return { deposited, paid, held, withdrawn, gap: deposited - paid - held - withdrawn, used: paid / deposited };
};
// The row's average blob since launch, whatever the window; a folded row averages its accounts.
const blobEver = (p) => {
  const ever = (p.list || [p]).map((x) => U().publishers.all.find((a) => a.address === x.address)).filter(Boolean), n = sum(ever, (a) => a.settlements);
  return n ? sum(ever, (a) => a.bytes) / n : null;
};
// What the available balance still buys at that blob, so only deposits and spend move it, never the window.
const blobsLeft = (p) => { const b = blobEver(p); return p.escrow_available_utia == null || b == null ? null : Math.floor(p.escrow_available_utia / fee(b)); };
// Days the balance lasts at the row's spend over this window; null when it spent nothing.
const runway = (p) => { const [t0, t1] = span(); return p.fees_utia ? p.escrow_available_utia / (p.fees_utia / ((t1 - t0) / DAY)) : null; };

/* ---------- groups ---------- */
const uniq = (a) => [...new Set(a)];
// Rolls rows of N().providers, .countries or .cities into one row of the same shape.
// agg(N().providers) is the "all providers" row; ready_share keeps the rows' base.
function agg(list, key = "all", name = "All") {
  const of = (f) => sum(list, f), checks = of((g) => g.checks), failed = of((g) => g.failed_checks), vp = of((g) => g.vp);
  return { key, name, tail: true, n: list.length, vp, share: of((g) => g.share), hosts: of((g) => g.hosts), host_share: of((g) => g.host_share),
    countries: uniq(list.flatMap((g) => g.countries || [])), companies: uniq(list.flatMap((g) => g.companies || [])), cities: uniq(list.flatMap((g) => g.cities || [])),
    reachability: checks ? 1 - failed / checks : null, checks, failed_checks: failed,
    ready_hosts: of((g) => g.ready_hosts), not_ready_hosts: of((g) => g.not_ready_hosts), not_reported_hosts: of((g) => g.not_reported_hosts),
    ready_share: vp ? of((g) => g.ready_share * g.vp) / vp : 0, served: of((g) => g.served), shards: of((g) => g.shards), not_served: of((g) => g.not_served) };
}

/* ---------- regions: UN geoscheme by country; the Americas split at Panama/Colombia ---------- */
const REGION = {
  Europe: "AD AL AT AX BA BE BG BY CH CZ DE DK EE ES FI FO FR GB GG GI GR HR HU IE IM IS IT JE LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS RU SE SI SJ SK SM UA VA XK",
  Asia: "AE AF AM AZ BD BH BN BT CN CY GE HK ID IL IN IQ IR JO JP KG KH KP KR KW KZ LA LB LK MM MN MO MV MY NP OM PH PK PS QA SA SG SY TH TJ TL TM TR TW UZ VN YE",
  Africa: "AO BF BI BJ BW CD CF CG CI CM CV DJ DZ EG EH ER ET GA GH GM GN GQ GW IO KE KM LR LS LY MA MG ML MR MU MW MZ NA NE NG RE RW SC SD SH SL SN SO SS ST SZ TD TF TG TN TZ UG YT ZA ZM ZW",
  "North America": "AG AI AW BB BL BM BQ BS BZ CA CR CU CW DM DO GD GL GP GT HN HT JM KN KY LC MF MQ MS MX NI PA PM PR SV SX TC TT US VC VG VI",
  "South America": "AR BO BR BV CL CO EC FK GF GS GY PE PY SR UY VE",
  Oceania: "AS AU CC CK CX FJ FM GU HM KI MH MP NC NF NR NU NZ PF PG PN PW SB TK TO TV UM VU WF WS",
};
const REGION_OF = new Map(Object.entries(REGION).flatMap(([r, cs]) => cs.split(" ").map((c) => [c, r])));
const regionOf = (cc) => REGION_OF.get(cc) || "Other";
// Each region's share of all bonded voting power, biggest first; a filter narrows it, e.g. to one provider.
function regions(match = () => true) {
  const m = new Map();
  N().validators.forEach((v) => {
    if (!v.has_host || !match(v)) return;
    const name = regionOf(v.cc), r = m.get(name) || m.set(name, { name, share: 0, vp: 0, hosts: 0, countries: new Set(), cities: new Set() }).get(name);
    r.share += v.share; r.vp += v.vp; r.hosts += 1; r.countries.add(v.cc); r.cities.add(v.city + "|" + v.cc);
  });
  return [...m.values()].map((r) => ({ ...r, countries: r.countries.size, cities: r.cities.size })).sort((a, b) => b.share - a.share);
}

/* ---------- segmented control ---------- */
const segs = new Set();
function seg(id, opts, get, change) {
  const box = $(id); box.innerHTML = `<i></i>` + opts.map(([v, t]) => `<button type="button" data-v="${v}">${t}</button>`).join("");
  const thumb = box.firstChild;
  const sync = () => { $$("button", box).forEach((b) => { const on = b.dataset.v === get(); b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); if (on) { thumb.style.width = b.offsetWidth + "px"; thumb.style.transform = `translateX(${b.offsetLeft}px)`; } }); };
  box.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b && b.dataset.v !== get()) { change(b.dataset.v); sync(); } });
  box.sync = sync; segs.add(box); sync(); return box;
}
const syncSegs = () => segs.forEach((b) => b.sync());

/* ---------- tooltip ---------- */
const tip = $("#tip");
// floor: a viewport y the tooltip stays above, so it never covers an axis or the mark it describes. ceil: one it stays below, which wins, so a figure is never covered.
function showTip(html, x, y, floor, ceil) {
  tip.innerHTML = html; tip.classList.add("on");
  const r = tip.getBoundingClientRect(), W = innerWidth, H = innerHeight;
  let tx = x + 14, ty = y + 14;
  if (tx + r.width > W - 8) tx = x - r.width - 14;
  if (ty + r.height > H - 8) ty = y - r.height - 14;
  if (floor != null) ty = Math.min(ty, floor - r.height - 6);
  if (ceil != null) ty = Math.max(ty, ceil);
  tip.style.transform = `translate(${Math.max(8, tx)}px, ${Math.max(8, ty)}px)`;
}
// The tooltip at a point the caller works out from its size, for a mark the box must not cover.
function tipAt(html, place) {
  tip.innerHTML = html; tip.classList.add("on");
  const r = tip.getBoundingClientRect(), [x, y] = place(r);
  tip.style.transform = `translate(${Math.max(8, Math.min(innerWidth - r.width - 8, x))}px, ${Math.max(8, Math.min(innerHeight - r.height - 8, y))}px)`;
}
const hideTip = () => tip.classList.remove("on");
const tipHead = (title, colour) => `<h4>${colour ? `<i style="--c:${colour}"></i>` : ""}${esc(title)}</h4>`;
const tipRow = (label, value) => (value == null ? `<div class="w">${esc(label)}</div>` : `<div>${esc(label)} <b>${esc(value)}</b></div>`);

/* ---------- header and foot: nobody's area ---------- */
function chrome() {
  const n = N();
  $("#foot").innerHTML = [`Data as of ${stamp(U().read_at)}`, `Hosts located ${stamp(n.hosting_looked_up_at)}`, "IP geolocation by DB-IP · IPtoASN"].map((t) => `<span>${esc(t)}</span>`).join("");
  $('#seg-win [data-v="30d"]').hidden = young(state.net);
  syncSegs();
}
// The site's own toggle sets the theme on the document.
const theme = new MutationObserver(() => set("theme", siteTheme()));
theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
stop.signal.addEventListener("abort", () => theme.disconnect());
on("net", chrome);

let rt = 0;
addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => emit("resize"), 120); }, { signal: stop.signal });
on("resize", syncSegs);
on("win", syncSegs);

function boot() {
  seg("#seg-win", [["7d", "7d"], ["30d", "30d"], ["all", "All"]], () => state.win, (v) => { chosen = true; set("win", v); });
  chrome();
  emit("boot");
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(syncSegs);
}

return { $, $$, el, esc, sum, calm, token, pct, sharePct, readyPct, int, count, bytes, size, tiaN, tia, tiaRange, day, dayOf, stamp,
  state, on, set, lit, pin, MAX_PINS, area, boot, N, U, market, span, pubs, settled, fee, perMib, young,
  activeDays, dayTicks, dailyRate, newPublishers, escrowFlow, blobEver, blobsLeft, runway, TAIL, RANKS, inkOn, agg, regionOf, regions, seg, showTip, tipAt, hideTip, tipHead, tipRow };
})();

/* ---------- top ---------- */
try {
const { $, $$, el, esc, sum, state, market, U, N, settled, span, perMib, area, on, bytes, size, int, count, tia, tiaN, pct, day, dayOf, stamp, showTip, hideTip, tipHead, tipRow, activeDays, dayTicks, dailyRate, newPublishers, escrowFlow } = M;

const WINDOW = { "7d": "last 7 days", "30d": "last 30 days", all: "since launch" };
const q = (s) => $("#top " + s);
const f = (name) => q(`[data-f="${name}"]`), c = (name) => q(`[data-c="${name}"]`);
const wipe = (svg) => { svg.textContent = ""; return svg; };
const unit = (value, u) => `${esc(value)}<small>${esc(u)}</small>`;
const side = (t) => (t ? `<span>${esc(t)}</span>` : "");
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// WIDE: from this grid width the tiles' titles leave room for the whole note.
const WIDE = 1200, AXIS = 10, FLUSH = 36, FEW = 24, FEW_NEW = 8, NEAR = 10, TICKS = 6, BAND = 28, QUIET = 8, BAR = 12, DAY = 86400, DOT = 3, FLOOR_RISE = 5, RAIL_W = 26, RAIL_GAP = 6;
// The small tiles share one frame: chart from T to B, axis ends under it. The inset is the tile's own, which narrows with the page.
const frame = (svg, hero) => {
  const L = parseFloat(getComputedStyle(q(hero ? ".main" : ".tile:not(.main)")).paddingLeft), W = svg.clientWidth, H = svg.clientHeight;
  return { W, H, L, R: W - L, T: 12, B: H - 26 };
};
// Tiles start on whole pixels at 1x; snapping keeps thin marks sharp at any zoom.
const snapper = (svg) => { const ox = svg.getBoundingClientRect().left, dpr = devicePixelRatio || 1; return (x) => +(Math.round((x + ox) * dpr) / dpr - ox).toFixed(2); };
const axisEnd = (svg, x, t, anchor) => { el("text", { x, y: svg.clientHeight - AXIS, "text-anchor": anchor }, svg).textContent = t; };
// A date names its day, so it sits at that day's noon, on the same days as every other time axis; near an end it stands flush. Small tiles name only their ends.
function dateAxis(svg, X, a, b, hero) {
  const [t0] = span(), { days } = activeDays(), live = Math.floor(Date.parse(N().fibre_live_at) / 1e3);
  if (!hero) { axisEnd(svg, a, day(days[0].day), "start"); axisEnd(svg, b, day(days.at(-1).day), "end"); return; }
  dayTicks(TICKS).forEach((d) => {
    const x = X(d.t), first = d === days[0] && t0 === live;
    if (x < a + FLUSH) axisEnd(svg, a, `${first ? "Launch " : ""}${day(d.day)}`, "start");
    else if (x > b - 20) axisEnd(svg, b, day(d.day), "end");
    else axisEnd(svg, x, day(d.day), "middle");
  });
}
const range = () => { const P = U().params; return `${tiaN(perMib(P.max_blob_size_bytes), 2)}–${tiaN(perMib(P.price_formula.chunk_bytes), 2)}`; };
const dayAt = (t) => activeDays().days.find((d) => d.day === dayOf(t));

/* ---------- every time chart answers to one cursor ---------- */
const CH = {};
const cursor = (t) => { for (const k in CH) CH[k].at(t); };

function hoverTime(name, tip, leave) {
  const tile = q(`[data-tile="${name}"]`);
  tile.addEventListener("mousemove", (e) => {
    const ch = CH[name], plot = c(name), r = plot.getBoundingClientRect(), x = clamp(e.clientX - r.left, ch.pad, ch.end);
    const t = ch.tAt ? ch.tAt(x) : ch.t0 + ((ch.t1 - ch.t0) * (x - ch.pad)) / (ch.end - ch.pad);
    cursor(t);
    // A small tile's figure stays in sight: the box may not climb past the plot's top.
    showTip(tip(t, x), e.clientX, e.clientY, r.top + ch.base, plot.closest(".main") ? undefined : r.top);
  });
  tile.addEventListener("mouseleave", () => { cursor(null); hideTip(); leave?.(); });
}

/* ---------- cumulative steps: Data settled and New publishers ---------- */
// Round values for the scale's gridlines: 50, 100 MiB, never more than the two a plot this size can carry.
function ladder(peak) {
  const u = peak >= 2 ** 30 ? 2 ** 30 : peak >= 2 ** 20 ? 2 ** 20 : 2 ** 10, name = u === 2 ** 30 ? "GiB" : u === 2 ** 20 ? "MiB" : "KiB";
  const mag = 10 ** Math.floor(Math.log10(peak / 3.2 / u)), step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s * 3.2 >= peak / u);
  const out = [];
  for (let v = step; v * u < peak * .92; v += step) out.push({ v: v * u, t: `${+v.toFixed(3)} ${name}` });
  return out.slice(0, 2);
}

function steps(name, rows, value, hero) {
  const svg = wipe(c(name)), [t0, t1] = span(), { H, L, R, T, B } = frame(svg, hero), snap = snapper(svg);
  const dot = hero ? 4.5 : 4, pad = L, end = R - dot - 1, base = hero ? H - 32 : B, top = hero ? 10 : T;
  const total = sum(rows, value), peak = total || 1;
  const dpr = devicePixelRatio || 1, X = (t) => pad + ((end - pad) * (t - t0)) / (t1 - t0), Y = (v) => +(Math.round((base - ((base - top) * v) / (hero ? peak * 1.06 : peak)) * dpr) / dpr).toFixed(2);
  // One corner per pixel column: Mocha has thousands of steps.
  const path = (list) => {
    const cols = new Map(); let run = 0;
    for (const r of list) { run += value(r); cols.set(snap(X(r.t)), run); }
    let d = `M${pad} ${Y(0)}`;
    for (const [x, v] of cols) d += `H${x}V${Y(v)}`;
    return d + `H${end}`;
  };
  const d = path(rows);
  if (hero && rows.length > 1) for (const g of ladder(peak)) {
    const y = Math.round(Y(g.v)) + .5;
    el("line", { class: "rule", x1: pad, x2: end, y1: y, y2: y }, svg);
    el("text", { x: end, y: y + 14, "text-anchor": "end" }, svg).textContent = g.t;
  }
  // On the hero the rules, labels and last date share one right edge; only the end dot hangs past it.
  const edge = hero ? end : R;
  el("line", { class: "base", x1: pad, x2: edge, y1: base + .5, y2: base + .5 }, svg);
  dateAxis(svg, X, pad, edge, hero);
  el("path", { class: "line", d }, svg);
  const part = el("g", {}, svg), few = rows.length <= (hero ? FEW : FEW_NEW), dots = new Map();
  if (few) { let run = 0; for (const r of rows) { run += value(r); dots.set(r, el("circle", { class: "stepdot", cx: snap(X(r.t)), cy: Y(run), r: hero ? 4 : 3, fill: "var(--acc)" }, svg)); } }
  const cross = el("line", { class: "cross", y1: top, y2: base, visibility: "hidden" }, svg);
  const cur = el("circle", { class: "cursor", r: 4, visibility: "hidden" }, svg);
  // Hollow means now, everywhere, and it is drawn last so the cursor never hides it.
  el("circle", { class: "end", cx: end, cy: Y(total), r: dot }, svg);
  const at = (t) => {
    if (t == null) { cross.setAttribute("visibility", "hidden"); cur.setAttribute("visibility", "hidden"); return; }
    const x = snap(X(t) - .5) + .5, v = rows.reduce((s, r) => (r.t <= t ? s + value(r) : s), 0);
    cross.setAttribute("x1", x); cross.setAttribute("x2", x); cross.setAttribute("visibility", "visible");
    cur.setAttribute("cx", x); cur.setAttribute("cy", Y(v)); cur.setAttribute("visibility", "visible");
  };
  CH[name] = { rows, X, pad, end, base, part, path, dots, t0, t1, at };
}

const nearest = (ch, x) => [...ch.dots.keys()].reduce((b, r) => { const g = Math.abs(ch.X(r.t) - x); return g < NEAR && (!b || g < b.g) ? { r, g } : b; }, null)?.r;

/* ---------- new publishers: hovering one shows its share of the big curve ---------- */
let LIT_PUB = null;
function light(p) {
  if (p === LIT_PUB) return;
  LIT_PUB = p;
  const ch = CH.data, n = CH.new;
  ch.part.textContent = "";
  c("new").classList.toggle("dim", !!p);
  n.dots.forEach((node, r) => node.classList.toggle("on", r === p));
  if (!p) return;
  const d = ch.path(ch.rows.filter((r) => r.pub.address === p.address));
  el("path", { d, fill: "none", stroke: "var(--ink)", "stroke-width": 2 }, ch.part);
}

// A date covers its whole day, so one date always shows one total.
const dayEnd = (t) => (Math.floor(t / DAY) + 1) * DAY;
function newTip(t, x) {
  const ch = CH.new, near = ch.rows.reduce((b, r) => { const g = Math.abs(ch.X(r.t) - x); return g < NEAR && (!b || g < b.g) ? { r, g } : b; }, null);
  light(near ? near.r : null);
  if (near) { const p = near.r; return tipHead(p.display, p.colour) + tipRow("First settlement", stamp(p.t * 1e3)) + tipRow("Data", size(p.bytes)) + tipRow("Fees paid", tia(p.fees_utia)); }
  return tipHead(`Through ${day(dayOf(t))}`) + tipRow("New publishers", int(newPublishers().filter((p) => p.t < dayEnd(t)).length));
}

function dataTip(t, x) {
  const ch = CH.data, s = nearest(ch, x);
  if (s) return tipHead(s.pub.display, s.pub.colour) + tipRow("Time", stamp(s.t * 1e3)) + tipRow("Size", size(s.size)) + tipRow("Fee", tia(s.fee));
  const done = ch.rows.filter((r) => r.t < dayEnd(t)), h = tipHead(`Through ${day(dayOf(t))}`);
  if (!done.length) return h + tipRow("No settlements");
  return h + tipRow("Data", size(sum(done, (r) => r.size))) + tipRow("Fees paid", tia(sum(done, (r) => r.fee))) + tipRow("Settlements", int(done.length));
}

/* ---------- one x per day, the first and last flush to the plot's ends, shared by the two daily tiles ---------- */
function dayAxis(svg, right = 0) {
  const g = frame(svg), snap = snapper(svg), { days } = activeDays(), n = days.length, R = g.R - right, per = (R - g.L) / Math.max(1, n - 1), w = per >= 7 ? 3 : 2;
  const x = (i) => snap(g.L + (R - g.L - w) * (n > 1 ? i / (n - 1) : 0)) + w / 2;
  return { ...g, R, days, n, w, per, snap, x, tAt: (px) => days[clamp(Math.round((px - g.L) / per), 0, n - 1)].t };
}
const dayEnds = (svg, g) => { axisEnd(svg, g.L, day(g.days[0].day), "start"); axisEnd(svg, g.R, day(g.days.at(-1).day), "end"); };

/* ---------- paid per MiB: one dot per active day, between the protocol's two prices ---------- */
function drawRate() {
  const svg = wipe(c("rate")), g = dayAxis(svg, RAIL_W + RAIL_GAP), P = U().params, days = dailyRate(), right = frame(svg).R;
  const hi = perMib(P.price_formula.chunk_bytes), lo = perMib(P.max_blob_size_bytes), floor = g.B - FLOOR_RISE;
  const Y = (v) => +(g.T + ((floor - g.T) * Math.log(hi / v)) / Math.log(hi / lo)).toFixed(1);
  const cx = (s) => clamp(g.x(s.i), g.L + DOT, g.R - DOT);
  for (const [y, v] of [[g.T, hi], [floor, lo]]) {
    el("line", { class: "base", x1: g.L, x2: g.R, y1: y + .5, y2: y + .5 }, svg);
    // The protocol's two prices stand in their own gutter, so no dot ever meets them.
    el("text", { x: right, y: y + 4, "text-anchor": "end" }, svg).textContent = tiaN(v, 2);
  }
  dayEnds(svg, g);
  let d = "";
  for (const s of days) d += `${s.joined ? "L" : "M"}${cx(s)} ${Y(s.rate)}`;
  if (d.includes("L")) el("path", { class: "rate", d }, svg);
  for (const s of days) el("circle", { class: "dot", cx: cx(s), cy: Y(s.rate), r: DOT }, svg);
  const cross = el("line", { class: "cross", y1: g.T, y2: floor, visibility: "hidden" }, svg);
  const cur = el("circle", { class: "cursor", r: DOT + .5, visibility: "hidden" }, svg);
  const at = (t) => {
    const d = t == null ? null : dayAt(t), on = d && days.find((s) => s.day === d.day);
    cross.setAttribute("visibility", d ? "visible" : "hidden"); cur.setAttribute("visibility", on ? "visible" : "hidden");
    if (d) { const x = g.snap(g.x(d.i) - .5) + .5; cross.setAttribute("x1", x); cross.setAttribute("x2", x); }
    if (on) { cur.setAttribute("cx", cx(on)); cur.setAttribute("cy", Y(on.rate)); }
  };
  CH.rate = { pad: g.L, end: g.R, base: floor + 4, tAt: g.tAt, at };
}

function rateTip(t) {
  const d = dayAt(t), s = dailyRate().find((x) => x.day === d.day);
  return tipHead(day(d.day)) + (s ? tipRow("TIA per MiB", tiaN(s.rate, 2)) + tipRow("Data", size(s.bytes)) + tipRow("Fees paid", tia(s.fees)) + tipRow("Price range", `${range()} TIA`) : tipRow("No settlements"));
}

/* ---------- active days: a tick a day, lit or quiet ---------- */
function drawDays() {
  const svg = wipe(c("days")), g = dayAxis(svg), mid = Math.round((g.T + g.B) / 2), { w } = g, nodes = new Map();
  for (const d of g.days) {
    const h = d.settlements ? BAND : QUIET;
    nodes.set(d.day, el("rect", { class: d.settlements ? "tick on" : "tick", x: g.x(d.i) - w / 2, y: mid - h / 2, width: w, height: h, rx: w / 2 }, svg));
  }
  dayEnds(svg, g);
  let lit = null;
  const at = (t) => {
    lit?.classList.remove("cur");
    lit = t == null ? null : nodes.get(dayOf(t)) || null;
    lit?.classList.add("cur");
  };
  CH.days = { pad: g.L, end: g.R, base: g.B + 4, tAt: g.tAt, at };
}

function daysTip(t) {
  const d = dayAt(t);
  return tipHead(day(d.day)) + (d.settlements ? tipRow("Settlements", int(d.settlements)) + tipRow("Data", size(d.bytes)) : tipRow("No settlements"));
}

/* ---------- escrow: deposited = paid + held + withdrawn, whatever the window ---------- */
const PARTS = [["paid", "Paid"], ["held", "Unspent"], ["withdrawn", "Withdrawn"]], SWATCH = 8, BAR_Y = 8, KEY_Y = 34;

function drawEscrow() {
  const svg = wipe(c("escrow")), F = escrowFlow(), { L, R } = frame(svg), snap = snapper(svg), W = R - L, used = PARTS.filter(([k]) => F[k]);
  const clip = el("clipPath", { id: "top-escrow-bar" }, el("defs", {}, svg));
  el("rect", { x: L, y: BAR_Y, width: W, height: BAR, rx: 3 }, clip);
  const bar = el("g", { "clip-path": "url(#top-escrow-bar)" }, svg);
  // The 2px gap straddles each boundary, so a boundary lands on the true share.
  let run = 0;
  used.forEach(([k], i) => {
    const a = snap(L + (W * run) / F.deposited) + (i ? 1 : 0);
    run += F[k];
    const b = snap(L + (W * run) / F.deposited) - (i < used.length - 1 ? 1 : 0);
    el("rect", { class: `part ${k}`, x: a, y: BAR_Y, width: Math.max(2, b - a), height: BAR }, bar);
  });
  const texts = PARTS.map(([k, name]) => {
    const g = el("g", {}, svg), key = el("rect", { class: `part ${k}`, y: KEY_Y - SWATCH + 1, width: SWATCH, height: SWATCH, rx: 2 }, g);
    const a = el("text", { y: KEY_Y }, g), b = el("text", { class: "val", y: KEY_Y + 14 }, g);
    a.textContent = name; b.textContent = tiaN(F[k]);
    return { key, a, b, w: Math.max(SWATCH + 4 + a.getComputedTextLength(), b.getComputedTextLength()) };
  });
  // Name and value stay together; the last column ends on the bar's end.
  const xs = [L, 0, R - texts[2].w];
  xs[1] = Math.round((xs[0] + texts[0].w + xs[2] - texts[1].w) / 2);
  texts.forEach((t, i) => { t.key.setAttribute("x", xs[i]); t.a.setAttribute("x", xs[i] + SWATCH + 4); t.b.setAttribute("x", xs[i]); });
  axisEnd(svg, L, `Of ${tia(F.deposited)} deposited`, "start");
}

function hoverEscrow() {
  const tile = q('[data-tile="escrow"]');
  const mark = (part) => { const k = part && PARTS.find(([n]) => part.classList.contains(n))?.[0]; c("escrow").classList.toggle("dim", !!k); $$("#top .part").forEach((n) => n.classList.toggle("on", !!k && n.classList.contains(k))); };
  tile.addEventListener("mousemove", (e) => {
    const F = escrowFlow(), P = U().params;
    mark(e.target.closest(".part"));
    showTip(tipHead("Since launch") + tipRow("Deposited", tia(F.deposited)) + tipRow("Paid", tia(F.paid)) + tipRow("Unspent, for future blobs", tia(F.held)) + tipRow("Withdrawn", tia(F.withdrawn)) + tipRow("Withdrawal delay", count(P.withdrawal_delay_s / DAY, "day")), e.clientX, e.clientY);
  });
  tile.addEventListener("mouseleave", () => { mark(null); hideTip(); });
}

/* ---------- the whole section ---------- */
function draw() {
  const m = market(), [num, u] = bytes(m.bytes).split(" "), fresh = newPublishers(), D = activeDays();
  f("data").innerHTML = unit(num, u);
  f("sub").textContent = `running total, ${WINDOW[state.win]}${m.settlements <= FEW ? "; a dot is a settlement" : ""}`;
  f("count").textContent = `${count(m.settlements, "settlement")} · ${tia(m.fees_utia)} paid`;
  f("new").innerHTML = int(fresh.length);
  f("rate").innerHTML = (m.settlements ? unit(tiaN(m.paid_per_mib_utia, 2), "average paid") : "–") + side(q(".grid").clientWidth < WIDE ? "a dot is a day" : "a dot is a day, log scale");
  f("escrow").innerHTML = pct(escrowFlow().used);
  f("days").innerHTML = unit(int(D.active), `of ${int(D.total)}`) + side("with a settlement");
  LIT_PUB = null;
  steps("data", [...settled()].reverse(), (r) => r.size, true);
  steps("new", fresh, () => 1);
  drawRate();
  drawEscrow();
  drawDays();
}

area("top", draw);
on("resize", draw);
// Escrow's columns are measured from the text, so they wait for the real font.
on("boot", () => document.fonts?.ready.then(drawEscrow));
hoverTime("data", dataTip);
hoverTime("new", newTip, () => light(null));
hoverTime("rate", rateTip);
hoverTime("days", daysTip);
hoverEscrow();
} catch (e) { console.error("top failed:", e); }

/* ---------- cost ---------- */
try {
const { $, el, esc, sum, area, on, U, market, settled, fee, perMib, tia, tiaN, tiaRange, bytes, size, int, sharePct, tipHead, tipRow, showTip, hideTip } = M;

const sizeRange = (a, b) => { const [x, u] = size(a).split(" "), [y, v] = size(b).split(" "); return u === v ? `${x}–${y} ${u}` : `${x} ${u}–${y} ${v}`; };

const q = (s) => $("#cost " + s);
const wipe = (n) => { n.textContent = ""; return n; };
const label = (parent, x, y, s, anchor = "start", cls = "") => { const t = el("text", { x, y, "text-anchor": anchor, class: cls }, parent); t.textContent = s; return t; };

// One small dot per size settled, in the line's own teal; the rows under the plot say how much. The curve, grid and ticks never move between windows or networks.
const GUT = 84, TICK = 10, YT = [2, 1, .5, .25], DOT_R = 3, T = 16;
// BAR: the tallest share in either row, so the two rows' bars compare. LEVEL_CLEAR: a gridline this close to the level rests. UNDER: room the level's words need below it.
// STOP: the level ends where the curve comes this near, so on the flat of the curve it never reads as a second line.
const AXIS = 36, ROW = 46, BAR = 30, BAR_FEW = 22, BAR_TWO = 16, ROW_GAP = 6, CLEAR = 8, PAID_H = 14, LEVEL_CLEAR = 5, UNDER = 16, STOP = 4;
const G = {}, DOT = "var(--acc)";

/* One band per doubling, centred on its size tick, so a tick names the middle of its column and an exact 512 KiB sits inside one. */
function bands() {
  const u = U(), lo = u.params.price_formula.chunk_bytes, hi = u.params.max_blob_size_bytes, m = market(), n = Math.round(Math.log2(hi / lo)) + 1;
  const list = Array.from({ length: n }, (_, i) => ({ i, tick: lo * 2 ** i, rows: [] }));
  for (const s of settled()) list[Math.max(0, Math.min(n - 1, Math.round(Math.log2(s.size / lo))))].rows.push(s);
  for (const b of list) {
    const sizes = b.rows.map((s) => s.size);
    b.n = sizes.length;
    b.bytes = sum(sizes, (x) => x);
    b.nShare = m.settlements ? b.n / m.settlements : 0;
    b.dShare = m.bytes ? b.bytes / m.bytes : 0;
    b.at = Math.exp(sum(sizes, Math.log) / b.n);
    b.min = Math.min(...sizes);
    b.max = Math.max(...sizes);
  }
  return list;
}

const top = (a, z, y, h) => { const r = Math.min(3, h, (z - a) / 2); return `M${a} ${y}V${y - h + r}Q${a} ${y - h} ${a + r} ${y - h}H${z - r}Q${z} ${y - h} ${z} ${y - h + r}V${y}Z`; };

function draw() {
  const u = U(), f = u.params.price_formula, lo = f.chunk_bytes, hi = u.params.max_blob_size_bytes, m = market();
  q('[data-f="head"]').innerHTML = `${esc(tiaN(perMib(lo), 2))}<em class="at">TIA per MiB at ${esc(bytes(lo))}</em><em>to</em>${esc(tiaN(perMib(hi), 2))}<em class="at">at ${esc(bytes(hi))}</em>`;
  q(".key").textContent = `A blob pays a base fee plus a fee per started ${bytes(lo)}, up to ${bytes(hi)}, even if it times out.`;

  const svg = wipe(q(".plot")), W = svg.clientWidth, H = svg.clientHeight, list = bands(), n = list.length;

  const rows = H - 2 * ROW - ROW_GAP, base = rows - AXIS, run = W - GUT, oct = run / n;
  // The formula between chunks. It meets perMib at every whole chunk, and every settled size is one.
  const price = (s) => ((f.base_gas + (f.gas_per_chunk * s) / lo) * f.utia_per_gas) / (s / 2 ** 20);
  const sizeAt = (p) => Math.min(hi, Math.max(lo, (f.base_gas * f.utia_per_gas) / (p / 2 ** 20 - (f.gas_per_chunk * f.utia_per_gas) / lo)));
  const yHi = price(lo), yLo = price(hi) * .66, edge = (i) => Math.round(GUT + oct * i);
  const X = (s) => GUT + oct * (.5 + Math.log2(s / lo));
  const Y = (p) => T + ((base - T) * Math.log(yHi / p)) / Math.log(yHi / yLo);
  // Every size settled, each on the curve, biggest band last so a crowded end stays readable.
  const marks = list.flatMap((b) => [...new Map(b.rows.map((r) => [r.size, 0])).keys()].map((s) => ({ b, s, n: b.rows.filter((r) => r.size === s).length, x: X(s), y: Y(price(s)), r: DOT_R })));
  const distinct = marks.length, shown = distinct > 1;
  const avoid = shown && m.settlements ? Y(m.paid_per_mib_utia) : null, nearLevel = (y) => avoid != null && Math.abs(y - avoid) < LEVEL_CLEAR;

  // The grid stays under the curve: each line ends where the curve reaches its value.
  for (const t of YT) {
    const p = t * 1e6, y = Math.round(Y(p)) + .5;
    if (nearLevel(y)) continue;
    el("line", { class: "grid", x1: GUT, x2: X(sizeAt(p)), y1: y, y2: y }, svg);
    label(svg, GUT - TICK, y + 4, t === YT[0] ? `${t} TIA per MiB` : String(t), "end");
  }
  // A column's line stops at the level, so the level's words sit on an empty ground.
  const floorOf = (y) => (avoid != null && avoid > y ? Math.round(avoid) : base);
  for (const b of list) { const x = Math.round(X(b.tick)) + .5, y = Y(price(b.tick)); el("line", { class: "grid", x1: x, x2: x, y1: y, y2: floorOf(y) }, svg); }
  el("line", { class: "base", x1: GUT, x2: W, y1: base + .5, y2: base + .5 }, svg);
  let line = "";
  for (let i = 0; i <= 240; i++) { const s = lo * (hi / lo) ** (i / 240); line += `${i ? "L" : "M"}${X(s).toFixed(1)} ${Y(price(s)).toFixed(1)}`; }
  el("path", { class: "curve", d: line }, svg);

  G.hover = el("rect", { class: "band", y: 0, height: H, visibility: "hidden" }, svg);

  G.dots = new Map(list.map((b) => [b, []]));
  marks.forEach((k) => G.dots.get(k.b).push(el("circle", { class: "dot fade", cx: k.x, cy: k.y, r: k.r, fill: DOT }, svg)));

  const rOf = (x) => Math.max(0, ...marks.filter((k) => Math.abs(k.x - x) < k.r + 8).map((k) => k.r));
  const first = label(svg, X(lo) + rOf(X(lo)) + CLEAR, Y(yHi) - 4, tiaN(perMib(lo), 2), "start", "mid");
  label(svg, X(hi), Y(price(hi)) - rOf(X(hi)) - CLEAR, tiaN(perMib(hi), 2), "middle", "mid");

  // What each mark is, on the empty corner above the curve's tail.
  const key = el("g", {}, svg), kY = T + 4, kLine = label(key, 0, kY, "the line is the price, log scale", "start", "mid"), kDot = label(key, 0, kY + 16, "a dot is a size settled", "start", "mid");
  const kX = W - Math.max(kLine.getComputedTextLength(), kDot.getComputedTextLength());
  for (const t of [kLine, kDot]) t.setAttribute("x", kX);
  el("line", { class: "curve", x1: kX - 22, x2: kX - 8, y1: kY - 4, y2: kY - 4 }, key);
  el("circle", { class: "dot kd", cx: kX - 15, cy: kY + 12, r: DOT_R, fill: DOT }, key);

  // The window's rate is a level, not a point: a dashed line from the axis to the curve, so it cannot read as a settlement.
  G.paid = null;
  // One size settled means the dot already is the average: a second figure would only repeat it.
  if (m.settlements && shown) {
    const p = m.paid_per_mib_utia, y = Math.round(Y(p)) + .5, x = X(sizeAt(yHi * (yLo / yHi) ** ((y - STOP - T) / (base - T))));
    el("line", { class: "level", x1: GUT, x2: x, y1: y, y2: y }, svg);
    const say = label(svg, GUT + 6, base - y < UNDER ? y - 5 : y + 13, `Average paid ${tiaN(p, 2)}, weighted by data`, "start", "mid level-say");
    // A short level leaves no room left of the curve: the words go past the first price, where the curve has already fallen away.
    if (GUT + 6 + say.getComputedTextLength() + 6 > x) { say.setAttribute("x", +first.getAttribute("x") + first.getComputedTextLength() + 10); say.setAttribute("y", first.getAttribute("y")); }
    G.paid = { x0: GUT, x1: x, y, box: say.getBBox() };
  }

  // The axis belongs to the curve, so it sits under it; the bands then hang from the same columns.
  const ty = base + 15;
  label(svg, 0, ty, "Size", "start", "lab");
  label(svg, 0, ty + 15, "Fee per blob", "start", "lab");
  for (const b of list) {
    const s = b.tick, end = !b.i || b.i === n - 1, x = X(s);
    label(svg, x, ty, bytes(s), "middle");
    label(svg, x, ty + 15, end ? tia(fee(s), 2) : tiaN(fee(s), 2), "middle", "mid");
  }

  G.cells = new Map(list.map((b) => [b, []]));
  const most = Math.max(...list.flatMap((b) => [b.nShare, b.dShare]), 1e-9), used = list.filter((b) => b.n).length, tall = used <= 2 ? BAR_TWO : used <= 4 ? BAR_FEW : BAR;
  const row = (y, name, note, share, text) => {
    if (note) { label(svg, 0, y - 14, name, "start", "lab"); label(svg, 0, y, note, "start", "note"); } else label(svg, 0, y, name, "start", "lab");
    el("line", { class: "base", x1: GUT, x2: W, y1: y + .5, y2: y + .5 }, svg);
    for (const b of list) {
      const v = share(b);
      if (!v) continue;
      // The 2px gap sits between columns; the outer two meet the baseline's ends.
      const h = Math.max(2, Math.round((v / most) * tall)), a = edge(b.i) + (b.i ? 1 : 0), z = edge(b.i + 1) - (b.i < n - 1 ? 1 : 0), c = X(b.tick), g = el("g", { class: "cell fade" }, svg);
      el("path", { class: "col", d: top(a, z, y, h) }, g);
      label(g, c, y - h - 4, text(b, v), "middle", "pct");
      G.cells.get(b).push(g);
    }
  };
  row(rows + ROW, "Settlements", "nearest size", (b) => b.nShare, (b, v) => sharePct(v));
  row(H - 1, "Share of data", "", (b) => b.dShare, (b, v) => sharePct(v));

  G.cross = el("line", { class: "cross", visibility: "hidden" }, svg);
  G.cursor = el("circle", { class: "cursor", r: 4, visibility: "hidden" }, svg);
  Object.assign(G, { list, marks, oct, rows, base, X, Y, lo, hi, n, edge, end: H });
  const spoken = list.filter((b) => b.n).map((b) => `around ${bytes(b.tick)}: ${sharePct(b.nShare)} of settlements, ${sharePct(b.dShare)} of data`).join("; ");
  svg.setAttribute("aria-label", `TIA per MiB falls from ${tiaN(perMib(lo), 2)} to ${tiaN(perMib(hi), 2)} TIA as blobs grow. ${spoken}`);
}

function tipBand(b) {
  if (!b.n) return tipHead(`Around ${bytes(b.tick)}`) + tipRow("No settlements") + tipRow("Fee", tia(fee(b.tick), 2));
  const one = b.min === b.max;
  return tipHead(one ? size(b.min) : `Around ${bytes(b.tick)}`, DOT) + (one ? "" : tipRow("Sizes", sizeRange(b.min, b.max))) + tipRow("Settlements", int(b.n))
    + tipRow("Share of settlements", sharePct(b.nShare)) + tipRow("Share of data", sharePct(b.dShare)) + tipRow("Fee", tiaRange(fee(b.min), fee(b.max)));
}

// One settled size: its own count and fee, inside the band it lights.
function tipDot(k) {
  return tipHead(size(k.s), DOT) + tipRow("Settlements", int(k.n)) + tipRow("Share of settlements", sharePct(k.n / market().settlements)) + tipRow("Fee", tia(fee(k.s), 2)) + tipRow("TIA per MiB", tiaN(perMib(k.s), 2));
}

function rest() {
  const svg = q(".plot");
  svg.classList.remove("dim");
  svg.querySelectorAll(".lit").forEach((n) => n.classList.remove("lit"));
  for (const n of [G.hover, G.cross, G.cursor]) n.setAttribute("visibility", "hidden");
}

function light(b) {
  rest();
  q(".plot").classList.add("dim");
  for (const n of [...G.cells.get(b), ...G.dots.get(b)]) n.classList.add("lit");
  G.hover.setAttribute("x", G.edge(b.i));
  G.hover.setAttribute("width", G.edge(b.i + 1) - G.edge(b.i));
  G.hover.setAttribute("visibility", "visible");
}

function hook() {
  const svg = q(".plot");
  const curveTip = (s) => tipHead(`${size(s)} blob`) + tipRow("Fee", tia(fee(s), 2)) + tipRow("TIA per MiB", tiaN(perMib(s), 2)) + (s === G.hi ? tipRow("Largest blob allowed") : "");
  const paidTip = () => { const m = market(); return tipHead("Average paid") + tipRow("TIA per MiB", tiaN(m.paid_per_mib_utia, 2)) + tipRow("Fees paid", tia(m.fees_utia)) + tipRow("Data", size(m.bytes)); };
  const leave = () => { rest(); hideTip(); };
  const onPaid = (x, y) => { const p = G.paid, b = p?.box; return p && ((x > p.x0 && x < p.x1 && y > p.y - 5 && y < p.y + PAID_H + 2) || (x > b.x && x < b.x + b.width && y > b.y && y < b.y + b.height)); };

  svg.addEventListener("mousemove", (e) => {
    const r = svg.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    let best = null, gap = 9;
    for (const k of G.marks) { const d = Math.hypot(k.x - x, k.y - y) - k.r; if (d < gap) { gap = d; best = k; } }
    if (!best && onPaid(x, y)) { rest(); return showTip(paidTip(), e.clientX, e.clientY); }
    const low = y >= G.rows - 2;
    if (!best && (x < GUT - 4 || y > G.end + 2)) return leave();
    if (best || low) {
      const b = best ? best.b : G.list[Math.max(0, Math.min(G.n - 1, Math.floor((x - GUT) / G.oct)))];
      light(b);
      return showTip(best ? tipDot(best) : tipBand(b), e.clientX, e.clientY, low ? r.top + G.rows : undefined);
    }
    rest();
    const s = Math.min(G.hi, Math.max(G.lo, Math.round(2 ** ((x - GUT) / G.oct - .5)) * G.lo)), cx = G.X(s), cy = G.Y(perMib(s));
    for (const [k, v] of [["x1", cx], ["x2", cx], ["y1", cy], ["y2", G.base], ["visibility", "visible"]]) G.cross.setAttribute(k, v);
    for (const [k, v] of [["cx", cx], ["cy", cy], ["visibility", "visible"]]) G.cursor.setAttribute(k, v);
    showTip(curveTip(s), e.clientX, e.clientY, r.top + G.base);
  });
  svg.addEventListener("mouseleave", leave);

  // The arrow keys walk the bands and show what a hover shows.
  svg.addEventListener("keydown", (e) => {
    const d = { ArrowLeft: -1, ArrowRight: 1 }[e.key], last = G.list.length - 1;
    if (!d) return;
    e.preventDefault();
    G.at = Math.max(0, Math.min(last, (G.at ?? (d > 0 ? -1 : last + 1)) + d));
    const b = G.list[G.at], r = svg.getBoundingClientRect();
    light(b);
    showTip(tipBand(b), r.left + GUT + G.oct * (b.i + .5), r.top + 8);
  });
  svg.addEventListener("blur", () => { G.at = null; leave(); });
}

area("cost", draw);
on("resize", draw);
// The key and the average's words are placed by their measured width.
on("boot", () => document.fonts?.ready.then(draw));
hook();
} catch (e) { console.error("cost failed:", e); }

/* ---------- publishers ---------- */
try {
const { $, $$, esc, sum, area, on, seg, token, pubs, settled, market, span, U, tia, tiaN, bytes, size, stamp, day, dayOf, count, pct, sharePct, int, showTip, hideTip, tipHead, tipRow, activeDays, dayTicks, blobEver, blobsLeft, runway, TAIL } = M;

const TOP = 8, HOUR = 3600, MIB = 2 ** 20;
// Activity. Strokes stand on one lattice for every row: PITCH css px apart, GAP px between them, so a busy row stays a trace at any width and screen scale.
// FEW settlements in quiet time stand as their own strokes, APART lattice steps from each other.
const TICKS = 6, TICK_W = 58, INSET = 18, SLOT = 82, H = 40, MID = H / 2, RULE_WIDE = 300;
const PITCH = 2, GAP = 1, DOT_EVERY = 3, FLOOR = 8, CEIL = 36, APART = 3, FEW = 3, REACH = 6, OVER = .03;
// The height scale's possible tops; the first is the largest blob allowed.
const TOPS = [2 ** 27, 2 ** 29, 2 ** 31, 2 ** 33, 2 ** 35];
const WINDOW = { "7d": "last 7 days", "30d": "last 30 days", all: "since launch" };
const S = { metric: "bytes", sort: "bytes", dir: -1, open: false, slices: [], seg: null };
const COLS = [
  ["name", "Publisher", "w"], ["settlements", "Settlements", "a"], ["bytes", "Data · share", "d"],
  ["paid_per_mib_utia", "TIA per MiB", "n"], ["avg_blob_bytes", "Avg blob", "n"],
  ["days", "Active days", "n"], ["left", "Escrow left,<br>in blobs", "n"], ["since", "First<br>settlement", "n"],
];
let R = [], C = null, T = null;

const keyOf = (p) => (p.colour === TAIL ? "tail" : p.address);
const shareOf = (x) => (S.metric === "fees" ? x.fees_share : x.bytes_share);
const ofWhat = () => (S.metric === "fees" ? "of fees" : "of data");

/* ---------- share bar ---------- */
function slices() {
  const groups = new Map();
  for (const p of pubs()) {
    const k = keyOf(p);
    if (!groups.has(k)) groups.set(k, { key: k, colour: k === "tail" ? "var(--rest)" : p.colour, list: [], name: nameFor(p) });
    groups.get(k).list.push(p);
  }
  // Publishers first, then the tail.
  const order = (g) => (g.key === "tail" ? 1 : 0);
  return [...groups.values()].map((g) => ({
    ...g, bytes: sum(g.list, (p) => p.bytes), fees_utia: sum(g.list, (p) => p.fees_utia),
    bytes_share: sum(g.list, (p) => p.bytes_share), fees_share: sum(g.list, (p) => p.fees_share),
    name: g.key === "tail" ? count(g.list.length, "other") : g.name,
  })).sort((a, b) => order(a) - order(b));
}

function label(g, cls = "") {
  return `<span class="pb-lab ${cls}"><b>${sharePct(shareOf(g))}</b><em class="u"></em><i style="--c:${g.colour}"></i><em>${esc(g.name)}</em></span>`;
}

function drawBar() {
  const box = $("#publishers .pb-bar"), sl = slices();
  S.slices = sl;
  box.innerHTML = sl.map((g) => `<i data-k="${esc(g.key)}" style="--c:${g.colour};flex-grow:${shareOf(g)}"></i>`).join("");
  $("#publishers .pb-labels").innerHTML = sl.map((g) => label(g)).join("");
  box.setAttribute("aria-label", sl.map((g) => `${g.name} ${sharePct(shareOf(g))} ${ofWhat()}`).join(", "));
  placeLabels();
}

// The switch shares the labels' row, so they stop short of it.
const labelRoom = () => $("#publishers .pb-top").clientWidth - $("#publishers .pb-of").offsetWidth - 16;
// Labels read their slice's real place: gaps and minimum widths move a slice off its share.
function placeLabels() {
  const nodes = $$("#publishers .pb-bar i"), room = labelRoom(); let said = false;
  $$("#publishers .pb-labels .pb-lab:not(.flo)").forEach((e, i) => {
    const w = nodes[i].offsetWidth;
    $(".u", e).textContent = said ? "" : ofWhat();
    e.classList.remove("hid");
    e.style.left = nodes[i].offsetLeft + "px";
    const fits = e.offsetWidth + 14 <= w && nodes[i].offsetLeft + e.offsetWidth <= room;
    e.classList.toggle("hid", !fits);
    said ||= fits;
  });
}

// Lights one publisher or group on the bar; the label names what is lit, even a sliver.
function light(keys, g) {
  const box = $("#publishers .pb-bar"), labs = $("#publishers .pb-labels");
  $("#publishers .pb-lab.flo")?.remove();
  box.classList.toggle("lit", !!keys);
  labs.classList.toggle("lit", !!keys);
  $$("i", box).forEach((e) => e.classList.toggle("on", !!keys && keys.has(e.dataset.k)));
  if (!keys) return;
  labs.insertAdjacentHTML("beforeend", label(g, "flo"));
  const e = labs.lastElementChild, at = $$("i", box).find((n) => keys.has(n.dataset.k));
  $(".u", e).textContent = ofWhat();
  e.style.left = Math.max(0, Math.min(at ? at.offsetLeft : 0, labelRoom() - e.offsetWidth)) + "px";
}

function barTip(g) {
  const many = g.list.length > 1 ? tipRow("Accounts", int(g.list.length)) : "";
  return tipHead(g.name, g.colour) + many
    + tipRow("Data", `${size(g.bytes)} · ${sharePct(g.bytes_share)}`)
    + tipRow("Fees paid", `${tia(g.fees_utia)} · ${sharePct(g.fees_share)}`)
    + (g.key === "tail" ? "" : nameTotal(g.list[0]));
}

/* ---------- table ---------- */
function fold(list) {
  const b = sum(list, (p) => p.bytes), n = sum(list, (p) => p.settlements), f = sum(list, (p) => p.fees_utia);
  return {
    list, settlements: n, bytes: b, fees_utia: f,
    bytes_share: sum(list, (p) => p.bytes_share), fees_share: sum(list, (p) => p.fees_share),
    paid_per_mib_utia: f / (b / MIB), avg_blob_bytes: b / n, largest_blob_bytes: Math.max(...list.map((p) => p.largest_blob_bytes)),
    escrow_utia: sum(list, (p) => p.escrow_utia), escrow_available_utia: sum(list, (p) => p.escrow_available_utia),
    timeouts: sum(list, (p) => p.timeouts),
    last_settlement_at: list.map((p) => p.last_settlement_at).sort().at(-1), first_settlement_at: list.map((p) => p.first_settlement_at).sort()[0],
  };
}
const others = (rows) => ({ ...fold(rows.flatMap((p) => p.list || [p])), others: true, display: count(rows.length, "other"), colour: TAIL });

const SORT = { name: (p) => p.display.toLowerCase(), days: (p) => activeDays(p).active, left: (p) => blobsLeft(p) ?? -1, since: (p) => Date.parse(p.first_settlement_at) };
const sortVal = (p) => (SORT[S.sort] ? SORT[S.sort](p) : p[S.sort]);
const ordered = (list) => [...list].sort((a, b) => {
  const x = sortVal(a), y = sortVal(b);
  return (x < y ? -1 : x > y ? 1 : 0) * S.dir || b.bytes - a.bytes;
});

// The fold follows data rank whatever the sort: a sort reorders the same named rows, so the biggest publishers never vanish into the others.
function rows() {
  const all = pubs(), cut = all.length > TOP + 1 ? TOP : all.length, rest = all.slice(cut);
  return [...ordered(all.slice(0, cut)), ...(rest.length && S.open ? ordered(rest) : []), ...(rest.length ? [others(rest)] : [])];
}

function head() {
  $("#publishers .pb-t").dataset.sort = S.sort;
  $("#publishers thead tr").innerHTML = COLS.map(([k, t, cls]) => {
    const sort = S.sort === k ? ` aria-sort="${S.dir < 0 ? "descending" : "ascending"}"` : "";
    const b = `<button type="button" data-k="${k}">${t}</button>`;
    return `<th class="${cls}"${sort} scope="col">${cls === "a" ? `<div class="pb-h"><span>Activity</span><div class="pb-ticks"></div>${b}</div>` : b}</th>`;
  }).join("");
}

// Accounts that share a name say which of them this is.
const named = (p) => (p.name ? U().publishers.all.filter((a) => a.name === p.name) : []);
const nth = (p) => { const same = named(p); return same.length > 1 ? `${same.findIndex((a) => a.address === p.address) + 1} of ${same.length} accounts` : ""; };
const nameFor = (p) => (nth(p) ? `${p.display}, ${nth(p)}` : p.display);
// A shared name is one row each, so the tooltip gives the sum of those active in this window.
function nameTotal(p) {
  const same = p.name ? pubs().filter((a) => a.name === p.name) : [];
  return same.length > 1 ? tipRow(`All ${same.length} active as ${p.name}`, `${size(sum(same, (a) => a.bytes))} · ${sharePct(sum(same, (a) => a.bytes_share))}`) : "";
}
const sinceDay = (p) => { const d = dayOf(Date.parse(p.first_settlement_at) / 1e3); return day(d, d.slice(0, 4) !== U().read_at.slice(0, 4)); };
function rowHtml(p, i) {
  const left = blobsLeft(p), [num, unit] = size(p.bytes).split(" "), [avg, avgUnit] = size(p.avg_blob_bytes).split(" ");
  const name = p.others
    ? `<button type="button" class="pb-more" aria-expanded="${S.open}"><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg><span>${esc(p.display)}</span></button>`
    : `<div class="pb-who"><em>${p.rank ?? ""}</em><b><span>${esc(p.display)}</span></b>${nth(p) ? `<small>${nth(p)}</small>` : p.name ? `<code>${esc(p.short)}</code>` : ""}</div>`;
  return `<tr data-i="${i}" class="${p.others ? "o" : ""}">
    <td class="w">${name}</td>
    <td class="a"><canvas role="img" aria-label="${esc(count(p.settlements, "settlement"))}"></canvas><span class="pb-n">${int(p.settlements)}</span></td>
    <td class="d"><div class="pb-d"><b>${num}</b><u>${unit}</u><em>${sharePct(p.bytes_share)}</em></div></td>
    <td data-c="mib">${tiaN(p.paid_per_mib_utia, 2)}</td>
    <td data-c="avg"><div class="pb-d"><b>${avg}</b><u>${avgUnit}</u></div></td>
    <td data-c="days">${p.others ? "–" : int(activeDays(p).active)}</td>
    <td data-c="left"${left === 0 && !p.others ? ' class="z"' : ""}>${p.others || left == null ? "–" : int(left)}</td>
    <td data-c="since">${p.others ? "–" : sinceDay(p)}</td>
  </tr>`;
}

function drawTable() {
  const body = $("#publishers tbody");
  R = rows();
  body.innerHTML = R.length ? R.map((p, i) => rowHtml(p, i)).join("") : `<tr><td class="pb-none" colspan="${COLS.length}">No settlements in this window</td></tr>`;
  const by = new Map(pubs().map((p) => [p.address, []]));
  settled().forEach((s) => by.get(s.pub.address).push(s));
  R.forEach((p) => { p.dots = p.list ? p.list.flatMap((q) => by.get(q.address)) : by.get(p.address); });
  scale(by);
  paint();
}

/* ---------- activity: a seismogram. Time on one axis, one lattice of strokes for all rows, height the data settled in an hour ---------- */
function axis(W) {
  const [t0, t1] = span(), dp = devicePixelRatio || 1, pitch = Math.max(2, Math.round(PITCH * dp)), start = Math.round(INSET * dp), w = W - INSET - SLOT, last = Math.floor((w * dp) / pitch) - 1;
  return { dp, W, w, t0, t1, pitch, start, last, stroke: pitch - Math.max(1, Math.round(GAP * dp)), x(t) { return INSET + ((t - t0) / (t1 - t0)) * this.w; }, time(px) { return t0 + ((px - INSET) / this.w) * (t1 - t0); },
    cell(t) { return Math.max(0, Math.min(last, Math.floor((this.x(t) * dp - start) / pitch))); }, px(c) { return start + c * pitch; } };
}

// One top per window, from the accounts' own hours, so neither the sort nor the screen moves it. The odd spike clips, the key says so, and its tooltip tells the true size.
function scale(by) {
  const seen = [];
  for (const list of by.values()) {
    const hours = new Map();
    for (const s of list) { const i = Math.floor(s.t / HOUR); hours.set(i, (hours.get(i) || 0) + s.size); }
    seen.push(...hours.values());
  }
  const fits = (top) => seen.filter((v) => v > top).length <= OVER * seen.length, top = TOPS.find(fits) ?? TOPS.at(-1), lo = U().params.price_formula.chunk_bytes;
  T = { lo, top, clipped: seen.some((v) => v > top) };
}
// Square root: a steady publisher sits low and its swings show, and 256 KiB stays visible beside 128 MiB.
const tall = (b) => FLOOR + (CEIL - FLOOR) * Math.sqrt(Math.min(b, T.top) / T.top);
const evenPx = (h) => 2 * Math.round((h * C.dp) / 2);

// A few settlements close together, each on its own step, centred on where they truly fell.
function fan(list) {
  const want = list.map((s) => C.cell(s.t)), cs = [...want];
  for (let i = 1; i < cs.length; i++) cs[i] = Math.max(cs[i], cs[i - 1] + APART);
  const back = Math.round(sum(want, (x) => x) / want.length - sum(cs, (x) => x) / cs.length);
  return list.map((s, i) => [s, Math.max(0, Math.min(C.last, cs[i] + back))]);
}

// Every settlement lands in one stroke. Runs of a few stand apart; in a busy run a stroke holds the hours under it, and the busiest gives its height.
function lay(p) {
  const hours = new Map(), runs = [], slots = new Map();
  for (const s of [...p.dots].sort((a, b) => a.t - b.t)) { const i = Math.floor(s.t / HOUR); (hours.get(i) || hours.set(i, []).get(i)).push(s); }
  for (const i of [...hours.keys()].sort((a, b) => a - b)) { const r = runs.at(-1); if (r && i - r.at(-1) === 1) r.push(i); else runs.push([i]); }
  const put = (c, list, peak) => { const m = slots.get(c) || slots.set(c, { c, list: [], peak: 0 }).get(c); m.list.push(...list); m.peak = Math.max(m.peak, peak); };
  for (const r of runs) {
    const list = r.flatMap((i) => hours.get(i)).sort((a, b) => a.t - b.t);
    if (list.length <= FEW) for (const [s, c] of fan(list)) put(c, [s], s.size);
    else for (const i of r) put(C.cell(hours.get(i)[0].t), hours.get(i), sum(hours.get(i), (x) => x.size));
  }
  // A stroke with no neighbour has the whole step: on a quiet row it is all there is to see.
  p.marks = [...slots.values()].sort((a, b) => a.c - b.c).map((m) => { const w = slots.has(m.c - 1) || slots.has(m.c + 1) ? C.stroke : C.pitch; return { ...m, px: C.px(m.c), w, h: evenPx(tall(m.peak)), x: C.px(m.c) / C.dp, cw: w / C.dp }; });
}

// The dated days: on the page's one step, starting on the first day when a step allows it.
function tickDays() {
  const { days } = activeDays(), wide = (l) => l.length < 2 || ((l.at(-1).t - l[0].t) * (C.w / (C.t1 - C.t0))) / (l.length - 1) >= TICK_W, tries = Array.from({ length: TICKS - 1 }, (_, i) => dayTicks(TICKS - i)).filter(wide);
  return tries.find((l) => l[0].day === days[0].day) ?? tries[0] ?? [days.at(-1)];
}
// A rule stands at the day's first moment, so a mark right of it belongs to that day. Launch day starts at launch.
const dayX = (d) => C.x(Math.max(C.t0, Date.parse(d.day) / 1e3));

function track(g, W, dated) {
  const { dp } = C, px = (v) => Math.round(v * dp), mid = px(MID), w = Math.max(1, px(1)), h = evenPx(1);
  g.canvas.width = px(W); g.canvas.height = px(H);
  g.canvas.style.width = g.canvas.width / dp + "px";
  // Empty time is drawn: a dotted centre line from launch, a faint line where each dated day starts.
  g.fillStyle = token("--rule1");
  for (const x of dated) g.fillRect(x, 0, w, g.canvas.height);
  g.fillStyle = token("--rule4");
  for (let c = 0; c <= C.last; c += DOT_EVERY) g.fillRect(C.px(c), mid - h / 2, w, h);
  return mid;
}

function paint() {
  const W = $("#publishers th.a").clientWidth;
  C = axis(W);
  R.forEach(lay);
  const list = tickDays(), dated = list.map((d) => Math.round(dayX(d) * C.dp));
  $$("#publishers tbody td.a canvas").forEach((cv) => {
    const p = R[+cv.closest("tr").dataset.i], g = cv.getContext("2d"), mid = track(g, W, dated);
    g.fillStyle = token(p.colour);
    for (const m of p.marks) g.fillRect(m.px, mid - m.h / 2, m.w, m.h);
  });
  $("#publishers .pb-x").style.height = $("#publishers tbody").getBoundingClientRect().height - 8 + "px";
  ruler(W);
  ticks(list);
}

// A key, not a row: the same strokes at true height, in a neutral ink, free of the time axis.
function ruler(W) {
  const box = $("#publishers .pb-rule"), wide = W >= RULE_WIDE, stops = [T.lo, ...(wide ? [T.top / 16] : []), T.top / 4, T.top];
  box.innerHTML = stops.map((b, i) => `<span><i style="height:${evenPx(tall(b)) / C.dp}px"></i>${esc(bytes(b))}${i === stops.length - 1 && T.clipped ? " or more" : ""}</span>`).join("");
}

// A date starts where its day does, so it never sits off its rule; the last one ends with the plot when it would run past it, and stays out only if that touches the date before.
function ticks(list) {
  const box = $("#publishers .pb-ticks");
  box.innerHTML = list.map((d) => `<span>${esc(day(d.day))}</span>`).join("");
  $$("span", box).forEach((e, k) => {
    const x = dayX(list[k]) - INSET, at = Math.min(x, C.w - e.offsetWidth), prev = k && dayX(list[k - 1]) - INSET + e.offsetWidth;
    e.style.left = at + "px"; e.hidden = at < x && k > 0 && at < prev + 8;
  });
}

/* ---------- hover ---------- */
// A row lights its own slice, the folded row all of its accounts'.
const rowKeys = (p) => new Set((p.others ? p.list : [p]).map(keyOf));
const inSlice = (p, k) => (p.others ? p.list.some((q) => keyOf(q) === k) : keyOf(p) === k);

function cellTip(p, c) {
  const h = tipHead(p.display, p.colour), D = activeDays(p), days = runway(p);
  if (c === "w") return h + (p.list ? tipRow("Accounts", int(p.list.length)) : "") + tipRow("Settlements", int(p.settlements)) + (p.list ? "" : tipRow("Namespaces", int(p.namespaces_total))) + tipRow("Fees paid", tia(p.fees_utia)) + (p.timeouts ? tipRow("Timeouts", int(p.timeouts)) : "") + (nth(p) ? tipRow(p.short) + tipRow(`One of ${named(p).length} accounts named ${p.name}`) + nameTotal(p) : "");
  if (c === "d") return h + tipRow("Share of data", sharePct(p.bytes_share)) + tipRow("Fees paid", `${tia(p.fees_utia)} · ${sharePct(p.fees_share)}`) + tipRow("Largest blob", size(p.largest_blob_bytes));
  if (c === "mib") return h + tipRow("Fees paid", tia(p.fees_utia)) + tipRow("Data", size(p.bytes));
  if (c === "avg") return h + tipRow("Largest blob", size(p.largest_blob_bytes)) + tipRow("Settlements", int(p.settlements));
  if (p.others && (c === "days" || c === "left" || c === "since")) return "";
  if (c === "days") return h + tipRow("Active", `${int(D.active)} of ${count(D.total, "day")}`);
  // A pace needs a few active days behind it, and a balance that can pay for a blob at all.
  if (c === "left") return h + tipRow("Balance", tia(p.escrow_available_utia)) + tipRow("Average blob since launch", size(blobEver(p) ?? 0))
    + (blobsLeft(p) === 0 ? tipRow("Not enough for one blob") : days == null || D.active < 3 ? "" : tipRow(days < 1 ? "Under a day at this pace" : `About ${count(Math.floor(days), "day")} at this pace`));
  if (c === "since") return h + tipRow("First settlement", stamp(p.first_settlement_at));
  return "";
}

// The nearest stroke within reach; the pointer never has to land on a 2 px line. x is the pixel under it, so its centre counts.
const markAt = (p, x) => { const gap = (m) => Math.abs(m.x + m.cw / 2 - (x + .5)); return p.marks.reduce((best, m) => (gap(m) <= REACH && (!best || gap(m) < gap(best)) ? m : best), null); };

function dotTip(s) {
  return tipHead(s.pub.display, s.pub.colour) + tipRow("Time", stamp(s.t * 1e3)) + tipRow("Size", size(s.size)) + tipRow("Fee", tia(s.fee))
    + tipRow("Endorsed", `${pct(s.share)} of voting power`) + (s.ns ? tipRow("Namespace", s.ns) : "");
}

// A stroke with several settlements is never shown as one: a few are listed, more are a range.
function pileTip(p, hits, peak) {
  const on = [...hits].sort((a, b) => a.t - b.t), hours = new Set(on.map((s) => Math.floor(s.t / HOUR))).size, f = tipRow("Fees paid", tia(sum(on, (s) => s.fee))) + (hours > 1 ? tipRow("Busiest hour", size(peak)) : "");
  const h = tipHead(`${count(on.length, "settlement")} · ${size(sum(on, (s) => s.size))}`, p.colour);
  if (on.length <= 4) return h + on.map((s) => tipRow(stamp(s.t * 1e3), size(s.size))).join("") + f;
  return h + tipRow("From", stamp(on[0].t * 1e3)) + tipRow("To", stamp(on.at(-1).t * 1e3)) + f;
}

function hoverActivity(e, p, cell) {
  const wrap = $("#publishers .pb-wrap"), b = cell.getBoundingClientRect(), o = wrap.getBoundingClientRect();
  const x = Math.max(INSET, e.clientX - b.left), m = markAt(p, x), line = $("#publishers .pb-x"), ring = $("#publishers .pb-ring");
  if (x > INSET + C.w + REACH) {
    line.style.display = ring.style.display = "none";
    showTip(tipHead(p.display, p.colour) + tipRow("Last settlement", stamp(p.last_settlement_at)), e.clientX, e.clientY);
    return;
  }
  line.style.display = "block"; line.style.transform = `translateX(${Math.round(b.left - o.left + (m ? m.x + m.cw / 2 : x))}px)`;
  ring.style.display = "none";
  if (m) {
    const w = m.cw + 6, h = m.h / C.dp + 6;
    ring.style.cssText = `display:block;width:${w}px;height:${h}px;transform:translate(${Math.round(b.left - o.left + m.x + m.cw / 2 - w / 2)}px,${b.top - o.top - wrap.clientTop + MID - h / 2}px)`;
    showTip(m.list.length > 1 ? pileTip(p, m.list, m.peak) : dotTip(m.list[0]), e.clientX, e.clientY);
    return;
  }
  const d = dayOf(C.time(x)), on = p.dots.filter((q) => dayOf(q.t) === d);
  showTip(tipHead(day(d), p.colour) + (on.length ? tipRow("Settlements", int(on.length)) + tipRow("Data", size(sum(on, (q) => q.size))) : tipRow("No settlements")), e.clientX, e.clientY);
}

function clearHover() {
  $("#publishers .pb-x").style.display = "none";
  $("#publishers .pb-ring").style.display = "none";
  hideTip();
}

function wire() {
  S.seg = seg("#publishers .pb-of .seg", [["bytes", "Data"], ["fees", "Fees"]], () => S.metric, (v) => { S.metric = v; drawBar(); });

  const bar = $("#publishers .pb-bar"), body = $("#publishers tbody");
  let slice = null, row = null;
  bar.addEventListener("mousemove", (e) => {
    const i = e.target.closest("i"); if (!i) return;
    const g = S.slices.find((s) => s.key === i.dataset.k);
    if (slice !== g) {
      slice = g; light(new Set([g.key]), g);
      $$("tr[data-i]", body).forEach((tr) => tr.classList.toggle("on", inSlice(R[+tr.dataset.i], g.key)));
      body.classList.add("lit");
    }
    showTip(barTip(g), e.clientX, e.clientY);
  });
  bar.addEventListener("mouseleave", () => {
    slice = null; light(null); hideTip(); body.classList.remove("lit");
    $$("tr.on", body).forEach((tr) => tr.classList.remove("on"));
  });

  $("#publishers thead").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    const k = b.dataset.k;
    if (k === S.sort) S.dir = -S.dir; else { S.sort = k; S.dir = k === "name" ? 1 : -1; }
    head(); drawTable();
  });

  body.addEventListener("mousemove", (e) => {
    const tr = e.target.closest("tr[data-i]"), td = e.target.closest("td");
    if (!tr || !td) return;
    const p = R[+tr.dataset.i];
    if (row !== p) { row = p; light(rowKeys(p), { key: p.others ? "" : keyOf(p), name: p.display, colour: p.colour, bytes_share: p.bytes_share, fees_share: p.fees_share }); }
    if (td.classList.contains("a")) { hoverActivity(e, p, td); return; }
    $("#publishers .pb-x").style.display = "none";
    $("#publishers .pb-ring").style.display = "none";
    const html = cellTip(p, td.dataset.c || td.classList[0]);
    if (html) showTip(html, e.clientX, e.clientY); else hideTip();
  });
  body.addEventListener("mouseleave", () => { row = null; light(null); clearHover(); });
  body.addEventListener("click", (e) => {
    if (!e.target.closest("tr.o")) return;
    S.open = !S.open; row = null; light(null); clearHover(); drawTable();
  });

  on("resize", () => { drawBar(); paint(); });
  // Which labels fit depends on the real font.
  document.fonts?.ready.then(placeLabels);
}

area("publishers", (why) => {
  if (why === "boot") wire();
  if (why === "net") { Object.assign(S, { metric: "bytes", sort: "bytes", dir: -1, open: false }); S.seg.sync(); }
  const m = market();
  $("#publishers .sec-h p").textContent = `${int(pubs().length)} active of ${count(m.escrow_accounts, "account")}, ${WINDOW[M.state.win]}`;
  head();
  drawBar();
  drawTable();
  $("#publishers .pb-notes").innerHTML = `<p>A stroke is an hour of settlements; a dotted line is none. A few close together stand apart, so each one shows.</p><p>A publisher is one account, and accounts can share a name. Escrow left is what the balance pays for at the account's average blob since launch.</p>`;
});
} catch (e) { console.error("publishers failed:", e); }

/* ---------- hosting ---------- */
try {
const { $, $$, el, esc, sum, calm, token, pct, readyPct, sharePct, int, count, day, N, U, TAIL, RANKS, inkOn, agg, regions, regionOf, seg, showTip, tipAt, hideTip, tipHead, tipRow, area, on, state, lit, pin, MAX_PINS } = M;

const root = $("#hosting"), box = $(".tb", root), list = $(".tb-list", root), vs = $(".tb-vs", root), clear = $(".clear", root), line = $(".sec-h p", root), notes = $(".notes", root);
// SORTED_TOP: rows before the others. LOW_MAX: hosts the sentence names. SHARDS_NAMED: groups the sentence names for shards not served. SUB_NAMES: validators a row names when they fit. TIP_NAMES: validators a tooltip lists.
const SORTED_TOP = 8, LOW_MAX = 6, SHARDS_NAMED = 2, SUB_NAMES = 3, TIP_NAMES = 10, SHORT_WINDOW = .6, PIPS_MAX = 7, TAU = Math.PI * 2, DEG = Math.PI / 180;
// Our pass mark for checks answered. It is a choice, not a protocol rule, and the card says so.
const MARK = .99;
// Under this share ready, with hosts that do not report, a row has no reading worth printing.
const READY_MIN = .001;
// hot is what the pointer lights: { key, vs, name, share, hosts, colour, from }.
const S = { by: "provider", weigh: "vp", sort: "vp", dir: -1, open: false, picks: [], hot: null, city: null, region: null, sig: "", kbd: false, width: 0 };
const SHORT = { "Hong Kong SAR China": "Hong Kong", "United Arab Emirates": "UAE", "Melbicom Eu": "Melbicom", "Ultahost Ap": "Ultahost", "Int 5gn As Ap": "5GN" };

/* ---------- model ---------- */
const prov = () => S.by === "provider";
const keyFn = { provider: (v) => v.company, country: (v) => v.cc, city: (v) => v.city + "|" + v.cc };
const keyOf = (g) => (prov() ? g.name : S.by === "country" ? g.cc : g.name + "|" + g.cc);
const srcOf = () => (prov() ? N().providers : S.by === "country" ? N().countries : N().cities);
const noun = () => (prov() ? "providers" : S.by === "country" ? "countries" : "cities");
const noun1 = () => (prov() ? "provider" : S.by === "country" ? "country" : "city");
// Rank carries identity: the ring's order is the ramp's, in every grouping and weighing. Picks in a head to head take steps far apart.
const PICK = ["var(--p1)", "var(--p3)", "var(--p5)"];
const pickTone = (k) => { const p = picks(); return p.length > 1 && p.includes(k) ? PICK[p.indexOf(k)] : null; };
const tint = (g) => pickTone(g.key) || V.step.get(g.key) || TAIL;
const rowTone = (g) => (picks().length > 1 && !picks().includes(g.key) ? TAIL : tint(g));
const geoOf = (g) => (prov() ? g.countries : g.companies);
const short = (name) => SHORT[name] || name;
const nameOf = (g) => short(g.name);
const weight = (g) => (S.weigh === "vp" ? g.vp : g.hosts);
// Shares are rounded, so a small holder can read 0. It still counts: sharePct prints it as <0.01%.
const shareOf = (g) => g.share || (g.vp > 0 ? 1e-9 : 0);
const finePct = (x) => (x < 1e-4 ? "<0.01%" : pct(x, 2));
const servedScope = () => (M.young(state.net) ? "Since launch" : "Last 30 days");
const under = (g) => g.reachability != null && g.reachability < MARK;
// A host's own rate; one host under the mark can sit inside a healthy group.
const rateOf = (v) => (v.reach?.den ? v.reach.num / v.reach.den : null);
const lowHost = (v) => rateOf(v) != null && rateOf(v) < MARK;
// Shards count once served or not served; the rest are still pending.
const settled = (g) => g.served + g.not_served;
const srate = (g) => (settled(g) ? g.served / settled(g) : null);
const srateText = (g) => { const r = srate(g); return r == null ? "–" : r === 1 ? "100%" : r >= .99995 ? ">99.99%" : pct(r, 2); };
// What reports ready is a floor while any host stays silent.
const silent = (g) => g.not_reported_hosts > 0;
const readyKnown = (g) => !silent(g) || g.ready_share >= READY_MIN;

// A null never leads a column, in either direction.
const SORT = {
  vp: (g) => g.vp, hosts: (g) => g.hosts, geo: (g) => geoOf(g).length, reach: (g) => g.reachability, miss: (g) => g.failed_checks,
  ready: (g) => g.ready_hosts, unrep: (g) => g.not_reported_hosts, vpready: (g) => (readyKnown(g) ? g.ready_share : null), served: (g) => g.not_served,
};
// These open on the worst figure, where the reader is looking for trouble.
const WORST_LOW = new Set(["reach", "ready", "vpready"]);
const ordered = (rows) => [...rows].sort((a, b) => { const x = SORT[S.sort](a), y = SORT[S.sort](b); return (x == null) - (y == null) || S.dir * (x - y) || b.vp - a.vp; });
const midOf = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];

let V = null;
function members(g) {
  if (V.mem.has(g.key)) return V.mem.get(g.key);
  const k = keyFn[S.by], match = g.key === "__all" ? () => true : g.key === "__rest" ? (v) => V.tailKeys.has(k(v)) : (v) => k(v) === g.key;
  const out = N().validators.filter((v) => v.has_host && match(v));
  V.mem.set(g.key, out);
  return out;
}
// A group with far fewer checks per host joined the window late, so its reachability is not like for like.
function windowOf(g) {
  if (g.checks / g.hosts >= SHORT_WINDOW * V.midChecks) return null;
  const hosts = members(g), late = hosts.filter((v) => (v.reach?.den ?? 0) < SHORT_WINDOW * V.midChecks);
  const first = late.map((v) => v.endpoint_since).sort()[0];
  return first ? { on: day(first.slice(0, 10)), n: late.length, of: hosts.length } : null;
}

function model() {
  const n = N(), key = keyFn[S.by], hosted = n.validators.filter((v) => v.has_host), mem = new Map();
  hosted.forEach((v) => { const k = key(v); (mem.get(k) || mem.set(k, []).get(k)).push(v); });
  const src = srcOf().map((g) => { const k = keyOf(g), vs = mem.get(k) || []; return { ...g, key: k, rep: sum(vs.filter((v) => v.readiness !== "not_reported"), (v) => v.vp), lows: vs.filter(lowHost).sort((a, b) => rateOf(a) - rateOf(b)) }; });
  // The weighing ranks the ring's groups. The table is one list, largest first in whatever column it is sorted by.
  const ranked = [...src].sort((a, b) => weight(b) - weight(a) || b.vp - a.vp), named = ranked.slice(0, RANKS), unnamed = ranked.slice(RANKS);
  const resting = S.sort === S.weigh && S.dir < 0, top = ordered(src).slice(0, SORTED_TOP), shown = new Set(top.map((g) => g.key));
  const served = [...src].filter((g) => g.not_served).sort((a, b) => b.not_served - a.not_served).slice(0, SHARDS_NAMED);
  const tail = src.filter((g) => !shown.has(g.key));
  const all = { ...agg(src, "__all", `All ${src.length} ${noun()}`), sum: true, lows: [], rep: sum(src, (g) => g.rep) };
  const rest = { ...agg(tail, "__rest", `${tail.length} ${tail.length === 1 ? "other" : "others"}`), sum: true, lows: [], rep: sum(tail, (g) => g.rep) };
  // The scale is the weighing's, so a bar keeps its length through every sort. The others are a figure, or their bar would halve every other.
  const scale = weight(ranked[0]);
  V = { src, ranked, named, unnamed, top, served, tail, all, rest, scale, resting, tailKeys: new Set(tail.map((g) => g.key)), step: new Map(named.map((g, i) => [g.key, `var(--p${i + 1})`])), rank: new Map(named.map((g, i) => [g.key, i + 1])), mem, byKey: new Map(), slices: new Map(),
    midChecks: midOf(hosted.map((v) => v.reach?.den ?? 0)) };
  [...src, all, rest].forEach((g) => V.byKey.set(g.key, g));
  src.forEach((g) => { g.win = windowOf(g); });
}

/* ---------- what is lit: the pointer wins, picks hold ---------- */
const picks = () => (prov() ? state.pinned.filter((k) => V.byKey.has(k)) : S.picks);
const groupFocus = (g, from) => ({ key: g.key, vs: members(g), name: g.key === "__rest" ? g.name : nameOf(g), share: shareOf(g), hosts: g.hosts, colour: tint(g), from });
function held() {
  const gs = picks().map((k) => V.byKey.get(k)).filter(Boolean);
  if (!gs.length) return null;
  return gs.length === 1 ? groupFocus(gs[0], "pick") : { vs: gs.flatMap(members), name: `${gs.length} picked`, share: sum(gs, shareOf), hosts: sum(gs, (g) => g.hosts), from: "pick" };
}
function paint() {
  const f = S.hot || held(), only = f && new Set(f.vs);
  paintRing(only); paintCentre(f); paintRows();
  if (!f || f.from !== "map") paintMap(f);
}
function setHot(f) {
  S.hot = f;
  lit(f && prov() && f.key && !f.key.startsWith("__") ? f.key : null);
  paint();
}
const paintLine = () => { const t = N().totals; line.textContent = `${t.hosts} of ${t.validators_bonded} validators run a Fibre host, ${sharePct(t.host_vp_share)} of voting power.`; };

/* ---------- the card answers in words: who, where, how well ---------- */
const sayWho = $(".say-who", root), sayWhere = $(".say-where", root), sayHow = $(".say-how", root);
// Fewest groups, biggest first, that reach a third of all Fibre hosts.
function toThird(rows, w, total) {
  let c = 0, n = 0;
  for (const g of [...rows].sort((a, b) => w(b) - w(a))) { if (c >= total / 3) break; c += w(g); n++; }
  return n;
}
// Fewest groups, biggest first, whose loss leaves hosted voting power under the two thirds a settlement needs.
function toStop(rows, total) {
  let left = sum(rows, (g) => g.vp), n = 0;
  for (const g of [...rows].sort((a, b) => b.vp - a.vp)) { if (left < total * 2 / 3) break; left -= g.vp; n++; }
  return { n, left: left / total };
}
const third = (n, one, many, what) => `${int(n)} ${n === 1 ? `${one} reaches` : `${many} reach`} a third of ${what}`;
const and = (a) => (a.length < 2 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a.at(-1)}`);
// Where a group's weight sits, when one city or provider holds most of it.
function mostly(g) {
  const by = new Map(), k = prov() ? (v) => v.city : (v) => short(v.company), vs = members(g), word = prov() ? "in" : "on";
  vs.forEach((v) => by.set(k(v), (by.get(k(v)) || 0) + v.share));
  const [name, part] = [...by].sort((a, b) => b[1] - a[1])[0];
  return by.size === 1 ? `, all ${word} ${esc(name)}` : part >= sum(vs, (v) => v.share) / 2 ? `, mostly ${word} ${esc(name)}` : "";
}
function say() {
  const n = N(), t = n.totals, hosts = S.weigh === "hosts", lead = V.ranked.filter((g) => weight(g) === weight(V.ranked[0])), names = and(lead.map((g) => `<b>${esc(nameOf(g))}</b>`));
  const stop = toStop(V.src, t.voting_power), many = stop.n === 1 ? noun1() : `${stop.n}<span class="sp"> ${noun()}</span>`;
  const why = hosts ? `${third(toThird(V.src, weight, t.hosts), noun1(), noun(), "Fibre hosts")}.` : stop.n ? `Without the top ${many}, ${sharePct(stop.left)} is left, under the two thirds a blob needs.` : "";
  const who = (where) => (hosts ? `${names} ${lead.length > 1 ? "have" : "has"} the most Fibre hosts, <b>${lead[0].hosts}</b> of ${t.hosts}${lead.length > 1 ? " each" : ""}.` : `${names} ${lead.length > 1 ? "host" : "hosts"} the most voting power, <b>${sharePct(shareOf(lead[0]))}</b>${lead.length > 1 ? " each" : where}.`);
  sayWho.innerHTML = `<span class="lead">${who(mostly(lead[0]))}</span><small>${why}</small>`;
  // One line: the place goes first, the row under the name still says it.
  const whoLine = $(".lead", sayWho);
  if (whoLine.scrollWidth > whoLine.clientWidth) whoLine.innerHTML = who("");
  const reg = regions().sort((a, b) => (hosts ? b.hosts - a.hosts : b.share - a.share))[0];
  sayWhere.innerHTML = (hosts ? `<b>${esc(reg.name)}</b> has the most Fibre hosts, <b>${reg.hosts}</b> of ${t.hosts}.` : reg.share >= .5 ? `Most voting power runs in <b>${esc(reg.name)}</b>, <b>${sharePct(reg.share)}</b>.` : `<b>${esc(reg.name)}</b> hosts the most voting power, <b>${sharePct(reg.share)}</b>.`)
    + `<small>${int(t.cities)} cities · ${int(t.countries)} countries</small>`;

  // Hosts, in every view: a sentence that quotes a host names the host, so it can never read as a row's own figure.
  const checked = n.validators.filter((v) => v.has_host && rateOf(v) != null), lows = checked.filter(lowHost).sort((a, b) => rateOf(a) - rateOf(b));
  const hostOf = (v) => `<b>${esc(v.moniker)}</b> on ${esc(short(v.company))} in ${esc(v.city)} ${pct(rateOf(v), 2)}`;
  const line1 = (k) => `<b>${checked.length - lows.length} of ${checked.length}</b> hosts answered at least 99% of checks.${!lows.length ? "" : k ? ` Under 99%: ${lows.slice(0, k).map(hostOf).join(", ")}${lows.length > k ? ` and ${lows.length - k} more` : ""}.` : ` ${lows.length} did not.`}`;
  const w = U().market[M.young(state.net) ? "all" : "30d"], asked = sum(n.providers, settled), missed = sum(n.providers, (g) => g.not_served);
  const blobs = `${servedScope()}: ${w.settlements ? `${count(w.settlements, "settlement")}, ${w.timeouts ? `${int(w.timeouts)} timed out` : "none timed out"}` : "no settlements"}.`;
  const shards = missed ? `${int(missed)} of ${int(asked)} shards were not served, the most ${prov() ? "at" : "in"} ${and(V.served.map((g) => `${esc(nameOf(g))} ${int(g.not_served)}`))}.` : `All ${int(asked)} shards asked for were served.`;
  sayHow.innerHTML = `<span class="lead"></span><small>${blobs} ${shards}</small>`;
  // As many hosts as the line holds, worst first; the count says the rest and the table lists them.
  const lead1 = $(".lead", sayHow);
  for (let k = Math.min(lows.length, LOW_MAX); k >= 0; k--) { lead1.innerHTML = line1(k); if (lead1.scrollWidth <= lead1.clientWidth) break; }

  // Only stated while the data bears it out, on this network, at this read.
  const quiet = n.validators.filter((v) => v.has_host && v.readiness === "not_reported"), working = quiet.length && quiet.every((v) => v.signing?.signed > 0 && v.reach?.num > 0);
  notes.innerHTML = `<p>A check only tests the connection, and a miss alone does not stop a blob. A shard is a piece of a blob, read back from a host that endorsed it. Bold marks a figure under 99%.</p>`
    + `<p>Ready means the host says it can take uploads now. ≥ means some hosts do not report${working ? "; they still sign and serve" : ""}.${V.src.some((g) => !readyKnown(g)) ? " – means next to nothing is ready and the rest does not report." : ""}</p>`;
}

/* ---------- ring: one arc per validator on a track ---------- */
const C = 250, R0 = 208, R1 = 242, LIFT = 8, MID = (R0 + R1) / 2;
// The tail starts on a wider seam, so the descent ends there.
const SEAM_TAIL = 9.4, SEAM_PX = 6;
const ringSvg = $(".ring", root), centre = $(".centre", root);
const trackC = el("circle", { class: "trk", cx: C, cy: C, r: MID, "stroke-width": R1 - R0 }, ringSvg);
const gArcs = el("g", {}, ringSvg), gSep = el("g", { "pointer-events": "none", fill: "none", stroke: "var(--card)" }, ringSvg);
const sepG = el("path", {}, gSep), sepE = el("path", { "stroke-width": SEAM_TAIL }, gSep), sepV = el("path", {}, gSep);
const whoBox = $(".whobox", root), namesBox = $(".names", root), ldrs = $(".ldrs", root);
const arcD = (r0, r1, a0, a1) => {
  if (a1 - a0 < 1e-5) return "";
  const la = a1 - a0 > Math.PI ? 1 : 0, s0 = Math.sin(a0), c0 = -Math.cos(a0), s1 = Math.sin(a1), c1 = -Math.cos(a1), f = (x) => x.toFixed(2);
  return `M${f(C + r1 * s0)} ${f(C + r1 * c0)}A${r1} ${r1} 0 ${la} 1 ${f(C + r1 * s1)} ${f(C + r1 * c1)}L${f(C + r0 * s1)} ${f(C + r0 * c1)}A${r0} ${r0} 0 ${la} 0 ${f(C + r0 * s0)} ${f(C + r0 * c0)}Z`;
};
let arcs = new Map(), seq = [], raf = 0;

function ringSeq() {
  const key = keyFn[S.by], groups = new Map();
  N().validators.forEach((v) => { if (v.has_host) { const k = key(v); (groups.get(k) || groups.set(k, []).get(k)).push(v); } });
  const order = (a, b) => b.vp - a.vp, out = [];
  const push = (v, g, sub, tail) => out.push({ v, id: v.valoper, g, sub, tail, up: false, w: S.weigh === "vp" ? v.vp : 1 });
  V.named.forEach((g) => (groups.get(g.key) || []).sort(order).forEach((v) => push(v, g.key, v.company, false)));
  V.unnamed.forEach((g) => (groups.get(g.key) || []).sort(order).forEach((v) => push(v, "others", g.key, true)));
  return out;
}
// Colour says which five; the neutral arc is everything past them.
const arcColour = (s) => pickTone(s.tail ? s.sub : s.g) || (s.tail ? "var(--hosting-tail)" : V.step.get(s.g));
function buildRing() {
  gArcs.textContent = ""; arcs = new Map();
  N().validators.filter((v) => v.has_host).forEach((v) => {
    const p = el("path", { class: "a" }, gArcs), a = { p, a0: 0, a1: 0, r: R1, tr: R1 };
    arcs.set(v.valoper, a);
    p.addEventListener("mouseenter", () => setHot(arcFocus(a.s)));
    p.addEventListener("mousemove", (e) => tipArc(a.s, e));
    p.addEventListener("mouseleave", () => { hideTip(); setHot(null); });
    p.addEventListener("click", () => togglePick(a.s.tail ? a.s.sub : a.s.g));
  });
}
// Outside the ring, on the pointer's side: the head names what the centre names, the rows the validator under the pointer. The ring's left has no room, so there the box goes above or below.
function tipArc(s, e) {
  const x = s.v, b = ringSvg.getBoundingClientRect(), k = b.width / (2 * C), cx = b.left + C * k, cy = b.top + C * k, t = Math.atan2(e.clientX - cx, cy - e.clientY), r = (R1 + LIFT) * k + 10;
  const html = tipHead(arcFocus(s).name, arcColour(s)) + tipRow(x.moniker, sharePct(shareOf(x))) + tipRow(`${short(x.company)} · ${x.city}`);
  tipAt(html, (box) => {
    const px = cx + r * Math.sin(t), py = cy - r * Math.cos(t);
    if (px >= cx || px - box.width >= 8) return [px >= cx ? px : px - box.width, py - box.height * (1 + Math.cos(t)) / 2];
    return [cx - box.width / 2, py < cy ? b.top - box.height - 8 : b.bottom + 8];
  });
}
const arcFocus = (s) => { const g = V.byKey.get(s.tail ? s.sub : s.g); return groupFocus(g, "ring"); };
function layoutRing() {
  seq = ringSeq();
  const tot = S.weigh === "vp" ? N().totals.voting_power : N().validators.length; let c = 0;
  seq.forEach((s) => {
    const a = arcs.get(s.id); a.s = s;
    a.b0 = c / tot * TAU; c += s.w; a.b1 = c / tot * TAU;
    a.a0 = a.b0; a.a1 = a.b1;
    a.r = R1; a.tr = R1;
  });
  ringSvg.setAttribute("aria-label", S.weigh === "vp" ? "Share of voting power" : "Validators with a Fibre host");
  placeNames();
  kick();
}
function kick() { if (!raf) raf = requestAnimationFrame(frame); }
function frame() {
  raf = 0; let more = false;
  seq.forEach((s, i) => {
    const a = arcs.get(s.id);
    if (calm) a.r = a.tr; else { a.r += (a.tr - a.r) * .28; if (Math.abs(a.tr - a.r) > .05) more = true; else a.r = a.tr; }
    // Same-colour neighbours overlap a touch, or antialiasing draws a hairline between them.
    a.p.setAttribute("d", arcD(R0, a.r, a.a0, a.a1 + (a.a1 > a.a0 && i < seq.length - 1 ? .006 : 0)));
  });
  drawSeps();
  if (more) kick();
}
// The tail is one flat arc: it holds a hit target per validator, and a seam only at its two ends.
function drawSeps() {
  const stroke = (a) => { const s = Math.sin(a), c = -Math.cos(a), r0 = R0 - 2, r1 = R1 + LIFT + 2; return `M${(C + r0 * s).toFixed(2)} ${(C + r0 * c).toFixed(2)}L${(C + r1 * s).toFixed(2)} ${(C + r1 * c).toFixed(2)}`; };
  const room = (SEAM_PX * 2 * C / (ringSvg.getBoundingClientRect().width || 264)) / MID;
  let g = "", e = "", v = "", last = -1;
  seq.forEach((s, i) => {
    const a = arcs.get(s.id), prev = seq[i - 1];
    if (a.a1 - a.a0 < 1e-5) return;
    if (!prev || s.g !== prev.g) { if (s.tail) e += stroke(a.a0); else g += stroke(a.a0); last = a.a0; }
    else if (!s.tail && s.up && a.a0 - last >= room) { v += stroke(a.a0); last = a.a0; }
  });
  if (seq.length) g += stroke(arcs.get(seq[seq.length - 1].id).a1);
  sepG.setAttribute("d", g); sepE.setAttribute("d", e); sepV.setAttribute("d", v);
  sepG.setAttribute("stroke-width", 3);
  sepV.setAttribute("stroke-width", 1.6);
}
/* The ring names its coloured slices on leaders that never cross: rows at an even pitch, the ring turned so each slice faces its row and every leader leaves from inside its own slice. */
// LANE: how far past the ring the leaders' level runs end, so a low slice never slides along the ring and no two leaders cross.
const RIGHT_FROM = 5 * DEG, RIGHT_TO = 175 * DEG, ANCHOR_GAP = 5, SNAP = 3, RUN = 10, LANE = 5, SEAM_OFF = 9;
const restFocus = () => {
  const vs = seq.filter((s) => s.tail).map((s) => s.v);
  return { key: "__ring", vs, name: `${V.unnamed.length} others`, share: sum(vs, shareOf), hosts: vs.length, colour: "var(--hosting-tail)", from: "ring" };
};
const wrapAngle = (a) => a - TAU * Math.floor((a + Math.PI) / TAU);
// A leader starts inside its slice, off the seams, on the ring's right, as near its row as that allows; null when the slice has no such spot.
function anchorFor(a0, a1, y, cy, r) {
  const start = wrapAngle(a0), w = a1 - a0, off = Math.min(w / 4, SEAM_OFF / r), from = Math.max(start + off, RIGHT_FROM), to = Math.min(start + w - off, RIGHT_TO);
  if (to < from) return null;
  return Math.max(from, Math.min(to, Math.acos(Math.max(-1, Math.min(1, (cy - y) / r)))));
}
// Every whole degree is tried. A slice's middle left of twelve o'clock or two leaders out of rank rule a turn out; the rest are ranked by how far leaders must climb to their rows.
function bestTurn(parts, ys, cy, r) {
  let best = 0, bestCost = Infinity;
  for (let d = -180; d < 180; d++) {
    const turn = d * DEG; let cost = 0, last = -Infinity;
    parts.forEach(([a0, a1], i) => {
      const mid = wrapAngle((a0 + a1) / 2 + turn), t = anchorFor(a0 + turn, a1 + turn, ys[i], cy, r);
      if (mid < RIGHT_FROM || mid > RIGHT_TO) cost += i ? 1e3 : 1e6;
      if (t == null) { cost += 1e6; return; }
      const y = cy - r * Math.cos(t);
      if (y < last + ANCHOR_GAP) cost += 1e4;
      cost += Math.abs(ys[i] - y); last = y;
    });
    if (cost < bestCost) { bestCost = cost; best = turn; }
  }
  return best;
}
function placeNames() {
  namesBox.textContent = ""; ldrs.textContent = "";
  const b = whoBox.getBoundingClientRect(), r = ringSvg.getBoundingClientRect();
  if (!b.width || !seq.length) return;
  const k = r.width / (2 * C), cx = r.left - b.left + C * k, cy = r.top - b.top + C * k, out = (R1 + 3) * k;
  const rest = seq.filter((s) => s.tail), n = V.named.length, rows = n + (rest.length ? 1 : 0) + 1, pitch = b.height > 240 ? 32 : 23, lx = b.width - namesBox.clientWidth, ex = lx - RUN;
  const parts = V.named.map((g) => { const on = seq.filter((s) => s.g === g.key); return [arcs.get(on[0].id).b0, arcs.get(on.at(-1).id).b1]; });
  // The block of rows centres on the ring, so nothing hangs off its foot.
  const ys = Array.from({ length: rows }, (_, i) => cy + (i - (rows - 1) / 2) * pitch);
  const turn = bestTurn(parts, ys, cy, out), lane = cx + out + LANE;
  seq.forEach((s) => { const a = arcs.get(s.id); a.a0 = a.b0 + turn; a.a1 = a.b1 + turn; });
  kick();
  const items = V.named.map((g, i) => ({ g, y: ys[i], c: `var(--p${i + 1})`, name: nameOf(g), val: weighText(g), a: anchorFor(parts[i][0] + turn, parts[i][1] + turn, ys[i], cy, out) }));
  let at = n;
  if (rest.length) { const f = restFocus(); items.push({ rest: true, y: ys[at++], c: "var(--hosting-tail)", name: f.name, val: S.weigh === "vp" ? sharePct(f.share) : f.hosts }); }
  items.push({ total: true, y: ys[at], name: `All ${V.src.length} ${noun()}`, val: S.weigh === "vp" ? sharePct(shareOf(V.all)) : V.all.hosts });
  S.pitch = pitch;
  items.forEach((it) => {
    const row = document.createElement("div");
    row.className = "nl" + (it.rest ? " oth" : it.total ? " all" : ""); row.style.top = it.y.toFixed(1) + "px";
    row.innerHTML = `${it.c ? `<i style="background:${it.c}"></i>` : ""}<span>${esc(it.name)}</span><b>${it.val}</b>`;
    namesBox.append(row); it.row = row; it.dot = $("i", row);
    if (it.a != null) {
      const x = cx + out * Math.sin(it.a), y = cy - out * Math.cos(it.a), flat = Math.abs(y - it.y) < SNAP;
      it.anchor = { x, y: flat ? it.y : y, ex, lx: lx - 5, ly: it.y };
      it.line = el("path", { d: `M${x.toFixed(1)} ${(flat ? it.y : y).toFixed(1)}${flat ? "" : `L${lane.toFixed(1)} ${y.toFixed(1)}L${ex.toFixed(1)} ${it.y.toFixed(1)}`}L${(lx - 5).toFixed(1)} ${it.y.toFixed(1)}` }, ldrs);
    }
    if (it.total) return;
    const focus = () => (it.rest ? restFocus() : groupFocus(it.g, "ring"));
    row.addEventListener("mouseenter", () => setHot(focus()));
    row.addEventListener("mouseleave", () => setHot(null));
    if (!it.rest) row.addEventListener("click", () => togglePick(it.g.key));
  });
  names = items;
  alignRail();
}
// The region rail keeps the names' rhythm, and its sum sits on their sum's line.
function alignRail() {
  const sum = $(".nl.all", namesBox), rows = regBox.children.length;
  if (!sum || !rows) return;
  const c = sum.getBoundingClientRect(), m = mp.getBoundingClientRect(), y = c.top + c.height / 2 - m.top;
  side.style.setProperty("--pitch", S.pitch + "px");
  side.style.top = y - (rows + .5) * S.pitch + "px";
}
let names = [];
function paintNames(only) {
  names.forEach((it) => {
    const on = !only || it.total || (it.rest ? seq.some((s) => s.tail && only.has(s.v)) : seq.some((s) => s.g === it.g.key && only.has(s.v)));
    it.row.classList.toggle("off", !on); it.line?.classList.toggle("off", !on);
    if (it.dot && it.g) it.dot.style.background = tint(it.g);
  });
}
function paintRing(only) {
  for (const s of seq) {
    const a = arcs.get(s.id), c = arcColour(s);
    s.up = !!only && only.has(s.v);
    a.tr = s.up ? R1 + LIFT : R1;
    a.p.setAttribute("fill", only && !s.up ? "var(--hosting-dim)" : only && s.tail && !pickTone(s.sub) ? TAIL : c);
  }
  paintNames(only);
  kick();
}
// At rest the centre names the whole, not a score of the slices. One stack in both states, so the figure stays put.
function paintCentre(f) {
  const hosts = S.weigh === "hosts", t = N().totals;
  if (!f) {
    centre.innerHTML = `<div class="c-n"></div><div class="c-v">${V.src.length}</div><div class="c-c"><b>${noun()}</b>${hosts ? "by Fibre hosts" : "by voting power"}</div>`;
    return;
  }
  const dot = f.colour ? `<i style="background:${f.colour}"></i>` : "";
  centre.innerHTML = `<div class="c-n">${dot}<span>${esc(f.name)}</span></div><div class="c-v">${hosts ? f.hosts : sharePct(f.share)}</div><div class="c-c">${hosts ? `of ${t.hosts} Fibre hosts` : "of voting power"}</div>`;
}

/* ---------- table marks ---------- */
const CHECK = `<svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.6 6.3 5 8.7l4.4-5"/></svg>`;
const CHEV = `<svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5"/></svg>`;
const CROSS = `<svg viewBox="0 0 10 10" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M2 2l6 6M8 2l-6 6"/></svg>`;

const bar = (f) => `<span class="lb" data-t="list" style="--f:${f.toFixed(4)}"></span>`;
const shortOf = (g) => !!g.win && g.win.n === g.win.of;
const missedText = (g) => `${int(g.failed_checks)} of ${int(g.checks)} missed`;
// Under a name: the validators on it, a host under the mark first with its rate, then by voting power. A short history says so.
function subOf(g, k = SUB_NAMES) {
  const low = g.hosts > 1 ? g.lows : [], all = [...low, ...[...members(g)].filter((v) => !low.includes(v)).sort((a, b) => b.share - a.share)], more = all.length - Math.min(k, all.length);
  const names = all.slice(0, k).map((v) => esc(v.moniker) + (low.includes(v) ? ` <b>${pct(rateOf(v), 2)}</b>` : "")).join(", ");
  return names + (more ? `<span class="mr"> and ${more} more</span>` : "") + (shortOf(g) ? `<span class="sp">, checked since ${g.win.on}</span>` : "");
}
// Past seven hosts single pips stop being countable at one size: a split bar says the same.
const pips = (g) => (g.hosts > PIPS_MAX ? `<span class="spl"><i style="flex:1 1 0"></i></span>` : `<span class="mk pips">${"<u></u>".repeat(g.hosts)}</span>`);

/* ---------- rows ---------- */
const shardText = (g) => `${int(g.not_served)} of ${int(settled(g))}`;
// A share ready is printed as a floor while any host stays silent. With next to nothing ready it says nothing: 0.0% would read as a failure.
const readyText = (g) => (!readyKnown(g) ? "–" : silent(g) ? `≥${readyPct(Math.min(g.ready_share, .999))}` : readyPct(g.ready_share));
const weighText = (g) => (S.weigh === "vp" ? sharePct(shareOf(g)) : g.hosts);
const otherText = (g) => (S.weigh === "vp" ? g.hosts : sharePct(shareOf(g)));
function cells(g) {
  const s = (k) => (S.sort === k ? " srt" : ""), o = S.weigh === "vp" ? "hosts" : "vp", r = g.reachability;
  return `<span class="k-n${s(o)}" data-t="${o}">${otherText(g)}</span>
    <span class="k-g${s("geo")}" data-t="geo">${geoOf(g).length}</span>
    <span class="k-r${s("reach")}${!g.sum && under(g) ? " lo" : ""}" data-t="reach"><b>${r == null ? "–" : pct(r, 2)}</b></span>
    <span class="k-m${s("miss")}" data-t="reach">${int(g.failed_checks)}</span>
    <span class="k-s${s("served")}${g.not_served ? "" : " nil"}" data-t="served"><b>${shardText(g)}</b></span>
    <span class="k-u${s("ready")}" data-t="ready">${g.ready_hosts} of ${g.hosts}</span>
    <span class="k-o${s("unrep")}" data-t="ready">${g.not_reported_hosts}</span>
    <span class="k-v${s("vpready")}${readyKnown(g) ? "" : " nil"}" data-t="ready">${readyText(g)}</span>`;
}
function row(g, kind) {
  const pickable = kind === "lead" || kind === "tail", plain = kind === "sum" || kind === "rest", vb = plain ? "" : bar(weight(g) / V.scale);
  const mark = kind === "rest" ? `<button type="button" class="ex" aria-expanded="${S.open}" aria-label="${S.open ? "Hide" : "Show"} ${esc(g.name)}">${CHEV}</button>` : pickable ? `<button type="button" class="pk" data-t="name" aria-pressed="false" aria-label="Pick ${esc(g.name)}">${CHECK}</button>` : "";
  const code = S.by === "city" && pickable ? `<code>${esc(g.cc)}</code>` : "";
  const rank = V.resting && kind === "lead" ? V.top.indexOf(g) + 1 : "", sub = kind === "sum" || kind === "rest" ? "" : subOf(g);
  return `<div class="tr rw ${kind}${kind === "rest" && S.open ? " opened" : ""}" data-k="${esc(g.key)}"${pickable ? " data-p" : ""} style="--c:${kind === "sum" ? "var(--ink2)" : kind === "rest" ? "var(--ink3)" : rowTone(g)}">
    <span class="k-a">${mark}${kind === "sum" ? "" : `<em>${rank}</em>`}<span class="nm"${pickable ? ' data-t="list"' : ""}>${esc(nameOf(g))}</span>${code}${sub ? `<small class="sub"${pickable ? ' data-t="list"' : ""}>${sub}</small>` : ""}</span>
    <span class="vb${plain ? " plain" : ""}">${vb}<b class="vv${S.sort === S.weigh ? " srt" : ""}" data-t="${S.weigh}">${weighText(g)}</b></span>
    ${cells(g)}</div>`;
}
const firstHead = () => (picks().length === 1 ? "Pick one more" : prov() ? "Provider" : S.by === "country" ? "Country" : "City");
function head() {
  const th = (k, name, cls = "") =>
    `<button type="button" class="h${cls}${S.sort === k ? " on" : ""}${S.sort === k && S.dir > 0 ? " asc" : ""}" data-s="${k}" aria-pressed="${S.sort === k}" aria-label="Sort by ${name}"><span class="h1"><span${HEAD[k] ? ' class="dt"' : ""}>${name}</span></span></button>`;
  const vp = S.weigh === "vp", grp = (name, cls) => `<span class="grp ${cls}">${name}</span>`;
  return `<div class="tr th"><span class="k-a"><span class="fh">${firstHead()}</span></span>${th(S.weigh, vp ? "Voting power" : "Fibre hosts", " wt")}${vp ? th("hosts", "Fibre hosts") : th("vp", "Voting power")}${th("geo", prov() ? "Countries" : "Providers")}${grp(`Checks, ${scope()}`, "g-c")}${th("reach", "Answered")}${th("miss", "Missed")}${grp(`Shards, ${scope()}`, "g-s")}${th("served", "Not served")}${grp("Readiness now", "g-r")}${th("ready", "Hosts ready")}${th("unrep", "Not reported")}${th("vpready", "Voting power ready")}</div>`;
}
function render() {
  model();
  const was = new Map($$(".tr.rw", list).map((r) => [r.dataset.k, r.getBoundingClientRect().top]));
  box.dataset.by = S.by;
  say();
  list.innerHTML = `<div class="top">${head()}${row(V.all, "sum")}</div>`
    + ordered(V.top).map((g) => row(g, "lead")).join("")
    + (V.tail.length ? row(V.rest, "rest") + `<div class="tailbox${S.open ? " open" : ""}"><div>${ordered(V.tail).map((g) => row(g, "tail")).join("")}</div></div>` : "");
  // The way back from an open tail stops under the head, whose height differs by width.
  list.style.setProperty("--top-h", $(".top", list).offsetHeight + "px");
  if (!calm) $$(".tr.rw", list).forEach((r) => {
    const y = was.get(r.dataset.k); if (y == null) return;
    const d = y - r.getBoundingClientRect().top;
    if (Math.abs(d) > 1) r.animate([{ transform: `translateY(${d}px)` }, { transform: "none" }], { duration: 240, easing: "cubic-bezier(.3,.7,.2,1)" });
  });
  syncPicks();
}

/* ---------- picks ---------- */
function togglePick(k) {
  hideTip();
  if (prov()) return pin(k);
  S.picks = S.picks.includes(k) ? S.picks.filter((x) => x !== k) : [...S.picks, k].slice(-MAX_PINS);
  syncPicks(); paint();
}
function clearPicks() {
  S.picks = [];
  if (state.pinned.length) M.set("pinned", []);
  syncPicks(); paint();
}
// A folded row still says what it holds.
function syncRest() {
  const nm = $(".rest .nm", list); if (!nm) return;
  const inTail = S.open ? 0 : picks().filter((k) => V.tailKeys.has(k)).length;
  nm.innerHTML = esc(V.rest.name) + (inTail ? `<small>${inTail} picked</small>` : "");
}
function syncPicks() {
  const p = picks(), open = p.length > 1, was = box.classList.contains("vs");
  $$(".tr[data-p]", list).forEach((r) => { const on = p.includes(r.dataset.k), tone = rowTone(V.byKey.get(r.dataset.k)); r.classList.toggle("on", on); r.style.setProperty("--c", tone); r.style.setProperty("--on", inkOn(tone)); $(".pk", r).setAttribute("aria-pressed", on); });
  clear.hidden = !(state.pinned.length || S.picks.length);
  $(".th .fh", list).textContent = firstHead();
  syncRest();
  box.classList.toggle("vs", open);
  renderVs(p);
  fitVs();
  if (open !== was && !calm) box.animate({ opacity: [.5, 1] }, { duration: 200, easing: "ease-out" });
}
// Only a hover dims: a pick must not grey out the rows still to choose from.
function paintRows() {
  const h = S.hot, set = h && new Set(h.vs); let n = 0;
  $$(".tr.rw:not(.sum)", list).forEach((r) => {
    const g = V.byKey.get(r.dataset.k), on = !!h && (h.key === r.dataset.k || (h.key !== "__rest" && !!g && h.from !== "row" && members(g).some((v) => set.has(v))));
    n += on; r.classList.toggle("lit", on);
  });
  box.classList.toggle("wide", n > 2);
  $$(".vs-col", vs).forEach((c) => c.classList.toggle("hot", !!h && c.dataset.k === h.key));
  box.classList.toggle("focus", !!h);
}

/* ---------- head to head ---------- */
const VS_ROW = 66, VS_ROW_MAX = 104;
const METRIC = () => [["vp", "Voting power"], ["hosts", "Fibre hosts"], ["geo", ""], ["reach", "Checks answered"], ["ready", "Hosts ready"], ["served", "Shards not served"]];
const label = (m) => m[1] || (prov() ? "Countries" : "Providers");
// Value, whether it leads (null on rate rows, where brightening one would read as a verdict), and its mark.
function vsCell(k, g, ps) {
  const top = (f) => Math.max(...ps.map(f));
  if (k === "vp") return [sharePct(shareOf(g)), shareOf(g) === top(shareOf), bar(shareOf(g) / top(shareOf))];
  if (k === "hosts") return [g.hosts, g.hosts === top((p) => p.hosts), pips(g)];
  if (k === "geo") return [geoOf(g).length, geoOf(g).length === top((p) => geoOf(p).length), prov() ? `<span class="chips">${g.countries.map((x) => `<code>${x}</code>`).join("")}</span>` : `<span class="mk dots">${g.companies.map(() => `<u class="c"></u>`).join("")}</span>`];
  if (k === "reach") return [g.reachability == null ? "–" : pct(g.reachability, 2), null, g.reachability == null ? "" : `<small>${missedText(g)}</small>`];
  if (k === "ready") return [`${g.ready_hosts} of ${g.hosts}`, null, `<small>${readyKnown(g) ? `${readyText(g)} of its voting power` : "Voting power not reported"}</small>`];
  return [shardText(g), null, ""];
}
function renderVs(keys) {
  if (keys.length < 2) { vs.innerHTML = ""; return; }
  const ps = keys.map((k) => V.byKey.get(k)).filter(Boolean), metric = METRIC();
  const labels = `<div class="vs-l"><div class="vs-hd"></div>${metric.map((m) => `<div class="vs-m ${m[0]}"><span>${label(m)}</span>${m[2] ? `<em>${m[2]}</em>` : ""}</div>`).join("")}</div>`;
  const cols = ps.map((g) => `<div class="vs-col" data-k="${esc(g.key)}" style="--c:${tint(g)}">
      <div class="vs-hd"><u></u><b>${esc(nameOf(g))}</b><button type="button" class="vs-x" data-x aria-label="Remove ${esc(g.name)}">${CROSS}</button></div>
      ${metric.map(([k]) => { const [v, lead, mark] = vsCell(k, g, ps); return `<div class="vs-m ${k}" data-t="${k}"><b class="${lead === null ? "nt" : lead ? "ld" : ""}">${v}</b>${mark}</div>`; }).join("")}
    </div>`).join("");
  vs.innerHTML = `<div class="vs-g" style="--n:${ps.length}">${labels}${cols}</div>`;
}

// The panel ends on the list's last line, unless an open tail makes that line far off.
function fitVs() {
  // A sub line names as many validators as fit; one that still clips gives up its second part.
  $$(".sub", list).forEach((e) => {
    const g = V.src.find((x) => x.key === e.closest(".rw").dataset.k);
    e.classList.remove("tight");
    for (let k = SUB_NAMES; k > 0; k--) { e.innerHTML = subOf(g, k); if (e.scrollWidth <= e.clientWidth) break; }
    e.classList.toggle("tight", e.scrollWidth > e.clientWidth);
  });
  if (!box.classList.contains("vs")) return;
  const head = $(".vs-hd", vs)?.offsetHeight ?? 0, rows = METRIC().length;
  vs.style.setProperty("--vs-row", (S.open ? VS_ROW : Math.max(VS_ROW, Math.min(VS_ROW_MAX, (list.offsetHeight - head) / rows))) + "px");
}

/* ---------- table tooltips ---------- */
const ccName = (cc) => (N().countries.find((c) => c.cc === cc) || {}).name || cc;
const hd = (g) => tipHead(nameOf(g), g.sum ? null : tint(g));
const worst = (g) => (g.key === "__all" ? V.src : V.tail).filter((x) => x.failed_checks).sort((a, b) => b.failed_checks - a.failed_checks).slice(0, 3);
const hostList = (g) => { const hosts = [...members(g)].sort((a, b) => b.share - a.share), top = hosts.slice(0, TIP_NAMES); return top.map((v) => tipRow(v.moniker, finePct(v.share))).join("") + (hosts.length > TIP_NAMES ? tipRow(`+${hosts.length - TIP_NAMES} more`) : ""); };
const scope = () => servedScope().toLowerCase();
const TIP = {
  name: (g) => hd(g) + (g.country && short(g.country) !== nameOf(g) ? tipRow(short(g.country)) : "") + tipRow(picks().includes(g.key) ? "Picked, click to remove" : `Pick to compare, up to ${MAX_PINS}`),
  list: (g) => hd(g) + hostList(g),
  vp: (g) => hd(g) + tipRow("Voting power", int(g.vp)) + tipRow("Share", finePct(shareOf(g))),
  hosts: (g) => hd(g) + tipRow("Fibre hosts", String(g.hosts)) + tipRow("Of all Fibre hosts", pct(g.host_share)),
  geo: (g) => hd(g) + (g.sum ? tipRow(prov() ? "Countries" : "Providers", String(geoOf(g).length)) : geoOf(g).slice(0, 8).map((x) => tipRow(short(prov() ? ccName(x) : x))).join("") + (geoOf(g).length > 8 ? tipRow(`+${geoOf(g).length - 8} more`) : "")),
  reach: (g) => hd(g) + tipRow(`Answered, ${scope()}`, pct(g.reachability, 2))
    + (g.win ? tipRow("Checked since", g.win.n < g.win.of ? `${g.win.on}, ${g.win.n} of ${g.win.of} hosts` : g.win.on) : "")
    + tipRow("Checks", `${int(g.checks - g.failed_checks)} of ${int(g.checks)}`) + tipRow("Missed", int(g.failed_checks))
    + (g.key !== "__all" && V.all.failed_checks ? tipRow("Of all missed", pct(g.failed_checks / V.all.failed_checks)) : "")
    + (g.sum && worst(g).length ? tipRow("Most missed") + worst(g).map((x) => tipRow(nameOf(x), int(x.failed_checks))).join("") : ""),
  ready: (g) => hd(g) + tipRow("Hosts ready", `${g.ready_hosts} of ${g.hosts}`) + (g.not_ready_hosts ? tipRow("Not ready", String(g.not_ready_hosts)) : "") + (g.not_reported_hosts ? tipRow("Not reported", String(g.not_reported_hosts)) : "")
    + tipRow(g.key === "__all" ? "Of hosted voting power, ready" : "Of its voting power, ready", readyKnown(g) ? readyPct(g.ready_share) : "under 0.1%") + (g.rep < g.vp ? tipRow("Not reported", readyPct(1 - g.rep / g.vp)) : "") + (g.key === "__all" ? tipRow("Of all voting power, ready", pct(N().totals.ready_vp_share)) : ""),
  served: (g) => { const open = g.shards - settled(g); return hd(g) + tipRow(`Not served, ${scope()}`, shardText(g)) + tipRow("Shards served", srateText(g)) + (open > 0 ? tipRow("Pending or not counted", int(open)) : ""); },
};
const HEAD = {
  reach: () => tipHead("Checks answered") + tipRow("A connection to each host every five minutes, no data asked for") + tipRow("Period", scope()) + tipRow("Tensile's mark, not a protocol rule", pct(MARK, 0)),
  miss: () => tipHead("Checks missed") + tipRow("Checks the host did not answer") + tipRow("Period", scope()),
  ready: () => tipHead("Hosts ready") + tipRow("Hosts that report their app node, signer, registration and store all pass"),
  unrep: () => tipHead("Not reported") + tipRow("Hosts that do not report readiness. It is not a failure."),
  vpready: () => tipHead("Voting power ready") + tipRow("Share of this row's voting power on hosts that report ready") + tipRow("≥ means some hosts do not report, so the share may be higher") + tipRow("– means next to nothing is ready and the rest does not report"),
  served: () => tipHead("Shards not served") + tipRow("A shard is a piece of a blob, read back from a host that endorsed it. Not served means that host did not return it.") + tipRow("Period", scope()),
};
function tipMove(e, keyAt) {
  const c = e.target.closest("[data-t]");
  if (!c) return hideTip();
  const k = keyAt(c), g = k && V.byKey.get(k);
  if (!g) return;
  if (c.dataset.t !== "name") return showTip(TIP[c.dataset.t](g, c), e.clientX, e.clientY);
  // The pick hint stands clear of the name it is about.
  const b = c.closest(".k-a").getBoundingClientRect();
  showTip(TIP.name(g, c), b.right - 14, b.top - 14);
}

/* ---------- table wiring ---------- */
function rowHover(k) {
  if ((S.hot ? S.hot.key : null) === k && (!S.hot || S.hot.from === "row")) return;
  setHot(k ? groupFocus(V.byKey.get(k), "row") : null);
}
function toggleRest(r) {
  const tb = $(".tailbox", list), y = r.getBoundingClientRect().top;
  // Closing from deep in the tail must not drop the reader past the table.
  const stuck = S.open && tb.getBoundingClientRect().top < y;
  S.open = !S.open;
  if (stuck) tb.style.transition = "none";
  tb.classList.toggle("open", S.open);
  r.classList.toggle("opened", S.open);
  if (stuck) { scrollBy(0, r.getBoundingClientRect().top - y); tb.style.transition = ""; }
  const ex = $(".ex", r); ex.setAttribute("aria-expanded", S.open); ex.setAttribute("aria-label", `${S.open ? "Hide" : "Show"} ${V.rest.name}`);
  syncRest();
  fitVs();
}
list.addEventListener("click", (e) => {
  const h = e.target.closest("[data-s]");
  if (h) {
    const k = h.dataset.s;
    if (S.sort === k) S.dir *= -1; else { S.sort = k; S.dir = WORST_LOW.has(k) ? 1 : -1; }
    render(); if (S.hot) paint();
    if (e.detail === 0) $(`[data-s="${k}"]`, list).focus({ preventScroll: true });
    return;
  }
  const r = e.target.closest(".tr");
  if (!r) return;
  if (r.classList.contains("rest")) return toggleRest(r);
  if (r.hasAttribute("data-p")) togglePick(r.dataset.k);
});
list.addEventListener("mouseover", (e) => { const r = e.target.closest(".tr.rw:not(.sum)"); rowHover(r ? r.dataset.k : null); });
list.addEventListener("mousemove", (e) => {
  const h = e.target.closest("[data-s]"), tip = h && HEAD[h.dataset.s];
  if (tip) showTip(tip(), e.clientX, e.clientY); else tipMove(e, (c) => c.closest(".tr")?.dataset.k);
});
list.addEventListener("mouseleave", () => { rowHover(null); hideTip(); });
// A clicked row keeps focus, so only keyboard focus may light or clear a row.
list.addEventListener("focusin", (e) => { const r = e.target.matches(":focus-visible") && e.target.closest(".tr[data-p]"); if (r) { S.kbd = true; rowHover(r.dataset.k); } });
list.addEventListener("focusout", () => { if (S.kbd) { S.kbd = false; rowHover(null); } });
vs.addEventListener("click", (e) => { const x = e.target.closest("[data-x]"); if (x) togglePick(x.closest(".vs-col").dataset.k); });
vs.addEventListener("mouseover", (e) => rowHover(e.target.closest(".vs-col")?.dataset.k ?? null));
vs.addEventListener("mousemove", (e) => tipMove(e, (c) => c.closest(".vs-col")?.dataset.k));
vs.addEventListener("mouseleave", () => { rowHover(null); hideTip(); });
clear.addEventListener("click", clearPicks);
/* ---------- map ---------- */
// World units: all the land. The band has a sentence above it now, so a crop would read as a cut across the card.
// EDGE: land stops this far from the card's text edge. RAIL_GAP: what the westmost mark keeps from the rail, past RAIL_R, the room its disc and ring take.
const LANDS = { x0: 14, y0: 5, x1: 4777, y1: 2100 }, EDGE = 4, RAIL_GAP = 12, RAIL_R = 8, SMALL = 640;
// SAME: how close two cities must sit to be one point on the map. Anything further apart stays two discs, overlapping if it must.
// HIT: how far past its edge a mark answers, HIT_MIN how near its centre at least.
const K = 23, RMIN = 2.6, SAME = 16, HIT = 3, HIT_MIN = 6, LABEL_MIN = .03, LABEL_TOP = 4, LABEL_TOP_NARROW = 3, NARROW = 800, BIG = .045;
const LAND = new Path2D(WORLD.countries.map((c) => c[1]).join(""));
const mp = $(".mp", root), canvas = $("canvas", mp), svg = $("svg", mp), side = $(".mside", root), keyBox = $(".mkey", root), regBox = $(".mreg", root), regHead = $(".mhd", root);
const P = { w: 0, h: 0, cam: { s: 1, x: 0, y: 0 }, layers: null, marks: [], iso: [], boxes: [], isoBoxes: [], over: null, mask: null };
const rOf = (s) => Math.max(RMIN, K * Math.sqrt(s));
// A mark weighs what the table weighs.
const vShare = (v) => (S.weigh === "vp" ? shareOf(v) : 1 / N().totals.hosts);

let geo = { cities: [] };
function buildGeo() {
  const byKey = new Map();
  const cities = N().cities.map((c) => {
    const [wx, wy] = WORLD.project(c.lon, c.lat), g = { c, k: c.name + "|" + c.cc, wx, wy, vs: [] };
    byKey.set(g.k, g); return g;
  });
  N().validators.forEach((v) => { const g = v.has_host && byKey.get(v.city + "|" + v.cc); if (g) g.vs.push(v); });
  geo = { cities };
}
function frameCam() {
  P.w = mp.clientWidth; P.h = mp.clientHeight;
  // The land hangs from the right edge, at the scale that keeps every mark off the rail: the rail then has the Pacific in any weighing.
  const bh = LANDS.y1 - LANDS.y0, west = Math.min(...geo.cities.filter((g) => g.vs.length).map((g) => g.wx));
  const s = Math.min(P.h / bh, (P.w - EDGE - side.offsetWidth - RAIL_GAP - RAIL_R) / (LANDS.x1 - west));
  P.cam = { s, x: LANDS.x1 - (P.w - EDGE) / s, y: LANDS.y0 - (P.h - bh * s) / 2 / s };
}
const at = (wx, wy) => ({ x: (wx - P.cam.x) * P.cam.s, y: (wy - P.cam.y) * P.cam.s });
function drawLand() {
  const dpr = Math.min(devicePixelRatio || 1, 2), x = canvas.getContext("2d", { willReadFrequently: true }), c = P.cam;
  canvas.width = Math.round(P.w * dpr); canvas.height = Math.round(P.h * dpr);
  x.setTransform(dpr * c.s, 0, 0, dpr * c.s, -c.x * c.s * dpr, -c.y * c.s * dpr);
  x.fillStyle = token("--land"); x.fill(LAND);
  P.mask = { w: canvas.width, dpr, data: x.getImageData(0, 0, canvas.width, canvas.height).data };
}
const onLand = (x, y) => { const m = P.mask, i = Math.round(y * m.dpr) * m.w + Math.round(x * m.dpr); return m.data[i * 4 + 3] > 0; };

// Places on one point join the biggest of them, sized by their sum.
function marksOf(list) {
  const ms = [];
  for (const { g, vs, share } of [...list].sort((a, b) => b.share - a.share)) {
    const host = ms.find((m) => Math.hypot(m.wx - g.wx, m.wy - g.wy) < SAME);
    if (host) { host.share += share; host.vs.push(...vs); host.cities.push({ g, share }); host.r = rOf(host.share); }
    else ms.push({ wx: g.wx, wy: g.wy, share, vs: [...vs], cities: [{ g, share }], r: rOf(share) });
  }
  return ms.sort((a, b) => b.share - a.share).map((m) => {
    m.cities.sort((a, b) => b.share - a.share);
    const head = m.cities[0].g, more = m.cities.length - 1, named = more ? `${head.c.name} +${more}` : head.c.name;
    return { ...m, ...at(head.wx, head.wy), head, vp: sum(m.vs, shareOf), low: m.vs.some(lowHost), name: named };
  });
}
function drawMark(host, m, colour, i) {
  const top = el("g", { class: "m", transform: `translate(${m.x.toFixed(1)} ${m.y.toFixed(1)})` }, host);
  top.mark = m;
  el("circle", { class: "mi", r: m.r.toFixed(2), fill: colour }, top).style.setProperty("--i", i);
}
// In their own layer over every disc: a ring is the one mark no neighbour may cover.
function drawRing(host, m) {
  const top = el("g", { class: "m", transform: `translate(${m.x.toFixed(1)} ${m.y.toFixed(1)})` }, host);
  top.mark = m;
  el("circle", { class: "lo", r: LOW_R }, top);
}
function drawBase() {
  svg.textContent = ""; svg.setAttribute("viewBox", `0 0 ${P.w} ${P.h}`);
  P.layers = { base: el("g", { class: "base" }, svg), rings: el("g", { class: "rings" }, svg), iso: el("g", { class: "iso-l" }, svg), labs: el("g", { class: "labs" }, svg), isoLabs: el("g", { class: "iso-l" }, svg) };
  P.marks = marksOf(geo.cities.map((g) => ({ g, vs: g.vs, share: sum(g.vs, vShare) })));
  P.iso = []; P.boxes = []; P.isoBoxes = []; P.over = null;
  // Biggest first, so a small city is never under a bigger neighbour.
  P.marks.forEach((m, i) => { drawMark(P.layers.base, m, "var(--acc)", i); if (m.low) drawRing(P.layers.rings, m); });
  placeLabels(P.marks.filter((m) => m.share >= LABEL_MIN).slice(0, P.w < NARROW ? LABEL_TOP_NARROW : LABEL_TOP), P.layers.labs, P.boxes, P.marks, true);
}

/* ---------- labels: marks never move, a label finds room around its mark ---------- */
function reserved() {
  const m = mp.getBoundingClientRect(), b = side.getBoundingClientRect();
  return [{ x0: b.left - m.left, x1: b.right - m.left + RAIL_CLEAR, y0: b.top - m.top, y1: b.bottom - m.top }];
}
const ANGLES = [0, 180, -90, 90, -45, 45, -135, 135, 60, 120, -60, -120, 30, 150, -30, -150, 75, 105, -75, -105, 15, 165, -15, -165], GAPS = [5, 14, 24, 36, 50, 66], NO_LINE = 6, LINE_CLEAR = 24;
// The big cities take the top, so the crowd around them keeps its sides.
const ANGLES_BIG = [-90, -135, ...ANGLES.filter((a) => a !== -90 && a !== -135)];
// COAST: text across a coast loses both edges, so a clean spot is worth this many px. LEAD: a leader at all costs this many.
// ORDER: a price on two column labels read against their size. LOW_R: one ring size for every place, so size stays voting power on the disc alone.
const LINE_T = Array.from({ length: 17 }, (_, i) => i / 16), LABEL_H = 16, COAST = 8, LEAD = 12, SPOTS = 40, BUDGET = 40000, LINE_MAX = 60, RAIL_CLEAR = 32, ORDER = 30, LOW_R = 5.5;
// Europe's labels have the North Atlantic: a right-aligned column off Ireland, on rows ATL_Y apart.
const ATL_LON = -24, ATL_LAT = 50, ATL_Y = 6, ATL_TOP = 14, ATL_ROWS = 22, ATL_PULL = 30;
const along = (l, t) => [l.x1 + (l.x2 - l.x1) * t, l.y1 + (l.y2 - l.y1) * t];
const inBox = (x, y, b) => x > b.x0 - 3 && x < b.x1 + 3 && y > b.y0 - 2 && y < b.y1 + 2;
const lineOnBox = (l, b) => LINE_T.some((t) => inBox(...along(l, t), b));
const boxesMeet = (a, b) => a.x0 < b.x1 + 10 && a.x1 > b.x0 - 10 && a.y0 < b.y1 + 1 && a.y1 > b.y0 - 1;
const turn = (q, x, y) => Math.sign((q.x2 - q.x1) * (y - q.y1) - (q.y2 - q.y1) * (x - q.x1));
const crosses = (l, q) => turn(l, q.x1, q.y1) !== turn(l, q.x2, q.y2) && turn(q, l.x1, l.y1) !== turn(q, l.x2, l.y2);
const reach = (l) => (l ? LEAD + Math.hypot(l.x2 - l.x1, l.y2 - l.y1) : 0);

// Every place a label may stand, given the marks and the side list, cheapest first.
function spotsFor({ d, w }, around, boxes, inland = false, clear = 2) {
  const edge = (m) => Math.max(m.r, m.low ? LOW_R : 0);
  const hitMark = (a) => around.some((m) => {
    const cx = Math.max(a.x0, Math.min(m.x, a.x1)), cy = Math.max(a.y0, Math.min(m.y, a.y1));
    // A label that ends beside another mark reads as that mark's.
    return Math.hypot(m.x - cx, m.y - cy) < edge(m) + (m === d ? 2 : P.w < SMALL ? 4 : 6);
  });
  // A leader through a disc says the label might be that disc's.
  const lineOnMark = (l) => around.some((m) => m !== d && LINE_T.some((t) => { const [x, y] = along(l, t); return Math.hypot(x - m.x, y - m.y) < m.r + clear; }));
  // A mark in the label's line reads as part of the sentence.
  const inLine = (a) => around.some((m) => m !== d && Math.abs(m.y - (a.y0 + a.y1) / 2) < m.r + LABEL_H / 2 && m.x > a.x0 - LINE_CLEAR && m.x < a.x1 + LINE_CLEAR);
  const boxDist = (a, m) => Math.hypot(m.x - Math.max(a.x0, Math.min(m.x, a.x1)), m.y - Math.max(a.y0, Math.min(m.y, a.y1))) - m.r;
  const nearestIs = (a) => around.every((m) => boxDist(a, m) >= boxDist(a, d));
  const wet = (a) => { const y = (a.y0 + a.y1) / 2; let sea = 0, n = 0; for (let x = a.x0; x <= a.x1; x += 6) { sea += !onLand(x, y); n++; } return sea / n; };
  const onCoast = (a) => { const f = wet(a); return f > 0 && f < 1; };
  const out = [];
  for (const gap of GAPS) for (const deg of d.share >= BIG ? ANGLES_BIG : ANGLES) {
    const c = Math.cos(deg * Math.PI / 180), s = Math.sin(deg * Math.PI / 180), ex = d.x + (d.r + gap) * c, ey = d.y + (d.r + gap) * s;
    const a = Math.abs(c) < .2 ? "middle" : c > 0 ? "start" : "end", wanted = a === "start" ? ex : a === "end" ? ex - w : ex - w / 2;
    // By the map's edge a label slides in along its side instead of giving the side up.
    const x0 = Math.max(8, Math.min(wanted, P.w - 8 - w)), cy = a === "middle" ? ey + Math.sign(s) * LABEL_H / 2 : ey, box = { x0, x1: x0 + w, y0: cy - LABEL_H / 2, y1: cy + LABEL_H / 2 };
    if (box.y0 < 6 || box.y1 > P.h - 6 || boxes.some((b) => boxesMeet(box, b)) || hitMark(box) || inLine(box)) continue;
    if (gap <= NO_LINE && !nearestIs(box)) continue;
    const line = gap > NO_LINE ? { x1: d.x + (edge(d) + 1) * c, y1: d.y + (edge(d) + 1) * s, x2: ex - 2 * c, y2: ey - 2 * s } : null;
    if (line && (boxes.some((b) => lineOnBox(line, b)) || lineOnMark(line) || reach(line) - LEAD > LINE_MAX)) continue;
    // Far from its mark a label over land reads as that land's.
    if (line && !inland && wet(box) < .5) continue;
    out.push({ box, x: x0 + (a === "end" ? 4 : a === "middle" ? 2 : 0), y: cy, line, cost: reach(line) + (onCoast(box) ? COAST : 0) });
  }
  const [ax] = WORLD.project(ATL_LON, ATL_LAT), right = at(ax, 0).x;
  for (let k = 0; k < ATL_ROWS; k++) {
    // A nearly level leader is drawn level.
    const row = ATL_TOP + k * ATL_Y, y = Math.abs(row - d.y) < ATL_Y ? d.y : row, x0 = right - w, box = { x0, x1: right, y0: y - LABEL_H / 2, y1: y + LABEL_H / 2 }, dx = right + 2 - d.x, dy = y - d.y, len = Math.hypot(dx, dy);
    if (dx >= 0 || x0 < 8 || len <= edge(d) + 2) continue;
    if (boxes.some((b) => boxesMeet(box, b)) || hitMark(box)) continue;
    const line = { x1: d.x + (edge(d) + 1) * dx / len, y1: d.y + (edge(d) + 1) * dy / len, x2: right + 2, y2: y };
    if (boxes.some((b) => lineOnBox(line, b)) || lineOnMark(line)) continue;
    out.push({ box, x: x0 + 4, y, line, cost: reach(line) - ATL_PULL, atl: true });
  }
  return out.sort((a, b) => a.cost - b.cost).slice(0, SPOTS);
}
// The cheapest seating of every label; loose, a label may stay out at a price that grows with its size. Bounded, so a crowded focus never stalls a hover.
function seat(items, strict) {
  const clash = (a, b) => boxesMeet(a.box, b.box) || (a.line && lineOnBox(a.line, b.box)) || (b.line && lineOnBox(b.line, a.box)) || (a.line && b.line && crosses(a.line, b.line));
  let best = null, bestCost = Infinity, steps = 0;
  const go = (i, cost, taken) => {
    if (cost >= bestCost || steps > BUDGET) return;
    if (i === items.length) { best = new Map(taken); bestCost = cost; return; }
    const it = items[i];
    for (const s of it.spots) {
      steps++;
      if ([...taken.values()].some((o) => clash(s, o))) continue;
      // The column reads top down, so a smaller place above a bigger one costs extra.
      const out = s.atl && [...taken.values()].some((o) => o.atl && s.y < o.y);
      taken.set(it, s); go(i + 1, cost + s.cost + (out ? ORDER : 0), taken); taken.delete(it);
    }
    if (!strict) go(i + 1, cost + 300 + it.d.share * 2000, taken);
  };
  go(0, 0, new Map());
  return best;
}
// strict: the labels shown are always the k biggest, so a small place never speaks over a bigger one.
function placeLabels(marks, layer, seats, around, strict = false) {
  const boxes = reserved();
  const items = marks.map((d) => {
    const t = el("text", { class: "lab " + (d.share >= BIG ? "t1" : d.share < .01 ? "t3" : "t2") }, layer), nm = el("tspan", {}, t), v = el("tspan", { class: "v", dx: 4 }, t);
    t.mark = d; nm.textContent = d.name; v.textContent = S.weigh === "hosts" ? d.vs.length : sharePct(d.share);
    const it = { d, t, w: t.getBBox().width + 4 };
    it.spots = spotsFor(it, around, boxes);
    return it;
  });
  const seatMost = () => { for (let k = items.length; k > 0; k--) { const b = seat(items.slice(0, k), strict); if (b) return b; } return null; };
  // Room first at sea and clear of every disc; in a crowd a leader may graze one, and only then may it pass a disc that touches its own.
  let best = null;
  for (const [inland, clear] of [[false, 2], [false, 0], [true, 0], [true, -2.5]]) {
    items.forEach((it) => { it.spots = spotsFor(it, around, boxes, inland, clear); });
    const b = seatMost();
    if (b && (!best || b.size > best.size)) best = b;
    if (best?.size === items.length) break;
  }
  items.forEach((it) => {
    const s = best?.get(it);
    if (!s) { it.t.remove(); return; }
    it.t.setAttribute("x", s.x.toFixed(1)); it.t.setAttribute("y", s.y.toFixed(1));
    if (s.line) el("line", { class: "ldr", x1: s.line.x1.toFixed(1), y1: s.line.y1.toFixed(1), x2: s.line.x2.toFixed(1), y2: s.line.y2.toFixed(1) }, layer).mark = it.d;
    // A label answers to the pointer as its mark does.
    seats.push({ box: s.box, mark: it.d });
  });
}

/* ---------- map hover: one test by geometry, so paint order never hides a mark ---------- */
function markUnder(x, y) {
  let best = null, gap = Infinity;
  for (const m of [...P.iso, ...P.marks.filter((o) => !o.gone)]) { const d = Math.hypot(m.x - x, m.y - y); if (d <= Math.max(m.r + HIT, HIT_MIN) && d < gap) { best = m; gap = d; } }
  return best || (P.iso.length ? P.isoBoxes : P.boxes).find((b) => inBox(x, y, b.box))?.mark || null;
}
function overMark(m) {
  if (m === P.over) return;
  P.over = m; S.city = m;
  setHot(m && { vs: m.vs, name: m.name, share: m.vp, hosts: m.vs.length, colour: "var(--acc)", from: "map" });
  heat();
}
mp.addEventListener("mousemove", (e) => {
  // The region list has its own hover; it only has to take over from a mark.
  if (e.target.closest(".mreg")) { P.over = null; S.city = null; return; }
  const r = mp.getBoundingClientRect(), m = markUnder(e.clientX - r.left, e.clientY - r.top);
  overMark(m);
  if (m) showTip(tipMark(m), e.clientX, e.clientY); else hideTip();
});
mp.addEventListener("mouseleave", () => { overMark(null); hideTip(); });
function regionFocus(name) {
  const f = held(), only = f && new Set(f.vs), vs = N().validators.filter((v) => v.has_host && regionOf(v.cc) === name && (!only || only.has(v)));
  return { vs, name, share: sum(vs, (v) => v.share), hosts: vs.length, from: "map" };
}
function regionTip(name, e) {
  const f = held(), only = f && new Set(f.vs), r = regions(only ? (v) => only.has(v) : undefined).find((x) => x.name === name);
  if (r) showTip(tipHead(name) + tipRow("Voting power", sharePct(r.share)) + tipRow("Fibre hosts", r.hosts) + tipRow("Countries", r.countries) + tipRow("Cities", r.cities), e.clientX, e.clientY);
}
function heat() {
  const m = S.city, live = !!(m || S.region); let n = 0;
  const isLit = (d) => (S.region ? d.cities.some((c) => regionOf(c.g.c.cc) === S.region) : d === m);
  $$(".m, .lab, .ldr", svg).forEach((e) => { const hit = live && isLit(e.mark); n += hit; e.classList.toggle("on", hit); });
  svg.classList.toggle("hot", n > 0);
  regBox.classList.toggle("hot", !!S.region);
  $$("[data-r]", regBox).forEach((e) => e.classList.toggle("on", e.dataset.r === S.region));
}
// Every city of a merged mark and every validator on a mark is named; a long list takes two columns. Two decimals throughout, so parts add up to the whole.
function tipMark(m) {
  const list = (rows) => { const html = rows.map(([k, w]) => tipRow(k, finePct(w))).join(""); return rows.length > 6 ? `<div class="cols">${html}</div>` : html; };
  const lows = m.vs.filter(lowHost).sort((a, b) => rateOf(a) - rateOf(b)).map((v) => tipRow(`${v.moniker}, checks answered`, pct(rateOf(v), 2))).join("");
  const base = tipRow("Voting power", finePct(m.vp)) + tipRow("Fibre hosts", m.vs.length), names = list([...m.vs].sort((a, b) => shareOf(b) - shareOf(a)).map((v) => [v.moniker, shareOf(v)]));
  if (m.cities.length > 1) return tipHead(m.name) + base + list(m.cities.map((c) => [c.g.c.name, sum(c.g.vs, shareOf)])) + names + lows;
  const place = short(m.head.c.country);
  return tipHead(m.name) + (place.includes(m.head.c.name) ? "" : tipRow(place)) + base + names + lows;
}

/* ---------- map focus ---------- */
// A focused city shows only what is in focus, so its full mark steps aside.
function drawIso(f) {
  const only = f && new Set(f.vs), L = P.layers, focus = only ? geo.cities.map((g) => { const vs = g.vs.filter((v) => only.has(v)); return { g, vs, share: sum(vs, vShare) }; }).filter((x) => x.vs.length) : [];
  const keys = new Set(focus.map((x) => x.g.k));
  svg.classList.toggle("iso", !!only);
  L.iso.textContent = ""; L.isoLabs.textContent = ""; P.iso = []; P.isoBoxes = [];
  P.marks.forEach((m) => { m.gone = m.cities.some((c) => keys.has(c.g.k)); });
  [...$$(".m", L.base), ...$$(".m", L.rings)].forEach((e) => e.classList.toggle("gone", e.mark.gone));
  if (!only) return;
  const marks = marksOf(focus);
  // One teal holds in focus too: a deep step would vanish on the land. Only picks need telling apart.
  const toneOf = (m) => (f.colour ? "var(--acc)" : tint(V.byKey.get(keyFn[S.by]([...m.vs].sort((a, b) => b.share - a.share)[0]))));
  marks.forEach((m, i) => drawMark(L.iso, m, toneOf(m), i));
  P.iso = marks;
  // A big group keeps the rest-state rule; a small one names every place it has.
  placeLabels(marks.filter((m) => marks.length <= 14 || m.share >= LABEL_MIN).slice(0, 8), L.isoLabs, P.isoBoxes, marks);
}
// Fixed rows in the biggest-first order, so a focus changes the figures and nothing moves. One track means the whole, so a short bar reads as short, and the last row sums them.
function drawRegions(only) {
  const part = new Map(regions(only ? (v) => only.has(v) : undefined).map((r) => [r.name, r])), hosts = S.weigh === "hosts", total = N().totals.hosts;
  const all = regions().sort((a, b) => (hosts ? b.hosts - a.hosts : 0) || b.share - a.share), shown = [...part.values()];
  regBox.innerHTML = all.map((r) => {
    const p = part.get(r.name), v = p ? (hosts ? p.hosts : sharePct(p.share)) : "–", f = p ? (hosts ? p.hosts / total : p.share) : 0;
    return `<div data-r="${esc(r.name)}"${p ? "" : ' class="no"'}><span>${esc(r.name)}</span><b>${v}</b><u style="--f:${f.toFixed(4)}"></u></div>`;
  }).join("") + `<div class="sum"><span>All regions</span><b>${hosts ? sum(shown, (r) => r.hosts) : sharePct(sum(shown, (r) => r.share))}</b></div>`;
}
function paintMap(f) {
  const only = f && new Set(f.vs), sig = only ? [...only].map((v) => v.valoper).sort().join() + (f.colour || "") : "";
  if (sig === S.sig) return;
  S.sig = sig; S.city = null;
  drawIso(f); drawRegions(only); heat();
}
function renderKey() {
  const vp = S.weigh === "vp", name = vp ? "Voting power" : "Fibre hosts", total = N().totals.hosts;
  regHead.textContent = `${name} by region`;
  keyBox.textContent = "";
  const steps = vp ? [[.03, "≤3%"], [.06, "6%"], [.12, "12%"]] : [[1 / total, "1"], [4 / total, "4"], [9 / total, "9"]];
  steps.forEach(([s, label]) => {
    const r = rOf(s), d = Math.ceil(2 * r) + 2, ks = el("svg", { width: d, height: d, viewBox: `${-d / 2} ${-d / 2} ${d} ${d}`, "aria-hidden": "true" }, keyBox);
    el("circle", { r }, ks); keyBox.insertAdjacentHTML("beforeend", `<span>${label}</span>`);
  });
  keyBox.insertAdjacentHTML("beforeend", `<span class="of">${vp ? "of voting power" : "Fibre hosts"}</span>`);
  if (N().validators.some((v) => v.has_host && lowHost(v))) keyBox.insertAdjacentHTML("beforeend", `<div class="mlow"><i></i><span>a place with a host under 99%<span class="sp"> of checks</span></span></div>`);
}
function draw() {
  svg.setAttribute("aria-label", `World map of Fibre hosts, sized by ${S.weigh === "vp" ? "voting power" : "number of hosts"}`);
  renderKey(); drawRegions(null); alignRail();
  frameCam(); drawLand(); drawBase();
  // Marks under a resting pointer are gone now and will never send mouseleave.
  S.region = null; S.city = null; S.sig = "\0"; P.over = null; hideTip();
  paintMap(S.hot || held());
}

regBox.addEventListener("mouseover", (e) => {
  const name = e.target.closest("[data-r]:not(.no)")?.dataset.r;
  if (!name || name === S.region) return;
  S.region = name; setHot(regionFocus(name)); heat();
});
regBox.addEventListener("mousemove", (e) => { const name = e.target.closest("[data-r]:not(.no)")?.dataset.r; if (name) regionTip(name, e); });
regBox.addEventListener("mouseleave", () => { S.region = null; hideTip(); setHot(null); heat(); });

/* ---------- controls ---------- */
// Group order changes on every switch, so arcs would cross the ring: fade the new state in.
function regroup() {
  S.hot = null; S.open = false;
  render(); layoutRing(); paint();
  if (!calm) [$(".ringbox", root), list].forEach((b) => b.animate([{ opacity: .25 }, { opacity: 1 }], { duration: 200, easing: "ease-out" }));
}
const segBy = seg("#hs-by", [["provider", "Provider"], ["country", "Country"], ["city", "City"]], () => S.by, (v) => { S.by = v; S.picks = []; if (state.pinned.length) M.set("pinned", []); regroup(); draw(); });
const segWeigh = seg("#hs-weigh", [["vp", "Voting power"], ["hosts", "Fibre hosts"]], () => S.weigh, (v) => { if (S.sort === S.weigh) { S.sort = v; S.dir = -1; } S.weigh = v; regroup(); draw(); });

on("pinned", () => { if (V) { syncPicks(); paint(); } });
on("resize", () => { if (root.clientWidth === S.width) return; S.width = root.clientWidth; render(); placeNames(); draw(); paint(); });
area("hosting", (why) => {
  if (why === "win") return;
  if (why === "theme") { drawLand(); paint(); return; }
  // A new network opens on the resting view, as Publishers does.
  if (why === "net") { Object.assign(S, { by: "provider", weigh: "vp", sort: "vp", dir: -1, hot: null, open: false, picks: [], city: null, region: null }); segBy.sync(); segWeigh.sync(); }
  paintLine(); render(); buildRing(); layoutRing(); buildGeo(); draw(); paint();
});
if (!calm) {
  const stage = $(".band", root), watch = new IntersectionObserver((seen) => {
    if (!seen.some((e) => e.isIntersecting)) return;
    watch.disconnect(); stage.classList.add("enter"); setTimeout(() => stage.classList.remove("enter"), 1500);
  }, { threshold: .35 });
  watch.observe(stage);
}
// Label widths are measured, so they settle once the page font is in.
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { fitVs(); if (geo.cities.length) { say(); draw(); paint(); } });
} catch (e) { console.error("hosting failed:", e); }

M.boot();
return () => { stop.abort(); shadow.replaceChildren(); };
};
